export const OPTIMIZE_RESULT_TABS = Object.freeze(['recipe', 'thermal', 'water-pressure', 'summary', 'ternary']);
export const WHAT_IF_RESULT_TABS = Object.freeze(['scenario-summary', 'recipe', 'thermal', 'water-pressure', 'summary', 'ternary']);

export function getResultTabs(mode = 'optimize') {
  return mode === 'what-if' ? WHAT_IF_RESULT_TABS : OPTIMIZE_RESULT_TABS;
}

export function getResultElement(root, key) {
  if (!root) return null;
  const selector = `[data-result-key="${String(key).replaceAll('"', '\\"')}"]`;
  return root.querySelector?.(selector) ?? root.getElementById?.(key) ?? null;
}

export function createResultPanel(document, host, { mode = 'optimize', instancePrefix = '' } = {}) {
  const template = document.getElementById('result-panel-template');
  if (!template || !host) return null;
  const fragment = template.content.cloneNode(true);
  const root = fragment.firstElementChild;
  if (!root) return null;
  root.dataset.resultMode = mode;
  root.dataset.instancePrefix = instancePrefix;
  host.replaceChildren(root);
  return root;
}
