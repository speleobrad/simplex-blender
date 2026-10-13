import { PRESET_IMPORT_DEFAULT_URLS } from '../preset-import.js';
import { sortCylinderPresetEntries, sortGasPresetEntries } from '../settings.js';

const CUSTOM_PRESET = 'custom';

function createPresetInput({ value, type, collection, index, field, label, min, max, step }) {
  const input = document.createElement('input');
  input.type = type;
  input.value = String(value ?? '');
  input.className = type === 'text'
    ? 'min-w-0 rounded border border-ocean-700 bg-ocean-950 px-2 py-1 text-xs text-slate-100'
    : 'min-w-0 rounded border border-ocean-700 bg-ocean-950 px-1 py-1 text-center text-xs text-slate-100';
  input.setAttribute('aria-label', label);
  input.dataset.settingsCollection = collection;
  input.dataset.settingsIndex = String(index);
  input.dataset.settingsField = field;
  if (min !== undefined) input.min = String(min);
  if (max !== undefined) input.max = String(max);
  if (step !== undefined) input.step = String(step);
  return input;
}

function createRemoveButton(action, index, label, disabled = false) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'rounded px-2 text-rose-400 hover:bg-rose-500/10 hover:text-rose-300 disabled:cursor-not-allowed disabled:opacity-40';
  button.textContent = '×';
  button.dataset.action = action;
  button.dataset.settingsIndex = String(index);
  button.disabled = disabled;
  button.setAttribute('aria-label', label);
  return button;
}

function renderGasRows(presets) {
  const container = document.getElementById('settings-gas-presets');
  if (!container) return;
  const rows = sortGasPresetEntries(presets).map(({ preset, index }) => {
    const row = document.createElement('div');
    row.className = 'grid grid-cols-[minmax(0,1fr)_3.5rem_3.5rem_auto] gap-1.5';
    row.append(
      createPresetInput({
        value: preset.name,
        type: 'text',
        collection: 'gasPresets',
        index,
        field: 'name',
        label: 'Gas preset name'
      }),
      createPresetInput({
        value: preset.oxygenPercent,
        type: 'number',
        collection: 'gasPresets',
        index,
        field: 'oxygenPercent',
        label: `${preset.name || 'Gas'} oxygen percentage`,
        min: 0,
        max: 100,
        step: 0.1
      }),
      createPresetInput({
        value: preset.heliumPercent,
        type: 'number',
        collection: 'gasPresets',
        index,
        field: 'heliumPercent',
        label: `${preset.name || 'Gas'} helium percentage`,
        min: 0,
        max: 100,
        step: 0.1
      }),
      createRemoveButton('remove-gas-preset', index, `Remove ${preset.name || 'gas preset'}`, presets.length <= 1)
    );
    return row;
  });
  container.replaceChildren(...rows);
}

function createTableCell(content, className = '') {
  const cell = document.createElement('td');
  cell.className = className;
  cell.append(content);
  return cell;
}

function createCylinderNumberInput({ value, index, field, label, min, max, step, width = 'w-full' }) {
  const input = createPresetInput({
    value,
    type: 'number',
    collection: 'cylinderPresets',
    index,
    field,
    label,
    min,
    max,
    step
  });
  input.className = input.className.replace('px-1', 'px-0.5');
  input.classList.add(width);
  return input;
}

function createMaterialSelect(preset, index) {
  const select = document.createElement('select');
  select.className = 'w-full min-w-0 rounded border border-ocean-700 bg-ocean-950 px-1 py-1 text-xs text-slate-100';
  select.dataset.settingsCollection = 'cylinderPresets';
  select.dataset.settingsIndex = String(index);
  select.dataset.settingsField = 'material';
  select.setAttribute('aria-label', `${preset.name || 'Cylinder'} material`);
  for (const [value, label] of [['steel', 'Steel'], ['aluminum', 'Aluminum']]) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    select.append(option);
  }
  select.value = preset.material;
  return select;
}

function createCylinderField(label, content) {
  const field = document.createElement('div');
  const labelElement = document.createElement('span');
  labelElement.className = 'mb-1 block text-[10px] uppercase tracking-wide text-slate-500';
  labelElement.textContent = label;
  field.append(labelElement, content);
  return field;
}

