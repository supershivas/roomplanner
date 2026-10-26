// Menus déroulants du bandeau (même mécanique que l'éditeur de schémas)
export class MenuBar {
  constructor(itemIds) {
    this.items = itemIds.map(({ triggerId, dropdownId }) => ({
      trigger: document.getElementById(triggerId),
      dropdown: document.getElementById(dropdownId),
    }));

    for (const item of this.items) {
      item.trigger.addEventListener('click', (event) => {
        event.stopPropagation();
        const wasOpen = !item.dropdown.hidden;
        this.closeAll();
        if (!wasOpen) this.open(item);
      });
    }

    document.addEventListener('click', () => this.closeAll());
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') this.closeAll();
    });
  }

  open(item) {
    item.dropdown.hidden = false;
    item.trigger.setAttribute('aria-expanded', 'true');
    item.trigger.parentElement.classList.add('menubar__item--open');
  }

  closeAll() {
    for (const item of this.items) {
      item.dropdown.hidden = true;
      item.trigger.setAttribute('aria-expanded', 'false');
      item.trigger.parentElement.classList.remove('menubar__item--open');
    }
  }

  // Ferme le menu puis lance l'action : menuBar.onAction('menu-undo', () => store.undo())
  onAction(id, handler) {
    document.getElementById(id).addEventListener('click', () => {
      this.closeAll();
      handler();
    });
  }
}
