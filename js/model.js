// Modèle du plan : constantes, géométrie pure, validation et sérialisation.
// Unités : centimètres. Le plan est vu de dessus ; x vers la droite, y vers le bas.

export const WALL_THICKNESS = 12;
export const WALL_DEFAULT = '#d5ddd5';
export const FORMAT = 'planificateur-piece';
export const SCHEMA_VERSION = 6;

// Palette de contenu (couleurs des murs, objets et lumières) : propre aux plans, hors tokens.
export const PALETTE = [
  { name: 'Gris brume', hex: '#d5ddd5' }, { name: 'Vert sauge', hex: '#d7e1d8' },
  { name: 'Bois miel', hex: '#c9a77b' }, { name: 'Sable', hex: '#bda78d' },
  { name: 'Chêne', hex: '#bba68b' }, { name: 'Bleu pâle', hex: '#dce8f5' },
  { name: 'Bleu vitrage', hex: '#b7d8e9' }, { name: 'Gris clair', hex: '#d9d9d9' },
  { name: 'Pierre', hex: '#b9b0a0' }, { name: 'Jaune doux', hex: '#f4d9a5' },
  { name: 'Graphite', hex: '#45484b' }, { name: 'Anthracite', hex: '#30343b' },
  { name: 'Noir mat', hex: '#252629' }, { name: 'Blanc ivoire', hex: '#f2eee5' },
  { name: 'Vert forêt', hex: '#3f5f50' }, { name: 'Bleu marine', hex: '#30465c' },
  { name: 'Terracotta', hex: '#bd705b' }, { name: 'Rouge brique', hex: '#984f43' },
  { name: 'Rose poudré', hex: '#d4b7b2' }, { name: 'Kaki', hex: '#858868' },
];
export const LIGHT_DEFAULT_COLOR = '#dce8f5';

// w × d : emprise au sol ; h : hauteur ; elev : hauteur de la base par rapport au sol.
export const OBJECT_TYPES = {
  furniture: { label: 'Meuble / bloc', name: 'Meuble', w: 90, d: 60, h: 75, elev: 0, color: '#d7e1d8' },
  table: { label: 'Table (4 pieds)', name: 'Table', w: 120, d: 80, h: 75, elev: 0, color: '#c9a77b' },
  chair: { label: 'Chaise (4 pieds)', name: 'Chaise', w: 45, d: 45, h: 85, elev: 0, color: '#bda78d' },
  shelf: { label: 'Étagère', name: 'Étagère', w: 80, d: 35, h: 180, elev: 0, color: '#bba68b' },
  door: { label: 'Porte', name: 'Porte', w: 80, d: 8, h: 205, elev: 0, color: '#dce8f5' },
  window: { label: 'Fenêtre', name: 'Fenêtre', w: 100, d: 8, h: 100, elev: 90, color: '#b7d8e9' },
  appliance: { label: 'Électroménager', name: 'Électroménager', w: 60, d: 60, h: 85, elev: 0, color: '#d9d9d9' },
  column: { label: 'Colonne / pilier', name: 'Colonne', w: 35, d: 35, h: 250, elev: 0, color: '#b9b0a0' },
  note: { label: 'Repère / commentaire', name: 'Repère', w: 100, d: 35, h: 2, elev: 0, color: '#f4d9a5' },
  patio: { label: 'Porte-fenêtre', name: 'Porte-fenêtre', w: 180, d: 8, h: 215, elev: 0, color: '#b7d8e9' },
  ironing: { label: 'Table à repasser', name: 'Table à repasser', w: 125, d: 40, h: 90, elev: 0, color: '#d9d9d9' },
  dresser: { label: 'Commode', name: 'Commode', w: 110, d: 50, h: 85, elev: 0, color: '#bba68b' },
  radiator: { label: 'Radiateur', name: 'Radiateur', w: 80, d: 10, h: 60, elev: 15, color: '#f2eee5' },
  desklamp: { label: 'Lampe de bureau', name: 'Lampe de bureau', w: 20, d: 20, h: 45, elev: 0, color: '#30343b' },
};
// Ouvertures percées dans un mur : porte, fenêtre, porte-fenêtre.
export const isOpening = (it) => it.type === 'door' || it.type === 'window' || it.type === 'patio';
// Ouvertures vitrées : elles laissent entrer la lumière du jour.
export const isGlazed = (it) => it.type === 'window' || it.type === 'patio';

