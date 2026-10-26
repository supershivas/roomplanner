// État du plan, sélection, historique d'annulation et sauvegarde locale.
import { newState, normalize, defaultRender, projectForExport, validateProject } from './model.js';

const PLAN_KEY = 'roomplanner:plan';
const RENDER_KEY = 'roomplanner:render';
const HISTORY_MAX = 80;

function read(key) {
  try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
}
function write(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* stockage indisponible */ }
}

const listeners = new Set();
let saveTimer;
let nextId = 1;

export const store = {
  state: newState(),
  render: defaultRender(), // réglages 3D : hors historique
  ui: { selected: null, vertex: null, wall: 0, light: null, tool: 'select', addType: 'furniture' },
  history: [],
  future: [],

  // kind : 'plan' (contenu), 'select' (sélection), 'tool' (outil actif), 'render' (réglages 3D)
  subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  emit(kind) { for (const fn of listeners) fn(kind); },

  newId(prefix) { const id = `${prefix}${nextId}`; nextId += 1; return id; },

  snapshot() { normalize(this.state); return JSON.stringify(this.state); },

  // À appeler une fois avant une série de modifications (un glissé = un seul pas d'annulation).
  checkpoint() {
    this.history.push(this.snapshot());
    if (this.history.length > HISTORY_MAX) this.history.shift();
    this.future = [];
  },

  // Notifie une modification du contenu et programme la sauvegarde locale.
  changed() {
    normalize(this.state);
    this.emit('plan');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => this.save(), 400);
  },

  edit(fn) { this.checkpoint(); fn(this.state); this.changed(); },

  undo() {
    if (!this.history.length) return false;
    this.future.push(this.snapshot());
    this.state = JSON.parse(this.history.pop());
    this.clearSelection();
    this.changed();
    return true;
  },
  redo() {
    if (!this.future.length) return false;
    this.history.push(this.snapshot());
    this.state = JSON.parse(this.future.pop());
    this.clearSelection();
    this.changed();
    return true;
  },

  // Remplace tout le plan (nouveau plan, import). Annulable.
  replace(state, render) {
    this.checkpoint();
    this.state = normalize(state);
    if (render) this.setRender(render, { silent: true });
    this.syncNextId();
    this.clearSelection();
    this.changed();
    this.emit('render');
  },

  syncNextId() {
    const all = [...this.state.items, ...this.state.columns, ...this.state.lights];
    const max = Math.max(0, ...all.map((x) => Number((String(x.id || '').match(/\d+/g) || []).join('')) || 0));
    nextId = Math.max(nextId, max + 1);
  },

  // ── Sélection ──
  select({ id = null, vertex = null, wall, light = null } = {}) {
    this.ui.selected = id;
    this.ui.vertex = vertex;
    if (wall !== undefined) this.ui.wall = wall;
    this.ui.light = light;
    this.emit('select');
  },
  clearSelection() { this.select({}); },
  setTool(tool) { this.ui.tool = tool; this.emit('tool'); },

  get selectedItem() { return this.state.items.find((i) => i.id === this.ui.selected) || null; },
  get selectedColumn() { return this.state.columns.find((c) => c.id === this.ui.selected) || null; },
  get selectedLight() { return this.state.lights.find((l) => l.id === this.ui.light) || null; },

  // ── Verrouillage : un élément verrouillé reste sélectionnable mais ne se modifie plus ──
  isLocked(id = this.ui.light || this.ui.selected) {
    if (!id) return false;
    if (id === 'room') return this.state.roomLocked === true;
    const target = this.state.items.find((i) => i.id === id)
      || this.state.columns.find((c) => c.id === id)
      || this.state.lights.find((l) => l.id === id);
    return target?.locked === true;
  },
  toggleLock() {
    const id = this.ui.light || this.ui.selected;
    if (!id) return;
    this.checkpoint();
    if (id === 'room') this.state.roomLocked = !this.state.roomLocked;
    else {
      const target = this.selectedItem || this.selectedColumn || this.selectedLight;
      if (target) target.locked = !target.locked;
    }
    this.changed();
  },

  // ── Rendu 3D ──
  setRender(patch, { silent = false } = {}) {
    this.render = { ...this.render, ...patch };
    write(RENDER_KEY, this.render);
    if (!silent) this.emit('render');
  },

  // ── Persistance locale ──
  save() { write(PLAN_KEY, projectForExport(this.state, this.render)); },

  load() {
    const saved = read(RENDER_KEY);
    if (saved) this.render = { ...defaultRender(), ...saved };
    const plan = read(PLAN_KEY);
    if (plan) {
      try {
        const loaded = validateProject(plan);
        this.state = loaded.state;
        this.render = { ...this.render, ...loaded.render };
      } catch { /* sauvegarde illisible : on repart d'un plan vide */ }
    }
    this.syncNextId();
  },
};
