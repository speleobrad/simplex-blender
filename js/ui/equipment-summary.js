import { convertToDisplay, formatQuantity, getUnitLabel, normalizeUnits } from '../units.js';
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
function equipmentQuantity(value, quantity, units) {
  if (normalizeUnits(units) === 'metric') return `${value} ${quantity === 'flow' ? 'L/min' : 'bar'}`;
  return formatQuantity(convertToDisplay(value, quantity, units), quantity, units);
}
function equipmentRate(value, units) {
  if (normalizeUnits(units) === 'metric') return String(value);
  return formatQuantity(convertToDisplay(value, 'pressure', units), 'pressure', units).split(' ')[0];
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
  note.textContent = 'Equipment can be changed in Settings.';
  container.replaceChildren(
    makeRow(
      'Compressor',
      `${compressorName} · ${equipmentQuantity(activeEquipment.compressorInletFlowLPerMin, 'flow', units)} · ${equipmentQuantity(activeEquipment.maxCompressorPressureBar, 'pressure', units)}`
    ),
    makeRow(
      'Booster',
      `${boosterName} · boost ${activeEquipment.oxygenBoostBpm}/${activeEquipment.otherBoostBpm} BPM · decant ${equipmentRate(activeEquipment.oxygenDecantRateBarPerMin, units)}/${equipmentRate(activeEquipment.otherDecantRateBarPerMin, units)} ${getUnitLabel('pressure', units)}/min · ${equipmentQuantity(activeEquipment.maxBoosterOutputPressureBar, 'pressure', units)}`
    ),
    note
  );
}
