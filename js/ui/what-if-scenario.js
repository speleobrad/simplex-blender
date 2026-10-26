import { convertToDisplay, formatInputValue, materialLabel, unitLabel } from '../units.js';
import { renderCompareRecipe } from './compare-recipe.js';
import { DEFAULT_WATER_SUBMERSION_PERCENT, WATER_SUBMERSION_PERCENT_OPTIONS } from '../thermodynamics.js';

const inputClass = 'w-full min-w-0 bg-ocean-900 border border-ocean-700 rounded px-2 py-1 font-mono text-slate-100 text-xs';
const selectClass = 'w-full min-w-0 bg-ocean-900 border border-ocean-700 rounded px-2 py-1 text-xs text-slate-200';

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

function valueFor(start, field, quantity, units) {
  const value = start?.[field];
  return quantity && Number.isFinite(value) ? formatInputValue(value, quantity, units) : (value ?? '');
}

function fieldInput(field, start, units, errors, {
  type = 'number',
  quantity = null,
  className = inputClass,
  inputmode = 'decimal'
} = {}) {
  const control = el('input', {
    class: className,
    type,
    'data-what-if-field': field,
    value: valueFor(start, field, quantity, units),
    inputmode
  });
  control.id = `what-if-${field}`;
  return control;
}

function labelled(field, label, control, quantity, units, errors = [], className = 'block space-y-1 text-xs text-slate-300') {
  const wrap = el('div', { class: className });
  const suffix = quantity ? ` (${unitLabel(quantity, units)})` : '';
  const labelNode = el('label', { for: `what-if-${field}` }, `${label}${suffix}`);
  control.id = `what-if-${field}`;
  wrap.append(labelNode, control);
  addFieldError(wrap, control, errors, field);
  return wrap;
}

function renderCurrentField(start, field, label, quantity, units, errors) {
  const wrap = el('div', { class: 'min-w-0' });
  const labelWrap = el('div', { class: 'min-h-[2rem] text-[11px] text-slate-400 mb-0.5' });
  labelWrap.append(el('label', { for: `what-if-${field}` }, `${label}:`));
  const control = fieldInput(field, start, units, errors, { quantity });
  wrap.append(labelWrap, control);
  wrap.append(el('span', { 'data-unit-quantity': quantity === 'pressureBar' ? 'pressure' : 'temperature', class: 'block w-full text-right font-mono text-slate-200' }, unitLabel(quantity, units)));
  addFieldError(wrap, control, errors, field);
  return wrap;
}

function renderGasField(start, field, label, units, errors, color) {
  const wrap = el('div', { class: 'min-w-0' });
  const control = fieldInput(field, start, units, errors, {
    type: 'text',
    className: `w-full min-w-0 bg-${color}-950/40 border border-${color}-900/60 rounded px-2 py-1 text-center text-${color}-400 font-bold`
  });
  wrap.append(el('label', { for: `what-if-${field}`, class: `block text-[10px] text-${color}-400 font-mono mb-0.5` }, label), control);
  addFieldError(wrap, control, errors, field);
  return wrap;
}

