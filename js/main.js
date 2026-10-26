// Point d'entrée : branche le plan 2D, la vue 3D, le panneau, les menus et les réglages.
import { store } from './store.js';
import { applyTokens } from './tokens.js';
import { MenuBar } from './menuBar.js';
import { createPlan2d } from './plan2d.js';
import { createView3d } from './view3d.js';
import { initPanel } from './panel.js';
import { initDialogs, closeAllDialogs, toast, say } from './dialogs.js';
import * as actions from './actions.js';
import { projectForExport, validateProject } from './model.js';
import { startUpdateCheck, loadChangelog, loadVersion, downloadJSON } from './app-update.js';

const $ = (id) => document.getElementById(id);
const EDITING = /^(INPUT|TEXTAREA|SELECT)$/;

let view = 'plan';
const plan = createPlan2d($('plan'));
const view3d = createView3d($('pane-3d'), { onUnavailable: () => toast('La 3D n’est pas disponible sur cet appareil (WebGL requis).') });

// ── Fichiers ───────────────────────────────────────────────────────────────
function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const stamp = () => new Date().toISOString().slice(0, 10).replaceAll('-', '');

async function exportData() {
  const version = await loadVersion();
  downloadJSON({ appVersion: version, ...projectForExport(store.state, store.render) }, `roomplanner-${stamp()}.json`);
}

async function importText(text, successMessage) {
  try {
    const { state, render } = validateProject(JSON.parse(text));
    store.replace(state, render);
    store.setTool('select');
    plan.fit();
    view3d.resetView();
    toast(successMessage || `Plan importé : ${state.room.length} sommets, ${state.items.length} objet(s).`);
  } catch (err) {
    toast(`Import impossible : ${err.message || 'fichier invalide'}`);
  }
}

async function openFile(file) {
  if (file) await importText(await file.text());
}

async function openExample() {
  try {
    const res = await fetch('exemples/plan-exemple.json', { cache: 'no-store' });
    if (!res.ok) throw new Error('exemple introuvable');
    await importText(await res.text(), 'Plan d’exemple ouvert.');
  } catch (err) {
    toast(`Impossible d’ouvrir l’exemple : ${err.message}`);
  }
}

function exportSvg() {
  if (view !== 'plan') setView('plan');
  downloadBlob(new Blob([plan.exportSvg()], { type: 'image/svg+xml' }), `roomplanner-${stamp()}.svg`);
}

