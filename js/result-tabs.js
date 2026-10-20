export const RESULT_TABS = Object.freeze([
  'recipe',
  'ternary',
  'thermal',
  'summary',
  'water-pressure'
]);

const ACTIVE_TAB_CLASSES = 'shrink-0 px-3.5 py-2 rounded-lg text-xs font-semibold bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-sm transition';
const INACTIVE_TAB_CLASSES = 'shrink-0 px-3.5 py-2 rounded-lg text-xs font-semibold text-slate-400 hover:text-slate-200 transition';

export function setResultTab(document, tabId) {
  if (!RESULT_TABS.includes(tabId)) return false;

  for (const tab of RESULT_TABS) {
    const selected = tab === tabId;
    const pane = document.getElementById(`tab-pane-${tab}`);
    const button = document.getElementById(`tab-btn-${tab}`);
    if (pane) {
      pane.hidden = !selected;
      pane.classList?.toggle('hidden', !selected);
      pane.setAttribute('aria-hidden', String(!selected));
      pane.setAttribute('aria-labelledby', `tab-btn-${tab}`);
    }
    if (button) {
      button.className = selected ? ACTIVE_TAB_CLASSES : INACTIVE_TAB_CLASSES;
      button.setAttribute('aria-selected', String(selected));
      button.setAttribute('aria-controls', `tab-pane-${tab}`);
      button.tabIndex = selected ? 0 : -1;
      if (selected) button.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    }
  }

  return true;
}
