import { isValidGasComposition } from './gas-input.js';
const STORAGE_KEY = 'simplex-gas-remixer-settings';

export const DEFAULT_SETTINGS = Object.freeze({
  physics: Object.freeze({ model: 'vdw' }),
  gasPresets: Object.freeze([
    Object.freeze({ name: 'Air', oxygenPercent: 21, heliumPercent: 0 }),
    Object.freeze({ name: 'EAN32', oxygenPercent: 32, heliumPercent: 0 }),
    Object.freeze({ name: 'Tx 18/45', oxygenPercent: 18, heliumPercent: 45 }),
    Object.freeze({ name: 'Tx 21/35', oxygenPercent: 21, heliumPercent: 35 }),
    Object.freeze({ name: 'Pure O₂', oxygenPercent: 100, heliumPercent: 0 }),
    Object.freeze({ name: 'Pure He', oxygenPercent: 0, heliumPercent: 100 })
  ]),
  cylinderPresets: Object.freeze([
    Object.freeze({ name: '12 L Steel 232 bar', volumeL: 12, material: 'steel', massKg: 14, workingPressureBar: 232 }),
    Object.freeze({ name: '3 L Steel 232 bar', volumeL: 3, material: 'steel', massKg: 14, workingPressureBar: 232 }),
    Object.freeze({ name: '5 L Steel 232 bar', volumeL: 5, material: 'steel', massKg: 14, workingPressureBar: 232 }),
    Object.freeze({ name: '7 L Steel 232 bar', volumeL: 7, material: 'steel', massKg: 14, workingPressureBar: 232 }),
    Object.freeze({ name: '10 L Steel 232 bar', volumeL: 10, material: 'steel', massKg: 14, workingPressureBar: 232 }),
    Object.freeze({ name: '15 L Steel 232 bar', volumeL: 15, material: 'steel', massKg: 14, workingPressureBar: 232 }),
    Object.freeze({ name: '18 L Steel 232 bar', volumeL: 18, material: 'steel', massKg: 14, workingPressureBar: 232 }),
    Object.freeze({ name: '24 L Steel 232 bar', volumeL: 24, material: 'steel', massKg: 14, workingPressureBar: 232 })
  ]),
  booster: Object.freeze({
    minimumSourcePressureBar: 20,
    cylinderVolumeCm3: 9,
    oxygenBoostBpm: 50,
    otherBoostBpm: 50,
    oxygenDecantRateBarPerMin: 5,
    otherDecantRateBarPerMin: 5,
    compressorInletFlowLPerMin: 100,
    maxCompressorPressureBar: 232,
    maxBoosterOutputPressureBar: 200,
    boosterTemperatureModifierC: 0,
    compressorTemperatureModifierC: 0
  })
});

function copySettings(settings) {
  return {
    physics: { model: settings.physics.model },
    gasPresets: settings.gasPresets.map(preset => ({ ...preset })),
    cylinderPresets: settings.cylinderPresets.map(preset => ({ ...preset })),
    booster: {
      minimumSourcePressureBar: settings.booster.minimumSourcePressureBar,
      cylinderVolumeCm3: settings.booster.cylinderVolumeCm3,
      oxygenBoostBpm: settings.booster.oxygenBoostBpm,
      otherBoostBpm: settings.booster.otherBoostBpm,
      oxygenDecantRateBarPerMin: settings.booster.oxygenDecantRateBarPerMin,
      otherDecantRateBarPerMin: settings.booster.otherDecantRateBarPerMin,
      compressorInletFlowLPerMin: settings.booster.compressorInletFlowLPerMin,
      maxCompressorPressureBar: settings.booster.maxCompressorPressureBar,
      maxBoosterOutputPressureBar: settings.booster.maxBoosterOutputPressureBar,
      boosterTemperatureModifierC: settings.booster.boosterTemperatureModifierC,
      compressorTemperatureModifierC: settings.booster.compressorTemperatureModifierC
    }
  };
}

function legacyVolumePresetsToCylinders(volumePresets) {
  return volumePresets.map(volume => ({
    name: `${volume} L Steel 232 bar`,
    volumeL: volume,
    material: 'steel',
    massKg: 14,
    workingPressureBar: 232
  }));
}

