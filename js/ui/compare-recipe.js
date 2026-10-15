import { COMPARE_METHODS, COMPARE_ROW_TYPES } from '../compare-recipe.js';

const inputClass = 'w-full rounded border border-ocean-700 bg-ocean-900 px-2 py-1 font-mono text-xs text-slate-100';

function element(tagName, { className, text, attributes } = {}) {
  const node = document.createElement(tagName);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  for (const [name, value] of Object.entries(attributes ?? {})) {
    if (value !== undefined && value !== null) node.setAttribute(name, value);
  }
  return node;
}

function fieldId(rowId, field) {
  return `compare-${rowId}-${field}`;
}

function errorsFor(errors, rowId, field) {
  return errors.filter(error => error.rowId === rowId && error.field === field);
}

function addFieldError(wrapper, control, errors, rowId, field) {
  const messages = errorsFor(errors, rowId, field);
  if (messages.length === 0) return;

  const errorId = `${fieldId(rowId, field)}-error`;
  control.setAttribute('aria-invalid', 'true');
  control.setAttribute('aria-describedby', errorId);
  const message = element('p', {
    className: 'mt-1 text-[10px] text-rose-300',
    attributes: { id: errorId }
  });
  message.textContent = messages.map(error => error.message).join(' ');
  wrapper.append(message);
}

function addGasError(wrapper, controls, errors, rowId) {
  const messages = errorsFor(errors, rowId, 'gas');
  if (messages.length === 0) return;

  const errorId = `${fieldId(rowId, 'gas')}-error`;
  for (const control of controls) {
    control.setAttribute('aria-invalid', 'true');
    control.setAttribute('aria-describedby', errorId);
  }
  const message = element('p', {
    className: 'col-span-2 mt-1 text-[10px] text-rose-300',
    attributes: { id: errorId }
  });
  message.textContent = messages.map(error => error.message).join(' ');
  wrapper.append(message);
}

function appendLabelledControl(wrapper, row, rowNumber, field, labelText, control, errors) {
  const id = fieldId(row.id, field);
  const label = element('label', {
    className: 'mb-0.5 block text-[10px] text-slate-400',
    text: labelText,
    attributes: { for: id }
  });
  control.setAttribute('id', id);
  control.setAttribute('aria-label', `Row ${rowNumber} ${labelText}`);
  control.setAttribute('data-row-id', row.id);
  control.setAttribute('data-compare-field', field);
  wrapper.append(label, control);
  addFieldError(wrapper, control, errors, row.id, field);
}

function input(row, field, value, type = 'text') {
  const control = element('input', {
    className: inputClass,
    attributes: { type }
  });
  control.value = value ?? '';
  return control;
}

function select(options, value) {
  const control = element('select', { className: inputClass });
  for (const option of options) {
    const item = element('option', { text: option.label, attributes: { value: option.value } });
    if (option.value === value) item.selected = true;
    control.append(item);
  }
  control.value = value ?? '';
  return control;
}

function addGasFields(card, row, rowNumber, gasPresets, errors) {
  const gas = row.gas ?? {};
  const fields = element('div', { className: 'grid grid-cols-2 gap-2' });
  const presetField = element('div', { className: 'col-span-2' });
  const preset = select([
    { value: '', label: 'Custom' },
    ...gasPresets.map(gasPreset => ({ value: gasPreset.name, label: gasPreset.name }))
  ], gas.presetName ?? '');
  appendLabelledControl(presetField, row, rowNumber, 'presetName', 'Gas preset', preset, errors);

  const nameField = element('div', { className: 'col-span-2' });
  const name = input(row, 'name', gas.name);
  appendLabelledControl(nameField, row, rowNumber, 'name', 'Gas name', name, errors);
  const oxygenField = element('div');
  const oxygen = input(row, 'oxygenPercent', gas.oxygenPercent, 'number');
  appendLabelledControl(oxygenField, row, rowNumber, 'oxygenPercent', '% O₂', oxygen, errors);
  const heliumField = element('div');
  const helium = input(row, 'heliumPercent', gas.heliumPercent, 'number');
  appendLabelledControl(heliumField, row, rowNumber, 'heliumPercent', '% He', helium, errors);
  const targetField = element('div');
  appendLabelledControl(targetField, row, rowNumber, 'targetPressureBar', 'Target pressure (bar)', input(row, 'targetPressureBar', row.targetPressureBar, 'number'), errors);
  const methodField = element('div');
  appendLabelledControl(methodField, row, rowNumber, 'method', 'Method', select(COMPARE_METHODS, row.method), errors);
  const sourceField = element('div');
  const sourcePressure = input(row, 'sourcePressureBar', row.sourcePressureBar, 'number');
  sourceField.hidden = row.method !== 'boost';
  sourcePressure.hidden = sourceField.hidden;
  appendLabelledControl(sourceField, row, rowNumber, 'sourcePressureBar', 'Source pressure (bar)', sourcePressure, errors);

  fields.append(presetField, nameField, oxygenField, heliumField, targetField, methodField, sourceField);
  addGasError(fields, [preset, name, oxygen, helium], errors, row.id);
  card.append(fields);
}

