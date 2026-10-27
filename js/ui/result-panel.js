export const OPTIMIZE_RESULT_TABS = Object.freeze(['recipe', 'thermal', 'water-pressure', 'summary', 'ternary']);
export const WHAT_IF_RESULT_TABS = Object.freeze(['recipe', 'thermal', 'water-pressure', 'summary', 'ternary']);

export function getResultTabs(mode = 'optimize') {
  return mode === 'what-if' ? WHAT_IF_RESULT_TABS : OPTIMIZE_RESULT_TABS;
}

export function getResultElement(root, key) {
  if (!root) return null;
  const selector = `[data-result-key="${String(key).replaceAll('"', '\\"')}"]`;
  return root.querySelector?.(selector)
    ?? root.querySelector?.(`#${String(key).replaceAll('"', '\\"')}`)
    ?? (root === document ? root.getElementById(key) : null);
}
const ACTIVE_TAB_CLASSES = 'shrink-0 px-3.5 py-2 rounded-lg text-xs font-semibold bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-sm transition';
const INACTIVE_TAB_CLASSES = 'shrink-0 px-3.5 py-2 rounded-lg text-xs font-semibold text-slate-400 hover:text-slate-200 transition';

export function setResultTabState(root, tabId, tabs = OPTIMIZE_RESULT_TABS) {
  if (!tabs.includes(tabId)) return false;
  const scope = root ?? (typeof document !== 'undefined' ? document : null);
  if (!scope) return false;
  for (const tab of tabs) {
    const selected = tab === tabId;
    const pane = scope.querySelector?.(`[data-result-key="tab-pane-${tab}"]`) ?? scope.getElementById?.(`tab-pane-${tab}`);
    const button = scope.querySelector?.(`[data-result-key="tab-btn-${tab}"]`) ?? scope.getElementById?.(`tab-btn-${tab}`);
    if (pane) {
      pane.hidden = !selected;
      pane.classList?.toggle('hidden', !selected);
      pane.setAttribute('aria-hidden', String(!selected));
      const paneId = pane.id || pane.getAttribute?.('id') || `tab-pane-${tab}`;
      const buttonId = button?.id || button?.getAttribute?.('id') || `tab-btn-${tab}`;
      pane.setAttribute('aria-labelledby', buttonId);
      if (button) button.setAttribute('aria-controls', paneId);
    }
    if (button) {
      button.className = selected ? ACTIVE_TAB_CLASSES : INACTIVE_TAB_CLASSES;
      button.setAttribute('aria-selected', String(selected));
      button.tabIndex = selected ? 0 : -1;
    }
  }
  return true;
}

export function createResultPanel(document, host, { mode = 'optimize', instancePrefix = '' } = {}) {
  const template = document.getElementById('result-panel-template');
  if (!template || !host) return null;
  const fragment = template.content.cloneNode(true);
  const root = fragment.firstElementChild;
  if (!root) return null;
  root.dataset.resultMode = mode;
  root.dataset.instancePrefix = instancePrefix;
  if (mode !== 'what-if') root.querySelectorAll?.('[data-what-if-only]').forEach(element => element.remove());
  if (mode !== 'optimize') root.querySelectorAll?.('[data-blending-only]').forEach(element => element.remove());
  root.querySelectorAll?.('[id]').forEach(element => {
    const logical = element.id;
    element.dataset.resultKey ??= logical;
    element.id = `${instancePrefix}${logical}`;
  });
  root.querySelectorAll?.('[aria-controls],[aria-labelledby],[aria-describedby]').forEach(element => {
    for (const attribute of ['aria-controls', 'aria-labelledby', 'aria-describedby']) {
      const value = element.getAttribute(attribute);
      if (value) element.setAttribute(attribute, value.split(/\s+/).map(id => `${instancePrefix}${id}`).join(' '));
    }
  });
  const allowed = new Set(getResultTabs(mode));
  root.querySelectorAll?.('[data-action="select-tab"]').forEach(button => {
    if (!allowed.has(button.dataset.tab)) button.remove();
    else button.dataset.resultKey ??= `tab-btn-${button.dataset.tab}`;
  });
  const initialTab = 'recipe';
  setResultTabState(root, initialTab, getResultTabs(mode));
  host.replaceChildren(root);
  return root;
}

if (typeof document !== 'undefined') {
  const mount = () => {
    const template = document.getElementById('result-panel-template');
    const blending = document.getElementById('blending-result-host');
    const whatIf = document.getElementById('what-if-result-host');
    if (template && blending && whatIf) {
      createResultPanel(document, blending, { mode: 'optimize', instancePrefix: 'blend-' });
      createResultPanel(document, whatIf, { mode: 'what-if', instancePrefix: 'what-if-' });
    }
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true });
  else mount();
}
