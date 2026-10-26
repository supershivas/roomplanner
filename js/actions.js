// Opérations sur le plan (ajout, suppression, duplication…), partagées par le plan 2D,
// la vue 3D, le panneau, les menus et le clavier.
import { store } from './store.js';
import {
  OBJECT_TYPES, LIGHT_TYPES, newState, interiorCenter, pointInPolygon,
  snapOpeningToWall, round5, bounds, LIGHT_DEFAULT_COLOR,
} from './model.js';
import { toast, say, confirmDialog } from './dialogs.js';

// Refuse de modifier un élément verrouillé (id : 'room', objet, colonne ou lumière).
export function blocked(id) {
  if (!store.isLocked(id)) return false;
  toast(id === 'room' ? 'Les murs sont verrouillés.' : 'Cet élément est verrouillé.');
  return true;
}

export function createObjectAt(center, type, { snapToWall = false } = {}) {
  const def = OBJECT_TYPES[type] || OBJECT_TYPES.furniture;
  const { state } = store;
  store.checkpoint();
  const cx = round5(center.x);
  const cy = round5(center.y);
  const item = {
    id: store.newId('o'),
    type,
    name: def.name,
    w: def.w,
    d: def.d,
    x: cx - def.w / 2,
    y: cy - def.d / 2,
    rot: 0,
    height: def.h,
    elevation: def.elev,
    color: def.color,
    comment: '',
    openPercent: 0,
    swingDirection: 'in',
    hingeSide: 'A',
  };
  if (type === 'column') item.shape = 'rect';
  if (snapToWall) snapOpeningToWall(item, state.room);
  state.items.push(item);
  store.changed();
  store.select({ id: item.id });
  say(`${def.name} ajouté au plan.`);
  return item;
}

// Pose l'objet au centre de la pièce (bouton « Ajouter »).
export function addObjectAtCenter(type) {
  const center = interiorCenter(store.state.room) || planCenterFallback();
  return createObjectAt(center, type);
}

