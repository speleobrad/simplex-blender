export const PRIMARY_SCREENS = Object.freeze(['blending', 'what-if', 'inventory', 'settings', 'about']);

const ACTIVE_NAV_CLASSES = 'primary-nav-button rounded-lg border border-cyan-500/40 bg-cyan-500/20 px-3 py-1.5 text-xs font-semibold text-cyan-300 shadow-sm transition';
const INACTIVE_NAV_CLASSES = 'primary-nav-button rounded-lg px-3 py-1.5 text-xs font-semibold text-slate-400 transition hover:text-slate-200';

export function setPrimaryScreen(document, screenId) {
  if (!PRIMARY_SCREENS.includes(screenId)) return false;

  for (const screen of PRIMARY_SCREENS) {
    const selected = screen === screenId;
    const pane = document.getElementById(`screen-${screen}`);
    if (pane) {
      pane.hidden = !selected;
      pane.classList?.toggle('hidden', !selected);
      pane.setAttribute('aria-hidden', String(!selected));
    }

    const button = document.querySelector?.(`[data-action="select-screen"][data-screen="${screen}"]`);
    if (button) {
      if (button.hasAttribute?.('data-nav-icon')) {
        button.classList?.toggle('bg-cyan-500/20', selected);
        button.classList?.toggle('text-cyan-300', selected);
        button.classList?.toggle('text-slate-300', !selected);
      } else {
        button.className = selected ? ACTIVE_NAV_CLASSES : INACTIVE_NAV_CLASSES;
      }
      button.setAttribute('aria-current', selected ? 'page' : 'false');
      if (!button.hasAttribute?.('data-nav-icon')) button.setAttribute('aria-selected', String(selected));
    }
  }


  return true;
}
