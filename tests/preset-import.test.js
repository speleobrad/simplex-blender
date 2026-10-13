import test from 'node:test';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import {
  analyzePresetSource,
  mergeSelectedPresets,
  PRESET_IMPORT_DEFAULT_URLS
} from '../js/preset-import.js';
import { copySettings, DEFAULT_SETTINGS, loadSettings, saveSettings } from '../js/settings.js';

function memoryStorage() {
  const values = new Map();
  return {
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, String(value)); }
  };
}

function newSettings() {
  return copySettings(DEFAULT_SETTINGS);
}

test('classifies gas candidates by name, content, source duplicate, and validation', () => {
  const settings = newSettings();
  const result = analyzePresetSource('gas', [
    { name: 'AIR', oxygenPercent: 21, heliumPercent: 0 },
    { name: 'New mix', oxygenPercent: 19, heliumPercent: 41 },
    { name: 'Same content, new name', oxygenPercent: 19, heliumPercent: 41 },
    { name: 'New mix', oxygenPercent: 20, heliumPercent: 30 },
    { name: 'Broken', oxygenPercent: 101, heliumPercent: 0 }
  ], settings);

  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.candidates.map(candidate => candidate.status), [
    'duplicate', 'new', 'duplicate', 'duplicate', 'invalid'
  ]);
  assert.equal(result.candidates[0].selectable, false);
  assert.equal(result.candidates[1].selectable, true);
  assert.match(result.candidates[0].reason, /name and content/i);
  assert.match(result.candidates[2].reason, /content/i);
});

test('classifies cylinder candidates and rejects malformed top-level data', () => {
  const settings = newSettings();
  const duplicate = { ...settings.cylinderPresets[0], name: 'Another name' };
  const result = analyzePresetSource('cylinders', [
    duplicate,
    { name: 'New cylinder', volumeL: 12, material: 'steel', massKg: 14, workingPressureBar: 232 },
    { name: 'Invalid cylinder', volumeL: 0, material: 'wood', massKg: -1, workingPressureBar: 500 }
  ], settings);

  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.candidates.map(candidate => candidate.status), ['duplicate', 'new', 'invalid']);
  assert.equal(result.candidates[1].collection, 'cylinderPresets');

  const malformed = analyzePresetSource('cylinders', { presets: [] }, settings);
  assert.equal(malformed.candidates.length, 0);
  assert.match(malformed.errors[0], /cylinder/i);
});

test('normalizes combined equipment files into compressor and booster candidates', () => {
  const settings = newSettings();
  const result = analyzePresetSource('equipment', {
    compressorPresets: [
      { ...settings.compressorPresets[0], name: 'Different name' },
      { name: 'New compressor', inletFlowLPerMin: 160, maxPressureBar: 250, temperatureModifierC: 4 }
    ],
    boosterPresets: [
      { ...settings.boosterPresets[0], name: 'New booster' }
    ]
  }, settings);

  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.candidates.map(candidate => [candidate.collection, candidate.status]), [
    ['compressorPresets', 'duplicate'],
    ['compressorPresets', 'new'],
    ['boosterPresets', 'duplicate']
  ]);
});

test('rejects equipment files without a preset collection', () => {
  const result = analyzePresetSource('equipment', {}, newSettings());
  assert.equal(result.candidates.length, 0);
  assert.match(result.errors[0], /equipment/i);
});

