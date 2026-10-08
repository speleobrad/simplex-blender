import { sortGasPresetEntries, sortVolumePresetEntries } from '../settings.js';

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

function renderVolumeRows(presets) {
  const container = document.getElementById('settings-volume-presets');
  if (!container) return;
  const rows = sortVolumePresetEntries(presets).map(({ volume, index }) => {
    const row = document.createElement('div');
    row.className = 'grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2';
    const input = createPresetInput({
      value: volume,
      type: 'number',
      collection: 'volumePresets',
      index,
      field: 'value',
      label: 'Cylinder preset size in litres',
      min: 0.1,
      step: 0.1
    });
    input.classList.add('text-left');
    row.append(input);
    const unit = document.createElement('span');
    unit.className = 'text-xs text-slate-400';
    unit.textContent = 'L';
    row.append(unit, createRemoveButton('remove-volume-preset', index, `Remove ${volume} L size`));
    return row;
  });
  container.replaceChildren(...rows);
}

export function renderSettingsDialog(settings) {
  renderGasRows(settings.gasPresets);
  renderVolumeRows(settings.volumePresets);
  const boosterFields = {
    'settings-booster-min-source-pressure': settings.booster.minimumSourcePressureBar,
    'settings-booster-cylinder-volume': settings.booster.cylinderVolumeCm3,
    'settings-booster-oxygen-bpm': settings.booster.oxygenBoostBpm,
    'settings-booster-other-bpm': settings.booster.otherBoostBpm,
    'settings-booster-oxygen-decant-rate': settings.booster.oxygenDecantRateBarPerMin,
    'settings-booster-other-decant-rate': settings.booster.otherDecantRateBarPerMin,
    'settings-compressor-inlet-flow': settings.booster.compressorInletFlowLPerMin
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

export function renderPresetOptions(settings, cylinderVolume) {
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

  const select = document.getElementById('cyl-vol-preset');
  const customInput = document.getElementById('cyl-vol-custom');
  if (!select || !customInput) return;
  const volume = Number(cylinderVolume);
  const matchingVolume = settings.volumePresets.find(preset => Math.abs(preset - volume) < 1e-9);
  const options = sortVolumePresetEntries(settings.volumePresets)
    .map(({ volume }) => createOption(volume, String(volume)));
  options.push(createOption(CUSTOM_PRESET, 'Custom…'));
  select.replaceChildren(...options);
  customInput.value = Number.isFinite(volume) ? String(volume) : '';
  const isCustom = matchingVolume === undefined;
  select.value = isCustom ? CUSTOM_PRESET : String(matchingVolume);
  customInput.classList.toggle('hidden', !isCustom);
}
