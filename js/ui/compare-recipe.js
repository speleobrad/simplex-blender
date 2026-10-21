import { formatInputValue, unitLabel } from '../units.js';
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

function addGasFields(card, row, rowNumber, banks, errors, pressureStart, units = 'metric') {
  const fields = element('div', { className: 'grid grid-cols-2 gap-2' });
  const enabledBanks = banks.filter(bank => bank.enabled && typeof bank.name === 'string' && bank.name.trim().length > 0);
  const bankField = element('div', { className: 'col-span-2' });
  const bank = select([
    { value: '', label: 'Select gas source' },
    { value: COMPRESSOR_AIR_ID, label: 'Compressor Air (infinite)' },
    ...enabledBanks.map(candidate => ({ value: candidate.id, label: candidate.name }))
  ], row.bankId ?? '');
  appendLabelledControl(bankField, row, rowNumber, 'bankId', 'Gas source', bank, errors);

  const selectedBank = row.bankId === COMPRESSOR_AIR_ID
    ? { name: 'Compressor Air', oxygenPercent: 21, heliumPercent: 0, infinite: true }
    : enabledBanks.find(candidate => candidate.id === row.bankId);
  if (selectedBank) {
    const details = element('p', {
      className: 'col-span-2 text-[10px] text-slate-400',
      text: selectedBank.infinite
        ? 'Compressor Air: O₂ 21% · He 0% · Infinite supply'
        : `${selectedBank.name}: O₂ ${selectedBank.oxygenPercent}% · He ${selectedBank.heliumPercent}% · ${selectedBank.volumeL} L · ${selectedBank.pressureBar} bar`
    });
    fields.append(details);
  }

  const addedField = element('div');
  const added = input(row, 'pressureAddedBar', formatInputValue(row.pressureAddedBar, 'pressureBar', units), 'number');
  added.setAttribute('data-pressure-input-mode', 'added');
  added.setAttribute('data-receiver-start-pressure', pressureStart);
  appendLabelledControl(addedField, row, rowNumber, 'pressureAddedBar', `Pressure added (${unitLabel('pressureBar', units)})`, added, errors);
  const targetField = element('div');
  const target = input(row, 'targetPressureBar', formatInputValue(row.targetPressureBar, 'pressureBar', units), 'number');
  target.setAttribute('data-pressure-input-mode', 'target');
  target.setAttribute('data-receiver-start-pressure', pressureStart);
  appendLabelledControl(targetField, row, rowNumber, 'targetPressureBar', `Receiver target pressure (${unitLabel('pressureBar', units)})`, target, errors);

  fields.append(bankField, addedField, targetField);
  card.append(fields);
}

function rowFields(card, row, rowNumber, banks, errors, pressureStarts, units = 'metric') {
  if (row.type === 'add') {
    addGasFields(card, row, rowNumber, banks, errors, pressureStarts[row.id], units);
    return;
  }

  const fields = element('div', { className: 'grid grid-cols-2 gap-2' });
  if (row.type === 'drain') {
    const targetField = element('div');
    appendLabelledControl(
      targetField,
      row,
      rowNumber,
      'targetPressureBar',
      'Drain target pressure (bar)',
      input(row, 'targetPressureBar', row.targetPressureBar, 'number'),
      errors
    );
    fields.append(targetField);
  }
  if (row.type === 'wait') {
    const modeField = element('div');
    appendLabelledControl(modeField, row, rowNumber, 'waitMode', 'Wait mode', select([
      { value: 'minutes', label: 'Minutes' },
      { value: 'target', label: 'Target state' }
    ], row.waitMode), errors);
    fields.append(modeField);
    if (row.waitMode === 'target') {
      const temperatureField = element('div');
      appendLabelledControl(temperatureField, row, rowNumber, 'targetTemperatureC', 'Target medium temperature (°C)', input(row, 'targetTemperatureC', row.targetTemperatureC, 'number'), errors);
      fields.append(temperatureField);
    } else {
      const waitField = element('div');
      appendLabelledControl(waitField, row, rowNumber, 'waitMinutes', 'Wait time (minutes)', input(row, 'waitMinutes', row.waitMinutes, 'number'), errors);
      fields.append(waitField);
    }
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

function renderRow(row, index, rows, banks, errors, pressureStarts, units = 'metric') {
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
  rowFields(card, row, rowNumber, banks, errors, pressureStarts, units);
  return card;
}

export function renderCompareRecipe(container, { rows = [], banks = [], errors = [], pressureStarts = {}, units = 'metric' } = {}) {
  const content = element('div', { className: 'space-y-3' });
  rows.forEach((row, index) => content.append(renderRow(row, index, rows, banks, errors, pressureStarts, units)));

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
