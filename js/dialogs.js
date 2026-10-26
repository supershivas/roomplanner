// Toasts et boîtes de dialogue de l'app (jamais window.alert / confirm / prompt).
const $ = (id) => document.getElementById(id);

let toastTimer;
// Le toast est un popover : il passe au-dessus des <dialog> ouverts.
export function toast(text) {
  const el = $('toast');
  el.textContent = text;
  try { if (!el.matches(':popover-open')) el.showPopover(); } catch { /* popover non supporté */ }
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { try { el.hidePopover(); } catch { /* idem */ } }, 3200);
}

function ask(dialog, onOpen, readResult) {
  return new Promise((resolve) => {
    let result = null;
    const done = (accepted) => { result = accepted ? readResult() : null; dialog.close(); };
    const yes = $(`${dialog.id}-yes`);
    const no = $(`${dialog.id}-no`);
    const onYes = () => done(true);
    const onNo = () => done(false);
    yes.addEventListener('click', onYes);
    no.addEventListener('click', onNo);
    dialog.addEventListener('close', () => {
      yes.removeEventListener('click', onYes);
      no.removeEventListener('click', onNo);
      resolve(result);
    }, { once: true });
    onOpen();
    dialog.showModal();
  });
}

export function confirmDialog(title, text, okLabel = 'Confirmer') {
  const dialog = $('confirm');
  return ask(dialog, () => {
    $('confirm-title').textContent = title;
    $('confirm-text').textContent = text;
    $('confirm-yes').textContent = okLabel;
  }, () => true).then((v) => v === true);
}

// Saisie d'un nombre ; renvoie null si annulé.
export function numberDialog(title, label, value) {
  const dialog = $('prompt');
  const input = $('prompt-input');
  return ask(dialog, () => {
    $('prompt-title').textContent = title;
    $('prompt-label').textContent = label;
    input.value = String(value);
    setTimeout(() => { input.focus(); input.select(); }, 30);
  }, () => {
    const n = Number(input.value.replace(',', '.'));
    return Number.isFinite(n) ? n : null;
  });
}

export function initDialogs() {
  document.querySelectorAll('dialog [data-close]').forEach((b) => b.addEventListener('click', () => b.closest('dialog').close()));
  document.querySelectorAll('dialog.modal').forEach((d) => d.addEventListener('click', (e) => { if (e.target === d) d.close(); }));
  $('prompt-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $('prompt-yes').click(); } });
}

export function closeAllDialogs() {
  document.querySelectorAll('dialog[open]').forEach((d) => d.close());
}

let hintTimer;
// Message d'aide ou de confirmation affiché en bas de la scène.
export function say(text, ms = 5000) {
  const el = $('hint');
  el.textContent = text;
  clearTimeout(hintTimer);
  if (ms) hintTimer = setTimeout(() => { if (el.textContent === text) el.textContent = ''; }, ms);
}