export const LIGHT_TYPES = {
  spot: { label: 'Spot directionnel', name: 'Spot', short: 'Spot' },
  ambient: { label: 'Lumière ambiante', name: 'Lumière ambiante', short: 'Ambiante' },
  lamp: { label: 'Lampe ponctuelle', name: 'Lampe', short: 'Lampe' },
};

export const FLOORS = {
  parquet: 'Parquet',
  tile: 'Carrelage',
  concrete: 'Béton ciré',
};

// Réglages du rendu 3D : préférences d'affichage, hors historique d'annulation.
export function defaultRender() {
  return {
    mode: 'standard', // 'standard' (éditeur) ou 'realistic'
    ambiance: 'day', // 'day' | 'evening' | 'night' | 'custom'
    hour: 15, // heure du soleil (6 à 21)
    daylight: 1, // intensité de la lumière du jour (0 à 1)
    exposure: 1, // exposition (0,4 à 2)
    ao: true, // occlusion ambiante
    softShadows: true,
  };
}

export const AMBIANCES = {
  day: { hour: 14, daylight: 1, exposure: 1 },
  evening: { hour: 19.5, daylight: 0.35, exposure: 1.15 },
  night: { hour: 12, daylight: 0, exposure: 1.35 },
};

export function newState() {
  return {
    room: [],
    columns: [],
    items: [],
    lights: [],
    wallHeight: 250,
    wallColor: WALL_DEFAULT,
    floor: 'parquet',
    roomLocked: false,
  };
}

export const paletteColor = (value, fallback) => {
  const v = String(value || '').toLowerCase();
  return PALETTE.some((p) => p.hex === v) ? v : fallback;
};

const num = (value, fallback) => (Number.isFinite(Number(value)) ? Number(value) : fallback);
export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export const round5 = (v) => Math.round(v / 5) * 5;

export const itemHeight = (it) => Math.max(1, num(it.height, OBJECT_TYPES[it.type]?.h ?? 75));
export const itemElevation = (it) => Math.max(0, num(it.elevation, OBJECT_TYPES[it.type]?.elev ?? 0));

// Cohérence interne : corrige les champs manquants sans jamais perdre de données.
export function normalize(state) {
  if (!Array.isArray(state.room)) state.room = [];
  if (!Array.isArray(state.columns)) state.columns = [];
  if (!Array.isArray(state.items)) state.items = [];
  if (!Array.isArray(state.lights)) state.lights = [];
  state.wallHeight = num(state.wallHeight, 250) > 0 ? num(state.wallHeight, 250) : 250;
  state.wallColor = paletteColor(state.wallColor, WALL_DEFAULT);
  if (!FLOORS[state.floor]) state.floor = 'parquet';
  state.roomLocked = state.roomLocked === true;
  for (const c of state.columns) {
    if (c.colorLinked === true) c.color = state.wallColor;
    else if (!c.color) { c.color = state.wallColor; c.colorLinked = true; } else c.color = paletteColor(c.color, state.wallColor);
  }
  for (const it of state.items) it.color = paletteColor(it.color, OBJECT_TYPES[it.type]?.color ?? OBJECT_TYPES.furniture.color);
  for (const l of state.lights) {
    l.color = paletteColor(l.color, LIGHT_DEFAULT_COLOR);
    if (l.enabled === undefined) l.enabled = true;
  }
  return state;
}

// ── Géométrie ───────────────────────────────────────────────────────────────

export const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

export function signedArea(poly) {
  let s = 0;
  for (let i = 0; i < poly.length; i += 1) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    s += a.x * b.y - b.x * a.y;
  }
  return s / 2;
}