function renderScenarioControl(field, label, control, units, errors, quantity = null) {
  const wrap = el('div', { class: 'min-w-0' });
  const labelWrap = el('div', { class: 'min-h-[2rem] text-[11px] text-slate-400 mb-0.5' });
  labelWrap.append(el('label', { for: `what-if-${field}` }, `${label}:`));
  control.id = `what-if-${field}`;
  wrap.append(labelWrap, control);
  if (quantity) {
    wrap.append(el('span', {
      'data-unit-quantity': quantity === 'pressureBar' ? 'pressure' : 'temperature',
      class: 'block w-full text-right font-mono text-slate-200'
    }, unitLabel(quantity, units)));
  }
  addFieldError(wrap, control, errors, field);
  return wrap;
}
function renderScenarioStart(container, { scenario = {}, cylinderPresets = [], gasPresets = [], units = 'metric', errors = [] } = {}) {
  const start = scenario.start ?? {};
  const current = el('div', { class: 'col-span-2 min-w-0 sm:col-span-1 bg-ocean-850/60 p-3 rounded-xl border border-ocean-700/60' });
  current.append(el('div', { class: 'text-[11px] font-bold text-rose-300 mb-2 flex items-center justify-between' }, 'CURRENT'));
  const currentGrid = el('div', { class: 'grid grid-cols-2 gap-2' });
  const gasPreset = el('select', {
    id: 'what-if-current-gas-preset',
    class: 'w-full min-w-0 bg-ocean-900 border border-ocean-700 rounded px-2 py-1 text-xs text-slate-200',
    'aria-label': 'Current gas preset',
    'data-action': 'select-what-if-gas'
  });
  gasPreset.append(el('option', { value: 'custom', selected: gasPresets.every(preset => preset.oxygenPercent !== start.oxygenPercent || preset.heliumPercent !== start.heliumPercent) ? '' : undefined }, 'Custom'));
  for (const preset of gasPresets) {
    const selected = preset.oxygenPercent === start.oxygenPercent && preset.heliumPercent === start.heliumPercent;
    gasPreset.append(el('option', { value: `gas:${preset.name}`, selected: selected ? '' : undefined }, preset.name));
  }
  const gasPresetWrap = el('div', { class: 'col-span-2 min-w-0' });
  gasPresetWrap.append(el('label', { for: 'what-if-current-gas-preset', class: 'block text-[10px] text-slate-400 font-mono mb-0.5' }, 'Gas preset'), gasPreset);
  currentGrid.append(
    renderCurrentField(start, 'pressureBar', 'Start pressure', 'pressureBar', units, errors),
    renderCurrentField(start, 'ambientTemperatureC', 'Ambient temperature', 'temperatureC', units, errors),
    gasPresetWrap,
    renderGasField(start, 'oxygenPercent', '% O₂', units, errors, 'emerald'),
    renderGasField(start, 'heliumPercent', '% He', units, errors, 'amber')
  );
  current.append(currentGrid);

  const scenarioCard = el('div', { class: 'col-span-2 min-w-0 sm:col-span-1 bg-ocean-850/60 p-3 rounded-xl border border-ocean-700/60' });
  scenarioCard.append(el('div', { class: 'text-[11px] font-bold text-emerald-300 mb-2 flex items-center justify-between' }, 'SCENARIO'));
  const scenarioGrid = el('div', { class: 'grid grid-cols-2 gap-2' });
  const copyWrap = el('div', { class: 'col-span-2 min-w-0' });
  copyWrap.append(el('button', {
    type: 'button',
    'data-action': 'copy-what-if-from-blending',
    class: 'w-full rounded-lg border border-ocean-700 px-2.5 py-1.5 text-xs font-semibold text-cyan-300 hover:bg-ocean-800'
  }, 'Copy from Blending'));
  const medium = el('select', { class: selectClass, 'data-what-if-field': 'coolingMedium' });
  for (const value of ['air', 'water']) medium.append(el('option', { value, selected: value === start.coolingMedium ? '' : undefined }, value === 'air' ? 'Air' : 'Water'));
  const inWater = fieldInput('inWaterTemperatureC', start, units, errors, { quantity: 'temperatureC' });
  const submersion = el('select', { class: selectClass, 'data-what-if-field': 'waterSubmersionPercent' });
  const selectedSubmersion = start.waterSubmersionPercent ?? DEFAULT_WATER_SUBMERSION_PERCENT;
  for (const value of WATER_SUBMERSION_PERCENT_OPTIONS) submersion.append(el('option', { value: String(value), selected: value === selectedSubmersion ? '' : undefined }, `${value}%`));
  scenarioGrid.append(
    copyWrap,
    renderScenarioControl('coolingMedium', 'Surrounding medium', medium, units, errors),
    ...(start.coolingMedium === 'water' ? [renderScenarioControl('waterSubmersionPercent', 'Tank submerged', submersion, units, errors)] : []),
    renderScenarioControl('inWaterTemperatureC', 'Target in-water temperature', inWater, units, errors, 'temperatureC')
  );
  scenarioCard.append(scenarioGrid);

  const cylinder = el('div', { class: 'col-span-2 bg-ocean-950/60 p-3 rounded-xl border border-ocean-800/80' });
  const cylinderControl = el('select', { class: 'w-full bg-ocean-900 border border-ocean-700 rounded-lg px-2.5 py-1.5 font-mono text-cyan-300 font-bold focus:outline-none focus:border-cyan-400', 'data-what-if-field': 'cylinderPresetName' });
  for (const preset of cylinderPresets) cylinderControl.append(el('option', { value: preset.name, selected: preset.name === start.cylinderPresetName ? '' : undefined }, preset.name));
  cylinder.append(labelled('cylinderPresetName', 'Cylinder', cylinderControl, null, units, errors, 'block text-slate-400 font-medium mb-1'));
  const selected = cylinderPresets.find(item => item.name === start.cylinderPresetName);
  if (selected) {
    const hint = `${convertToDisplay(selected.volumeL, 'volumeL', units)} ${unitLabel('volumeL', units)} · ${materialLabel(selected.material, units)} · ${convertToDisplay(selected.massKg, 'massKg', units)} ${unitLabel('massKg', units)} · ${convertToDisplay(selected.workingPressureBar, 'pressureBar', units)} ${unitLabel('pressureBar', units)} working pressure`;
    cylinder.append(el('p', { class: 'mt-1 text-[10px] text-slate-500', 'data-cylinder-hint': '' }, hint));
  }

  const grid = el('div', { class: 'grid min-w-0 grid-cols-2 gap-4 text-xs' });
  grid.append(current, scenarioCard, cylinder);
  container.replaceChildren(grid);
}

export function renderWhatIfScenarioEditor(container, { scenario = {}, cylinderPresets = [], gasPresets = [], units = 'metric', errors = [], sharedInputChanged = false, banks = [], pressureStarts = {}, rowsContainer = null, statusContainer = null } = {}) {
  const root = el('div', { class: 'space-y-4' });
  const status = el('div', { role: 'status', class: 'text-xs text-slate-400', 'data-what-if-status': 'copied' }, scenario.initialized ? 'Starting state copied from Blending; edits are independent.' : 'Starting state not copied yet.');
  if (sharedInputChanged) status.append(' ', el('span', { 'data-what-if-status': 'shared-stale', class: 'text-amber-300' }, 'Out of date — shared inputs changed'));
  if (statusContainer) statusContainer.replaceChildren(status);
  else root.append(status);
  const startFieldset = el('fieldset', { class: 'space-y-3' });
  startFieldset.append(el('legend', { class: 'sr-only' }, 'What-if working tank'));
  renderScenarioStart(startFieldset, { scenario, cylinderPresets, gasPresets, units, errors });
  root.append(startFieldset);
  container.replaceChildren(root);
  const rows = el('div', { 'data-what-if-rows': '' });
  renderCompareRecipe(rows, { rows: scenario.rows ?? [], banks, errors, pressureStarts, units, whatIf: true });
  if (rowsContainer && rowsContainer !== container) rowsContainer.replaceChildren(rows);
  else root.append(rows);
}