function addDefaultCylinderPresets(settings) {
  const cylinderPresets = Array.isArray(settings?.cylinderPresets)
    ? settings.cylinderPresets
    : Array.isArray(settings?.volumePresets)
      ? legacyVolumePresetsToCylinders(settings.volumePresets)
      : undefined;
  return { ...settings, cylinderPresets };
}

function addDefaultBooster(settings) {
  const booster = settings?.booster && typeof settings.booster === 'object'
    ? settings.booster
    : {};
  return {
    ...settings,
    booster: {
      ...DEFAULT_SETTINGS.booster,
      ...booster
    }
  };
}
function addDefaultPhysics(settings) {
  const physics = settings?.physics && typeof settings.physics === 'object'
    ? settings.physics
    : {};
  return {
    ...settings,
    physics: {
      ...DEFAULT_SETTINGS.physics,
      ...physics
    }
  };
}

export function validateSettings(settings) {
  const errors = [];
  if (!settings || !Array.isArray(settings.gasPresets) || !Array.isArray(settings.cylinderPresets)) {
    return ['Settings must contain gas and cylinder preset lists.'];
  }
  if (settings.cylinderPresets.length === 0) {
    errors.push('At least one cylinder preset is required.');
  }
  if (!['ideal', 'vdw'].includes(settings.physics?.model)) {
    errors.push('Gas model must be either ideal or vdw.');
  }
  const booster = settings.booster;
  if (!booster || !Number.isFinite(booster.minimumSourcePressureBar)
    || booster.minimumSourcePressureBar < 0
    || booster.minimumSourcePressureBar > 100) {
    errors.push('Booster minimum source pressure must be between 0 and 100 bar.');
  }
  if (!Number.isFinite(booster?.cylinderVolumeCm3)
    || booster.cylinderVolumeCm3 < 0.1
    || booster.cylinderVolumeCm3 > 1000) {
    errors.push('Booster cylinder volume must be between 0.1 and 1000 cm³.');
  }
  if (!Number.isFinite(booster?.oxygenBoostBpm)
    || booster.oxygenBoostBpm < 1
    || booster.oxygenBoostBpm > 1000) {
    errors.push('Oxygen booster speed must be between 1 and 1000 BPM.');
  }
  if (!Number.isFinite(booster?.otherBoostBpm)
    || booster.otherBoostBpm < 1
    || booster.otherBoostBpm > 1000) {
    errors.push('Other-gas booster speed must be between 1 and 1000 BPM.');
  }
  if (!Number.isFinite(booster?.oxygenDecantRateBarPerMin)
    || booster.oxygenDecantRateBarPerMin < 0.01
    || booster.oxygenDecantRateBarPerMin > 1000) {
    errors.push('Oxygen manual decant rate must be between 0.01 and 1000 bar/min.');
  }
  if (!Number.isFinite(booster?.otherDecantRateBarPerMin)
    || booster.otherDecantRateBarPerMin < 0.01
    || booster.otherDecantRateBarPerMin > 1000) {
    errors.push('Other-gas manual decant rate must be between 0.01 and 1000 bar/min.');
  }
  if (!Number.isFinite(booster?.compressorInletFlowLPerMin)
    || booster.compressorInletFlowLPerMin < 0.1
    || booster.compressorInletFlowLPerMin > 10000) {
    errors.push('Compressor inlet flow must be between 0.1 and 10000 L/min.');
  }
  for (const [field, label] of [
    ['maxCompressorPressureBar', 'Maximum compressor pressure'],
    ['maxBoosterOutputPressureBar', 'Maximum booster output pressure']
  ]) {
    if (!Number.isFinite(booster?.[field]) || booster[field] < 10 || booster[field] > 350) {
      errors.push(`${label} must be between 10 and 350 bar.`);
    }
  }
  for (const [field, label] of [
    ['boosterTemperatureModifierC', 'Booster temperature modifier'],
    ['compressorTemperatureModifierC', 'Compressor temperature modifier']
  ]) {
    if (!Number.isFinite(booster?.[field]) || booster[field] < -100 || booster[field] > 100) {
      errors.push(`${label} must be between -100 and 100°C.`);
    }
  }

  const names = new Set();
  for (const preset of settings.gasPresets) {
    if (!preset || typeof preset.name !== 'string' || !preset.name.trim()) {
      errors.push('Every gas preset needs a name.');
      continue;
    }
    const normalizedName = preset.name.trim().toLocaleLowerCase();
    if (names.has(normalizedName)) errors.push('Gas preset names must be unique.');
    names.add(normalizedName);

    const oxygen = preset.oxygenPercent;
    const helium = preset.heliumPercent;
    if (!isValidGasComposition(oxygen, helium)) {
      errors.push(`Gas preset “${preset.name}” must total at most 100% O₂ and He.`);
    }
  }

  const cylinderNames = new Set();
  for (const preset of settings.cylinderPresets) {
    if (!preset || typeof preset.name !== 'string' || !preset.name.trim()) {
      errors.push('Every cylinder preset needs a name.');
      continue;
    }
    const normalizedName = preset.name.trim().toLocaleLowerCase();
    if (cylinderNames.has(normalizedName)) errors.push('Cylinder preset names must be unique.');
    cylinderNames.add(normalizedName);

    if (!Number.isFinite(preset.volumeL) || preset.volumeL < 0.1) {
      errors.push(`Cylinder preset “${preset.name}” volume must be at least 0.1 L.`);
    }
    if (!['steel', 'aluminum'].includes(preset.material)) {
      errors.push(`Cylinder preset “${preset.name}” material must be steel or aluminum.`);
    }
    if (!Number.isFinite(preset.massKg) || preset.massKg <= 0) {
      errors.push(`Cylinder preset “${preset.name}” mass must be greater than 0 kg.`);
    }
    if (!Number.isFinite(preset.workingPressureBar)
      || preset.workingPressureBar < 10
      || preset.workingPressureBar > 350) {
      errors.push(`Cylinder preset “${preset.name}” working pressure must be between 10 and 350 bar.`);
    }
  }
  return errors;
}

