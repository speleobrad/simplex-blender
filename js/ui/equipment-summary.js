import { convertToDisplay, formatUnitValue, unitLabel } from '../units.js';
function compressorPresetMatchesActiveFields(compressor, preset) {
  return preset.inletFlowLPerMin === compressor.compressorInletFlowLPerMin
    && preset.maxPressureBar === compressor.maxCompressorPressureBar
    && preset.temperatureModifierC === compressor.compressorTemperatureModifierC;
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

function equipmentValue(value, quantity, units) {
  if (units === 'metric') return `${value} ${unitLabel(quantity, units)}`;
  return formatUnitValue(value, quantity, units);
}
function rateValue(value, units) {
  const digits = units === 'metric' ? 0 : 1;
  return convertToDisplay(value, 'pressureBar', units).toFixed(digits);
}


function makeRow(label, value) {
  const row = document.createElement('div');
  row.className = 'flex flex-wrap items-baseline gap-x-2 gap-y-0.5';

  const labelElement = document.createElement('span');
  labelElement.className = 'font-medium text-slate-400';
  labelElement.textContent = label;

  const valueElement = document.createElement('span');
  valueElement.className = 'font-mono text-slate-200';
  valueElement.textContent = value;
  row.append(labelElement, valueElement);
  return row;
}

function makePresetSelect(id, action, label, presets, selectedName) {
  const wrapper = document.createElement('label');
  wrapper.className = 'flex items-center gap-2 text-xs';
  wrapper.textContent = label;
  const select = document.createElement('select');
  select.id = id;
  select.dataset ??= {};
  select.dataset.action = action;
  select.className = 'min-w-0 flex-1 rounded border border-ocean-700 bg-ocean-950 px-2 py-1 text-xs text-slate-100';
  select.setAttribute?.('aria-label', label);
  for (const preset of presets) {
    const option = document.createElement('option');
    option.value = preset.name;
    option.textContent = preset.name;
    select.append(option);
  }
  if (selectedName) select.value = selectedName;
  wrapper.append(select);
  return wrapper;
}

export function renderEquipmentSummary(settings, units = 'metric') {
  const container = document.getElementById('equipment-summary');
  if (!container) return;

  const activeEquipment = settings.booster;
  const compressorPreset = settings.compressorPresets.find(preset => compressorPresetMatchesActiveFields(activeEquipment, preset));
  const boosterPreset = settings.boosterPresets.find(preset => boosterPresetMatchesActiveFields(activeEquipment, preset));
  const compressorName = compressorPreset?.name ?? 'Custom compressor';
  const boosterName = boosterPreset?.name ?? 'Custom booster';

  const note = document.createElement('p');
  note.className = 'text-[10px] text-slate-500';
  note.textContent = 'Choose available equipment here; equipment lists and properties can also be changed in Settings.';
  container.replaceChildren(
    makePresetSelect('inventory-compressor-preset', 'select-inventory-compressor-preset', 'Compressor', settings.compressorPresets, compressorName),
    makePresetSelect('inventory-booster-preset', 'select-inventory-booster-preset', 'Booster', settings.boosterPresets, boosterName),
    makeRow(
      'Compressor details',
      `${compressorName} · ${equipmentValue(activeEquipment.compressorInletFlowLPerMin, 'flowLPerMin', units)} · ${equipmentValue(activeEquipment.maxCompressorPressureBar, 'pressureBar', units)}`
    ),
    makeRow(
      'Booster details',
      `${boosterName} · boost ${activeEquipment.oxygenBoostBpm}/${activeEquipment.otherBoostBpm} BPM · decant ${rateValue(activeEquipment.oxygenDecantRateBarPerMin, units)}/${rateValue(activeEquipment.otherDecantRateBarPerMin, units)} ${unitLabel('pressureBar', units)}/min · ${equipmentValue(activeEquipment.maxBoosterOutputPressureBar, 'pressureBar', units)}`
    ),
    note
  );
}
