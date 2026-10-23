import { PRESET_IMPORT_DEFAULT_URLS } from '../preset-import.js';
import { matchesPressureWarningUnlockPhrase, sortCylinderPresetEntries, sortGasPresetEntries } from '../settings.js';
import { convertToDisplay, materialLabel, unitLabel } from '../units.js';
const CUSTOM_PRESET = 'custom';
const EQUIPMENT_FIELD_QUANTITIES = {
  'settings-booster-min-source-pressure': 'pressureBar',
  'settings-booster-cylinder-volume': 'volumeCm3',
  'settings-booster-oxygen-decant-rate': 'pressureBarPerMin',
  'settings-booster-other-decant-rate': 'pressureBarPerMin',
  'settings-booster-draining-rate': 'pressureBarPerMin',
  'settings-compressor-inlet-flow': 'flowLPerMin',
  'settings-compressor-max-pressure': 'pressureBar',
  'settings-booster-max-output-pressure': 'pressureBar',
  'settings-booster-temperature-modifier': 'temperatureDeltaC',
  'settings-compressor-temperature-modifier': 'temperatureDeltaC'
};
const EQUIPMENT_FIELD_LIMITS = {
  'settings-booster-min-source-pressure': [0, 100, 1],
  'settings-booster-cylinder-volume': [0.1, 1000, 0.1],
  'settings-booster-oxygen-decant-rate': [0.01, 1000, 0.01],
  'settings-booster-other-decant-rate': [0.01, 1000, 0.01],
  'settings-booster-draining-rate': [0.01, 1000, 0.01],
  'settings-compressor-inlet-flow': [0.1, 10000, 0.1],
  'settings-compressor-max-pressure': [10, 350, 1],
  'settings-booster-max-output-pressure': [10, 350, 1],
  'settings-booster-temperature-modifier': [-100, 100, 1],
  'settings-compressor-temperature-modifier': [-100, 100, 1]
};
function formatSettingNumber(value) {
  return Number.isFinite(Number(value)) ? Number(value).toFixed(2) : String(value);
}

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


function createCylinderNumberInput({ value, index, field, label, min, max, step, width = 'w-20' }) {
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
  input.classList.add(...width.split(/\s+/).filter(Boolean));
  if (min !== undefined) input.min = formatSettingNumber(min);
  if (max !== undefined) input.max = formatSettingNumber(max);
  if (step !== undefined) input.step = formatSettingNumber(step);
  input.value = formatSettingNumber(value);
  return input;
}

function createMaterialSelect(preset, index, units) {
  const select = document.createElement('select');
  select.className = 'w-24 min-w-0 rounded border border-ocean-700 bg-ocean-950 px-2 py-1 text-xs text-slate-100';
  select.dataset.settingsCollection = 'cylinderPresets';
  select.dataset.settingsIndex = String(index);
  select.dataset.settingsField = 'material';
  select.setAttribute('aria-label', `${preset.name || 'Cylinder'} material`);
  for (const [value, label] of [['steel', 'Steel'], ['aluminum', 'Aluminum']]) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = materialLabel(value, units);
    select.append(option);
  }
  select.value = preset.material;
  return select;
}

function createCylinderField(label, content) {
  const field = document.createElement('div');
  field.className = 'min-w-0 px-1';
  const labelElement = document.createElement('span');
  labelElement.className = 'mb-1 block truncate text-[10px] uppercase tracking-wide text-slate-500';
  labelElement.textContent = label;
  field.append(labelElement, content);
  return field;
}
const LITRES_PER_CU_FT_AT_ONE_BAR = 28.316846592 * 1.01325;

function cylinderDisplayValue(preset, field, units) {
  if (field === 'volumeL' && units === 'imperial') {
    return preset.volumeL * preset.workingPressureBar / LITRES_PER_CU_FT_AT_ONE_BAR;
  }
  const quantity = { volumeL: 'volumeL', massKg: 'massKg', workingPressureBar: 'pressureBar' }[field];
  return quantity ? convertToDisplay(preset[field], quantity, units) : preset[field];
}

