import {
  copySettings,
  DEFAULT_SETTINGS,
  normalizePresetName,
  validateSettings
} from './settings.js';
import {
  DEFAULT_HOT_OVERFILL_PERCENT,
  validateBoosterPreset,
  validateCompressorPreset,
  validateCylinderPreset,
  validateGasPreset
} from './preset-validation.js';

export const PRESET_IMPORT_DEFAULT_URLS = Object.freeze({
  gas: 'https://raw.githubusercontent.com/speleobrad/simplex-blender/master/presets/gas.json',
  cylinders: 'https://raw.githubusercontent.com/speleobrad/simplex-blender/master/presets/cylinders.json',
  equipment: 'https://raw.githubusercontent.com/speleobrad/simplex-blender/master/presets/equipment.json'
});

const CATEGORY_DEFINITIONS = Object.freeze({
  gas: Object.freeze({
    collections: Object.freeze([Object.freeze({
      collection: 'gasPresets',
      validator: validateGasPreset,
      fields: Object.freeze(['name', 'oxygenPercent', 'heliumPercent']),
      duplicateBy: 'content'
    })])
  }),
  cylinders: Object.freeze({
    collections: Object.freeze([Object.freeze({
      collection: 'cylinderPresets',
      validator: validateCylinderPreset,
      fields: Object.freeze(['name', 'volumeL', 'material', 'massKg', 'workingPressureBar', 'hotOverfillPercent']),
      duplicateBy: 'name'
    })])
  }),
  equipment: Object.freeze({
    collections: Object.freeze([
      Object.freeze({
        sourceKey: 'compressorPresets',
        collection: 'compressorPresets',
        validator: validateCompressorPreset,
        fields: Object.freeze(['name', 'inletFlowLPerMin', 'maxPressureBar', 'temperatureModifierC']),
        duplicateBy: 'name'
      }),
      Object.freeze({
        sourceKey: 'boosterPresets',
        collection: 'boosterPresets',
        validator: validateBoosterPreset,
        fields: Object.freeze([
          'name',
          'minimumSourcePressureBar',
          'cylinderVolumeCm3',
          'oxygenBoostBpm',
          'otherBoostBpm',
          'oxygenDecantRateBarPerMin',
          'otherDecantRateBarPerMin',
          'maxOutputPressureBar',
          'temperatureModifierC',
          'drainingRateBarPerMin'
        ]),
        duplicateBy: 'name'
      })
    ])
  })
});

function definitionFor(category) {
  const definition = CATEGORY_DEFINITIONS[category];
  if (!definition) throw new RangeError(`Unknown preset import category: ${category}`);
  return definition;
}

function copyPreset(source, fields) {
  return Object.fromEntries(fields.map(field => [field, source?.[field]]));
}

function contentKey(preset, fields) {
  return JSON.stringify(fields.slice(1).map(field => preset[field]));
}

function duplicateKey(preset, collectionDefinition) {
  return collectionDefinition.duplicateBy === 'name'
    ? normalizePresetName(preset.name)
    : contentKey(preset, collectionDefinition.fields);
}

function addExistingIndexes(settings, definition, duplicateKeysByCollection, nameKeysByCollection) {
  for (const collectionDefinition of definition.collections) {
    const duplicateKeys = new Set();
    const nameKeys = new Set();
    for (const preset of settings?.[collectionDefinition.collection] ?? []) {
      duplicateKeys.add(duplicateKey(preset, collectionDefinition));
      nameKeys.add(normalizePresetName(preset.name));
    }
    duplicateKeysByCollection.set(collectionDefinition.collection, duplicateKeys);
    nameKeysByCollection.set(collectionDefinition.collection, nameKeys);
  }
}

