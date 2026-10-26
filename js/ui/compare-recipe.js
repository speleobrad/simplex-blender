import { COMPARE_ROW_TYPES, COMPRESSOR_AIR_ID } from '../compare-recipe.js';
import { convertToDisplay, formatInputValue, unitLabel } from '../units.js';
const inputClass = 'min-w-0 w-full rounded border border-ocean-700 bg-ocean-900 px-2 py-1 font-mono text-xs text-slate-100';

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
    className: 'mb-0.5 block h-7 text-[10px] text-slate-400',
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

function pressureInputValue(value, units) {
  const displayValue = convertToDisplay(Number(value), 'pressureBar', units);
  return Number.isFinite(displayValue) ? displayValue.toFixed(2) : (value ?? '');
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
  const fields = element('div', { className: 'min-w-0 grid grid-cols-2 gap-2' });
  const enabledBanks = banks.filter(bank => bank.enabled && typeof bank.name === 'string' && bank.name.trim().length > 0);
  const bankField = element('div', { className: 'col-span-2 min-w-0' });
  const bank = select([
    { value: '', label: 'Select gas source' },
    { value: COMPRESSOR_AIR_ID, label: 'Compressor Air (infinite)' },
    ...enabledBanks.map(candidate => ({ value: candidate.id, label: candidate.name }))
  ], row.bankId ?? '');
  appendLabelledControl(bankField, row, rowNumber, 'bankId', 'Gas source', bank, errors);

  const selectedBank = row.bankId === COMPRESSOR_AIR_ID
    ? { name: 'Compressor Air', oxygenPercent: 21, heliumPercent: 0, infinite: true }
    : enabledBanks.find(candidate => candidate.id === row.bankId);
  let detailsElement = null;
  if (selectedBank) {
    const details = element('p', {
      className: 'col-span-2 min-w-0 break-words text-[10px] text-slate-400',
      text: selectedBank.infinite
        ? 'Compressor Air: O₂ 21% · He 0% · Infinite supply'
        : `${selectedBank.name}: O₂ ${selectedBank.oxygenPercent}% · He ${selectedBank.heliumPercent}% · ${selectedBank.volumeL} L · ${selectedBank.pressureBar} bar`
    });
    detailsElement = details;
  }

  const addedField = element('div');
  const added = input(row, 'pressureAddedBar', pressureInputValue(row.pressureAddedBar, units), 'number');
  added.setAttribute('step', '0.01');
  added.setAttribute('data-pressure-input-mode', 'added');
  added.setAttribute('data-receiver-start-pressure', pressureStart);
  appendLabelledControl(addedField, row, rowNumber, 'pressureAddedBar', `Pressure added (${unitLabel('pressureBar', units)})`, added, errors);
  const targetField = element('div');
  const target = input(row, 'targetPressureBar', pressureInputValue(row.targetPressureBar, units), 'number');
  target.setAttribute('step', '0.01');
  target.setAttribute('data-pressure-input-mode', 'target');
  target.setAttribute('data-receiver-start-pressure', pressureStart);
  appendLabelledControl(targetField, row, rowNumber, 'targetPressureBar', `Receiver target pressure (${unitLabel('pressureBar', units)})`, target, errors);

  fields.append(bankField);
  if (detailsElement) fields.append(detailsElement);
  fields.append(addedField, targetField);
  card.append(fields);
}

function rowFields(card, row, rowNumber, banks, errors, pressureStarts, units = 'metric', whatIf = false) {
  const fields = element('div', { className: 'min-w-0 grid grid-cols-2 gap-2' });
  if (row.type === 'add') {
    addGasFields(card, row, rowNumber, banks, errors, pressureStarts[row.id], units);
    return;
  }

  if (row.type === 'drain') {
    const targetField = element('div');
    appendLabelledControl(
      targetField,
      row,
      rowNumber,
      'targetPressureBar',
      `Drain target pressure (${unitLabel('pressureBar', units)})`,
      input(row, 'targetPressureBar', formatInputValue(row.targetPressureBar, 'pressureBar', units), 'number'),
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
      appendLabelledControl(temperatureField, row, rowNumber, 'targetTemperatureC', `Target medium temperature (${unitLabel('temperatureC', units)})`, input(row, 'targetTemperatureC', Number.isFinite(row.targetTemperatureC) ? formatInputValue(row.targetTemperatureC, 'temperatureC', units) : '', 'number'), errors);
      fields.append(temperatureField);
    } else {
      const waitField = element('div');
      appendLabelledControl(waitField, row, rowNumber, 'waitMinutes', 'Wait time (minutes)', input(row, 'waitMinutes', row.waitMinutes, 'number'), errors);
      fields.append(waitField);
    }
  }
  if (fields.children.length > 0) card.append(fields);
}