function createCylinderCard(preset, index, presetCount) {
  const card = document.createElement('article');
  card.className = 'rounded-xl border border-ocean-800/80 bg-ocean-950/40 p-3 sm:hidden';
  const header = document.createElement('div');
  header.className = 'flex items-center gap-2';
  const name = createPresetInput({
    value: preset.name,
    type: 'text',
    collection: 'cylinderPresets',
    index,
    field: 'name',
    label: 'Cylinder preset name'
  });
  name.className += ' min-w-0 flex-1';
  header.append(name);
  const fields = document.createElement('div');
  fields.className = 'mt-3 grid grid-cols-2 gap-2';
  fields.append(
    createCylinderField('Material', createMaterialSelect(preset, index)),
    createCylinderField('Volume (L)', createCylinderNumberInput({
      value: preset.volumeL,
      index,
      field: 'volumeL',
      label: `${preset.name || 'Cylinder'} internal volume in litres`,
      min: 0.1,
      step: 0.1
    })),
    createCylinderField('Mass (kg)', createCylinderNumberInput({
      value: preset.massKg,
      index,
      field: 'massKg',
      label: `${preset.name || 'Cylinder'} mass in kilograms`,
      min: 0.1,
      step: 0.1
    })),
    createCylinderField('Max pressure (bar)', createCylinderNumberInput({
      value: preset.workingPressureBar,
      index,
      field: 'workingPressureBar',
      label: `${preset.name || 'Cylinder'} working pressure in bar`,
      min: 10,
      max: 350,
      step: 1
    }))
  );
  const removeButton = createRemoveButton(
    'remove-cylinder-preset',
    index,
    `Remove ${preset.name || 'cylinder preset'}`,
    presetCount <= 1
  );
  removeButton.textContent = 'Remove';
  removeButton.className += ' inline-flex w-full justify-center py-1';
  card.append(header, fields, removeButton);
  return card;
}

function renderCylinderRows(presets) {
  const container = document.getElementById('settings-cylinder-presets');
  if (!container) return;
  const sortedPresets = sortCylinderPresetEntries(presets);
  const cards = document.createElement('div');
  cards.className = 'space-y-2 sm:hidden';
  for (const { preset, index } of sortedPresets) {
    cards.append(createCylinderCard(preset, index, presets.length));
  }

  const table = document.createElement('table');
  table.className = 'hidden w-full table-fixed text-left text-xs sm:table';
  const thead = document.createElement('thead');
  const headerRow = document.createElement('tr');
  headerRow.className = 'text-[10px] uppercase tracking-wide text-slate-400';
  for (const [label, className, ariaLabel] of [
    ['Name', 'min-w-[8.5rem]'],
    ['Material', 'w-20'],
    ['Volume (L)', 'w-14'],
    ['Mass (kg)', 'w-16'],
    ['Max pressure (bar)', 'w-16'],
    ['', 'w-6', 'Actions']
  ]) {
    const header = document.createElement('th');
    header.scope = 'col';
    header.className = `px-1.5 pb-1 text-left font-medium ${className}`;
    header.textContent = label;
    if (ariaLabel) header.setAttribute('aria-label', ariaLabel);
    headerRow.append(header);
  }
  thead.append(headerRow);

  const tbody = document.createElement('tbody');
  for (const { preset, index } of sortedPresets) {
    const row = document.createElement('tr');
    row.className = 'border-t border-ocean-800/70 align-middle';
    const name = createPresetInput({
      value: preset.name,
      type: 'text',
      collection: 'cylinderPresets',
      index,
      field: 'name',
      label: 'Cylinder preset name'
    });
    name.classList.add('w-full');
    row.append(
      createTableCell(name, 'px-1.5 py-1'),
      createTableCell(createMaterialSelect(preset, index), 'px-1.5 py-1'),
      createTableCell(createCylinderNumberInput({
        value: preset.volumeL,
        index,
        field: 'volumeL',
        label: `${preset.name || 'Cylinder'} internal volume in litres`,
        min: 0.1,
        step: 0.1
      }), 'px-1.5 py-1'),
      createTableCell(createCylinderNumberInput({
        value: preset.massKg,
        index,
        field: 'massKg',
        width: 'w-16',
        label: `${preset.name || 'Cylinder'} mass in kilograms`,
        min: 0.1,
        step: 0.1
      }), 'px-1.5 py-1'),
      createTableCell(createCylinderNumberInput({
        value: preset.workingPressureBar,
        index,
        field: 'workingPressureBar',
        label: `${preset.name || 'Cylinder'} working pressure in bar`,
        min: 10,
        max: 350,
        step: 1
      }), 'px-1.5 py-1'),
      createTableCell(
        createRemoveButton('remove-cylinder-preset', index, `Remove ${preset.name || 'cylinder preset'}`, presets.length <= 1),
        'px-0 py-1 text-center'
      )
    );
    tbody.append(row);
  }
  table.append(thead, tbody);

  const scrollContainer = document.createElement('div');
  scrollContainer.className = 'hidden overflow-x-auto sm:block';
  scrollContainer.append(table);
  container.replaceChildren(cards, scrollContainer);
}

