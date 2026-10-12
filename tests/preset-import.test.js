import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS } from '../js/settings.js';
import {
  DEFAULT_PRESET_URLS,
  PRESET_CATEGORIES,
  canonicalPresetContent,
  getImportEntries,
  mergeSelectedPresets,
  parsePresetDocument
} from '../js/preset-import.js';

test('parses a gas-only document', () => {
  const result = parsePresetDocument({
    gasPresets: [{ name: 'EAN32', oxygenPercent: 32, heliumPercent: 0 }]
  });

  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.entries, [{
    category: 'gasPresets',
    preset: { name: 'EAN32', oxygenPercent: 32, heliumPercent: 0 }
  }]);
});

test('parses mixed category documents and rejects invalid records', () => {
  const result = parsePresetDocument({
    gasPresets: [
      { name: 'EAN32', oxygenPercent: 32, heliumPercent: 0 },
      { name: 'Bad gas', oxygenPercent: 80, heliumPercent: 30 }
    ],
    cylinderPresets: [{
      name: '12 L', volumeL: 12, material: 'steel', massKg: 14, workingPressureBar: 232
    }]
  });

  assert.equal(result.entries.length, 2);
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0], /Bad gas/);
});

test('parses normalized compressor and booster records', () => {
  const result = parsePresetDocument({
    compressorPresets: [{
      name: 'High flow', inletFlowLPerMin: 160, maxPressureBar: 250, temperatureModifierC: 4
    }],
    boosterPresets: [{
      name: 'Fast booster', cylinderVolumeCm3: 12, minimumSourcePressureBar: 18,
      oxygenBoostBpm: 40, otherBoostBpm: 55, maxOutputPressureBar: 185,
      temperatureModifierC: 3, oxygenDecantRateBarPerMin: 3,
      otherDecantRateBarPerMin: 7, drainingRateBarPerMin: 5
    }]
  });

  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.entries, [{
    category: 'compressorPresets',
    preset: { name: 'High flow', inletFlowLPerMin: 160, maxPressureBar: 250, temperatureModifierC: 4 }
  }, {
    category: 'boosterPresets',
    preset: {
      name: 'Fast booster', cylinderVolumeCm3: 12, minimumSourcePressureBar: 18,
      oxygenBoostBpm: 40, otherBoostBpm: 55, maxOutputPressureBar: 185,
      temperatureModifierC: 3, oxygenDecantRateBarPerMin: 3,
      otherDecantRateBarPerMin: 7, drainingRateBarPerMin: 5
    }
  }]);
});

test('allows omitted categories but reports malformed category arrays and invalid values', () => {
  const result = parsePresetDocument({
    gasPresets: [],
    cylinderPresets: {},
    compressorPresets: [{ name: 'Bad flow', inletFlowLPerMin: 0, maxPressureBar: 232, temperatureModifierC: 0 }],
    boosterPresets: [{ name: 'Bad booster', cylinderVolumeCm3: 9, minimumSourcePressureBar: 20, oxygenBoostBpm: 50, otherBoostBpm: 50, maxOutputPressureBar: 200, temperatureModifierC: 0, oxygenDecantRateBarPerMin: 5, otherDecantRateBarPerMin: 5, drainingRateBarPerMin: 0 }]
  });

  assert.deepEqual(result.entries, []);
  assert.equal(result.errors.length, 3);
  assert.match(result.errors.join('\n'), /cylinderPresets.*array/i);
  assert.match(result.errors.join('\n'), /Bad flow/);
  assert.match(result.errors.join('\n'), /Bad booster/);
});

test('rejects documents without a recognized category', () => {
  assert.throws(() => parsePresetDocument({ banks: [] }), /recognized preset/i);
});

test('copies accepted source records', () => {
  const preset = { name: 'EAN32', oxygenPercent: 32, heliumPercent: 0 };
  const parsed = parsePresetDocument({ gasPresets: [preset] });
  preset.name = 'Changed';

  assert.equal(parsed.entries[0].preset.name, 'EAN32');
});