function renderAutomaticWait(row, index, errors) {
  const wait = element('div', {
    className: 'flex items-center gap-2 rounded-lg border border-dashed border-ocean-700 bg-ocean-950/30 px-2 py-1.5 text-[10px] text-slate-400',
    attributes: { 'data-what-if-wait': row.id }
  });
  wait.append(element('span', { className: 'font-semibold uppercase tracking-wider text-slate-500', text: 'Wait' }));
  const label = element('label', {
    className: 'sr-only',
    text: `Wait between step ${index} and step ${index + 1} (minutes)`,
    attributes: { for: `compare-${row.id}-waitMinutes` }
  });
  const control = input(row, 'waitMinutes', row.waitMinutes ?? 0, 'number');
  control.setAttribute('data-row-id', row.id);
  control.setAttribute('data-compare-field', 'waitMinutes');
  control.setAttribute('min', '0');
  control.setAttribute('max', '1440');
  control.setAttribute('id', `compare-${row.id}-waitMinutes`);
  control.setAttribute('aria-label', `Wait between step ${index} and step ${index + 1} (minutes)`);
  const suffix = element('span', { className: 'text-slate-500', text: 'min' });
  const errorMessages = errorsFor(errors, `${row.id}-wait`, 'waitMinutes');
  wait.append(label, control, suffix);
  if (errorMessages.length) {
    const message = element('span', { className: 'text-rose-300', text: errorMessages.map(error => error.message).join(' ') });
    wait.append(message);
  }
  return wait;
}

function actionButton(action, label, rowId, disabled = false, attributes = {}) {
  const button = element('button', {
    className: attributes.className ?? 'rounded border border-ocean-700 bg-ocean-950 px-2 py-1 text-[10px] text-slate-300 disabled:cursor-not-allowed disabled:opacity-40',
    text: label,
    attributes: {
      type: 'button',
      'data-action': action,
      'data-row-id': rowId,
      ...attributes
    }
  });
  button.disabled = disabled;
  return button;
}

function renderRow(row, index, rows, banks, errors, pressureStarts, units = 'metric', whatIf = false) {
  const rowNumber = index + 1;
  const card = element('fieldset', {
    className: 'rounded-xl border border-ocean-800 bg-ocean-950/60 p-3',
    attributes: { 'data-row-id': row.id }
  });
  const legend = element('legend', { className: 'px-1 text-xs font-semibold text-slate-200', text: `${whatIf ? 'Step' : 'Row'} ${rowNumber}` });
  const type = element('div', { className: 'min-w-0' });
  const options = whatIf ? COMPARE_ROW_TYPES.filter(option => option.value !== 'wait') : COMPARE_ROW_TYPES;
  appendLabelledControl(type, row, rowNumber, 'type', 'Operation', select(options, row.type), errors);
  if (whatIf) {
    const removeAction = actionButton('remove-compare-row', '×', row.id, false, {
      className: 'rounded px-1.5 py-1 text-base leading-none text-rose-400 hover:bg-rose-500/20 hover:text-rose-300',
      'aria-label': `Remove step ${rowNumber}`,
      title: 'Remove step'
    });
    const dragAction = actionButton('drag-compare-row', '⠿', row.id, false, {
      className: 'cursor-grab rounded px-1.5 py-1 text-base leading-none text-slate-400 hover:bg-ocean-800 hover:text-cyan-300',
      draggable: 'true',
      'aria-label': `Reorder step ${rowNumber}`,
      title: 'Drag to reorder'
    });
    const actions = element('div', { className: 'flex flex-col items-end gap-1' });
    actions.append(dragAction, removeAction);
    const body = element('div', { className: 'grid grid-cols-[minmax(7rem,auto)_minmax(0,1fr)_auto] items-start gap-3' });
    const parameters = element('div', { className: 'min-w-0' });
    rowFields(parameters, row, rowNumber, banks, errors, pressureStarts, units, true);
    body.append(type, parameters, actions);
    card.append(legend, body);
  } else {
    const actions = element('div', { className: 'flex items-center justify-end gap-1' });
    actions.append(
      actionButton('move-compare-row-up', 'Move up', row.id, index === 0),
      actionButton('move-compare-row-down', 'Move down', row.id, index === rows.length - 1),
      actionButton('remove-compare-row', 'Remove', row.id)
    );
    const header = element('div', { className: 'mb-3 flex flex-wrap items-center justify-between gap-2' });
    header.append(type, actions);
    card.append(legend, header);
    rowFields(card, row, rowNumber, banks, errors, pressureStarts, units);
  }
  return card;
}


export function renderCompareRecipe(container, { rows = [], banks = [], errors = [], pressureStarts = {}, units = 'metric', whatIf = false } = {}) {
  const content = element('div', { className: 'space-y-3' });
  rows.forEach((row, index) => {
    if (whatIf && row.type === 'wait') return;
    content.append(renderRow(row, index, rows, banks, errors, pressureStarts, units, whatIf));
    if (whatIf && index < rows.length - 1) content.append(renderAutomaticWait(row, index + 1, errors));
  });

  const addButton = element('button', {
    className: 'rounded-lg border border-ocean-700 bg-ocean-800 px-3 py-1.5 text-xs font-medium text-cyan-300 hover:bg-ocean-700',
    text: whatIf ? 'Add step' : 'Add row',
    attributes: { type: 'button', 'data-action': 'add-compare-row' }
  });
  const controls = element('div', { className: 'flex flex-wrap justify-between gap-2' });
  controls.append(addButton);
  content.append(controls);
  container.replaceChildren(content);
}