function takeSnapshot() {
  const capture = () => {
    const url = view3d.snapshot();
    if (!url) { toast('Image indisponible : ouvre la vue 3D d’abord.'); return; }
    const a = document.createElement('a');
    a.href = url;
    a.download = `roomplanner-3d-${stamp()}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    toast('Image enregistrée.');
  };
  if (view !== '3d') {
    setView('3d');
    requestAnimationFrame(() => requestAnimationFrame(capture));
  } else capture();
}

// ── Vues et outils ─────────────────────────────────────────────────────────
function setView(next) {
  view = next;
  $('pane-plan').hidden = next !== 'plan';
  $('pane-3d').hidden = next !== '3d';
  document.querySelectorAll('#tabs [data-view]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.view === next)));
  document.querySelectorAll('#tools [data-tool]').forEach((b) => { b.disabled = next === '3d' && b.dataset.tool !== 'select'; });
  $('btn-grid').disabled = next === '3d';
  if (next === '3d') {
    plan.cancel();
    if (store.ui.tool !== 'select') store.setTool('select');
    say('Vue 3D : glisse un objet pour le déplacer, le fond pour tourner, la molette pour zoomer.', 6000);
  } else say('', 0);
  view3d.setActive(next === '3d');
  if (next === 'plan') plan.render();
}

function syncTools() {
  document.querySelectorAll('#tools [data-tool]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tool === store.ui.tool)));
}
document.querySelectorAll('#tools [data-tool]').forEach((b) => b.addEventListener('click', () => store.setTool(b.dataset.tool)));
document.querySelectorAll('#tabs [data-view]').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));

let gridOn = true;
$('btn-grid').addEventListener('click', () => {
  gridOn = !gridOn;
  $('btn-grid').setAttribute('aria-pressed', String(gridOn));
  plan.setGrid(gridOn);
});
$('btn-fit').addEventListener('click', () => (view === '3d' ? view3d.resetView() : plan.fit()));
$('btn-reset-view').addEventListener('click', () => view3d.resetView());
$('btn-snapshot').addEventListener('click', takeSnapshot);

// ── Annuler / rétablir ─────────────────────────────────────────────────────
function syncHistoryButtons() {
  const canUndo = store.history.length > 0;
  const canRedo = store.future.length > 0;
  ['btn-undo', 'menu-undo'].forEach((id) => { $(id).disabled = !canUndo; });
  ['btn-redo', 'menu-redo'].forEach((id) => { $(id).disabled = !canRedo; });
  const hasSel = !!(store.ui.selected && store.ui.selected !== 'room') || !!store.ui.light;
  $('menu-duplicate').disabled = !(store.selectedItem || store.selectedLight);
  $('menu-delete').disabled = !hasSel;
}

store.subscribe((kind) => {
  if (kind === 'plan') plan.render();
  if (kind === 'select') plan.render();
  if (kind === 'tool') { syncTools(); plan.render(); }
  syncHistoryButtons();
});

// ── Menus ──────────────────────────────────────────────────────────────────
const menus = new MenuBar([
  { triggerId: 'menu-file-trigger', dropdownId: 'menu-file-dropdown' },
  { triggerId: 'menu-edit-trigger', dropdownId: 'menu-edit-dropdown' },
]);
menus.onAction('menu-new', async () => { if (await actions.newPlan()) { if (view !== 'plan') setView('plan'); plan.render(); } });
menus.onAction('menu-open', () => $('open-input').click());
menus.onAction('menu-save', exportData);
menus.onAction('menu-example', openExample);
menus.onAction('menu-export-svg', exportSvg);
menus.onAction('menu-export-png', takeSnapshot);
menus.onAction('menu-undo', () => store.undo());
menus.onAction('menu-redo', () => store.redo());
menus.onAction('menu-duplicate', actions.duplicateSelected);
menus.onAction('menu-delete', actions.deleteSelected);
$('open-input').addEventListener('change', async (e) => { const f = e.target.files[0]; e.target.value = ''; await openFile(f); });
$('btn-undo').addEventListener('click', () => store.undo());
$('btn-redo').addEventListener('click', () => store.redo());

// État vide
$('empty-draw').addEventListener('click', () => store.setTool('wall'));
$('empty-rect').addEventListener('click', () => { actions.makeRectangle(500, 400); plan.fit(); });
$('empty-example').addEventListener('click', openExample);

// ── Nom de l'app : retour à l'accueil, depuis n'importe quelle vue ─────────
$('brand').addEventListener('click', (e) => {
  e.preventDefault();
  closeAllDialogs();
  menus.closeAll();
  plan.cancel();
  store.setTool('select');
  store.clearSelection();
  setView('plan');
  plan.fit();
});

// ── Réglages ───────────────────────────────────────────────────────────────
async function openSettings() {
  $('settings').showModal();
  const [version, entries] = await Promise.all([loadVersion(), loadChangelog()]);
  $('s-version').textContent = `v${version ?? '?'}`;
  $('s-changelog').replaceChildren(...entries.map((en) => {
    const li = document.createElement('li');
    const b = document.createElement('b');
    b.textContent = `v${en.version}`;
    li.append(b, ` · ${en.date}`);
    const inner = document.createElement('ul');
    en.changes.forEach((c) => { const l = document.createElement('li'); l.textContent = c; inner.append(l); });
    li.append(inner);
    return li;
  }));
}
$('open-settings').addEventListener('click', openSettings);
$('s-export').addEventListener('click', exportData);
$('s-import').addEventListener('click', () => { $('settings').close(); $('open-input').click(); });

// ── Clavier ────────────────────────────────────────────────────────────────
window.addEventListener('keydown', (e) => {
  const typing = EDITING.test(document.activeElement?.tagName) || document.activeElement?.isContentEditable;
  const mod = e.ctrlKey || e.metaKey;
  const key = e.key.toLowerCase();
  if (document.querySelector('dialog[open]')) return;
  if (mod && key === 'z') { if (typing) return; e.preventDefault(); if (e.shiftKey) store.redo(); else store.undo(); return; }
  if (mod && key === 'y') { if (typing) return; e.preventDefault(); store.redo(); return; }
  if (mod && key === 's') { e.preventDefault(); exportData(); return; }
  if (mod && key === 'o') { e.preventDefault(); $('open-input').click(); return; }
  if (typing) return;
  if (mod && key === 'd') { e.preventDefault(); actions.duplicateSelected(); return; }
  if (key === 'escape') {
    if (plan.isDrafting || store.ui.tool !== 'select') { plan.cancel(); store.setTool('select'); } else store.clearSelection();
    return;
  }
  if ((key === 'delete' || key === 'backspace') && !(store.ui.tool === 'wall' && plan.isDrafting)) {
    if (store.ui.selected || store.ui.light) { e.preventDefault(); actions.deleteSelected(); }
    return;
  }
  const tools = { v: 'select', w: 'wall', o: 'object', m: 'measure' };
  if (!mod && tools[key] && view === 'plan') { store.setTool(tools[key]); return; }
  const arrows = { arrowleft: [-1, 0], arrowright: [1, 0], arrowup: [0, -1], arrowdown: [0, 1] };
  if (arrows[key] && (store.selectedItem || store.selectedLight)) {
    e.preventDefault();
    const step = e.shiftKey ? 10 : 1;
    const [dx, dy] = arrows[key];
    store.checkpoint();
    const it = store.selectedItem;
    if (it) { it.x += dx * step; it.y += dy * step; delete it.wallIndex; } else { const l = store.selectedLight; l.x += dx * step; l.planY += dy * step; }
    store.changed();
  }
});

// ── Démarrage ──────────────────────────────────────────────────────────────
initDialogs();
applyTokens();
store.load();
initPanel({ onSnapshot: takeSnapshot });
syncTools();
syncHistoryButtons();
store.emit('plan');
store.emit('render');
requestAnimationFrame(() => plan.fit());
startUpdateCheck({ versionUrl: 'version.json', onUpdated: (v) => toast(`Mis à jour en v${v}`) });

window.roomplanner = { store, plan, view3d }; // pratique pour le débogage en console