test('exposes stable category metadata and no default remote URLs', () => {
  assert.deepEqual(Object.keys(PRESET_CATEGORIES), [
    'gasPresets', 'cylinderPresets', 'compressorPresets', 'boosterPresets'
  ]);
  assert.deepEqual(DEFAULT_PRESET_URLS, {});
});

test('marks local name and content duplicates while retaining new entries', () => {
  const parsed = parsePresetDocument({
    gasPresets: [
      { name: ' air ', oxygenPercent: 21, heliumPercent: 0 },
      { name: 'My mix', oxygenPercent: 32, heliumPercent: 0 },
      { name: 'Same content', oxygenPercent: 32, heliumPercent: 0 }
    ]
  });
  const entries = getImportEntries(parsed, {
    ...DEFAULT_SETTINGS,
    gasPresets: [{ name: 'Air', oxygenPercent: 21, heliumPercent: 0 }]
  });

  assert.equal(entries[0].duplicate, true);
  assert.equal(entries[0].duplicateReason, 'same name');
  assert.equal(entries[1].duplicate, false);
  assert.equal(entries[2].duplicate, true);
  assert.equal(entries[2].duplicateReason, 'same content');
});

test('marks later duplicate entries in one imported document', () => {
  const parsed = parsePresetDocument({
    cylinderPresets: [
      { name: '12 L', volumeL: 12, material: 'steel', massKg: 14, workingPressureBar: 232 },
      { name: 'Other name', volumeL: 12, material: 'steel', massKg: 14, workingPressureBar: 232 },
      { name: ' 12 l ', volumeL: 15, material: 'steel', massKg: 14, workingPressureBar: 232 }
    ]
  });
  const entries = getImportEntries(parsed, { ...DEFAULT_SETTINGS, cylinderPresets: [] });

  assert.deepEqual(entries.map(entry => entry.duplicate), [false, true, true]);
  assert.deepEqual(entries.map(entry => entry.duplicateReason), [null, 'same content', 'same name']);
});

test('canonicalizes functional fields in category order without names', () => {
  assert.equal(
    canonicalPresetContent('compressorPresets', {
      name: 'One', temperatureModifierC: 0, maxPressureBar: 232, inletFlowLPerMin: 100
    }),
    canonicalPresetContent('compressorPresets', {
      name: 'Two', inletFlowLPerMin: 100, maxPressureBar: 232, temperatureModifierC: 0
    })
  );
  assert.notEqual(
    canonicalPresetContent('gasPresets', { name: 'EAN32', oxygenPercent: 32, heliumPercent: 0 }),
    canonicalPresetContent('gasPresets', { name: 'EAN32', oxygenPercent: 32, heliumPercent: 1 })
  );
});

test('merges only selected non-duplicates into a copied draft', () => {
  const draft = {
    ...DEFAULT_SETTINGS,
    gasPresets: DEFAULT_SETTINGS.gasPresets.map(preset => ({ ...preset }))
  };
  const merged = mergeSelectedPresets(draft, [{
    category: 'gasPresets',
    preset: { name: 'My mix', oxygenPercent: 32, heliumPercent: 0 },
    selected: true,
    duplicate: false
  }, {
    category: 'gasPresets',
    preset: { name: 'Ignored', oxygenPercent: 30, heliumPercent: 0 },
    selected: false,
    duplicate: false
  }]);

  assert.equal(merged.gasPresets.at(-1).name, 'My mix');
  assert.equal(draft.gasPresets.some(preset => preset.name === 'My mix'), false);
  assert.equal(merged.gasPresets.some(preset => preset.name === 'Ignored'), false);
});

test('merges selected equipment presets into their category collections', () => {
  const merged = mergeSelectedPresets(DEFAULT_SETTINGS, [{
    category: 'compressorPresets',
    preset: { name: 'High flow', inletFlowLPerMin: 160, maxPressureBar: 250, temperatureModifierC: 4 },
    selected: true,
    duplicate: false
  }]);

  assert.deepEqual(merged.compressorPresets, [
    DEFAULT_SETTINGS.compressorPresets[0],
    { name: 'High flow', inletFlowLPerMin: 160, maxPressureBar: 250, temperatureModifierC: 4 }
  ]);
  assert.notStrictEqual(merged.compressorPresets, DEFAULT_SETTINGS.compressorPresets);
});
