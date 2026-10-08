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
  booster: Object.freeze({ minimumSourcePressureBar: 20 })
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
      minimumSourcePressureBar: settings.booster.minimumSourcePressureBar
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
      minimumSourcePressureBar: DEFAULT_SETTINGS.booster.minimumSourcePressureBar,
      ...booster
    }
  };
}

export function validateSettings(settings) {
  const errors = [];
  if (!settings || !Array.isArray(settings.gasPresets) || !Array.isArray(settings.volumePresets)) {
    return ['Settings must contain gas and volume preset lists.'];
  }
  if (!settings.booster || !Number.isFinite(settings.booster.minimumSourcePressureBar)
    || settings.booster.minimumSourcePressureBar < 0
    || settings.booster.minimumSourcePressureBar > 100) {
    errors.push('Booster minimum source pressure must be between 0 and 100 bar.');
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