export function loadSettings(storage, onFallback = () => {}) {
  let serialized;
  try {
    serialized = storage.getItem(STORAGE_KEY);
  } catch (error) {
    onFallback(error);
    return copySettings(DEFAULT_SETTINGS);
  }
  if (serialized === null) return copySettings(DEFAULT_SETTINGS);

  let saved;
  try {
    saved = JSON.parse(serialized);
  } catch (error) {
    onFallback(error);
    return copySettings(DEFAULT_SETTINGS);
  }

  const normalized = addDefaultCylinderPresets(addDefaultPhysics(addDefaultBooster(saved)));
  const errors = validateSettings(normalized);
  if (errors.length > 0) {
    onFallback(new RangeError(errors.join(' ')));
    return copySettings(DEFAULT_SETTINGS);
  }
  return copySettings(normalized);
}

export function saveSettings(settings, storage) {
  const normalized = addDefaultCylinderPresets(addDefaultPhysics(addDefaultBooster(settings)));
  const errors = validateSettings(normalized);
  if (errors.length > 0) throw new RangeError(errors.join(' '));
  storage.setItem(STORAGE_KEY, JSON.stringify(copySettings(normalized)));
}

export function applyGasPresetToBank(bank, preset) {
  bank.name = preset.name;
  bank.oxygenPercent = preset.oxygenPercent;
  bank.heliumPercent = preset.heliumPercent;
}

export function getSelectedGasPreset(bank, gasPresets) {
  if (bank.gasPresetName === null) return null;
  const matchesComposition = preset => Math.abs(preset.oxygenPercent - bank.oxygenPercent) < 1e-9
    && Math.abs(preset.heliumPercent - bank.heliumPercent) < 1e-9;
  const selected = bank.gasPresetName === undefined
    ? gasPresets.find(matchesComposition)
    : gasPresets.find(preset => preset.name === bank.gasPresetName && matchesComposition(preset));
  return selected ?? null;
}

export function sortGasPresetEntries(presets) {
  return presets
    .map((preset, index) => ({ preset, index }))
    .sort((left, right) => left.preset.heliumPercent - right.preset.heliumPercent || left.index - right.index);
}

export function sortCylinderPresetEntries(presets) {
  return presets
    .map((preset, index) => ({ preset, index }))
    .sort((left, right) => left.preset.volumeL - right.preset.volumeL || left.index - right.index);
}
