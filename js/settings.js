import {
  DEFAULT_HOT_OVERFILL_PERCENT,
  validateBoosterPreset,
  validateCompressorPreset,
  validateCylinderPreset,
  validateGasPreset
} from './preset-validation.js';
const STORAGE_KEY = 'simplex-gas-remixer-settings';

export function normalizePresetName(name) {
  return typeof name === 'string' ? name.trim().toLowerCase() : '';
}

const PRESSURE_WARNING_UNLOCK_PHRASE = "I KNOW WHAT I'M DOING";

export function matchesPressureWarningUnlockPhrase(value) {
  return typeof value === 'string'
    && value.replace(/[a-z]/g, letter => letter.toUpperCase())
      .replace(/[`"]/g, "'") === PRESSURE_WARNING_UNLOCK_PHRASE;
}

export const DEFAULT_SETTINGS = Object.freeze({
  units: 'metric',
  pressureLimitMode: 'hard-stop',
  pressureWarningUnlocked: false,
  physics: Object.freeze({ model: 'vdw' }),
  gasPresets: Object.freeze([
    Object.freeze({ name: 'Air', oxygenPercent: 21, heliumPercent: 0 }),
    Object.freeze({ name: 'EAN 32', oxygenPercent: 32, heliumPercent: 0 }),
    Object.freeze({ name: 'EAN 50', oxygenPercent: 50, heliumPercent: 0 }),
    Object.freeze({ name: 'Oxygen', oxygenPercent: 100, heliumPercent: 0 }),
    Object.freeze({ name: 'Helium', oxygenPercent: 0, heliumPercent: 100 }),
    Object.freeze({ name: 'Tx 21/35', oxygenPercent: 21, heliumPercent: 35 }),
    Object.freeze({ name: 'Tx 18/45', oxygenPercent: 18, heliumPercent: 45 }),
    Object.freeze({ name: 'Tx 15/55', oxygenPercent: 15, heliumPercent: 55 }),
    Object.freeze({ name: 'Tx 12/65', oxygenPercent: 12, heliumPercent: 65 }),
    Object.freeze({ name: 'Tx 50/20', oxygenPercent: 50, heliumPercent: 20 })
  ]),
  cylinderPresets: Object.freeze([
    Object.freeze({ name: 'Faber 3L', volumeL: 3, material: 'steel', massKg: 4.4, workingPressureBar: 232, hotOverfillPercent: DEFAULT_HOT_OVERFILL_PERCENT }),
    Object.freeze({ name: 'Catalina S80', volumeL: 11.1, material: 'aluminum', massKg: 14.3, workingPressureBar: 207, hotOverfillPercent: DEFAULT_HOT_OVERFILL_PERCENT })
  ]),
  compressorPresets: Object.freeze([
    Object.freeze({
      name: 'Bauer Junior 2 200bar',
      inletFlowLPerMin: 100,
      maxPressureBar: 232,
      temperatureModifierC: 5
    }),
    Object.freeze({
      name: 'Bauer Oceanus 300bar',
      inletFlowLPerMin: 140,
      maxPressureBar: 300,
      temperatureModifierC: 7
    })
  ]),
  boosterPresets: Object.freeze([
    Object.freeze({
      name: 'MPS C1 Sport light',
      minimumSourcePressureBar: 5,
      cylinderVolumeCm3: 9,
      oxygenBoostBpm: 35,
      otherBoostBpm: 50,
      oxygenDecantRateBarPerMin: 5,
      otherDecantRateBarPerMin: 10,
      maxOutputPressureBar: 230,
      temperatureModifierC: 10,
      drainingRateBarPerMin: 15
    }),
    Object.freeze({
      name: 'Maximator ROB22',
      minimumSourcePressureBar: 50,
      cylinderVolumeCm3: 4.6,
      oxygenBoostBpm: 30,
      otherBoostBpm: 50,
      oxygenDecantRateBarPerMin: 5,
      otherDecantRateBarPerMin: 10,
      maxOutputPressureBar: 280,
      temperatureModifierC: 0,
      drainingRateBarPerMin: 15
    })
  ]),
  booster: Object.freeze({
    minimumSourcePressureBar: 5,
    cylinderVolumeCm3: 9,
    oxygenBoostBpm: 35,
    otherBoostBpm: 50,
    oxygenDecantRateBarPerMin: 5,
    otherDecantRateBarPerMin: 10,
    drainingRateBarPerMin: 15,
    compressorInletFlowLPerMin: 100,
    maxCompressorPressureBar: 232,
    maxBoosterOutputPressureBar: 230,
    boosterTemperatureModifierC: 10,
    compressorTemperatureModifierC: 5
  })
});

export function copySettings(settings) {
  return {
    units: settings.units === 'imperial' ? 'imperial' : 'metric',
    pressureLimitMode: settings.pressureLimitMode,
    pressureWarningUnlocked: settings.pressureWarningUnlocked,
    physics: { model: settings.physics.model },
    gasPresets: settings.gasPresets.map(preset => ({ ...preset })),
    compressorPresets: settings.compressorPresets.map(preset => ({ ...preset })),
    boosterPresets: settings.boosterPresets.map(preset => ({ ...preset })),
    cylinderPresets: settings.cylinderPresets.map(preset => ({ ...preset })),
    booster: {
      minimumSourcePressureBar: settings.booster.minimumSourcePressureBar,
      cylinderVolumeCm3: settings.booster.cylinderVolumeCm3,
      oxygenBoostBpm: settings.booster.oxygenBoostBpm,
      otherBoostBpm: settings.booster.otherBoostBpm,
      oxygenDecantRateBarPerMin: settings.booster.oxygenDecantRateBarPerMin,
      otherDecantRateBarPerMin: settings.booster.otherDecantRateBarPerMin,
      drainingRateBarPerMin: settings.booster.drainingRateBarPerMin,
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
    workingPressureBar: 232,
    hotOverfillPercent: DEFAULT_HOT_OVERFILL_PERCENT
  }));
}

function addDefaultCylinderPresets(settings) {
  const sourcePresets = Array.isArray(settings?.cylinderPresets)
    ? settings.cylinderPresets
    : Array.isArray(settings?.volumePresets)
      ? legacyVolumePresetsToCylinders(settings.volumePresets)
      : undefined;
  const cylinderPresets = Array.isArray(sourcePresets)
    ? sourcePresets.map(preset => ({
      ...preset,
      hotOverfillPercent: preset?.hotOverfillPercent === undefined
        ? DEFAULT_HOT_OVERFILL_PERCENT
        : preset.hotOverfillPercent
    }))
    : sourcePresets;
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

function addDefaultUnits(settings) {
  return {
    ...settings,
    units: settings?.units === 'imperial' ? 'imperial' : DEFAULT_SETTINGS.units
  };
}
function addDefaultPressureLimitPolicy(settings) {
  return {
    ...settings,
    pressureLimitMode: Object.hasOwn(settings ?? {}, 'pressureLimitMode')
      ? settings.pressureLimitMode
      : DEFAULT_SETTINGS.pressureLimitMode,
    pressureWarningUnlocked: Object.hasOwn(settings ?? {}, 'pressureWarningUnlocked')
      ? settings.pressureWarningUnlocked
      : DEFAULT_SETTINGS.pressureWarningUnlocked
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
  if (settings.gasPresets.length === 0) {
    errors.push('At least one gas preset is required.');
  }
  if (!['metric', 'imperial'].includes(settings.units)) {
    errors.push('Units must be either metric or imperial.');
  }
  if (!['hard-stop', 'warning'].includes(settings.pressureLimitMode)) {
    errors.push('Pressure limit mode must be either hard-stop or warning.');
  }
  if (typeof settings.pressureWarningUnlocked !== 'boolean') {
    errors.push('Pressure warning unlock must be boolean.');
  }
  if (settings.pressureLimitMode === 'warning' && settings.pressureWarningUnlocked !== true) {
    errors.push('Pressure warning mode requires an unlock.');
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
  if (!Number.isFinite(booster?.drainingRateBarPerMin)
    || booster.drainingRateBarPerMin < 0.01
    || booster.drainingRateBarPerMin > 1000) {
    errors.push('Draining rate must be between 0.01 and 1000 bar/min.');
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

  errors.push(
    ...validatePresetCollection(settings.compressorPresets, 'compressor', validateCompressorPreset),
    ...validatePresetCollection(settings.boosterPresets, 'booster', validateBoosterPreset)
  );

  const names = new Set();
  for (const preset of settings.gasPresets) {
    const presetErrors = validateGasPreset(preset);
    if (!preset || typeof preset.name !== 'string' || !preset.name.trim()) {
      errors.push(...presetErrors.filter(error => /needs a name/.test(error)));
      continue;
    }
    const normalizedName = normalizePresetName(preset.name);
    if (names.has(normalizedName)) errors.push('Gas preset names must be unique.');
    names.add(normalizedName);
    errors.push(...presetErrors);
  }

  const cylinderNames = new Set();
  for (const preset of settings.cylinderPresets) {
    const presetErrors = validateCylinderPreset(preset);
    if (!preset || typeof preset.name !== 'string' || !preset.name.trim()) {
      errors.push(...presetErrors.filter(error => /needs a name/.test(error)));
      continue;
    }
    const normalizedName = normalizePresetName(preset.name);
    if (cylinderNames.has(normalizedName)) errors.push('Cylinder preset names must be unique.');
    cylinderNames.add(normalizedName);
    errors.push(...presetErrors);
  }
  return errors;
}

function addDefaultEquipmentPresets(settings) {
  const source = settings ?? {};
  const booster = source.booster;
  return {
    ...source,
    compressorPresets: Object.hasOwn(source, 'compressorPresets')
      ? source.compressorPresets
      : [{
          name: 'Standard compressor',
          inletFlowLPerMin: booster.compressorInletFlowLPerMin,
          maxPressureBar: booster.maxCompressorPressureBar,
          temperatureModifierC: booster.compressorTemperatureModifierC
        }],
    boosterPresets: Object.hasOwn(source, 'boosterPresets')
      ? source.boosterPresets
      : [{
          name: 'Standard booster',
          minimumSourcePressureBar: booster.minimumSourcePressureBar,
          cylinderVolumeCm3: booster.cylinderVolumeCm3,
          oxygenBoostBpm: booster.oxygenBoostBpm,
          otherBoostBpm: booster.otherBoostBpm,
          oxygenDecantRateBarPerMin: booster.oxygenDecantRateBarPerMin,
          otherDecantRateBarPerMin: booster.otherDecantRateBarPerMin,
          maxOutputPressureBar: booster.maxBoosterOutputPressureBar,
          temperatureModifierC: booster.boosterTemperatureModifierC,
          drainingRateBarPerMin: booster.drainingRateBarPerMin
        }]
  };
}

function validatePresetCollection(presets, category, validator) {
  const errors = [];
  if (!Array.isArray(presets)) return [`Settings must contain a ${category} preset list.`];
  if (presets.length === 0) return [`At least one ${category} preset is required.`];

  const names = new Set();
  for (const preset of presets) {
    const presetErrors = validator(preset);
    if (!preset || typeof preset.name !== 'string' || !preset.name.trim()) {
      errors.push(...presetErrors.filter(error => /needs a name/.test(error)));
      continue;
    }
    const normalizedName = normalizePresetName(preset.name);
    if (names.has(normalizedName)) errors.push(`${category[0].toUpperCase()}${category.slice(1)} preset names must be unique.`);
    names.add(normalizedName);
    errors.push(...presetErrors);
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

  const normalized = addDefaultEquipmentPresets(addDefaultCylinderPresets(addDefaultPhysics(addDefaultPressureLimitPolicy(addDefaultUnits(addDefaultBooster(saved))))));
  const errors = validateSettings(normalized);
  if (errors.length > 0) {
    onFallback(new RangeError(errors.join(' ')));
    return copySettings(DEFAULT_SETTINGS);
  }
  return copySettings(normalized);
}

export function saveSettings(settings, storage) {
  const normalized = addDefaultEquipmentPresets(addDefaultCylinderPresets(addDefaultPhysics(addDefaultPressureLimitPolicy(addDefaultUnits(addDefaultBooster(settings))))));
  const errors = validateSettings(normalized);
  if (errors.length > 0) throw new RangeError(errors.join(' '));
  storage.setItem(STORAGE_KEY, JSON.stringify(copySettings(normalized)));
}

export function applyCompressorPresetToSettings(settings, preset) {
  const copied = copySettings(settings);
  copied.booster.compressorInletFlowLPerMin = preset.inletFlowLPerMin;
  copied.booster.maxCompressorPressureBar = preset.maxPressureBar;
  copied.booster.compressorTemperatureModifierC = preset.temperatureModifierC;
  return copied;
}

export function applyBoosterPresetToSettings(settings, preset) {
  const copied = copySettings(settings);
  copied.booster.minimumSourcePressureBar = preset.minimumSourcePressureBar;
  copied.booster.cylinderVolumeCm3 = preset.cylinderVolumeCm3;
  copied.booster.oxygenBoostBpm = preset.oxygenBoostBpm;
  copied.booster.otherBoostBpm = preset.otherBoostBpm;
  copied.booster.oxygenDecantRateBarPerMin = preset.oxygenDecantRateBarPerMin;
  copied.booster.otherDecantRateBarPerMin = preset.otherDecantRateBarPerMin;
  copied.booster.maxBoosterOutputPressureBar = preset.maxOutputPressureBar;
  copied.booster.boosterTemperatureModifierC = preset.temperatureModifierC;
  copied.booster.drainingRateBarPerMin = preset.drainingRateBarPerMin;
  return copied;
}

export function createCompressorPreset(settings, name) {
  return {
    name,
    inletFlowLPerMin: settings.booster.compressorInletFlowLPerMin,
    maxPressureBar: settings.booster.maxCompressorPressureBar,
    temperatureModifierC: settings.booster.compressorTemperatureModifierC
  };
}

export function createBoosterPreset(settings, name) {
  return {
    name,
    minimumSourcePressureBar: settings.booster.minimumSourcePressureBar,
    cylinderVolumeCm3: settings.booster.cylinderVolumeCm3,
    oxygenBoostBpm: settings.booster.oxygenBoostBpm,
    otherBoostBpm: settings.booster.otherBoostBpm,
    oxygenDecantRateBarPerMin: settings.booster.oxygenDecantRateBarPerMin,
    otherDecantRateBarPerMin: settings.booster.otherDecantRateBarPerMin,
    maxOutputPressureBar: settings.booster.maxBoosterOutputPressureBar,
    temperatureModifierC: settings.booster.boosterTemperatureModifierC,
    drainingRateBarPerMin: settings.booster.drainingRateBarPerMin
  };
}

export function createUniquePresetName(baseName, presets) {
  const names = new Set(presets.map(preset => normalizePresetName(preset.name)));
  let name = baseName;
  let suffix = 2;
  while (names.has(normalizePresetName(name))) name = `${baseName} ${suffix++}`;
  return name;
}

export function addEquipmentPresetToDraft(settingsDraft, category, baseName) {
  const presets = settingsDraft[category];
  const name = createUniquePresetName(baseName, presets);
  presets.push(category === 'compressorPresets'
    ? createCompressorPreset(settingsDraft, name)
    : createBoosterPreset(settingsDraft, name));
  return name;
}

export function selectEquipmentPreset(settings, category, presetName) {
  if (!settings || (category !== 'compressorPresets' && category !== 'boosterPresets')) return null;
  const preset = settings[category].find(candidate => candidate.name === presetName);
  if (!preset) return null;
  return category === 'compressorPresets'
    ? applyCompressorPresetToSettings(settings, preset)
    : applyBoosterPresetToSettings(settings, preset);
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
