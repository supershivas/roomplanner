// Applique design-tokens.json (synchronisé depuis le design system) aux variables CSS.
// Les valeurs par défaut de css/roomplanner.css servent de repli si le fichier est absent.
export async function applyTokens() {
  try {
    const res = await fetch('design-tokens.json', { cache: 'no-store' });
    if (!res.ok) return;
    const t = await res.json();
    const root = document.documentElement.style;
    const set = (name, value) => { if (value !== undefined) root.setProperty(name, value); };
    const c = t.colors;
    set('--accent', c.accentFixed);
    set('--accent-hover', c.accentFixedHover);
    set('--accent-fg', c.accentFixedFg);
    set('--bg', c.sidebarBg);
    set('--fg', c.sidebarFg);
    set('--muted', c.sidebarMuted);
    set('--icon', c.sidebarIcon);
    set('--hover', c.sidebarHover);
    set('--selected', c.sidebarSelected);
    set('--selected-fg', c.sidebarSelectedFg);
    set('--border', c.sidebarBorder);
    set('--radius-sm', t.radii.sm);
    set('--radius-md', t.radii.md);
    set('--radius-lg', t.radii.lg);
    set('--font-sans', t.fonts.sans);
    set('--font-title', t.fonts.title);
    set('--font-mono', t.fonts.mono);
    set('--overlay', t.modal.overlayBackground);
    set('--header-h', t.sidebarHeader.minHeight);
  } catch { /* repli sur les valeurs du CSS */ }
}
