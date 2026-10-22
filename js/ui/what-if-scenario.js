import { convertToDisplay, formatInputValue, unitLabel } from '../units.js';
import { renderCompareRecipe } from './compare-recipe.js';

const inputClass = 'w-full rounded border border-ocean-700 bg-ocean-900 px-2 py-1 font-mono text-xs text-slate-100';
const fields = [
  ['pressureBar', 'Starting pressure', 'number', 'pressureBar'],
  ['oxygenPercent', 'Starting O₂ (%)', 'number'],
  ['heliumPercent', 'Starting He (%)', 'number'],
  ['ambientTemperatureC', 'Ambient temperature', 'number', 'temperatureC'],
  ['coolingMedium', 'Surrounding medium', 'select'],
  ['inWaterTemperatureC', 'In-water temperature', 'number', 'temperatureC']
];
function el(tag, attrs = {}, text) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) if (value !== undefined) node.setAttribute(key, value);
  if (text !== undefined) node.textContent = text;
  return node;
}
function addFieldError(wrapper, control, errors, field) {
  const messages = errors.filter(error => error.rowId === null && error.field === field);
  if (!messages.length) return;
  const errorId = `what-if-${field}-error`;
  control.setAttribute('aria-invalid', 'true');
  control.setAttribute('aria-describedby', errorId);
  wrapper.append(el('p', {
    id: errorId,
    class: 'text-[10px] text-rose-300'
  }, messages.map(error => error.message).join(' ')));
}
function labelled(field, label, control, quantity, units, errors = []) {
  const wrap = el('div', { class: 'block space-y-1 text-xs text-slate-300' });
  const suffix = quantity ? ` (${unitLabel(quantity, units)})` : '';
  const labelNode = el('label', { for: `what-if-${field}` }, `${label}${suffix}`);
  control.id = `what-if-${field}`;
  wrap.append(labelNode, control);
  addFieldError(wrap, control, errors, field);
  return wrap;
}
function valueFor(start, field, quantity, units) {
  const value = start?.[field];
  return quantity && Number.isFinite(value) ? formatInputValue(value, quantity, units) : (value ?? '');
}

export function renderWhatIfScenarioEditor(container, { scenario = {}, cylinderPresets = [], units = 'metric', errors = [], sharedInputChanged = false, banks = [], pressureStarts = {} } = {}) {
  const root = el('div', { class: 'space-y-4' });
  const status = el('div', { role: 'status', class: 'text-xs text-slate-400', 'data-what-if-status': 'copied' }, scenario.initialized ? 'Starting state copied from Blending; edits are independent.' : 'Starting state not copied yet.');
  if (sharedInputChanged) status.append(' ', el('span', { 'data-what-if-status': 'shared-stale', class: 'text-amber-300' }, 'Out of date — shared inputs changed'));
  root.append(status);
  const start = scenario.start ?? {};
  const startFieldset = el('fieldset', { class: 'space-y-3 rounded-xl border border-ocean-800 p-3' });
  startFieldset.append(el('legend', { class: 'px-1 text-xs font-semibold text-slate-200' }, 'Starting tank'));
  const copy = el('button', { type: 'button', 'data-action': 'copy-what-if-from-blending', class: 'rounded border border-ocean-700 px-2 py-1 text-xs text-cyan-300' }, 'Copy from Blending');
  startFieldset.append(copy);
  for (const [field, label, type, quantity] of fields.slice(0, 3)) {
    const input = el('input', { class: inputClass, type, 'data-what-if-field': field, value: valueFor(start, field, quantity, units), inputmode: 'decimal' });
    startFieldset.append(labelled(field, label, input, quantity, units, errors));
  }
  const cylinder = el('select', { class: inputClass, 'data-what-if-field': 'cylinderPresetName' });
  for (const preset of cylinderPresets) cylinder.append(el('option', { value: preset.name, selected: preset.name === start.cylinderPresetName ? '' : undefined }, preset.name));
  startFieldset.append(labelled('cylinderPresetName', 'Cylinder preset', cylinder, null, units, errors));
  const selected = cylinderPresets.find(item => item.name === start.cylinderPresetName);
  if (selected) {
    const hint = `${convertToDisplay(selected.volumeL, 'volumeL', units)} ${unitLabel('volumeL', units)} · ${selected.material ?? ''} · ${convertToDisplay(selected.massKg, 'massKg', units)} ${unitLabel('massKg', units)} · ${convertToDisplay(selected.workingPressureBar, 'pressureBar', units)} ${unitLabel('pressureBar', units)} working pressure`;
    startFieldset.append(el('p', { class: 'text-[10px] text-slate-400', 'data-cylinder-hint': '' }, hint));
  }
  root.append(startFieldset);
  const condition = el('fieldset', { class: 'space-y-3 rounded-xl border border-ocean-800 p-3' });
  condition.append(el('legend', { class: 'px-1 text-xs font-semibold text-slate-200' }, 'Scenario conditions'));
  for (const [field, label, type, quantity] of [fields[3], fields[4], fields[5]]) {
    let control;
    if (type === 'select') { control = el('select', { class: inputClass, 'data-what-if-field': field }); for (const value of ['air', 'water']) control.append(el('option', { value, selected: value === start[field] ? '' : undefined }, value)); }
    else control = el('input', { class: inputClass, type, 'data-what-if-field': field, value: valueFor(start, field, quantity, units), inputmode: 'decimal' });
    condition.append(labelled(field, label, control, quantity, units, errors));
  }
  root.append(condition);
  const rows = el('div', { 'data-what-if-rows': '' });
  root.append(rows);
  container.replaceChildren(root);
  renderCompareRecipe(rows, { rows: scenario.rows ?? [], banks, errors, pressureStarts, units, whatIf: true });
}