test('merges selected new candidates immutably into matching collections', () => {
  const settings = newSettings();
  const result = analyzePresetSource('equipment', {
    compressorPresets: [{ name: 'Imported compressor', inletFlowLPerMin: 160, maxPressureBar: 250, temperatureModifierC: 4 }],
    boosterPresets: [{
      name: 'Imported booster',
      minimumSourcePressureBar: 20,
      cylinderVolumeCm3: 10,
      oxygenBoostBpm: 40,
      otherBoostBpm: 55,
      oxygenDecantRateBarPerMin: 6,
      otherDecantRateBarPerMin: 11,
      maxOutputPressureBar: 240,
      temperatureModifierC: 2,
      drainingRateBarPerMin: 12
    }]
  }, settings);
  const selectedIds = result.candidates.map(candidate => candidate.id);

  const merged = mergeSelectedPresets(settings, result.candidates, selectedIds);

  assert.equal(merged.compressorPresets.at(-1).name, 'Imported compressor');
  assert.equal(merged.boosterPresets.at(-1).name, 'Imported booster');
  assert.equal(settings.compressorPresets.some(preset => preset.name === 'Imported compressor'), false);
  assert.notStrictEqual(merged.compressorPresets, settings.compressorPresets);
});

test('rejects attempts to merge duplicate or invalid candidates', () => {
  const settings = newSettings();
  const result = analyzePresetSource('gas', [{ name: 'Air', oxygenPercent: 21, heliumPercent: 0 }], settings);
  assert.throws(() => mergeSelectedPresets(settings, result.candidates, [result.candidates[0].id]), RangeError);
});

test('exposes repository raw preset URLs', () => {
  assert.equal(PRESET_IMPORT_DEFAULT_URLS.gas, 'https://raw.githubusercontent.com/speleobrad/simplex-blender/master/presets/gas.json');
  assert.equal(PRESET_IMPORT_DEFAULT_URLS.cylinders, 'https://raw.githubusercontent.com/speleobrad/simplex-blender/master/presets/cylinders.json');
  assert.equal(PRESET_IMPORT_DEFAULT_URLS.equipment, 'https://raw.githubusercontent.com/speleobrad/simplex-blender/master/presets/equipment.json');
});

test('repository preset files contain only valid candidates', () => {
  const settings = newSettings();
  for (const [category, filename] of [
    ['gas', 'gas.json'],
    ['cylinders', 'cylinders.json'],
    ['equipment', 'equipment.json']
  ]) {
    const source = JSON.parse(readFileSync(new URL(`../presets/${filename}`, import.meta.url), 'utf8'));
    const result = analyzePresetSource(category, source, settings);
    assert.deepEqual(result.errors, []);
    assert.equal(result.candidates.some(candidate => candidate.status === 'invalid'), false);
  }
});

test('selected imports survive the existing settings storage round trip', () => {
  const settings = newSettings();
  const sources = [
    analyzePresetSource('gas', [{ name: 'Imported gas', oxygenPercent: 19, heliumPercent: 41 }], settings),
    analyzePresetSource('cylinders', [{
      name: 'Imported cylinder',
      volumeL: 12,
      material: 'steel',
      massKg: 14,
      workingPressureBar: 232
    }], settings),
    analyzePresetSource('equipment', {
      compressorPresets: [{
        name: 'Imported compressor',
        inletFlowLPerMin: 160,
        maxPressureBar: 250,
        temperatureModifierC: 4
      }],
      boosterPresets: [{
        name: 'Imported booster',
        minimumSourcePressureBar: 20,
        cylinderVolumeCm3: 10,
        oxygenBoostBpm: 40,
        otherBoostBpm: 55,
        oxygenDecantRateBarPerMin: 6,
        otherDecantRateBarPerMin: 11,
        maxOutputPressureBar: 240,
        temperatureModifierC: 2,
        drainingRateBarPerMin: 12
      }]
    }, settings)
  ];
  const candidates = sources.flatMap(result => result.candidates);
  const merged = mergeSelectedPresets(settings, candidates, candidates.map(candidate => candidate.id));
  const storage = memoryStorage();

  saveSettings(merged, storage);

  const loaded = loadSettings(storage);
  assert.equal(loaded.gasPresets.at(-1).name, 'Imported gas');
  assert.equal(loaded.cylinderPresets.at(-1).name, 'Imported cylinder');
  assert.equal(loaded.compressorPresets.at(-1).name, 'Imported compressor');
  assert.equal(loaded.boosterPresets.at(-1).name, 'Imported booster');
});
