import { validatePreset } from './preset-validation.js';
import { normalizePresetName, validateSettings } from './settings.js';

export const PRESET_CATEGORIES = Object.freeze({
  gasPresets: Object.freeze({ fields: Object.freeze(['name', 'oxygenPercent', 'heliumPercent']) }),
  cylinderPresets: Object.freeze({ fields: Object.freeze(['name', 'volumeL', 'material', 'massKg', 'workingPressureBar']) }),
  compressorPresets: Object.freeze({ fields: Object.freeze(['name', 'inletFlowLPerMin', 'maxPressureBar', 'temperatureModifierC']) }),
  boosterPresets: Object.freeze({ fields: Object.freeze([
    'name', 'cylinderVolumeCm3', 'minimumSourcePressureBar', 'oxygenBoostBpm', 'otherBoostBpm',
    'maxOutputPressureBar', 'temperatureModifierC', 'oxygenDecantRateBarPerMin',
    'otherDecantRateBarPerMin', 'drainingRateBarPerMin'
  ]) })
});

export const DEFAULT_PRESET_URLS = Object.freeze({});

function copyPreset(category, preset) {
  return Object.fromEntries(PRESET_CATEGORIES[category].fields.map(field => [field, preset[field]]));
}

function displayPresetErrors(category, index, preset) {
  const name = preset && typeof preset.name === 'string' ? ` “${preset.name}”` : '';
  return validatePreset(category, preset).map(error => `${category}[${index}]${name}: ${error}`);
}

export function parsePresetDocument(document) {
  if (!document || typeof document !== 'object' || Array.isArray(document)) {
    throw new TypeError('Preset document must be an object.');
  }

  const categories = Object.keys(PRESET_CATEGORIES).filter(category => Object.hasOwn(document, category));
  if (categories.length === 0) {
    throw new RangeError('Preset document must contain at least one recognized preset category.');
  }

  const entries = [];
  const errors = [];
  for (const category of categories) {
    const presets = document[category];
    if (!Array.isArray(presets)) {
      errors.push(`${category} must be an array.`);
      continue;
    }
    for (const [index, preset] of presets.entries()) {
      const presetErrors = displayPresetErrors(category, index, preset);
      if (presetErrors.length > 0) {
        errors.push(...presetErrors);
        continue;
      }
      entries.push({ category, preset: copyPreset(category, preset) });
    }
  }
  return { entries, errors };
}


export function canonicalPresetContent(category, preset) {
  const metadata = PRESET_CATEGORIES[category];
  if (!metadata) throw new RangeError(`Unknown preset category: ${category}`);
  return JSON.stringify(metadata.fields.slice(1).map(field => {
    const value = preset[field];
    return typeof value === 'number' && Number.isFinite(value) ? Number(value) : value;
  }));
}

export function getImportEntries(parsed, settings) {
  const localPresets = Object.fromEntries(Object.keys(PRESET_CATEGORIES).map(category => [
    category,
    Array.isArray(settings?.[category]) ? settings[category] : []
  ]));
  const knownNames = Object.fromEntries(Object.keys(PRESET_CATEGORIES).map(category => [
    category,
    new Set(localPresets[category].filter(preset => preset && typeof preset.name === 'string' && preset.name.trim())
      .map(preset => normalizePresetName(preset.name)))
  ]));
  const knownContent = Object.fromEntries(Object.keys(PRESET_CATEGORIES).map(category => [
    category,
    new Set(localPresets[category].map(preset => canonicalPresetContent(category, preset)))
  ]));

  return parsed.entries.map(entry => {
    const name = normalizePresetName(entry.preset.name);
    const content = canonicalPresetContent(entry.category, entry.preset);
    let duplicateReason = null;
    if (knownNames[entry.category].has(name)) duplicateReason = 'same name';
    else if (knownContent[entry.category].has(content)) duplicateReason = 'same content';
    knownNames[entry.category].add(name);
    knownContent[entry.category].add(content);
    return { ...entry, duplicate: duplicateReason !== null, duplicateReason };
  });
}

export function selectPresetImportEntries(entries, selectedIndexes) {
  return entries.flatMap((entry, index) => (
    selectedIndexes.has(index) && !entry.duplicate ? [{ ...entry, selected: true }] : []
  ));
}

function copySettingsDraft(settings) {
  return {
    ...settings,
    physics: { ...settings.physics },
    gasPresets: settings.gasPresets.map(preset => ({ ...preset })),
    cylinderPresets: settings.cylinderPresets.map(preset => ({ ...preset })),
    booster: { ...settings.booster },
    compressorPresets: Array.isArray(settings.compressorPresets)
      ? settings.compressorPresets.map(preset => ({ ...preset }))
      : [],
    boosterPresets: Array.isArray(settings.boosterPresets)
      ? settings.boosterPresets.map(preset => ({ ...preset }))
      : []
  };
}

export function mergeSelectedPresets(settingsDraft, entries) {
  const merged = copySettingsDraft(settingsDraft);
  const importErrors = [];
  for (const entry of entries) {
    if (!entry.selected || entry.duplicate) continue;
    if (!PRESET_CATEGORIES[entry.category]) {
      importErrors.push(`Unknown preset category: ${entry.category}`);
      continue;
    }
    const presetErrors = validatePreset(entry.category, entry.preset);
    if (presetErrors.length > 0) {
      importErrors.push(...presetErrors);
      continue;
    }
    merged[entry.category].push(copyPreset(entry.category, entry.preset));
  }
  const settingsErrors = validateSettings(merged);
  if (importErrors.length > 0 || settingsErrors.length > 0) {
    throw new RangeError([...importErrors, ...settingsErrors].join(' '));
  }
  return merged;
}