function cylinderUnitLabel(field, units) {
  if (field === 'volumeL') return units === 'imperial' ? 'cu ft' : 'L';
  if (field === 'massKg') return unitLabel('massKg', units);
  return field === 'workingPressureBar' ? unitLabel('pressureBar', units) : '';
}


function createCylinderCard(preset, index, presetCount, units) {
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
    createCylinderField('Material', createMaterialSelect(preset, index, units)),
    createCylinderField(`Volume (${cylinderUnitLabel('volumeL', units)})`, createCylinderNumberInput({
      value: cylinderDisplayValue(preset, 'volumeL', units),
      index,
      field: 'volumeL',
      label: `${preset.name || 'Cylinder'} internal volume in ${cylinderUnitLabel('volumeL', units)}`,
      min: 0.1,
      step: 0.1
    })),
    createCylinderField(`Mass (${cylinderUnitLabel('massKg', units)})`, createCylinderNumberInput({
      value: cylinderDisplayValue(preset, 'massKg', units),
      index,
      field: 'massKg',
      label: `${preset.name || 'Cylinder'} mass in ${cylinderUnitLabel('massKg', units)}`,
      min: 0.1,
      step: 0.1
    })),
    createCylinderField(`Working pressure (${cylinderUnitLabel('workingPressureBar', units)})`, createCylinderNumberInput({
      value: cylinderDisplayValue(preset, 'workingPressureBar', units),
      index,
      field: 'workingPressureBar',
      label: `${preset.name || 'Cylinder'} working pressure in ${cylinderUnitLabel('workingPressureBar', units)}`,
      min: convertToDisplay(10, 'pressureBar', units),
      max: convertToDisplay(350, 'pressureBar', units),
      step: 1
    })),
    createCylinderField('Hot overfill (%)', createCylinderNumberInput({
      value: preset.hotOverfillPercent,
      index,
      field: 'hotOverfillPercent',
      label: `${preset.name || 'Cylinder'} hot overfill percentage`,
      min: 0,
      max: 5,
      step: 0.5
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

function renderCylinderRows(presets, units) {
  const container = document.getElementById('settings-cylinder-presets');
  if (!container) return;
  const sortedPresets = sortCylinderPresetEntries(presets);
  const cards = document.createElement('div');
  cards.className = 'space-y-2 sm:hidden';
  for (const { preset, index } of sortedPresets) {
    cards.append(createCylinderCard(preset, index, presets.length, units));
  }

  const table = document.createElement('table');
  table.className = 'hidden min-w-[48rem] w-full text-left text-xs sm:table sm:grid';
  const thead = document.createElement('thead');
  thead.className = 'grid';
  const headerRow = document.createElement('tr');
  headerRow.className = 'grid grid-cols-[minmax(0,1fr)_6rem_4.5rem_4.5rem_6rem_5.5rem_1.5rem] items-end gap-2 px-2 pb-1 text-[10px] uppercase tracking-wide text-slate-400';
  for (const [label, ariaLabel] of [
    ['Name', undefined],
    ['Material', undefined],
    [`Volume (${cylinderUnitLabel('volumeL', units)})`, undefined],
    [`Mass (${cylinderUnitLabel('massKg', units)})`, undefined],
    [`Working pressure (${cylinderUnitLabel('workingPressureBar', units)})`, undefined],
    ['Hot overfill (%)', undefined],
    ['', 'Actions']
  ]) {
    const header = document.createElement('th');
    header.scope = 'col';
    header.className = `min-w-0 text-left font-medium ${/Mass|Working pressure/.test(label) ? 'w-16' : ''}`;
    header.textContent = label;
    if (ariaLabel) header.setAttribute('aria-label', ariaLabel);
    headerRow.append(header);
  }
  thead.append(headerRow);
  table.append(thead);

  const tbody = document.createElement('tbody');
  tbody.className = 'grid';
  for (const { preset, index } of sortedPresets) {
    const row = document.createElement('tr');
    row.className = 'grid grid-cols-[minmax(0,1fr)_6rem_4.5rem_4.5rem_6rem_5.5rem_1.5rem] items-center gap-2 border-t border-ocean-800/70 px-2 py-1';
    const name = createPresetInput({
      value: preset.name,
      type: 'text',
      collection: 'cylinderPresets',
      index,
      field: 'name',
      label: 'Cylinder preset name'
    });
    name.classList.add('w-full');
    const volume = createCylinderNumberInput({
      value: cylinderDisplayValue(preset, 'volumeL', units),
      index,
      field: 'volumeL',
      width: 'w-full',
      label: `${preset.name || 'Cylinder'} internal volume in ${cylinderUnitLabel('volumeL', units)}`,
      min: 0.1,
      step: 0.1
    });
    const mass = createCylinderNumberInput({
      value: cylinderDisplayValue(preset, 'massKg', units),
      index,
      field: 'massKg',
      width: 'w-full w-16',
      label: `${preset.name || 'Cylinder'} mass in ${cylinderUnitLabel('massKg', units)}`,
      min: 0.1,
      step: 0.1
    });
    const workingPressure = createCylinderNumberInput({
      value: cylinderDisplayValue(preset, 'workingPressureBar', units),
      index,
      field: 'workingPressureBar',
      width: 'w-full',
      label: `${preset.name || 'Cylinder'} working pressure in ${cylinderUnitLabel('workingPressureBar', units)}`,
      min: convertToDisplay(10, 'pressureBar', units),
      max: convertToDisplay(350, 'pressureBar', units),
      step: 1
    });
    const hotOverfill = createCylinderNumberInput({
      value: preset.hotOverfillPercent,
      index,
      field: 'hotOverfillPercent',
      width: 'w-full',
      label: `${preset.name || 'Cylinder'} hot overfill percentage`,
      min: 0,
      max: 5,
      step: 0.5
    });
    row.append(
      name,
      createMaterialSelect(preset, index, units),
      volume,
      mass,
      workingPressure,
      hotOverfill,
      createRemoveButton('remove-cylinder-preset', index, `Remove ${preset.name || 'cylinder preset'}`, presets.length <= 1)
    );
    tbody.append(row);
  }
  table.append(tbody);

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

function presetImportLabel(category, preset, units) {
  if (category === 'gas') return `${preset.name} — ${preset.oxygenPercent}% O₂ / ${preset.heliumPercent}% He`;
  if (category === 'cylinders') {
    return `${preset.name} — ${preset.volumeL} L / ${materialLabel(preset.material, units)} / ${preset.workingPressureBar} bar`;
  }
  const kind = preset.inletFlowLPerMin === undefined ? 'Booster' : 'Compressor';
  return `${kind}: ${preset.name}`;
}

function candidateStatusLabel(candidate) {
  if (candidate.status === 'duplicate') return 'Already exists';
  if (candidate.status === 'invalid') return 'Rejected';
  return 'New';
}

function renderPresetImportCandidates(importState, units) {
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
    title.textContent = presetImportLabel(importState.category, candidate.preset, units);
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
  renderPresetImportCandidates(state, settings.units);
  const selectedIds = new Set(importState.selectedIds ?? []);
  importButton.disabled = Boolean(importState.loading)
    || !(importState.candidates ?? []).some(candidate => (
      candidate.status === 'new'
      && candidate.selectable !== false
    ));
  importButton.textContent = importState.loading ? 'Loading…' : 'Import selected';
}

export function renderSettingsDialog(settings, importState) {
  const units = document.getElementById('settings-units');
  if (units) units.value = settings.units === 'imperial' ? 'imperial' : 'metric';
  const physicsModel = document.getElementById('settings-physics-model');
  if (physicsModel && settings.physics?.model) physicsModel.value = settings.physics.model;
  const pressureMode = document.getElementById('settings-pressure-limit-mode');
  const warningUnlocked = settings.pressureWarningUnlocked === true;
  if (pressureMode) {
    pressureMode.value = settings.pressureLimitMode === 'warning' && warningUnlocked ? 'warning' : 'hard-stop';
    const warningOption = pressureMode.querySelector('option[value="warning"]');
    if (warningOption) warningOption.disabled = !warningUnlocked;
  }
  const confirmation = document.getElementById('settings-pressure-limit-confirmation');
  const unlock = document.getElementById('settings-pressure-warning-unlock-button');
  if (unlock) unlock.disabled = warningUnlocked
    || !matchesPressureWarningUnlockPhrase(confirmation?.value);
  const notice = document.getElementById('settings-pressure-warning-notice');
  if (notice) notice.classList.toggle('hidden', pressureMode?.value !== 'warning');
  renderGasRows(settings.gasPresets);
  renderCylinderRows(settings.cylinderPresets, settings.units);
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
  for (const unitElement of document.querySelectorAll('[data-settings-unit]')) {
    unitElement.textContent = unitLabel(unitElement.dataset.settingsUnit, settings.units);
  }
  for (const [id, value] of Object.entries(boosterFields)) {
    const input = document.getElementById(id);
    if (!input) continue;
    const quantity = EQUIPMENT_FIELD_QUANTITIES[id];
    const displayValue = quantity ? convertToDisplay(value, quantity, settings.units) : value;
    const limits = EQUIPMENT_FIELD_LIMITS[id];
    if (limits && quantity) {
      input.min = String(convertToDisplay(limits[0], quantity, settings.units));
      input.max = String(convertToDisplay(limits[1], quantity, settings.units));
      input.step = String(convertToDisplay(limits[2], quantity, settings.units));
    }
    input.value = id.includes('temperature-modifier')
      ? `${Number(displayValue) >= 0 ? '+' : ''}${formatSettingNumber(displayValue)}`
      : formatSettingNumber(displayValue);
    if (quantity) {
      const currentLabel = input.getAttribute
        ? input.getAttribute('aria-label')
        : input.attributes?.get('aria-label');
      const label = currentLabel?.replace(/ in .+$/i, '') ?? id;
      input.setAttribute('aria-label', `${label} in ${unitLabel(quantity, settings.units)}`);
    }
    if (id.includes('temperature-modifier')) {
      input.classList.toggle('text-orange-300', Number(value) > 0);
      input.classList.toggle('text-emerald-300', Number(value) < 0);
    }
  }
}

function createOption(value, label) {
  const option = document.createElement('option');
  option.value = String(value);
  option.textContent = label;
  return option;
}

export function renderPresetOptions(settings, selectedCylinderName, units = 'metric') {
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
  const displayValue = (value, quantity, preset) => {
    const displayed = quantity === 'volumeL' && units === 'imperial'
      ? preset.volumeL * preset.workingPressureBar / LITRES_PER_CU_FT_AT_ONE_BAR
      : convertToDisplay(value, quantity, units);
    return `${formatSettingNumber(displayed)} ${unitLabel(quantity, units)}`;
  };
  const options = sortCylinderPresetEntries(settings.cylinderPresets)
    .map(({ preset }) => createOption(
      preset.name,
      `${preset.name} — ${displayValue(preset.volumeL, 'volumeL', preset)} / ${materialLabel(preset.material, units)} / ${displayValue(preset.workingPressureBar, 'pressureBar', preset)}`
    ));
  select.replaceChildren(...options);
  const requested = selectedCylinderName === undefined
    ? settings.cylinderPresets.find(preset => preset.name === 'Catalina S80')
    : settings.cylinderPresets.find(preset => preset.name === selectedCylinderName);
  const selected = requested ?? sortCylinderPresetEntries(settings.cylinderPresets)[0]?.preset;
  if (selected) select.value = selected.name;
}