function renderEquipmentPresetSelector(id, presets, matchesActiveFields, removeButtonId) {
  const removeButton = document.getElementById(removeButtonId);
  if (removeButton) removeButton.disabled = presets.length <= 1;
  const select = document.getElementById(id);
  if (!select) return;
  const options = presets.map(preset => createOption(preset.name, preset.name));
  select.replaceChildren(...options);
  const selected = presets.find(matchesActiveFields) ?? presets[0];
  if (selected) select.value = selected.name;
}

function compressorPresetMatchesActiveFields(booster, preset) {
  return preset.inletFlowLPerMin === booster.compressorInletFlowLPerMin
    && preset.maxPressureBar === booster.maxCompressorPressureBar
    && preset.temperatureModifierC === booster.compressorTemperatureModifierC;
}

function boosterPresetMatchesActiveFields(booster, preset) {
  return preset.minimumSourcePressureBar === booster.minimumSourcePressureBar
    && preset.cylinderVolumeCm3 === booster.cylinderVolumeCm3
    && preset.oxygenBoostBpm === booster.oxygenBoostBpm
    && preset.otherBoostBpm === booster.otherBoostBpm
    && preset.oxygenDecantRateBarPerMin === booster.oxygenDecantRateBarPerMin
    && preset.otherDecantRateBarPerMin === booster.otherDecantRateBarPerMin
    && preset.maxOutputPressureBar === booster.maxBoosterOutputPressureBar
    && preset.temperatureModifierC === booster.boosterTemperatureModifierC
    && preset.drainingRateBarPerMin === booster.drainingRateBarPerMin;
}


const PRESET_IMPORT_CATEGORIES = ['gas', 'cylinders', 'equipment'];

function presetImportLabel(category, preset) {
  if (category === 'gas') return `${preset.name} — ${preset.oxygenPercent}% O₂ / ${preset.heliumPercent}% He`;
  if (category === 'cylinders') {
    return `${preset.name} — ${preset.volumeL} L / ${preset.material} / ${preset.workingPressureBar} bar`;
  }
  const kind = preset.inletFlowLPerMin === undefined ? 'Booster' : 'Compressor';
  return `${kind}: ${preset.name}`;
}

function candidateStatusLabel(candidate) {
  if (candidate.status === 'duplicate') return 'Already exists';
  if (candidate.status === 'invalid') return 'Rejected';
  return 'New';
}

function renderPresetImportCandidates(importState) {
  const container = document.getElementById('settings-preset-import-candidates');
  if (!container) return;
  const selectedIds = new Set(importState.selectedIds ?? []);
  const candidates = importState.candidates ?? [];
  const rows = candidates.map(candidate => {
    const row = document.createElement('label');
    const enabled = candidate.status === 'new' && candidate.selectable !== false;
    row.className = enabled
      ? 'flex items-start gap-2 rounded border border-ocean-800 px-2 py-1.5 text-xs'
      : 'flex items-start gap-2 rounded border border-ocean-900 px-2 py-1.5 text-xs text-slate-500 opacity-60';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.dataset.action = 'toggle-preset-import';
    checkbox.dataset.presetImportId = candidate.id;
    checkbox.checked = enabled && selectedIds.has(candidate.id);
    checkbox.disabled = !enabled || Boolean(importState.loading);
    checkbox.className = 'mt-0.5 accent-cyan-500';
    checkbox.setAttribute('aria-label', `Import ${candidate.preset.name || 'unnamed preset'}`);
    const details = document.createElement('span');
    details.className = 'min-w-0 flex-1';
    const title = document.createElement('span');
    title.className = 'block break-words text-slate-200';
    title.textContent = presetImportLabel(importState.category, candidate.preset);
    const status = document.createElement('span');
    status.className = 'mr-1 text-[10px] font-semibold uppercase tracking-wide';
    status.textContent = candidateStatusLabel(candidate);
    const reason = document.createElement('span');
    reason.className = 'text-[10px] text-slate-500';
    reason.textContent = ` — ${candidate.reason}`;
    details.append(title, status, reason);
    row.append(checkbox, details);
    return row;
  });
  container.replaceChildren(...rows);
}