function sourceEntries(category, source, definition) {
  if (category === 'equipment') {
    if (!source || typeof source !== 'object' || Array.isArray(source)) {
      return { entries: [], errors: ['Equipment presets must be an object containing preset lists.'] };
    }
    const presentCollections = definition.collections.filter(item => Object.hasOwn(source, item.sourceKey));
    if (presentCollections.length === 0) {
      return { entries: [], errors: ['Equipment presets must contain compressorPresets or boosterPresets.'] };
    }
    const errors = [];
    const entries = [];
    for (const collectionDefinition of presentCollections) {
      if (!Array.isArray(source[collectionDefinition.sourceKey])) {
        errors.push(`${collectionDefinition.sourceKey} must be an array.`);
        continue;
      }
      source[collectionDefinition.sourceKey].forEach((preset, index) => {
        entries.push({ collectionDefinition, preset, index });
      });
    }
    return errors.length > 0 ? { entries: [], errors } : { entries, errors };
  }

  if (!Array.isArray(source)) {
    const label = category === 'gas' ? 'Gas' : 'Cylinder';
    return { entries: [], errors: [`${label} presets must be an array.`] };
  }
  const collectionDefinition = definition.collections[0];
  return {
    entries: source.map((preset, index) => ({ collectionDefinition, preset, index })),
    errors: []
  };
}

export function analyzePresetSource(category, source, settings = DEFAULT_SETTINGS) {
  const definition = definitionFor(category);
  const { entries, errors } = sourceEntries(category, source, definition);
  const duplicateKeysByCollection = new Map();
  const nameKeysByCollection = new Map();
  addExistingIndexes(settings, definition, duplicateKeysByCollection, nameKeysByCollection);
  const candidates = [];

  for (const { collectionDefinition, preset: sourcePreset, index } of entries) {
    const preset = copyPreset(sourcePreset, collectionDefinition.fields);
    if (collectionDefinition.collection === 'cylinderPresets'
      && preset.hotOverfillPercent === undefined) {
      preset.hotOverfillPercent = DEFAULT_HOT_OVERFILL_PERCENT;
    }
    const validationErrors = collectionDefinition.validator(preset);
    const candidate = {
      id: `${collectionDefinition.collection}:${index}`,
      category,
      collection: collectionDefinition.collection,
      preset,
      status: 'invalid',
      reason: validationErrors.join(' '),
      selectable: false
    };
    if (validationErrors.length === 0) {
      const duplicateKeys = duplicateKeysByCollection.get(collectionDefinition.collection);
      const nameKeys = nameKeysByCollection.get(collectionDefinition.collection);
      const key = duplicateKey(preset, collectionDefinition);
      const nameKey = normalizePresetName(preset.name);
      if (collectionDefinition.duplicateBy === 'content'
        && nameKeys.has(nameKey) && !duplicateKeys.has(key)) {
        candidate.reason = 'An entry with the same name but different content already exists.';
      } else if (duplicateKeys.has(key)) {
        candidate.status = 'duplicate';
        candidate.reason = collectionDefinition.duplicateBy === 'name'
          ? 'An entry with the same name already exists.'
          : 'An entry with the same content already exists.';
      } else {
        candidate.status = 'new';
        candidate.reason = 'Ready to import.';
        candidate.selectable = true;
        duplicateKeys.add(key);
      }
      nameKeys.add(nameKey);
    }
    candidates.push(candidate);
  }

  return { candidates, errors };
}

export function mergeSelectedPresets(settings, candidates, selectedIds) {
  const selected = new Set(selectedIds);
  const byId = new Map(candidates.map(candidate => [candidate.id, candidate]));
  const merged = copySettings(settings);
  for (const id of selected) {
    const candidate = byId.get(id);
    if (!candidate || candidate.status !== 'new' || !candidate.selectable) {
      throw new RangeError('Only new valid presets can be imported.');
    }
    merged[candidate.collection].push({ ...candidate.preset });
  }
  const errors = validateSettings(merged);
  if (errors.length > 0) throw new RangeError(errors.join(' '));
  return merged;
}