function planCenterFallback() {
  const pts = [...store.state.items.map((i) => ({ x: i.x, y: i.y }))];
  if (!pts.length) return { x: 400, y: 300 };
  const b = bounds(pts);
  return { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
}

export function duplicateSelected() {
  const it = store.selectedItem;
  if (it) {
    store.checkpoint();
    const copy = { ...it, id: store.newId('o'), name: `${it.name} (copie)`, x: it.x + 20, y: it.y + 20 };
    delete copy.wallIndex;
    delete copy.locked;
    store.state.items.push(copy);
    store.changed();
    store.select({ id: copy.id });
    return;
  }
  const l = store.selectedLight;
  if (l) {
    store.checkpoint();
    const copy = { ...l, id: store.newId('l'), name: `${l.name} (copie)`, x: l.x + 30, planY: l.planY + 30 };
    delete copy.locked;
    store.state.lights.push(copy);
    store.changed();
    store.select({ light: copy.id });
  }
}

export function deleteSelected() {
  const { state, ui } = store;
  if (blocked(ui.light || ui.selected)) return;
  if (ui.light) {
    store.checkpoint();
    state.lights = state.lights.filter((l) => l.id !== ui.light);
    store.changed();
    store.clearSelection();
    return;
  }
  if (!ui.selected) return;
  if (ui.selected === 'room') {
    if (ui.vertex !== null) removeVertex();
    return;
  }
  const id = ui.selected;
  if (!state.items.some((i) => i.id === id) && !state.columns.some((c) => c.id === id)) return;
  store.checkpoint();
  state.items = state.items.filter((i) => i.id !== id);
  state.columns = state.columns.filter((c) => c.id !== id);
  store.changed();
  store.clearSelection();
  say('Élément supprimé.');
}

export function makeRectangle(w, h) {
  if (blocked('room')) return;
  const width = Math.max(50, Number(w) || 500);
  const length = Math.max(50, Number(h) || 400);
  store.checkpoint();
  store.state.room = [
    { x: 300, y: 250 }, { x: 300 + width, y: 250 },
    { x: 300 + width, y: 250 + length }, { x: 300, y: 250 + length },
  ];
  store.changed();
  store.select({ id: 'room', wall: 0 });
  store.setTool('select');
}

export function addVertex() {
  const { state, ui } = store;
  if (blocked('room')) return;
  if (state.room.length < 3) { toast('Crée d’abord le contour de la pièce.'); return; }
  store.checkpoint();
  const i = ui.wall % state.room.length;
  const a = state.room[i];
  const b = state.room[(i + 1) % state.room.length];
  state.room.splice(i + 1, 0, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  state.items.forEach((it) => { if (Number.isInteger(it.wallIndex) && it.wallIndex > i) it.wallIndex += 1; });
  store.changed();
  store.select({ id: 'room', vertex: i + 1, wall: i });
  say('Point ajouté au milieu du mur. Glisse-le pour le placer.');
}

export function removeVertex() {
  const { state, ui } = store;
  if (blocked('room')) return;
  if (ui.selected !== 'room' || ui.vertex === null || state.room.length <= 3) {
    toast('Sélectionne un sommet (la pièce garde au moins 3 points).');
    return;
  }
  store.checkpoint();
  state.room.splice(ui.vertex, 1);
  state.items.forEach((it) => { delete it.wallIndex; });
  store.changed();
  store.select({ id: 'room', wall: 0 });
}

export function setWallLength(index, desired) {
  if (blocked('room')) return;
  const { room } = store.state;
  if (!(desired > 0)) { toast('Saisis une longueur positive en centimètres.'); return; }
  const a = room[index];
  const nextIndex = (index + 1) % room.length;
  const b = room[nextIndex];
  const old = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const k = desired / old;
  store.checkpoint();
  room[nextIndex] = { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
  store.changed();
  store.select({ id: 'room', vertex: nextIndex, wall: index });
  say(`Longueur du mur : ${Math.round(desired)} cm.`);
}

// Un contour fermé à l'intérieur de la pièce devient une colonne, sinon il remplace la pièce.
export function closeContour(points) {
  const { state } = store;
  const inside = state.room.length >= 3 && points.every((p) => pointInPolygon(p, state.room));
  if (!inside && state.room.length >= 3 && blocked('room')) { store.setTool('select'); return; }
  store.checkpoint();
  if (inside) {
    const id = store.newId('col');
    state.columns.push({
      id, name: `Colonne ${state.columns.length + 1}`, points, height: state.wallHeight, elevation: 0,
      color: state.wallColor, colorLinked: true, comment: '',
    });
    store.changed();
    store.select({ id });
    say('Contour intérieur reconnu comme colonne / pilier.');
  } else {
    const replaced = state.room.length >= 3;
    state.room = points;
    state.items.forEach((it) => { delete it.wallIndex; });
    store.changed();
    store.select({ id: 'room', wall: 0 });
    say(replaced ? 'Contour de la pièce remplacé (Ctrl+Z pour annuler).' : 'Contour de la pièce fermé.');
  }
  store.setTool('select');
}

export function addLight(type) {
  const { state } = store;
  const room = state.room;
  const c = interiorCenter(room) || planCenterFallback();
  const wh = state.wallHeight;
  const defaults = {
    spot: { intensity: 3, distance: Math.max(300, wh * 2.4), angle: 50, height: Math.max(wh - 10, 100) },
    ambient: { intensity: 0.5, distance: 1000, angle: 50, height: wh },
    lamp: { intensity: 3.5, distance: 700, angle: 50, height: Math.max(wh - 30, 100) },
  }[type];
  store.checkpoint();
  const light = {
    id: store.newId('l'), type, name: LIGHT_TYPES[type].name, color: LIGHT_DEFAULT_COLOR, enabled: true,
    x: round5(c.x), planY: round5(c.y), ...defaults,
  };
  state.lights.push(light);
  store.changed();
  store.select({ light: light.id });
  say(`${LIGHT_TYPES[type].name} ajoutée.`);
}

export async function newPlan() {
  const { state } = store;
  const empty = !state.room.length && !state.items.length && !state.columns.length && !state.lights.length;
  if (!empty && !await confirmDialog('Nouveau plan ?', 'Le plan actuel sera remplacé. Tu pourras annuler avec Ctrl+Z tant que la page reste ouverte.', 'Nouveau plan')) return false;
  store.replace(newState());
  store.setTool('wall');
  return true;
}