export function pointInPolygon(pt, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
    const a = poly[i];
    const b = poly[j];
    if ((a.y > pt.y) !== (b.y > pt.y) && pt.x < ((b.x - a.x) * (pt.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

// Projection d'un point sur le segment a→b : { t (0..1), x, y, d }.
export function projectOnSegment(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  const t = l2 ? clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / l2, 0, 1) : 0;
  const x = a.x + t * dx;
  const y = a.y + t * dy;
  return { t, x, y, d: Math.hypot(p.x - x, p.y - y) };
}

// Indice du mur (segment i → i+1) le plus proche d'un point.
export function nearestWall(p, room) {
  let best = { index: 0, d: Infinity, t: 0 };
  room.forEach((a, i) => {
    const pr = projectOnSegment(p, a, room[(i + 1) % room.length]);
    if (pr.d < best.d) best = { index: i, d: pr.d, t: pr.t };
  });
  return best;
}

export function bounds(points) {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
}

// Point intérieur à la pièce : barycentre, ou à défaut le point le plus dégagé des murs.
export function interiorCenter(poly) {
  if (poly.length < 3) return null;
  let sum = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < poly.length; i += 1) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const cross = a.x * b.y - b.x * a.y;
    sum += cross;
    cx += (a.x + b.x) * cross;
    cy += (a.y + b.y) * cross;
  }
  const center = Math.abs(sum) > 1e-8
    ? { x: cx / (3 * sum), y: cy / (3 * sum) }
    : { x: poly.reduce((s, p) => s + p.x, 0) / poly.length, y: poly.reduce((s, p) => s + p.y, 0) / poly.length };
  if (pointInPolygon(center, poly)) return center;
  const { minX, maxX, minY, maxY } = bounds(poly);
  let best = null;
  for (let iy = 1; iy < 30; iy += 1) {
    for (let ix = 1; ix < 30; ix += 1) {
      const q = { x: minX + ((maxX - minX) * ix) / 30, y: minY + ((maxY - minY) * iy) / 30 };
      if (!pointInPolygon(q, poly)) continue;
      const clearance = nearestWall(q, poly).d;
      if (!best || clearance > best.clearance) best = { ...q, clearance };
    }
  }
  return best || center;
}

// Vecteur unitaire (x, y) de l'intérieur de la pièce pour chaque mur i → i+1.
export function inwardNormals(room) {
  const sign = Math.sign(signedArea(room)) || 1;
  const out = [];
  room.forEach((a, i) => {
    const b = room[(i + 1) % room.length];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len < 1e-6) out.push(out[out.length - 1] || { x: 0, y: 1 });
    else out.push({ x: (-(b.y - a.y) / len) * sign, y: ((b.x - a.x) / len) * sign });
  });
  return out;
}

// Contour intérieur et extérieur des murs (épaisseur t, centrée sur le contour),
// avec des angles en onglet : sert au dessin 2D comme à la 3D.
export function wallRings(room, t = WALL_THICKNESS) {
  const n = inwardNormals(room);
  const inner = [];
  const outer = [];
  room.forEach((p, i) => {
    const prev = n[(i - 1 + room.length) % room.length];
    const next = n[i];
    const k = Math.max(0.3, 1 + prev.x * next.x + prev.y * next.y);
    const vx = ((prev.x + next.x) / k) * (t / 2);
    const vy = ((prev.y + next.y) / k) * (t / 2);
    inner.push({ x: p.x + vx, y: p.y + vy });
    outer.push({ x: p.x - vx, y: p.y - vy });
  });
  return { inner, outer, normals: n };
}

// Mur sur lequel est posée une porte ou une fenêtre (null si aucun n'est assez proche).
export function wallMatch(it, room) {
  if (room.length < 3) return null;
  const cx = it.x + it.w / 2;
  const cy = it.y + it.d / 2;
  const normals = inwardNormals(room);
  let best = null;
  for (let i = 0; i < room.length; i += 1) {
    const a = room[i];
    const b = room[(i + 1) % room.length];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len < 1) continue;
    const pr = projectOnSegment({ x: cx, y: cy }, a, b);
    const preferred = Number.isInteger(it.wallIndex) && it.wallIndex === i;
    const cand = { i, a, b, len, s: pr.t * len, dist: pr.d, preferred, inward: normals[i], px: pr.x, py: pr.y };
    if (!best || (preferred && !best.preferred) || (preferred === best.preferred && cand.dist < best.dist)) best = cand;
  }
  if (!best || best.dist > Math.max(30, Math.min(it.w, it.d) / 2 + 22)) return null;
  return best;
}

