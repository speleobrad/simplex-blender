import { isValidGasComposition } from './gas-input.js';
import { isValidMaterial, materialListText } from './materials.js';
export const DEFAULT_HOT_OVERFILL_PERCENT = 2;

export function isValidHotOverfillPercent(value) {
  return Number.isFinite(value)
    && value >= 0
    && value <= 5
    && Number.isInteger(value * 2);
}

function hasName(preset) {
  return preset && typeof preset.name === 'string' && preset.name.trim();
}

function validateNamedPreset(category, preset) {
  if (hasName(preset)) return [];
  return [`Every ${category} preset needs a name.`];
}

export function validateGasPreset(preset) {
  const errors = validateNamedPreset('gas', preset);
  if (!preset || !isValidGasComposition(preset.oxygenPercent, preset.heliumPercent)) {
    errors.push(`Gas preset “${preset?.name ?? ''}” must total at most 100% O₂ and He.`);
  }
  return errors;
}

export function validateCylinderPreset(preset) {
  const errors = validateNamedPreset('cylinder', preset);
  if (!preset || !Number.isFinite(preset.volumeL) || preset.volumeL < 0.1) {
    errors.push(`Cylinder preset “${preset?.name ?? ''}” volume must be at least 0.1 L.`);
  }
  if (!preset || !isValidMaterial(preset.material)) {
    errors.push(`Cylinder preset “${preset?.name ?? ''}” material must be ${materialListText()}.`);
  }
  if (!preset || !Number.isFinite(preset.massKg) || preset.massKg <= 0) {
    errors.push(`Cylinder preset “${preset?.name ?? ''}” mass must be greater than 0 kg.`);
  }
  if (!preset || !Number.isFinite(preset.workingPressureBar)
    || preset.workingPressureBar < 10 || preset.workingPressureBar > 350) {
    errors.push(`Cylinder preset “${preset?.name ?? ''}” working pressure must be between 10 and 350 bar.`);
  }
  if (!preset || !isValidHotOverfillPercent(preset.hotOverfillPercent)) {
    errors.push(`Cylinder preset “${preset?.name ?? ''}” hot overfill must be between 0 and 5% in 0.5% steps.`);
  }
  return errors;
}

export function validateCompressorPreset(preset) {
  const errors = validateNamedPreset('compressor', preset);
  if (!preset || !Number.isFinite(preset.inletFlowLPerMin)
    || preset.inletFlowLPerMin < 0.1 || preset.inletFlowLPerMin > 10000) {
    errors.push('Compressor inlet flow must be between 0.1 and 10000 L/min.');
  }
  if (!preset || !Number.isFinite(preset.maxPressureBar)
    || preset.maxPressureBar < 10 || preset.maxPressureBar > 350) {
    errors.push('Maximum compressor pressure must be between 10 and 350 bar.');
  }
  if (!preset || !Number.isFinite(preset.temperatureModifierC)
    || preset.temperatureModifierC < -100 || preset.temperatureModifierC > 100) {
    errors.push('Compressor temperature modifier must be between -100 and 100°C.');
  }
  return errors;
}

export function validateBoosterPreset(preset) {
  const errors = validateNamedPreset('booster', preset);
  const ranges = [
    ['cylinderVolumeCm3', 0.1, 1000, 'Booster cylinder volume', 'cm³'],
    ['minimumSourcePressureBar', 0, 100, 'Booster minimum source pressure', 'bar'],
    ['oxygenBoostBpm', 1, 1000, 'Oxygen booster speed', 'BPM'],
    ['otherBoostBpm', 1, 1000, 'Other-gas booster speed', 'BPM'],
    ['maxOutputPressureBar', 10, 350, 'Maximum booster output pressure', 'bar'],
    ['temperatureModifierC', -100, 100, 'Booster temperature modifier', '°C'],
    ['oxygenDecantRateBarPerMin', 0.01, 1000, 'Oxygen manual decant rate', 'bar/min'],
    ['otherDecantRateBarPerMin', 0.01, 1000, 'Other-gas manual decant rate', 'bar/min'],
    ['drainingRateBarPerMin', 0.01, 1000, 'Draining rate', 'bar/min']
  ];
  for (const [field, minimum, maximum, label, unit] of ranges) {
    if (!preset || !Number.isFinite(preset[field]) || preset[field] < minimum || preset[field] > maximum) {
      errors.push(`${label} must be between ${minimum} and ${maximum} ${unit}.`);
    }
  }
  return errors;
}

export const CATEGORY_VALIDATORS = Object.freeze({
  gasPresets: validateGasPreset,
  cylinderPresets: validateCylinderPreset,
  compressorPresets: validateCompressorPreset,
  boosterPresets: validateBoosterPreset
});

export function validatePreset(category, preset) {
  const validator = CATEGORY_VALIDATORS[category];
  if (!validator) throw new RangeError(`Unknown preset category: ${category}`);
  return validator(preset);
}
