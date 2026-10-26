// Plan 2D en SVG : dessin, sélection, déplacement, murs, mesure, zoom et déplacement de la vue.
import { store } from './store.js';
import {
  OBJECT_TYPES, WALL_THICKNESS, isOpening, bounds, clamp, round5, dist, wallRings, inwardNormals,
  signedArea, interiorCenter, projectOnSegment, snapOpeningToWall, doorSwing,
} from './model.js';
import { createObjectAt, closeContour, setWallLength, blocked } from './actions.js';
import { numberDialog, say } from './dialogs.js';

const NS = 'http://www.w3.org/2000/svg';
const SNAP_PX = 10; // portée de l'aimant, en pixels écran
const CLOSE_PX = 14; // distance pour fermer un contour
const DRAG_PX = 3; // seuil avant qu'un clic devienne un glissé

const el = (tag, attrs = {}, parent = null) => {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  if (parent) parent.appendChild(n);
  return n;
};
const fmt = (n) => String(Math.round(n * 10) / 10).replace('.', ',');
const pts = (list) => list.map((p) => `${p.x},${p.y}`).join(' ');

export function createPlan2d(svg) {
  const view = { cx: 400, cy: 300, w: 900 };
  let grid = true;
  let draft = []; // points du contour en cours de dessin
  let cursor = null; // dernier point survolé (aperçu des outils)
  let measure = null; // { a, b, pending }
  let guides = []; // lignes d'aimantation affichées pendant un glissé
  let drag = null;
  let spaceDown = false;
  const touches = new Map(); // pointeurs tactiles actifs (pincement)
  let pinch = null;

  // ── Vue ────────────────────────────────────────────────────────────────
  const size = () => ({ cw: svg.clientWidth || 1, ch: svg.clientHeight || 1 });
  const cmPerPx = () => view.w / size().cw;

  function applyViewBox() {
    const { cw, ch } = size();
    const h = (view.w * ch) / cw;
    svg.setAttribute('viewBox', `${view.cx - view.w / 2} ${view.cy - h / 2} ${view.w} ${h}`);
  }

  function toPlan(e) {
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const q = pt.matrixTransform(svg.getScreenCTM().inverse());
    return { x: q.x, y: q.y };
  }

  function fit() {
    const { state } = store;
    const all = [
      ...state.room,
      ...state.columns.flatMap((c) => c.points),
      ...state.items.flatMap((it) => [{ x: it.x, y: it.y }, { x: it.x + it.w, y: it.y + it.d }]),
      ...state.lights.map((l) => ({ x: l.x, y: l.planY })),
    ];
    const { cw, ch } = size();
    if (!all.length) { view.cx = 400; view.cy = 300; view.w = Math.max(900, (700 * cw) / ch); applyViewBox(); return; }
    const b = bounds(all);
    const pad = 80;
    const bw = b.maxX - b.minX + pad * 2;
    const bh = b.maxY - b.minY + pad * 2;
    view.cx = (b.minX + b.maxX) / 2;
    view.cy = (b.minY + b.maxY) / 2;
    view.w = Math.max(300, bw, (bh * cw) / ch);
    applyViewBox();
    render();
  }

  // ── Aimant ─────────────────────────────────────────────────────────────
  function anchors(excludeId) {
    const { state } = store;
    const xs = [];
    const ys = [];
    for (const p of state.room) { xs.push(p.x); ys.push(p.y); }
    for (const c of state.columns) for (const p of c.points) { xs.push(p.x); ys.push(p.y); }
    for (const it of state.items) {
      if (it.id === excludeId) continue;
      const bb = itemBox(it);
      xs.push(bb.x0, bb.cx, bb.x1);
      ys.push(bb.y0, bb.cy, bb.y1);
    }
    return { xs, ys };
  }

  // Emprise rectangulaire (axes du plan) d'un objet, rotation comprise.
  function itemBox(it) {
    const r = ((it.rot || 0) * Math.PI) / 180;
    const hw = (Math.abs(it.w * Math.cos(r)) + Math.abs(it.d * Math.sin(r))) / 2;
    const hh = (Math.abs(it.w * Math.sin(r)) + Math.abs(it.d * Math.cos(r))) / 2;
    const cx = it.x + it.w / 2;
    const cy = it.y + it.d / 2;
    return { cx, cy, hw, hh, x0: cx - hw, x1: cx + hw, y0: cy - hh, y1: cy + hh };
  }

  // Point libre (murs, mesure) : aimanté aux sommets et à la grille de 5 cm.
  function snapPoint(p, { noSnap = false, excludeId = null } = {}) {
    guides = [];
    if (noSnap) return { x: p.x, y: p.y };
    const thr = SNAP_PX * cmPerPx();
    const { state } = store;
    const cands = [...state.room, ...state.columns.flatMap((c) => c.points)];
    for (const it of state.items) {
      if (it.id === excludeId) continue;
      const bb = itemBox(it);
      cands.push({ x: bb.x0, y: bb.y0 }, { x: bb.x1, y: bb.y0 }, { x: bb.x0, y: bb.y1 }, { x: bb.x1, y: bb.y1 }, { x: bb.cx, y: bb.cy });
    }
    let best = null;
    for (const c of cands) {
      const d = dist(c, p);
      if (d < thr && (!best || d < best.d)) best = { d, x: c.x, y: c.y };
    }
    return best ? { x: best.x, y: best.y } : { x: round5(p.x), y: round5(p.y) };
  }

  // Objet en cours de déplacement : ses bords et son centre s'aimantent aux lignes des autres éléments.
  function snapItemPosition(it, nx, ny, noSnap) {
    guides = [];
    if (noSnap) return { x: nx, y: ny };
    const thr = SNAP_PX * cmPerPx();
    const probe = { ...it, x: nx, y: ny };
    const bb = itemBox(probe);
    const { xs, ys } = anchors(it.id);
    const best = (anchorsList, lines) => {
      let res = null;
      for (const a of anchorsList) for (const l of lines) {
        const d = l - a;
        if (Math.abs(d) < thr && (!res || Math.abs(d) < Math.abs(res.d))) res = { d, line: l };
      }
      return res;
    };
    const sx = best([bb.x0, bb.cx, bb.x1], xs);
    const sy = best([bb.y0, bb.cy, bb.y1], ys);
    let x = nx;
    let y = ny;
    if (sx) { x += sx.d; guides.push({ x: sx.line }); } else x = round5(nx);
    if (sy) { y += sy.d; guides.push({ y: sy.line }); } else y = round5(ny);
    return { x, y };
  }

  const constrain = (p, base, shift) => {
    if (!shift || !base) return p;
    return Math.abs(p.x - base.x) >= Math.abs(p.y - base.y) ? { x: p.x, y: base.y } : { x: base.x, y: p.y };
  };

  // ── Rendu ──────────────────────────────────────────────────────────────
  function render() {
    const { state, ui } = store;
    applyViewBox();
    svg.replaceChildren();
    svg.setAttribute('class', `drawing tool-${ui.tool}${drag?.kind === 'pan' && drag.moved ? ' panning' : ''}`);
    const px = cmPerPx(); // taille d'un pixel écran, en cm
    const fs = 11 * px; // corps du texte : 11 px à l'écran
    const hasRoom = state.room.length >= 3;
    const empty = !hasRoom && !state.items.length && !state.columns.length && !state.lights.length && !draft.length;
    document.getElementById('empty').hidden = !empty || ui.tool === 'wall';

    // Grille
    const defs = el('defs', {}, svg);
    const pat = el('pattern', { id: 'grid-pattern', width: 25, height: 25, patternUnits: 'userSpaceOnUse' }, defs);
    el('path', { d: 'M 25 0 L 0 0 0 25', class: 'grid-line' }, pat);
    if (grid) el('rect', { x: -20000, y: -20000, width: 40000, height: 40000, class: 'grid-bg' }, svg);

    const gRoom = el('g', {}, svg);
    const gCols = el('g', {}, svg);
    const gItems = el('g', {}, svg);
    const gLights = el('g', {}, svg);
    const gOver = el('g', {}, svg);

    if (hasRoom) drawRoom(gRoom, fs, px);
    state.columns.forEach((c) => drawColumn(gCols, c, px));
    state.items.forEach((it) => drawItem(gItems, it, fs, px));
    state.lights.forEach((l) => drawLight(gLights, l, fs, px));
    drawOverlays(gOver, fs, px);
  }

  function drawRoom(g, fs, px) {
    const { state, ui } = store;
    const { room } = state;
    const rings = wallRings(room, WALL_THICKNESS);
    const selected = ui.selected === 'room';
    el('polygon', { points: pts(rings.inner), class: 'room-fill' }, g);

    const ring = (list) => `M ${list.map((p) => `${p.x} ${p.y}`).join(' L ')} Z`;
    const band = el('path', { d: `${ring(rings.outer)} ${ring(rings.inner)}`, class: `wall-band${selected ? ' selected' : ''}`, fill: state.wallColor, 'data-kind': 'wall' }, g);
    band.style.fill = state.wallColor;

    if (selected) {
      const a = room[ui.wall % room.length];
      const b = room[(ui.wall + 1) % room.length];
      el('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, class: 'wall-sel' }, g);
    }

    // Cotes de chaque mur, côté extérieur
    const normals = inwardNormals(room);
    room.forEach((a, i) => {
      const b = room[(i + 1) % room.length];
      const len = dist(a, b);
      if (len / px < 46) return;
      const n = normals[i];
      const off = WALL_THICKNESS / 2 + 13 * px;
      const mid = { x: (a.x + b.x) / 2 - n.x * off, y: (a.y + b.y) / 2 - n.y * off };
      const t = el('text', { x: mid.x, y: mid.y, 'font-size': fs, class: `dim-txt${selected && ui.wall === i ? ' dim-sel' : ''}` }, g);
      t.textContent = fmt(len);
    });

    // Surface au centre
    const area = Math.abs(signedArea(room)) / 10000;
    const c = interiorCenter(room);
    if (c && area > 0) {
      const t = el('text', { x: c.x, y: c.y, 'font-size': fs * 1.1, class: 'lbl', opacity: 0.45 }, g);
      t.textContent = `${fmt(area)} m²`;
    }

    // Sommets (absents quand les murs sont verrouillés)
    if (state.roomLocked) {
      const c0 = room[0];
      lockBadge(g, c0.x + 14 * px, c0.y - 14 * px, px);
      return;
    }
    room.forEach((p, i) => {
      const r = (selected ? 6 : 4) * px;
      const sel = selected && ui.vertex === i;
      el('circle', { cx: p.x, cy: p.y, r, class: `vertex${sel ? ' selected' : ''}`, 'data-kind': 'vertex', 'data-index': i, opacity: selected ? 1 : 0.7 }, g);
    });
  }

  function drawColumn(g, col, px) {
    const { ui } = store;
    const selected = ui.selected === col.id;
    const poly = el('polygon', { points: pts(col.points), class: `column-shape${selected ? ' selected' : ''}`, 'data-kind': 'column', 'data-id': col.id }, g);
    poly.style.fill = col.color;
    poly.style.fillOpacity = 0.85;
    if (col.locked) lockBadge(g, col.points[0].x, col.points[0].y, px);
    if (selected && !col.locked) {
      col.points.forEach((p, i) => {
        el('circle', { cx: p.x, cy: p.y, r: 6 * px, class: `vertex${ui.vertex === i ? ' selected' : ''}`, 'data-kind': 'cvertex', 'data-id': col.id, 'data-index': i }, g);
      });
    }
  }

  function drawItem(g, it, fs, px) {
    const { ui } = store;
    const selected = ui.selected === it.id;
    const grp = el('g', {
      class: `item t-${it.type}${selected ? ' selected' : ''}${it.locked ? ' locked' : ''}`,
      transform: `translate(${it.x} ${it.y}) rotate(${it.rot || 0} ${it.w / 2} ${it.d / 2})`,
      'data-kind': 'item', 'data-id': it.id,
    }, g);
    const body = (x, y, w, h, fill, rx = 0, cls = 'item-body') => {
      const r = el('rect', { x, y, width: Math.max(0.5, w), height: Math.max(0.5, h), rx, class: cls }, grp);
      r.style.fill = fill;
      return r;
    };
    const color = it.color || OBJECT_TYPES[it.type]?.color;
    const darker = `color-mix(in srgb, ${color}, black 35%)`;
    const legs = (leg, ix, iy) => {
      [[ix - leg / 2, iy - leg / 2], [it.w - ix - leg / 2, iy - leg / 2], [ix - leg / 2, it.d - iy - leg / 2], [it.w - ix - leg / 2, it.d - iy - leg / 2]]
        .forEach(([x, y]) => body(x, y, leg, leg, darker, 0, 'item-detail'));
    };
    switch (it.type) {
      case 'table': {
        const leg = clamp(Math.min(it.w, it.d) * 0.09, 4, 8);
        legs(leg, Math.max(leg + 2, it.w * 0.1), Math.max(leg + 2, it.d * 0.1));
        body(3, 3, it.w - 6, it.d - 6, color, 2);
        break;
      }
      case 'chair': {
        const leg = clamp(Math.min(it.w, it.d) * 0.12, 3, 6);
        legs(leg, Math.max(leg + 2, it.w * 0.18), Math.max(leg + 2, it.d * 0.18));
        body(5, 5, it.w - 10, it.d - 10, color, 2);
        body(5, 2, it.w - 10, Math.max(3, leg), darker, 1);
        break;
      }
      case 'shelf':
        body(0, 0, it.w, it.d, color, 1);
        body(2, 2, it.w - 4, it.d - 4, 'none', 0, 'item-detail');
        break;
      case 'column':
        if ((it.shape || 'round') === 'round') {
          const e = el('ellipse', { cx: it.w / 2, cy: it.d / 2, rx: it.w / 2, ry: it.d / 2, class: 'item-body' }, grp);
          e.style.fill = color;
        } else body(0, 0, it.w, it.d, color, 1);
        break;
      case 'door': drawDoor(grp, it, color); break;
      case 'patio':
      case 'window': {
        body(0, 0, it.w, it.d, color, 0);
        const mid = it.d / 2;
        el('line', { x1: 0, y1: mid, x2: it.w, y2: mid, class: 'item-detail' }, grp);
        break;
      }
      case 'appliance':
        body(0, 0, it.w, it.d, color, 3);
        body(it.w * 0.15, it.d * 0.15, it.w * 0.7, it.d * 0.7, 'none', 2, 'item-detail');
        break;
      case 'ironing':
        body(0, 0, it.w, it.d, color, it.d / 2);
        body(it.w * 0.08, it.d * 0.2, it.w * 0.84, it.d * 0.6, 'none', it.d * 0.3, 'item-detail');
        break;
      case 'dresser':
        body(0, 0, it.w, it.d, color, 1);
        for (let i = 1; i < 3; i += 1) el('line', { x1: (it.w * i) / 3, y1: 0, x2: (it.w * i) / 3, y2: it.d, class: 'item-detail' }, grp);
        break;
      case 'radiator': {
        body(0, 0, it.w, it.d, color, 2);
        const fins = Math.max(3, Math.floor(it.w / 8));
        for (let i = 1; i < fins; i += 1) el('line', { x1: (it.w * i) / fins, y1: 1, x2: (it.w * i) / fins, y2: it.d - 1, class: 'item-detail' }, grp);
        break;
      }
      case 'desklamp': {
        const base = el('circle', { cx: it.w / 2, cy: it.d / 2, r: Math.min(it.w, it.d) / 2, class: 'item-body' }, grp);
        base.style.fill = color;
        const head = el('circle', { cx: it.w / 2, cy: it.d / 2, r: Math.min(it.w, it.d) / 5, class: 'item-detail' }, grp);
        head.style.fill = '#fff8e0';
        break;
      }
      default:
        body(0, 0, it.w, it.d, color, it.type === 'note' ? 5 : 1);
    }

    if (it.locked) {
      const badge = el('g', { transform: `translate(${it.w} 0)` }, grp);
      lockBadge(badge, 0, 0, px, -(it.rot || 0));
    }

    // Nom, toujours horizontal
    const small = Math.min(it.w, it.d) < 24 || isOpening(it) || it.type === 'radiator';
    const maxChars = Math.floor(Math.max(it.w, it.d) / (fs * 0.62));
    if (!small && maxChars >= 3) {
      const label = it.name.length > maxChars ? `${it.name.slice(0, Math.max(1, maxChars - 1))}…` : it.name;
      const t = el('text', { x: it.w / 2, y: it.d / 2, 'font-size': fs, class: 'lbl', transform: `rotate(${-(it.rot || 0)} ${it.w / 2} ${it.d / 2})` }, grp);
      t.textContent = label;
    }
  }

  // Petit cadenas au trait (Tabler « lock »), à l'échelle de l'écran
  function lockBadge(g, x, y, px, back = 0) {
    const k = (14 * px) / 24;
    const badge = el('g', { transform: `translate(${x} ${y}) rotate(${back}) scale(${k}) translate(-12 -12)`, class: 'lock-badge' }, g);
    el('path', { d: 'M5 13a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2z', class: 'lock-fill' }, badge);
    el('path', { d: 'M8 11V7a4 4 0 1 1 8 0v4', class: 'lock-line' }, badge);
  }

  function drawDoor(grp, it, color) {
    const { state } = store;
    const frame = el('rect', { x: 0, y: 0, width: it.w, height: it.d, class: 'item-body' }, grp);
    frame.style.fill = color;
    const { angle, hingeB } = doorSwing(it, state.room);
    const hx = hingeB ? it.w : 0;
    const hy = it.d / 2;
    const dir = hingeB ? -1 : 1;
    // Point du battant à l'angle `deg` autour de la charnière (sens horaire à l'écran)
    const at = (deg) => {
      const r = (deg * Math.PI) / 180;
      return { x: hx + dir * it.w * Math.cos(r), y: hy + dir * it.w * Math.sin(r) };
    };
    // Débattement complet (90°) du côté où la porte s'ouvre, même fermée
    const side = angle !== 0 ? Math.sign(angle) : Math.sign(doorSwing({ ...it, openPercent: 100 }, state.room).angle) || 1;
    const from = at(0);
    const to = at(side * 90);
    el('path', { d: `M ${from.x} ${from.y} A ${it.w} ${it.w} 0 0 ${side > 0 ? 1 : 0} ${to.x} ${to.y}`, class: 'door-arc' }, grp);
    const leafEnd = at(angle);
    el('line', { x1: hx, y1: hy, x2: leafEnd.x, y2: leafEnd.y, class: 'door-leaf' }, grp);
  }

  function drawLight(g, l, fs, px) {
    const { ui } = store;
    const grp = el('g', { class: `light${ui.light === l.id ? ' selected' : ''}`, 'data-kind': 'light', 'data-id': l.id, transform: `translate(${l.x} ${l.planY})` }, g);
    const r = 9 * px;
    if (l.type !== 'ambient') {
      for (let i = 0; i < 8; i += 1) {
        const a = (i * Math.PI) / 4;
        el('line', { x1: Math.cos(a) * r * 1.35, y1: Math.sin(a) * r * 1.35, x2: Math.cos(a) * r * 1.9, y2: Math.sin(a) * r * 1.9, class: 'light-ray' }, grp);
      }
    }
    const body = el('circle', { r: l.type === 'ambient' ? r * 0.8 : r, class: `light-body${l.enabled ? '' : ' off'}`, 'stroke-dasharray': l.type === 'ambient' ? '3 2' : 'none' }, grp);
    body.style.fill = l.enabled ? l.color : '';
    const t = el('text', { x: 0, y: r * 3.1, 'font-size': fs * 0.9, class: 'lbl' }, grp);
    t.textContent = l.name;
    if (l.locked) lockBadge(grp, r * 1.4, -r * 1.4, px);
  }

  function dimension(g, x1, y1, x2, y2, label, fs, px, vertical, rotBack, textSide = -1) {
    const wrap = el('g', { class: 'dim-sel' }, g);
    el('line', { x1, y1, x2, y2, class: 'dim-line' }, wrap);
    const tick = 4 * px;
    if (vertical) {
      el('line', { x1: x1 - tick, y1, x2: x1 + tick, y2: y1, class: 'dim-line' }, wrap);
      el('line', { x1: x2 - tick, y1: y2, x2: x2 + tick, y2, class: 'dim-line' }, wrap);
    } else {
      el('line', { x1, y1: y1 - tick, x2: x1, y2: y1 + tick, class: 'dim-line' }, wrap);
      el('line', { x1: x2, y1: y2 - tick, x2, y2: y2 + tick, class: 'dim-line' }, wrap);
    }
    const mx = (x1 + x2) / 2 + (vertical ? 10 * px + label.length * fs * 0.3 : 0);
    const my = (y1 + y2) / 2 + (vertical ? 0 : textSide * 9 * px);
    const t = el('text', { x: mx, y: my, 'font-size': fs, class: 'dim-txt', transform: `rotate(${rotBack} ${mx} ${my})` }, wrap);
    t.textContent = label;
  }

  function drawOverlays(g, fs, px) {
    const { state, ui } = store;
    const it = state.items.find((x) => x.id === ui.selected);
    if (it) {
      const grp = el('g', { transform: `translate(${it.x} ${it.y}) rotate(${it.rot || 0} ${it.w / 2} ${it.d / 2})` }, g);
      const off = 14 * px;
      dimension(grp, 0, it.d + off, it.w, it.d + off, fmt(it.w), fs, px, false, -(it.rot || 0), 1);
      dimension(grp, it.w + off, 0, it.w + off, it.d, fmt(it.d), fs, px, true, -(it.rot || 0));
      if (!isOpening(it) && !it.locked) {
        const hy = -34 * px;
        el('line', { x1: it.w / 2, y1: 0, x2: it.w / 2, y2: hy, class: 'rot-link' }, grp);
        el('circle', { cx: it.w / 2, cy: hy, r: 6 * px, class: 'rot-dot', 'data-kind': 'rot', 'data-id': it.id }, grp);
      }
    }
    // Lignes d'aimantation
    const { cw, ch } = size();
    const half = { x: (view.w * 1.2) / 2, y: ((view.w * ch) / cw) * 0.6 };
    guides.forEach((gd) => {
      if (gd.x !== undefined) el('line', { x1: gd.x, y1: view.cy - half.y, x2: gd.x, y2: view.cy + half.y, class: 'rot-link', 'stroke-dasharray': '5 3' }, g);
      else el('line', { x1: view.cx - half.x, y1: gd.y, x2: view.cx + half.x, y2: gd.y, class: 'rot-link', 'stroke-dasharray': '5 3' }, g);
    });
    drawDraft(g, fs, px);
    drawMeasure(g, fs, px);
  }

  function drawDraft(g, fs, px) {
    if (!draft.length) return;
    const live = cursor ? [...draft, cursor] : draft;
    el('polyline', { points: pts(live), class: 'draft-line' }, g);
    draft.forEach((p, i) => {
      if (i === 0 && draft.length > 2 && cursor && dist(cursor, p) < CLOSE_PX * px) el('circle', { cx: p.x, cy: p.y, r: CLOSE_PX * px, class: 'draft-close' }, g);
      el('circle', { cx: p.x, cy: p.y, r: 5 * px, class: 'draft-dot' }, g);
    });
    if (cursor) {
      const last = draft[draft.length - 1];
      const len = dist(last, cursor);
      if (len > 1) {
        const t = el('text', { x: (last.x + cursor.x) / 2, y: (last.y + cursor.y) / 2 - 12 * px, 'font-size': fs, class: 'dim-txt' }, g);
        t.textContent = fmt(len);
      }
    }
  }

  function drawMeasure(g, fs, px) {
    if (!measure) return;
    const { a, b } = measure;
    const grp = el('g', { class: 'measure' }, g);
    el('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, class: 'measure-line' }, grp);
    [a, b].forEach((p) => el('circle', { cx: p.x, cy: p.y, r: 4 * px, class: 'measure-dot' }, grp));
    const len = dist(a, b);
    if (len > 0.5) {
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      const t = el('text', { x: mx, y: my - 12 * px, 'font-size': fs * 1.15, class: 'dim-txt' }, grp);
      t.textContent = `${fmt(len)} cm`;
      const s = el('text', { x: mx, y: my + 4 * px, 'font-size': fs * 0.9, class: 'dim-txt' }, grp);
      s.textContent = `${fmt(Math.abs(b.x - a.x))} × ${fmt(Math.abs(b.y - a.y))}`;
    }
  }

  // ── Interactions ───────────────────────────────────────────────────────
  const hitOf = (e) => e.target.closest?.('[data-kind]');

  function startPan(e) {
    drag = { kind: 'pan', cx: view.cx, cy: view.cy, sx: e.clientX, sy: e.clientY, moved: false };
  }

  svg.addEventListener('pointerdown', (e) => {
    const { ui, state } = store;
    svg.setPointerCapture?.(e.pointerId);
    if (e.pointerType === 'touch') {
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (touches.size === 2) {
        const [a, b] = [...touches.values()];
        pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), w: view.w };
        drag = null;
        return;
      }
    }
    if (e.button === 1 || (spaceDown && e.button === 0)) { startPan(e); e.preventDefault(); return; }
    if (e.button !== 0) return;
    const p = toPlan(e);
    const tool = ui.tool;

    if (tool === 'wall') {
      addDraftPoint(e, p);
      return;
    }
    if (tool === 'object') {
      const type = store.ui.addType;
      createObjectAt(snapPoint(p, { noSnap: e.altKey }), type, { snapToWall: true });
      store.setTool('select');
      return;
    }
    if (tool === 'measure') {
      const q = snapPoint(p, { noSnap: e.altKey });
      if (measure?.pending) measure = { a: measure.a, b: constrain(q, measure.a, e.shiftKey), pending: false };
      else measure = { a: q, b: { ...q }, pending: true };
      render();
      return;
    }

    const hit = hitOf(e);
    const kind = hit?.dataset.kind;
    const id = hit?.dataset.id;
    if (kind === 'vertex') {
      const index = Number(hit.dataset.index);
      store.select({ id: 'room', vertex: index, wall: ui.wall });
      drag = { kind: 'vertex', index, moved: false, sx: e.clientX, sy: e.clientY };
    } else if (kind === 'cvertex') {
      store.select({ id, vertex: Number(hit.dataset.index) });
      drag = { kind: 'cvertex', id, index: Number(hit.dataset.index), moved: false, sx: e.clientX, sy: e.clientY };
    } else if (kind === 'rot') {
      drag = { kind: 'rot', id, moved: false, sx: e.clientX, sy: e.clientY };
    } else if (kind === 'item') {
      const it = state.items.find((x) => x.id === id);
      store.select({ id });
      drag = { kind: 'item', id, ox: p.x - it.x, oy: p.y - it.y, start: { x: it.x, y: it.y }, moved: false, sx: e.clientX, sy: e.clientY };
    } else if (kind === 'column') {
      const col = state.columns.find((c) => c.id === id);
      store.select({ id });
      drag = { kind: 'column', id, start: p, original: col.points.map((q) => ({ ...q })), moved: false, sx: e.clientX, sy: e.clientY };
    } else if (kind === 'light') {
      const l = state.lights.find((x) => x.id === id);
      store.select({ light: id });
      drag = { kind: 'light', id, ox: p.x - l.x, oy: p.y - l.planY, moved: false, sx: e.clientX, sy: e.clientY };
    } else if (kind === 'wall') {
      const near = state.room.length >= 3 ? nearestWallIndex(p) : 0;
      store.select({ id: 'room', wall: near });
    } else {
      startPan(e);
    }
    // Un élément verrouillé reste sélectionnable mais ne se déplace pas.
    if (drag && drag.kind !== 'pan' && store.isLocked(drag.kind === 'vertex' ? 'room' : drag.id)) drag = null;
  });

  function nearestWallIndex(p) {
    const { room } = store.state;
    let best = { i: 0, d: Infinity };
    room.forEach((a, i) => {
      const d = projectOnSegment(p, a, room[(i + 1) % room.length]).d;
      if (d < best.d) best = { i, d };
    });
    return best.i;
  }

  function addDraftPoint(e, p) {
    let q = snapPoint(p, { noSnap: e.altKey });
    q = constrain(q, draft[draft.length - 1], e.shiftKey);
    if (draft.length > 2 && dist(q, draft[0]) < CLOSE_PX * cmPerPx()) { finishDraft(); return; }
    const last = draft[draft.length - 1];
    if (last && dist(last, q) < 1) return;
    draft.push(q);
    say('Clique les angles suivants. Clique le premier point (ou Entrée) pour fermer.', 0);
    render();
  }

  function finishDraft() {
    const points = draft;
    draft = [];
    cursor = null;
    if (points.length >= 3) closeContour(points);
    else { store.setTool('select'); render(); }
  }

  function cancelDraft() { draft = []; cursor = null; guides = []; measure = null; render(); }

  window.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'touch' && touches.has(e.pointerId)) {
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pinch && touches.size === 2) {
        const [a, b] = [...touches.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        view.w = clamp(pinch.w * (pinch.d / Math.max(1, d)), 100, 20000);
        render();
        return;
      }
    }
    if (!drag) return;
    const { state } = store;
    if (!drag.moved) {
      if (Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < DRAG_PX) return;
      drag.moved = true;
      if (drag.kind !== 'pan') store.checkpoint();
    }
    if (drag.kind === 'pan') {
      view.cx = drag.cx - (e.clientX - drag.sx) * cmPerPx();
      view.cy = drag.cy - (e.clientY - drag.sy) * cmPerPx();
      render();
      return;
    }
    const p = toPlan(e);
    if (drag.kind === 'item') {
      const it = state.items.find((x) => x.id === drag.id);
      if (!it) return;
      let nx = p.x - drag.ox;
      let ny = p.y - drag.oy;
      if (e.shiftKey) { if (Math.abs(nx - drag.start.x) >= Math.abs(ny - drag.start.y)) ny = drag.start.y; else nx = drag.start.x; }
      const pos = snapItemPosition(it, nx, ny, e.altKey);
      it.x = pos.x;
      it.y = pos.y;
      if (isOpening(it)) snapOpeningToWall(it, state.room);
    } else if (drag.kind === 'vertex') {
      const q = snapPoint(p, { noSnap: e.altKey });
      state.room[drag.index] = q;
    } else if (drag.kind === 'cvertex') {
      const col = state.columns.find((c) => c.id === drag.id);
      if (col) col.points[drag.index] = snapPoint(p, { noSnap: e.altKey });
    } else if (drag.kind === 'column') {
      const col = state.columns.find((c) => c.id === drag.id);
      if (col) {
        const dx = round5(p.x - drag.start.x);
        const dy = round5(p.y - drag.start.y);
        col.points = drag.original.map((q) => ({ x: q.x + dx, y: q.y + dy }));
      }
    } else if (drag.kind === 'light') {
      const l = state.lights.find((x) => x.id === drag.id);
      if (l) { l.x = round5(p.x - drag.ox); l.planY = round5(p.y - drag.oy); }
    } else if (drag.kind === 'rot') {
      const it = state.items.find((x) => x.id === drag.id);
      if (it) {
        const cx = it.x + it.w / 2;
        const cy = it.y + it.d / 2;
        let deg = (Math.atan2(p.y - cy, p.x - cx) * 180) / Math.PI + 90;
        if (!e.altKey) deg = Math.round(deg / 15) * 15;
        it.rot = ((deg % 360) + 360) % 360;
      }
    }
    store.changed();
  });

  window.addEventListener('pointerup', (e) => {
    touches.delete(e.pointerId);
    if (touches.size < 2) pinch = null;
    if (!drag) return;
    const finished = drag;
    drag = null;
    guides = [];
    if (finished.kind === 'pan' && !finished.moved) store.clearSelection();
    else if (finished.kind !== 'pan' && finished.moved) store.changed();
    render();
  });

  svg.addEventListener('pointermove', (e) => {
    const tool = store.ui.tool;
    if (tool === 'wall' && draft.length) {
      cursor = constrain(snapPoint(toPlan(e), { noSnap: e.altKey }), draft[draft.length - 1], e.shiftKey);
      render();
    } else if (tool === 'measure' && measure?.pending) {
      measure.b = constrain(snapPoint(toPlan(e), { noSnap: e.altKey }), measure.a, e.shiftKey);
      render();
    }
  });

  svg.addEventListener('dblclick', async (e) => {
    const { ui, state } = store;
    if (ui.tool === 'wall') { if (draft.length >= 3) finishDraft(); return; }
    if (ui.tool !== 'select' || state.room.length < 3) return;
    const hit = hitOf(e);
    if (hit?.dataset.kind !== 'wall' || blocked('room')) return;
    const index = nearestWallIndex(toPlan(e));
    const a = state.room[index];
    const b = state.room[(index + 1) % state.room.length];
    const value = await numberDialog('Longueur du mur', 'Nouvelle longueur (cm)', Math.round(dist(a, b)));
    if (value !== null) setWallLength(index, value);
  });

  svg.addEventListener('wheel', (e) => {
    e.preventDefault();
    const before = toPlan(e);
    view.w = clamp(view.w * Math.exp(e.deltaY * 0.0015), 100, 20000);
    applyViewBox();
    const after = toPlan(e);
    view.cx += before.x - after.x;
    view.cy += before.y - after.y;
    render();
  }, { passive: false });

  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space' && !/^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(document.activeElement?.tagName)) spaceDown = true;
    if (document.getElementById('pane-plan').hidden) return;
    const tool = store.ui.tool;
    if (e.key === 'Enter' && tool === 'wall' && draft.length >= 3) { e.preventDefault(); finishDraft(); }
    if (e.key === 'Backspace' && tool === 'wall' && draft.length) { e.preventDefault(); draft.pop(); render(); }
  });
  window.addEventListener('keyup', (e) => { if (e.code === 'Space') spaceDown = false; });

  // Changement d'outil : on abandonne le tracé en cours.
  store.subscribe((kind) => {
    if (kind === 'tool') {
      draft = [];
      cursor = null;
      measure = null;
      guides = [];
      const hints = {
        wall: 'Clique les angles du contour (Maj : à l’équerre). Clique le premier point ou Entrée pour fermer.',
        object: 'Clique dans le plan pour poser l’objet choisi.',
        measure: 'Clique deux points pour mesurer (Maj : un seul sens, Alt : sans aimant).',
        select: '',
      };
      say(hints[store.ui.tool] ?? '', 0);
    }
  });

  // La largeur change quand l'inspecteur apparaît : on garde l'échelle et le bord gauche du plan.
  let lastWidth = 0;
  new ResizeObserver(() => {
    const { cw } = size();
    if (lastWidth && cw !== lastWidth) {
      const w = view.w * (cw / lastWidth);
      view.cx += (w - view.w) / 2;
      view.w = w;
    }
    lastWidth = cw;
    render();
  }).observe(svg);

  return {
    render,
    fit,
    setGrid(on) { grid = on; render(); },
    cancel: cancelDraft,
    get isDrafting() { return draft.length > 0; },
    exportSvg() {
      const clone = svg.cloneNode(true);
      clone.setAttribute('xmlns', NS);
      clone.querySelectorAll('.grid-bg, [data-kind="vertex"], [data-kind="cvertex"], [data-kind="rot"], .rot-link, .wall-sel').forEach((n) => n.remove());
      const style = document.createElementNS(NS, 'style');
      style.textContent = [...document.styleSheets].flatMap((sheet) => {
        try { return [...sheet.cssRules].map((r) => r.cssText); } catch { return []; }
      }).filter((t) => /^\.(wall-band|room-fill|column-shape|item|door|lbl|dim|light|grid)/.test(t)).join('\n');
      clone.prepend(style);
      return new XMLSerializer().serializeToString(clone);
    },
  };
}
