import { getResultTabs, setResultTabState } from './ui/result-panel.js';

export const RESULT_TABS = getResultTabs('optimize');

export function setResultTab(root, tabId, tabs = getResultTabs('optimize')) {
  if (!setResultTabState(root, tabId, tabs)) return false;
  const scope = root ?? document;
  scope.querySelector?.(`[data-result-key="tab-btn-${tabId}"]`)?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  return true;
}
