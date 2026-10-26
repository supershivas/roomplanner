// Fenêtres déroulantes ancrées à un bouton (catalogue, liste, rendu, couleurs).
// Position fixe : la barre d'outils défile horizontalement et couperait un élément absolu.
const $ = (id) => document.getElementById(id);
let current = null; // { pop, anchor }

export function closePopovers() {
  if (!current) return;
  current.pop.hidden = true;
  current.anchor.setAttribute('aria-expanded', 'false');
  current = null;
}

export function openPopover(pop, anchor) {
  closePopovers();
  pop.hidden = false;
  anchor.setAttribute('aria-expanded', 'true');
  const a = anchor.getBoundingClientRect();
  const margin = 12;
  const width = Math.min(pop.offsetWidth, window.innerWidth - margin * 2);
  const left = Math.max(margin, Math.min(a.left, window.innerWidth - width - margin));
  pop.style.left = `${left}px`;
  pop.style.top = `${a.bottom + 6}px`;
  pop.style.maxHeight = `${window.innerHeight - a.bottom - 6 - margin}px`;
  current = { pop, anchor };
}

export function togglePopover(pop, anchor) {
  if (current?.pop === pop) closePopovers();
  else openPopover(pop, anchor);
}

export function initPopovers() {
  document.querySelectorAll('[data-pop]').forEach((btn) => {
    btn.addEventListener('click', (e) => { e.stopPropagation(); togglePopover($(btn.dataset.pop), btn); });
  });
  document.addEventListener('click', (e) => {
    if (current && !current.pop.contains(e.target) && !current.anchor.contains(e.target)) closePopovers();
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closePopovers(); });
  window.addEventListener('resize', closePopovers);
}
