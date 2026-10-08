import { isValidGasComposition } from './gas-input.js';
const STORAGE_KEY = 'simplex-gas-remixer-settings';

export const DEFAULT_SETTINGS = Object.freeze({
  gasPresets: Object.freeze([
    Object.freeze({ name: 'Air', oxygenPercent: 21, heliumPercent: 0 }),
    Object.freeze({ name: 'EAN32', oxygenPercent: 32, heliumPercent: 0 }),
    Object.freeze({ name: 'Tx 18/45', oxygenPercent: 18, heliumPercent: 45 }),
    Object.freeze({ name: 'Tx 21/35', oxygenPercent: 21, heliumPercent: 35 }),
    Object.freeze({ name: 'Pure O₂', oxygenPercent: 100, heliumPercent: 0 }),
    Object.freeze({ name: 'Pure He', oxygenPercent: 0, heliumPercent: 100 })
  ]),
  volumePresets: Object.freeze([3, 5, 7, 10, 12, 15, 18, 24]),
  booster: Object.freeze({
    minimumSourcePressureBar: 20,
    cylinderVolumeCm3: 9,
    oxygenBoostBpm: 50,
    otherBoostBpm: 50,
    oxygenDecantRateBarPerMin: 5,
    otherDecantRateBarPerMin: 5,
    compressorInletFlowLPerMin: 100
  })
});

function copySettings(settings) {
  return {
    gasPresets: settings.gasPresets.map(({ name, oxygenPercent, heliumPercent }) => ({
      name,
      oxygenPercent,
      heliumPercent
    })),
    volumePresets: [...settings.volumePresets],
    booster: {
      minimumSourcePressureBar: settings.booster.minimumSourcePressureBar,
      cylinderVolumeCm3: settings.booster.cylinderVolumeCm3,
      oxygenBoostBpm: settings.booster.oxygenBoostBpm,
      otherBoostBpm: settings.booster.otherBoostBpm,
      oxygenDecantRateBarPerMin: settings.booster.oxygenDecantRateBarPerMin,
      otherDecantRateBarPerMin: settings.booster.otherDecantRateBarPerMin,
      compressorInletFlowLPerMin: settings.booster.compressorInletFlowLPerMin
    }
  };
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

export function validateSettings(settings) {
  const errors = [];
  if (!settings || !Array.isArray(settings.gasPresets) || !Array.isArray(settings.volumePresets)) {
    return ['Settings must contain gas and volume preset lists.'];
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

  const volumes = new Set();
  for (const volume of settings.volumePresets) {
    if (!Number.isFinite(volume) || volume < 0.1 || volumes.has(volume)) {
      errors.push('Cylinder volumes must be at least 0.1 L, finite, and unique.');
    }
    volumes.add(volume);
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

  const normalized = addDefaultBooster(saved);
  const errors = validateSettings(normalized);
  if (errors.length > 0) {
    onFallback(new RangeError(errors.join(' ')));
    return copySettings(DEFAULT_SETTINGS);
  }
  return copySettings(normalized);
}

export function saveSettings(settings, storage) {
  const errors = validateSettings(settings);
  if (errors.length > 0) throw new RangeError(errors.join(' '));
  storage.setItem(STORAGE_KEY, JSON.stringify(copySettings(settings)));
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

export function sortVolumePresetEntries(volumes) {
  return volumes
    .map((volume, index) => ({ volume, index }))
    .sort((left, right) => left.volume - right.volume || left.index - right.index);
}
