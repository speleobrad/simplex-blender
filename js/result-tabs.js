import { getResultTabs } from './ui/result-panel.js';

export const RESULT_TABS = getResultTabs('optimize');
const ACTIVE_TAB_CLASSES = 'shrink-0 px-3.5 py-2 rounded-lg text-xs font-semibold bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-sm transition';
const INACTIVE_TAB_CLASSES = 'shrink-0 px-3.5 py-2 rounded-lg text-xs font-semibold text-slate-400 hover:text-slate-200 transition';

export function setResultTab(root, tabId, tabs = getResultTabs('optimize')) {
  if (!tabs.includes(tabId)) return false;
  const scope = root ?? document;
  for (const tab of tabs) {
    const selected = tab === tabId;
    const pane = scope.querySelector?.(`[data-result-key="tab-pane-${tab}"]`) ?? scope.getElementById?.(`tab-pane-${tab}`);
    const button = scope.querySelector?.(`[data-result-key="tab-btn-${tab}"]`) ?? scope.getElementById?.(`tab-btn-${tab}`);
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