// Aimante une porte ou une fenêtre sur le mur le plus proche (rotation et position).
export function snapOpeningToWall(it, room) {
  if (!isOpening(it) || room.length < 2) return;
  const cx = it.x + it.w / 2;
  const cy = it.y + it.d / 2;
  let best = null;
  for (let i = 0; i < room.length; i += 1) {
    const a = room[i];
    const b = room[(i + 1) % room.length];
    if (Math.hypot(b.x - a.x, b.y - a.y) < 1) continue;
    const pr = projectOnSegment({ x: cx, y: cy }, a, b);
    if (!best || pr.d < best.d) best = { ...pr, i, angle: (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI };
  }
  if (best && best.d < 90) {
    it.rot = best.angle;
    it.x = best.x - it.w / 2;
    it.y = best.y - it.d / 2;
    it.wallIndex = best.i;
  }
}

// Angle (en degrés, sens horaire à l'écran) du battant d'une porte autour de sa charnière,
// et côté (+1 / −1 selon l'axe y local de la porte) vers lequel il s'ouvre.
export function doorSwing(it, room) {
  const open = clamp(num(it.openPercent, 0), 0, 100) * 1.2;
  const match = wallMatch(it, room);
  const r = (num(it.rot, 0) * Math.PI) / 180;
  const localY = { x: -Math.sin(r), y: Math.cos(r) };
  let inward = 1;
  if (match) inward = localY.x * match.inward.x + localY.y * match.inward.y >= 0 ? 1 : -1;
  let side = it.swingDirection === 'out' ? -inward : inward;
  if (it.hingeSide === 'B') side = -side;
  return { angle: side * open, hingeB: it.hingeSide === 'B', open };
}

// ── Sérialisation ───────────────────────────────────────────────────────────

export function projectForExport(state, render) {
  normalize(state);
  return {
    format: FORMAT,
    version: SCHEMA_VERSION,
    units: 'cm',
    exportedAt: new Date().toISOString(),
    wallHeight: num(state.wallHeight, 250),
    wallColor: state.wallColor,
    floor: state.floor,
    roomLocked: state.roomLocked,
    render: { ...render },
    lights: state.lights.map((l) => ({ ...l })),
    room: state.room.map((p) => ({ x: Number(p.x), y: Number(p.y) })),
    columns: state.columns.map((c) => ({
      id: String(c.id),
      name: String(c.name || 'Colonne'),
      points: (c.points || []).map((p) => ({ x: Number(p.x), y: Number(p.y) })),
      height: Math.max(1, num(c.height, num(state.wallHeight, 250))),
      elevation: Math.max(0, num(c.elevation, 0)),
      color: c.color || state.wallColor,
      colorLinked: c.colorLinked === true || !c.color,
      comment: String(c.comment || ''),
      locked: c.locked === true,
    })),
    items: state.items.map((it) => ({ ...it, height: itemHeight(it), elevation: itemElevation(it) })),
  };
}

// Valide un fichier importé (schémas 4 à 6) et renvoie { state, render }.
export function validateProject(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Le fichier doit contenir un objet JSON.');
  if (!Array.isArray(data.room) || !Array.isArray(data.items)) throw new Error('Le JSON doit contenir les tableaux « room » et « items ».');
  const pointList = (arr, label, min) => {
    if (!Array.isArray(arr) || arr.length < min) throw new Error(`${label} : nombre de points insuffisant.`);
    return arr.map((p, i) => {
      if (!p || !Number.isFinite(Number(p.x)) || !Number.isFinite(Number(p.y))) throw new Error(`${label} : point ${i + 1} invalide.`);
      return { x: Number(p.x), y: Number(p.y) };
    });
  };
  const used = new Set();
  const uniqueId = (raw, fallback) => {
    let id = String(raw || fallback);
    while (used.has(id)) id += '-';
    used.add(id);
    return id;
  };
  const wallHeight = Math.max(1, num(data.wallHeight, num(data.settings?.wallHeight, 250)));
  const wallColor = String(data.wallColor || WALL_DEFAULT);
  const room = pointList(data.room, 'Contour de la pièce', data.room.length ? 3 : 0);

  const columns = (Array.isArray(data.columns) ? data.columns : []).map((c, i) => {
    if (!c || typeof c !== 'object') throw new Error(`Colonne ${i + 1} invalide.`);
    return {
      ...c,
      id: uniqueId(c.id, `col${i + 1}`),
      name: String(c.name || `Colonne ${i + 1}`),
      points: pointList(c.points, `Colonne ${i + 1}`, 3),
      height: Math.max(1, num(c.height, wallHeight)),
      elevation: Math.max(0, num(c.elevation, 0)),
      color: String(c.color || wallColor),
      comment: String(c.comment || ''),
    };
  });

  const items = data.items.map((raw, i) => {
    if (!raw || typeof raw !== 'object') throw new Error(`Objet ${i + 1} invalide.`);
    const type = String(raw.type || 'furniture');
    const def = OBJECT_TYPES[type];
    if (!def) throw new Error(`Type d’objet inconnu : ${type}`);
    // Anciens schémas : fenêtre décrite par appui (sillHeight) et linteau (headHeight).
    const sill = num(raw.sillHeight, 90);
    const legacyHeight = Number.isFinite(Number(raw.headHeight)) ? Math.max(1, Number(raw.headHeight) - sill) : def.h;
    const height = Number.isFinite(Number(raw.height)) ? Math.max(1, Number(raw.height)) : (type === 'window' ? legacyHeight : def.h);
    const elevation = Number.isFinite(Number(raw.elevation)) ? Math.max(0, Number(raw.elevation)) : (type === 'window' ? Math.max(0, sill) : 0);
    return {
      ...raw,
      id: uniqueId(raw.id, `o${i + 1}`),
      type,
      name: String(raw.name || def.name),
      x: num(raw.x, 0),
      y: num(raw.y, 0),
      w: Math.max(1, num(raw.w, 80)),
      d: Math.max(1, num(raw.d, 8)),
      rot: num(raw.rot, 0),
      height,
      elevation,
      openPercent: clamp(num(raw.openPercent, 0), 0, 100),
      swingDirection: raw.swingDirection === 'out' ? 'out' : 'in',
      hingeSide: raw.hingeSide === 'B' ? 'B' : 'A',
      color: String(raw.color || def.color),
      comment: String(raw.comment || ''),
    };
  });

  const lights = (Array.isArray(data.lights) ? data.lights : []).map((l, i) => {
    if (!l || typeof l !== 'object') throw new Error(`Source lumineuse ${i + 1} invalide.`);
    const type = String(l.type || 'lamp');
    if (!LIGHT_TYPES[type]) throw new Error(`Type de lumière inconnu : ${type}`);
    const n = (k, d) => num(l[k], d);
    return {
      ...l,
      id: uniqueId(l.id, `l${i + 1}`),
      type,
      name: String(l.name || LIGHT_TYPES[type].name),
      color: String(l.color || LIGHT_DEFAULT_COLOR),
      intensity: clamp(n('intensity', type === 'ambient' ? 0.5 : 3), 0, 10),
      x: n('x', 0),
      planY: n('planY', 0),
      height: Math.max(0, n('height', 200)),
      distance: Math.max(1, n('distance', 700)),
      angle: clamp(n('angle', 50), 10, 120),
      enabled: l.enabled !== false,
    };
  });

  const state = normalize({
    room, columns, items, lights, wallHeight, wallColor,
    floor: FLOORS[data.floor] ? data.floor : 'parquet',
    roomLocked: data.roomLocked === true,
  });
  const render = { ...defaultRender() };
  if (data.render && typeof data.render === 'object') {
    const r = data.render;
    if (r.mode === 'realistic' || r.mode === 'standard') render.mode = r.mode;
    if (r.ambiance in AMBIANCES || r.ambiance === 'custom') render.ambiance = r.ambiance;
    render.hour = clamp(num(r.hour, render.hour), 6, 21);
    render.daylight = clamp(num(r.daylight, render.daylight), 0, 1);
    render.exposure = clamp(num(r.exposure, render.exposure), 0.4, 2);
    render.ao = r.ao !== false;
    render.softShadows = r.softShadows !== false;
  }
  return { state, render };
}