export function renderPresetImport(settings, importState = {}) {
  const categorySelect = document.getElementById('settings-preset-import-category');
  const urlInput = document.getElementById('settings-preset-import-url');
  const status = document.getElementById('settings-preset-import-status');
  const importButton = document.getElementById('settings-preset-import-button');
  if (!categorySelect || !urlInput || !status || !importButton) return;
  const category = PRESET_IMPORT_CATEGORIES.includes(importState.category)
    ? importState.category
    : 'gas';
  const state = { ...importState, category };
  categorySelect.value = category;
  urlInput.value = importState.url ?? PRESET_IMPORT_DEFAULT_URLS[category];
  status.textContent = importState.status ?? '';
  status.classList.toggle('hidden', !status.textContent);
  status.classList.toggle('text-rose-300', Boolean(importState.error));
  status.classList.toggle('text-slate-400', !importState.error);
  renderPresetImportCandidates(state);
  const selectedIds = new Set(importState.selectedIds ?? []);
  importButton.disabled = Boolean(importState.loading)
    || !(importState.candidates ?? []).some(candidate => (
      candidate.status === 'new'
      && candidate.selectable !== false
      && selectedIds.has(candidate.id)
    ));
  importButton.textContent = importState.loading ? 'Loading…' : 'Import selected';
}

export function renderSettingsDialog(settings, importState) {
  const physicsModel = document.getElementById('settings-physics-model');
  if (physicsModel && settings.physics?.model) physicsModel.value = settings.physics.model;
  renderGasRows(settings.gasPresets);
  renderCylinderRows(settings.cylinderPresets);
  renderEquipmentPresetSelector(
    'settings-compressor-preset',
    settings.compressorPresets,
    preset => compressorPresetMatchesActiveFields(settings.booster, preset),
    'settings-remove-compressor-preset'
  );
  renderEquipmentPresetSelector(
    'settings-booster-preset',
    settings.boosterPresets,
    preset => boosterPresetMatchesActiveFields(settings.booster, preset),
    'settings-remove-booster-preset'
  );
  const boosterFields = {
    'settings-booster-min-source-pressure': settings.booster.minimumSourcePressureBar,
    'settings-booster-cylinder-volume': settings.booster.cylinderVolumeCm3,
    'settings-booster-oxygen-bpm': settings.booster.oxygenBoostBpm,
    'settings-booster-other-bpm': settings.booster.otherBoostBpm,
    'settings-booster-oxygen-decant-rate': settings.booster.oxygenDecantRateBarPerMin,
    'settings-booster-other-decant-rate': settings.booster.otherDecantRateBarPerMin,
    'settings-booster-draining-rate': settings.booster.drainingRateBarPerMin,
    'settings-compressor-inlet-flow': settings.booster.compressorInletFlowLPerMin,
    'settings-compressor-max-pressure': settings.booster.maxCompressorPressureBar,
    'settings-booster-max-output-pressure': settings.booster.maxBoosterOutputPressureBar,
    'settings-booster-temperature-modifier': settings.booster.boosterTemperatureModifierC,
    'settings-compressor-temperature-modifier': settings.booster.compressorTemperatureModifierC
  };
  for (const [id, value] of Object.entries(boosterFields)) {
    const input = document.getElementById(id);
    if (input) input.value = String(value);
  }
  renderPresetImport(settings, importState);
}

function createOption(value, label) {
  const option = document.createElement('option');
  option.value = String(value);
  option.textContent = label;
  return option;
}

export function renderPresetOptions(settings, selectedCylinderName) {
  for (const select of document.querySelectorAll('[data-action="select-cylinder-gas"]')) {
    const side = select.dataset.mix;
    const prefix = side === 'initial' ? 'init' : 'target';
    const oxygen = Number.parseFloat(document.getElementById(`${prefix}-o2`).value);
    const helium = Number.parseFloat(document.getElementById(`${prefix}-he`).value);
    const match = settings.gasPresets.find(preset => Math.abs(preset.oxygenPercent - oxygen) < 1e-9
      && Math.abs(preset.heliumPercent - helium) < 1e-9);
    const options = [createOption(CUSTOM_PRESET, 'Custom')];
    for (const { preset } of sortGasPresetEntries(settings.gasPresets)) {
      options.push(createOption(`gas:${preset.name}`, preset.name));
    }
    select.replaceChildren(...options);
    select.value = match ? `gas:${match.name}` : CUSTOM_PRESET;
  }

  const select = document.getElementById('cylinder-preset');
  if (!select) return;
  const options = sortCylinderPresetEntries(settings.cylinderPresets)
    .map(({ preset }) => createOption(
      preset.name,
      `${preset.name} — ${preset.volumeL} L / ${preset.material} / ${preset.workingPressureBar} bar`
    ));
  select.replaceChildren(...options);
  const requested = selectedCylinderName === undefined
    ? settings.cylinderPresets.find(preset => preset.name === 'Catalina S80')
    : settings.cylinderPresets.find(preset => preset.name === selectedCylinderName);
  const selected = requested ?? sortCylinderPresetEntries(settings.cylinderPresets)[0]?.preset;
  if (selected) select.value = selected.name;
}
