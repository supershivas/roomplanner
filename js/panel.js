// Panneau latéral : ajout, propriétés, pièce, éclairage, rendu 3D et liste des éléments.
import { store } from './store.js';
import {
  OBJECT_TYPES, LIGHT_TYPES, FLOORS, PALETTE, AMBIANCES, WALL_DEFAULT, LIGHT_DEFAULT_COLOR, clamp,
  itemHeight, itemElevation, snapOpeningToWall, isOpening,
} from './model.js';
import { addObjectAtCenter, duplicateSelected, deleteSelected, makeRectangle, addVertex, removeVertex, addLight } from './actions.js';

const $ = (id) => document.getElementById(id);
const fmtHour = (h) => `${String(Math.floor(h)).padStart(2, '0')} h ${String(Math.round((h % 1) * 60)).padStart(2, '0')}`;

export function initPanel({ onSnapshot }) {
  const { ui } = store;

  // ── Listes déroulantes ──
  const fillSelect = (id, entries) => {
    const sel = $(id);
    sel.replaceChildren(...entries.map(([value, label]) => new Option(label, value)));
  };
  fillSelect('add-type', Object.entries(OBJECT_TYPES).map(([k, v]) => [k, v.label]));
  fillSelect('pType', Object.entries(OBJECT_TYPES).map(([k, v]) => [k, v.label]));
  fillSelect('lightTypeCreate', Object.entries(LIGHT_TYPES).map(([k, v]) => [k, v.label]));
  fillSelect('floorType', Object.entries(FLOORS));

  // ── Palettes de couleurs ──
  const palettes = [];
  function buildPalette(holderId, nameId, get, set) {
    const holder = $(holderId);
    holder.replaceChildren(...PALETTE.map((p) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'swatch';
      b.style.backgroundColor = p.hex;
      b.title = p.name;
      b.setAttribute('aria-label', p.name);
      b.dataset.color = p.hex;
      b.addEventListener('click', () => { set(p.hex); });
      return b;
    }));
    palettes.push(() => {
      const current = get();
      holder.querySelectorAll('.swatch').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.color === current)));
      const entry = PALETTE.find((p) => p.hex === current);
      $(nameId).textContent = entry ? entry.name : '';
    });
  }
  buildPalette('pColorPalette', 'pColorName',
    () => (store.selectedItem?.color ?? store.selectedColumn?.color),
    (hex) => {
      const it = store.selectedItem;
      const col = store.selectedColumn;
      if (!it && !col) return;
      store.checkpoint();
      if (it) it.color = hex; else { col.color = hex; col.colorLinked = false; }
      store.changed();
    });
  buildPalette('wallColorPalette', 'wallColorName', () => store.state.wallColor, (hex) => {
    store.checkpoint();
    store.state.wallColor = hex;
    store.state.columns.forEach((c) => { if (c.colorLinked === true) c.color = hex; });
    store.changed();
  });
  buildPalette('pLightColorPalette', 'pLightColorName', () => store.selectedLight?.color, (hex) => updateLight('color', hex));

  // ── Verrouillage ──
  $('lockBtn').addEventListener('click', () => store.toggleLock());
  $('lightLockBtn').addEventListener('click', () => store.toggleLock());
  $('roomLockBtn').addEventListener('click', () => {
    store.checkpoint();
    store.state.roomLocked = !store.state.roomLocked;
    store.changed();
  });
  function applyLock(rootId, lockBtnId, locked) {
    document.querySelectorAll(`#${rootId} input, #${rootId} select, #${rootId} textarea, #${rootId} button`).forEach((n) => {
      if (n.id !== lockBtnId) n.disabled = locked;
    });
    const b = $(lockBtnId);
    b.setAttribute('aria-pressed', String(locked));
    b.querySelector('i').className = `ti ${locked ? 'ti-lock' : 'ti-lock-open'}`;
    const label = b.querySelector('span');
    label.textContent = lockBtnId === 'roomLockBtn'
      ? (locked ? 'Déverrouiller les murs' : 'Verrouiller les murs')
      : (locked ? 'Déverrouiller' : 'Verrouiller');
  }

  // ── Ajout ──
  $('add-btn').addEventListener('click', () => addObjectAtCenter($('add-type').value));
  $('addLight').addEventListener('click', () => addLight($('lightTypeCreate').value));
  $('duplicateBtn').addEventListener('click', duplicateSelected);
  $('deleteBtn').addEventListener('click', deleteSelected);
  $('deleteLightBtn').addEventListener('click', deleteSelected);

  // ── Propriétés d'un objet ou d'une colonne ──
  function bindProp(id, key, cast) {
    $(id).addEventListener('change', () => {
      const it = store.selectedItem;
      const col = store.selectedColumn;
      if (!it && !col) return;
      store.checkpoint();
      const value = cast($(id).value, it || col);
      if (it) it[key] = value;
      else if (['name', 'comment', 'height', 'elevation'].includes(key)) col[key] = value;
      if (it && isOpening(it) && ['x', 'y', 'rot', 'w', 'd'].includes(key)) delete it.wallIndex;
      store.changed();
    });
  }
  const text = (v) => v;
  const dimension = (v) => Math.max(1, Number(v) || 1);
  bindProp('pName', 'name', text);
  bindProp('pComment', 'comment', text);
  bindProp('pW', 'w', dimension);
  bindProp('pD', 'd', dimension);
  bindProp('pX', 'x', (v) => Number(v) || 0);
  bindProp('pY', 'y', (v) => Number(v) || 0);
  bindProp('pRot', 'rot', (v) => Number(v) || 0);
  $('pH').addEventListener('change', () => {
    const it = store.selectedItem;
    const col = store.selectedColumn;
    if (!it && !col) return;
    store.checkpoint();
    const h = Math.max(1, Number($('pH').value) || 1);
    if (it) it.height = h; else col.height = h;
    store.changed();
  });
  $('pElev').addEventListener('change', () => {
    const it = store.selectedItem;
    const col = store.selectedColumn;
    if (!it && !col) return;
    store.checkpoint();
    const e = Math.max(0, Number($('pElev').value) || 0);
    if (it) it.elevation = e; else col.elevation = e;
    store.changed();
  });
  $('pRotMinus').addEventListener('click', () => rotateBy(-90));
  $('pRotPlus').addEventListener('click', () => rotateBy(90));
  function rotateBy(deg) {
    const it = store.selectedItem;
    if (!it) return;
    store.checkpoint();
    it.rot = (((Number(it.rot) || 0) + deg) % 360 + 360) % 360;
    delete it.wallIndex;
    store.changed();
  }
  $('pType').addEventListener('change', () => {
    const it = store.selectedItem;
    const next = $('pType').value;
    if (!it || it.type === next) return;
    store.checkpoint();
    // Changer de type ne touche ni aux dimensions ni à la position.
    it.type = next;
    it.name = OBJECT_TYPES[next].name;
    if (next === 'column') it.shape = it.shape || 'rect'; else delete it.shape;
    if (isOpening(it)) snapOpeningToWall(it, store.state.room); else delete it.wallIndex;
    store.changed();
  });
  $('pColumnShape').addEventListener('change', () => {
    const it = store.selectedItem;
    if (!it || it.type !== 'column') return;
    store.checkpoint();
    it.shape = $('pColumnShape').value;
    store.changed();
  });

  // Porte : le curseur d'ouverture ne crée qu'un seul pas d'annulation par glissé.
  let doorChecked = false;
  $('pDoorOpen').addEventListener('pointerdown', () => { doorChecked = false; });
  $('pDoorOpen').addEventListener('input', () => {
    const it = store.selectedItem;
    if (!it || it.type !== 'door') return;
    if (!doorChecked) { store.checkpoint(); doorChecked = true; }
    it.openPercent = clamp(Number($('pDoorOpen').value) || 0, 0, 100);
    $('pDoorOpenValue').textContent = `${Math.round(it.openPercent * 1.2)}°`;
    store.changed();
  });
  const doorProp = (id, key) => $(id).addEventListener('change', () => {
    const it = store.selectedItem;
    if (!it || it.type !== 'door') return;
    store.checkpoint();
    it[key] = $(id).value;
    store.changed();
  });
  doorProp('pDoorSwing', 'swingDirection');
  doorProp('pDoorHinge', 'hingeSide');

  // ── Pièce ──
  $('makeRect').addEventListener('click', () => makeRectangle($('roomWidth').value, $('roomLength').value));
  $('addVertexBtn').addEventListener('click', addVertex);
  $('removeVertexBtn').addEventListener('click', removeVertex);
  $('wallHeight').addEventListener('change', () => {
    store.checkpoint();
    store.state.wallHeight = Math.max(100, Number($('wallHeight').value) || 250);
    store.changed();
  });
  $('floorType').addEventListener('change', () => {
    store.checkpoint();
    store.state.floor = $('floorType').value;
    store.changed();
  });

  // ── Éclairage ──
  function updateLight(key, value) {
    const l = store.selectedLight;
    if (!l) return;
    store.checkpoint();
    l[key] = value;
    store.changed();
  }
  [
    ['pLightName', 'name', (v) => v],
    ['pLightIntensity', 'intensity', (v) => clamp(Number(v) || 0, 0, 10)],
    ['pLightX', 'x', (v) => Number(v) || 0],
    ['pLightPlanY', 'planY', (v) => Number(v) || 0],
    ['pLightHeight', 'height', (v) => Math.max(0, Number(v) || 0)],
    ['pLightDistance', 'distance', (v) => Math.max(1, Number(v) || 1)],
    ['pLightAngle', 'angle', (v) => clamp(Number(v) || 50, 10, 120)],
  ].forEach(([id, key, cast]) => $(id).addEventListener('change', () => updateLight(key, cast($(id).value))));
  $('pLightEnabled').addEventListener('change', () => updateLight('enabled', $('pLightEnabled').checked));

  // ── Rendu 3D (préférences : hors historique) ──
  document.querySelectorAll('#render-mode [data-mode], #mode-seg [data-mode]').forEach((b) => {
    b.addEventListener('click', () => store.setRender({ mode: b.dataset.mode }));
  });
  document.querySelectorAll('#ambiance [data-ambiance]').forEach((b) => {
    b.addEventListener('click', () => store.setRender({ ambiance: b.dataset.ambiance, ...AMBIANCES[b.dataset.ambiance] }));
  });
  const slider = (id, key) => $(id).addEventListener('input', () => store.setRender({ [key]: Number($(id).value), ambiance: 'custom' }));
  slider('rHour', 'hour');
  slider('rDaylight', 'daylight');
  slider('rExposure', 'exposure');
  $('rAo').addEventListener('change', () => store.setRender({ ao: $('rAo').checked }));
  $('rSoft').addEventListener('change', () => store.setRender({ softShadows: $('rSoft').checked }));
  $('rSnapshot').addEventListener('click', onSnapshot);

  // ── Synchronisation de l'affichage ──
  const setValue = (id, value) => { const n = $(id); if (document.activeElement !== n) n.value = value; };

  function syncSelection() {
    const { state } = store;
    const it = store.selectedItem;
    const col = store.selectedColumn;
    const has = !!(it || col);
    $('props').hidden = !has;
    $('roomPanel').hidden = has;
    $('propTypeField').hidden = !it;
    $('propDimensions').hidden = !it;
    $('propPosition').hidden = !it;
    $('propRotation').hidden = !it;
    $('duplicateBtn').hidden = !it;
    $('propCommentField').hidden = false;
    $('columnShapeField').hidden = !(it && it.type === 'column');
    $('doorOptions').hidden = !(it && it.type === 'door');
    $('p-type-label').textContent = it ? OBJECT_TYPES[it.type].label : col ? 'Colonne (contour)' : '';
    if (has) {
      const src = it || col;
      setValue('pName', src.name || '');
      setValue('pComment', src.comment || '');
      setValue('pH', Math.round(it ? itemHeight(it) : Math.max(1, Number(col.height) || state.wallHeight)));
      setValue('pElev', Math.round(it ? itemElevation(it) : Math.max(0, Number(col.elevation) || 0)));
    }
    if (it) {
      setValue('pType', it.type);
      setValue('pW', Math.round(it.w * 10) / 10);
      setValue('pD', Math.round(it.d * 10) / 10);
      setValue('pX', Math.round(it.x));
      setValue('pY', Math.round(it.y));
      setValue('pRot', Math.round((it.rot || 0) * 10) / 10);
      setValue('pColumnShape', it.shape || 'round');
      setValue('pDoorOpen', it.openPercent || 0);
      $('pDoorOpenValue').textContent = `${Math.round((it.openPercent || 0) * 1.2)}°`;
      setValue('pDoorSwing', it.swingDirection === 'out' ? 'out' : 'in');
      setValue('pDoorHinge', it.hingeSide === 'B' ? 'B' : 'A');
    }

    // Pièce
    setValue('wallHeight', Math.round(state.wallHeight));
    setValue('floorType', state.floor);
    $('room-summary').textContent = state.room.length >= 3
      ? `${state.room.length} sommets. Clique un mur pour le sélectionner, glisse un sommet pour le déplacer.`
      : 'Aucune pièce. Dessine un contour avec l’outil Murs, ou crée un rectangle.';
    $('removeVertexBtn').disabled = !(ui.selected === 'room' && ui.vertex !== null && state.room.length > 3);
    $('addVertexBtn').disabled = state.room.length < 3;

    // Lumières
    const l = store.selectedLight;
    $('lightProps').hidden = !l;
    if (l) {
      setValue('pLightName', l.name || '');
      setValue('pLightIntensity', Number(l.intensity) || 0);
      $('pLightEnabled').checked = l.enabled !== false;
      setValue('pLightX', Math.round(Number(l.x) || 0));
      setValue('pLightPlanY', Math.round(Number(l.planY) || 0));
      setValue('pLightHeight', Math.round(Number(l.height) || 0));
      setValue('pLightDistance', Math.round(Number(l.distance) || 700));
      setValue('pLightAngle', Math.round(Number(l.angle) || 50));
      $('lightPositionFields').hidden = l.type === 'ambient';
      $('lightAngleField').hidden = l.type !== 'spot';
    }
    palettes.forEach((refresh) => refresh());
    syncLists();
    applyLock('props', 'lockBtn', has && !!(it || col)?.locked);
    applyLock('roomPanel', 'roomLockBtn', state.roomLocked === true);
    applyLock('lightProps', 'lightLockBtn', !!l?.locked);
    if (!state.roomLocked) {
      $('removeVertexBtn').disabled = !(ui.selected === 'room' && ui.vertex !== null && state.room.length > 3);
      $('addVertexBtn').disabled = state.room.length < 3;
    }
  }

  function listButton(label, small, color, current, onClick, locked = false) {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'list-item';
    if (current) b.setAttribute('aria-current', 'true');
    const dot = document.createElement('span');
    dot.className = 'dot';
    dot.style.background = color;
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = label;
    const sm = document.createElement('small');
    sm.textContent = small;
    b.append(dot, name);
    if (locked) { const lock = document.createElement('i'); lock.className = 'ti ti-lock lock'; lock.setAttribute('aria-label', 'Verrouillé'); b.append(lock); }
    b.append(sm);
    b.addEventListener('click', onClick);
    li.append(b);
    return li;
  }

  function syncLists() {
    const { state } = store;
    const rows = [
      ...state.items.map((it) => listButton(it.name, `${Math.round(it.w)}×${Math.round(it.d)}`, it.color || OBJECT_TYPES[it.type].color, ui.selected === it.id, () => { store.setTool('select'); store.select({ id: it.id }); }, it.locked === true)),
      ...state.columns.map((c) => listButton(c.name, 'contour', c.color || WALL_DEFAULT, ui.selected === c.id, () => { store.setTool('select'); store.select({ id: c.id }); }, c.locked === true)),
    ];
    $('itemList').replaceChildren(...rows);
    $('emptyList').hidden = rows.length > 0;
    const lights = state.lights.map((l) => listButton(l.name || LIGHT_TYPES[l.type].name, LIGHT_TYPES[l.type].short, l.color || LIGHT_DEFAULT_COLOR, ui.light === l.id, () => store.select({ light: l.id }), l.locked === true));
    $('lightList').replaceChildren(...lights);
    $('emptyLightList').hidden = lights.length > 0;
  }

  function syncRender() {
    const r = store.render;
    document.querySelectorAll('#render-mode [data-mode], #mode-seg [data-mode]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === r.mode)));
    document.querySelectorAll('#ambiance [data-ambiance]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.ambiance === r.ambiance)));
    $('realistic-opts').hidden = r.mode !== 'realistic';
    $('standard-hint').hidden = r.mode === 'realistic';
    setValue('rHour', r.hour);
    setValue('rDaylight', r.daylight);
    setValue('rExposure', r.exposure);
    $('hourValue').textContent = fmtHour(r.hour);
    $('daylightValue').textContent = `${Math.round(r.daylight * 100)} %`;
    $('exposureValue').textContent = r.exposure.toFixed(2).replace('.', ',');
    $('rAo').checked = r.ao;
    $('rSoft').checked = r.softShadows;
  }

  store.subscribe((kind) => {
    if (kind === 'plan' || kind === 'select') syncSelection();
    if (kind === 'render') syncRender();
  });
  syncSelection();
  syncRender();
}
