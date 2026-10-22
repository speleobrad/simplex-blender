export const OPTIMIZE_RESULT_TABS = Object.freeze(['recipe', 'thermal', 'water-pressure', 'summary', 'ternary']);
export const WHAT_IF_RESULT_TABS = Object.freeze(['scenario-summary', 'recipe', 'thermal', 'water-pressure', 'summary', 'ternary']);

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

export function createResultPanel(document, host, { mode = 'optimize', instancePrefix = '' } = {}) {
  const template = document.getElementById('result-panel-template');
  if (!template || !host) return null;
  const fragment = template.content.cloneNode(true);
  const root = fragment.firstElementChild;
  if (!root) return null;
  root.dataset.resultMode = mode;
  root.dataset.instancePrefix = instancePrefix;
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
  const initialTab = mode === 'what-if' ? 'scenario-summary' : 'recipe';
  root.querySelectorAll?.('[data-result-key^="tab-pane-"]').forEach(pane => { pane.hidden = pane.dataset.resultKey !== `tab-pane-${initialTab}`; });
  root.querySelectorAll?.('[data-action="select-tab"]').forEach(button => {
    const selected = button.dataset.tab === initialTab;
    button.setAttribute('aria-selected', String(selected));
    button.tabIndex = selected ? 0 : -1;
  });
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
