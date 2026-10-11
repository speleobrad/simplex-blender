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

function createRemoveButton(action, index, label) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'rounded px-2 text-rose-400 hover:bg-rose-500/10 hover:text-rose-300';
  button.textContent = '×';
  button.dataset.action = action;
  button.dataset.settingsIndex = String(index);
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
      createRemoveButton('remove-gas-preset', index, `Remove ${preset.name || 'gas preset'}`)
    );
    return row;
  });
  container.replaceChildren(...rows);
}

function createUnitField({ value, collection, index, field, label, min, max, step, unit }) {
  const wrapper = document.createElement('div');
  wrapper.className = 'flex items-center gap-1';
  const input = createPresetInput({
    value,
    type: 'number',
    collection,
    index,
    field,
    label,
    min,
    max,
    step
  });
  input.classList.add('w-full');
  const suffix = document.createElement('span');
  suffix.className = 'text-[10px] text-slate-400';
  suffix.textContent = unit;
  wrapper.append(input, suffix);
  return wrapper;
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

function renderCylinderRows(presets) {
  const container = document.getElementById('settings-cylinder-presets');
  if (!container) return;
  const rows = sortCylinderPresetEntries(presets).map(({ preset, index }) => {
    const row = document.createElement('div');
    row.className = 'grid grid-cols-[minmax(0,1fr)_4.5rem_5.5rem_4.5rem_5rem_auto] items-center gap-1.5';
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
      name,
      createUnitField({
        value: preset.volumeL,
        collection: 'cylinderPresets',
        index,
        field: 'volumeL',
        label: `${preset.name || 'Cylinder'} internal volume in litres`,
        min: 0.1,
        step: 0.1,
        unit: 'L'
      }),
      createMaterialSelect(preset, index),
      createUnitField({
        value: preset.massKg,
        collection: 'cylinderPresets',
        index,
        field: 'massKg',
        label: `${preset.name || 'Cylinder'} mass in kilograms`,
        min: 0.1,
        step: 0.1,
        unit: 'kg'
      }),
      createUnitField({
        value: preset.workingPressureBar,
        collection: 'cylinderPresets',
        index,
        field: 'workingPressureBar',
        label: `${preset.name || 'Cylinder'} working pressure in bar`,
        min: 10,
        max: 350,
        step: 1,
        unit: 'bar'
      }),
      createRemoveButton('remove-cylinder-preset', index, `Remove ${preset.name || 'cylinder preset'}`)
    );
    return row;
  });
  container.replaceChildren(...rows);
}

export function renderSettingsDialog(settings) {
  const physicsModel = document.getElementById('settings-physics-model');
  if (physicsModel) physicsModel.value = settings.physics.model;
  renderCylinderRows(settings.cylinderPresets);
  const boosterFields = {
    'settings-booster-min-source-pressure': settings.booster.minimumSourcePressureBar,
    'settings-booster-cylinder-volume': settings.booster.cylinderVolumeCm3,
    'settings-booster-oxygen-bpm': settings.booster.oxygenBoostBpm,
    'settings-booster-other-bpm': settings.booster.otherBoostBpm,
    'settings-booster-oxygen-decant-rate': settings.booster.oxygenDecantRateBarPerMin,
    'settings-booster-other-decant-rate': settings.booster.otherDecantRateBarPerMin,
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
  const selected = settings.cylinderPresets.find(preset => preset.name === selectedCylinderName)
    ?? settings.cylinderPresets.find(preset => preset.name === '12 L Steel 232 bar')
    ?? sortCylinderPresetEntries(settings.cylinderPresets)[0]?.preset;
  if (selected) select.value = selected.name;
}
