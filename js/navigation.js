export const PRIMARY_SCREENS = Object.freeze(['blending', 'what-if', 'inventory', 'settings']);

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
      button.className = selected ? ACTIVE_NAV_CLASSES : INACTIVE_NAV_CLASSES;
      button.setAttribute('aria-current', selected ? 'page' : 'false');
      button.setAttribute('aria-selected', String(selected));
    }
  }


  return true;
}