function rowFields(card, row, rowNumber, gasPresets, errors) {
  if (row.type === 'add') {
    addGasFields(card, row, rowNumber, gasPresets, errors);
    return;
  }

  const fields = element('div', { className: 'grid grid-cols-2 gap-2' });
  if (row.type === 'drain') {
    const targetField = element('div');
    appendLabelledControl(targetField, row, rowNumber, 'targetPressureBar', 'Target pressure (bar)', input(row, 'targetPressureBar', row.targetPressureBar, 'number'), errors);
    fields.append(targetField);
  }
  if (row.type === 'wait') {
    const waitField = element('div');
    appendLabelledControl(waitField, row, rowNumber, 'waitMinutes', 'Wait time (minutes)', input(row, 'waitMinutes', row.waitMinutes, 'number'), errors);
    fields.append(waitField);
  }
  if (fields.children.length > 0) card.append(fields);
}

function actionButton(action, label, rowId, disabled = false) {
  const button = element('button', {
    className: 'rounded border border-ocean-700 bg-ocean-950 px-2 py-1 text-[10px] text-slate-300 disabled:cursor-not-allowed disabled:opacity-40',
    text: label,
    attributes: { type: 'button', 'data-action': action, 'data-row-id': rowId }
  });
  button.disabled = disabled;
  return button;
}

function renderRow(row, index, rows, gasPresets, errors) {
  const rowNumber = index + 1;
  const card = element('fieldset', {
    className: 'rounded-xl border border-ocean-800 bg-ocean-950/60 p-3',
    attributes: { 'data-row-id': row.id }
  });
  const header = element('div', { className: 'mb-3 flex flex-wrap items-center justify-between gap-2' });
  const legend = element('legend', { className: 'px-1 text-xs font-semibold text-slate-200', text: `Row ${rowNumber}` });
  const type = element('div', { className: 'min-w-32' });
  appendLabelledControl(type, row, rowNumber, 'type', 'Operation', select(COMPARE_ROW_TYPES, row.type), errors);
  const actions = element('div', { className: 'flex items-center gap-1' });
  actions.append(
    actionButton('move-compare-row-up', 'Move up', row.id, index === 0),
    actionButton('move-compare-row-down', 'Move down', row.id, index === rows.length - 1),
    actionButton('remove-compare-row', 'Remove', row.id)
  );
  header.append(type, actions);
  card.append(legend, header);
  rowFields(card, row, rowNumber, gasPresets, errors);
  return card;
}

export function renderCompareRecipe(container, { rows = [], gasPresets = [], errors = [] } = {}) {
  const content = element('div', { className: 'space-y-3' });
  rows.forEach((row, index) => content.append(renderRow(row, index, rows, gasPresets, errors)));

  const addButton = element('button', {
    className: 'rounded-lg border border-ocean-700 bg-ocean-800 px-3 py-1.5 text-xs font-medium text-cyan-300 hover:bg-ocean-700',
    text: 'Add row',
    attributes: { type: 'button', 'data-action': 'add-compare-row' }
  });
  const runButton = element('button', {
    className: 'rounded-lg border border-cyan-500/50 bg-cyan-500/20 px-3 py-1.5 text-xs font-semibold text-cyan-200 hover:bg-cyan-500/30',
    text: 'Run comparison',
    attributes: { type: 'button', 'data-action': 'run-compare' }
  });
  const controls = element('div', { className: 'flex flex-wrap justify-between gap-2' });
  controls.append(addButton, runButton);
  content.append(controls);
  container.replaceChildren(content);
}
