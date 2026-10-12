import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyBoosterPresetToSettings,
  applyCompressorPresetToSettings,
  applyGasPresetToBank,
  copySettings,
  DEFAULT_SETTINGS,
  getSelectedGasPreset,
  loadSettings,
  normalizePresetName,
  saveSettings,
  selectEquipmentPreset,
  sortCylinderPresetEntries,
  sortGasPresetEntries
} from '../js/settings.js';

function memoryStorage(initialEntries = []) {
  const values = new Map(initialEntries);
  return {
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, String(value)); }
  };
}

test('missing settings return independent copies of the built-in presets', () => {
  const first = loadSettings(memoryStorage());
  first.gasPresets[0].name = 'Changed';
  const second = loadSettings(memoryStorage());
  assert.equal(second.gasPresets[0].name, DEFAULT_SETTINGS.gasPresets[0].name);
  assert.equal(second.cylinderPresets[0].name, DEFAULT_SETTINGS.cylinderPresets[0].name);
});

test('settings default to the real-gas physics model', () => {
  assert.deepEqual(DEFAULT_SETTINGS.physics, { model: 'vdw' });
});
test('settings include compressor and booster pressure ceilings, temperature modifiers, and draining rate', () => {
  assert.equal(DEFAULT_SETTINGS.booster.maxCompressorPressureBar, 232);
  assert.equal(DEFAULT_SETTINGS.booster.maxBoosterOutputPressureBar, 200);
  assert.equal(DEFAULT_SETTINGS.booster.boosterTemperatureModifierC, 0);
  assert.equal(DEFAULT_SETTINGS.booster.compressorTemperatureModifierC, 0);
  assert.equal(DEFAULT_SETTINGS.booster.drainingRateBarPerMin, 5);
});

test('default settings expose named compressor and booster presets', () => {
  assert.equal(DEFAULT_SETTINGS.compressorPresets.length, 1);
  assert.equal(DEFAULT_SETTINGS.boosterPresets.length, 1);
  assert.equal(DEFAULT_SETTINGS.compressorPresets[0].inletFlowLPerMin, 100);
  assert.equal(DEFAULT_SETTINGS.boosterPresets[0].maxOutputPressureBar, 200);
});

test('legacy settings migrate active equipment values into preset collections', () => {
  const loaded = loadSettings(memoryStorage([[
    'simplex-gas-remixer-settings',
    JSON.stringify({
      gasPresets: [{ name: 'Air', oxygenPercent: 21, heliumPercent: 0 }],
      volumePresets: [12],
      booster: { ...DEFAULT_SETTINGS.booster, compressorInletFlowLPerMin: 160 }
    })
  ]]));

  assert.equal(loaded.compressorPresets[0].inletFlowLPerMin, 160);
  assert.equal(loaded.boosterPresets[0].cylinderVolumeCm3, 9);
});

test('equipment preset collections survive a settings round trip', () => {
  const settings = {
    ...DEFAULT_SETTINGS,
    gasPresets: DEFAULT_SETTINGS.gasPresets.map(preset => ({ ...preset })),
    cylinderPresets: DEFAULT_SETTINGS.cylinderPresets.map(preset => ({ ...preset })),
    booster: { ...DEFAULT_SETTINGS.booster },
    compressorPresets: DEFAULT_SETTINGS.compressorPresets.map(preset => ({ ...preset })),
    boosterPresets: DEFAULT_SETTINGS.boosterPresets.map(preset => ({ ...preset }))
  };
  settings.compressorPresets.push({
    name: 'High flow', inletFlowLPerMin: 160, maxPressureBar: 250, temperatureModifierC: 4
  });
  const storage = memoryStorage();

  saveSettings(settings, storage);

  assert.deepEqual(loadSettings(storage).compressorPresets, settings.compressorPresets);
});

test('invalid equipment preset collections are rejected before storage changes', () => {
  const storage = memoryStorage();
  const invalidSettings = [
    {
      ...DEFAULT_SETTINGS,
      compressorPresets: [{ ...DEFAULT_SETTINGS.compressorPresets[0], inletFlowLPerMin: 0 }]
    },
    {
      ...DEFAULT_SETTINGS,
      boosterPresets: [{ ...DEFAULT_SETTINGS.boosterPresets[0], maxOutputPressureBar: 351 }]
    },
    {
      ...DEFAULT_SETTINGS,
      compressorPresets: [
        DEFAULT_SETTINGS.compressorPresets[0],
        { ...DEFAULT_SETTINGS.compressorPresets[0], name: 'standard compressor' }
      ]
    },
    {
      ...DEFAULT_SETTINGS,
      boosterPresets: [
        DEFAULT_SETTINGS.boosterPresets[0],
        { ...DEFAULT_SETTINGS.boosterPresets[0], name: 'standard booster' }
      ]
    },
    { ...DEFAULT_SETTINGS, compressorPresets: {} },
    { ...DEFAULT_SETTINGS, boosterPresets: {} }
  ];

  for (const settings of invalidSettings) {
    assert.throws(() => saveSettings(settings, storage), RangeError);
    assert.equal(storage.getItem('simplex-gas-remixer-settings'), null);
  }
});

test('applying equipment presets copies only their active booster fields', () => {
  const settings = {
    ...DEFAULT_SETTINGS,
    booster: { ...DEFAULT_SETTINGS.booster },
    compressorPresets: DEFAULT_SETTINGS.compressorPresets.map(preset => ({ ...preset })),
    boosterPresets: DEFAULT_SETTINGS.boosterPresets.map(preset => ({ ...preset }))
  };
  const compressor = {
    name: 'High flow', inletFlowLPerMin: 160, maxPressureBar: 250, temperatureModifierC: 4
  };
  const booster = {
    ...DEFAULT_SETTINGS.boosterPresets[0],
    name: 'Rapid booster',
    cylinderVolumeCm3: 12,
    minimumSourcePressureBar: 25,
    oxygenBoostBpm: 75,
    otherBoostBpm: 80,
    maxOutputPressureBar: 240,
    temperatureModifierC: 3,
    oxygenDecantRateBarPerMin: 7,
    otherDecantRateBarPerMin: 8,
    drainingRateBarPerMin: 9
  };

  const withCompressor = applyCompressorPresetToSettings(settings, compressor);
  const withBooster = applyBoosterPresetToSettings(withCompressor, booster);

  assert.notStrictEqual(withCompressor, settings);
  assert.notStrictEqual(withCompressor.booster, settings.booster);
  assert.deepEqual(withBooster.booster, {
    ...settings.booster,
    compressorInletFlowLPerMin: 160,
    maxCompressorPressureBar: 250,
    compressorTemperatureModifierC: 4,
    cylinderVolumeCm3: 12,
    minimumSourcePressureBar: 25,
    oxygenBoostBpm: 75,
    otherBoostBpm: 80,
    maxBoosterOutputPressureBar: 240,
    boosterTemperatureModifierC: 3,
    oxygenDecantRateBarPerMin: 7,
    otherDecantRateBarPerMin: 8,
    drainingRateBarPerMin: 9
  });
  assert.deepEqual(settings.booster, DEFAULT_SETTINGS.booster);
});

test('selecting named equipment presets changes only copied draft active fields', () => {
  const draft = copySettings(DEFAULT_SETTINGS);
  draft.compressorPresets.push({
    name: 'High flow', inletFlowLPerMin: 160, maxPressureBar: 250, temperatureModifierC: 4
  });
  draft.boosterPresets.push({
    name: 'Rapid booster',
    minimumSourcePressureBar: 25,
    cylinderVolumeCm3: 12,
    oxygenBoostBpm: 75,
    otherBoostBpm: 80,
    oxygenDecantRateBarPerMin: 7,
    otherDecantRateBarPerMin: 8,
    maxOutputPressureBar: 240,
    temperatureModifierC: 3,
    drainingRateBarPerMin: 9
  });
  const withCompressor = selectEquipmentPreset(draft, 'compressorPresets', 'High flow');
  const withBooster = selectEquipmentPreset(withCompressor, 'boosterPresets', 'Rapid booster');

  assert.deepEqual(withCompressor.booster, {
    ...draft.booster,
    compressorInletFlowLPerMin: 160,
    maxCompressorPressureBar: 250,
    compressorTemperatureModifierC: 4
  });
  assert.deepEqual(withBooster.booster, {
    ...withCompressor.booster,
    minimumSourcePressureBar: 25,
    cylinderVolumeCm3: 12,
    oxygenBoostBpm: 75,
    otherBoostBpm: 80,
    oxygenDecantRateBarPerMin: 7,
    otherDecantRateBarPerMin: 8,
    maxBoosterOutputPressureBar: 240,
    boosterTemperatureModifierC: 3,
    drainingRateBarPerMin: 9
  });
  assert.deepEqual(withBooster.gasPresets, draft.gasPresets);
  assert.deepEqual(withBooster.cylinderPresets, draft.cylinderPresets);
  assert.deepEqual(withBooster.compressorPresets, draft.compressorPresets);
  assert.deepEqual(withBooster.boosterPresets, draft.boosterPresets);
  assert.deepEqual(draft.booster, DEFAULT_SETTINGS.booster);
});

test('normalizes preset names with locale-independent case folding', () => {
  assert.equal(normalizePresetName('  I  '), 'i');
  assert.equal(normalizePresetName(' EAN32 '), 'ean32');
});

test('old settings gain both pressure ceiling defaults', () => {
  const storage = memoryStorage([[
    'simplex-gas-remixer-settings',
    JSON.stringify({
      gasPresets: [{ name: 'Air', oxygenPercent: 21, heliumPercent: 0 }],
      volumePresets: [12]
    })
  ]]);
  assert.deepEqual(loadSettings(storage).booster, DEFAULT_SETTINGS.booster);
});

test('legacy settings gain the default real-gas physics model', () => {
  const storage = memoryStorage([[
    'simplex-gas-remixer-settings',
    JSON.stringify({
      gasPresets: [{ name: 'Air', oxygenPercent: 21, heliumPercent: 0 }],
      volumePresets: [12]
    })
  ]]);

  assert.deepEqual(loadSettings(storage).physics, { model: 'vdw' });
});

test('pressure ceilings survive settings round trip', () => {
  const settings = {
    ...DEFAULT_SETTINGS,
    gasPresets: DEFAULT_SETTINGS.gasPresets.map(preset => ({ ...preset })),
    cylinderPresets: DEFAULT_SETTINGS.cylinderPresets.map(preset => ({ ...preset })),
    booster: {
      ...DEFAULT_SETTINGS.booster,
      maxCompressorPressureBar: 240,
      maxBoosterOutputPressureBar: 190
    }
  };
  const storage = memoryStorage();

  saveSettings(settings, storage);

  assert.deepEqual(loadSettings(storage).booster, settings.booster);
});

test('invalid pressure ceilings are rejected before storage changes', () => {
  const storage = memoryStorage();
  for (const field of ['maxCompressorPressureBar', 'maxBoosterOutputPressureBar']) {
    assert.throws(() => saveSettings({
      ...DEFAULT_SETTINGS,
      booster: { ...DEFAULT_SETTINGS.booster, [field]: 9 }
    }, storage), /pressure.*10.*350/i);
  }
  assert.equal(storage.getItem('simplex-gas-remixer-settings'), null);
});

test('selected gas model survives a settings round trip', () => {
  const storage = memoryStorage();
  const settings = {
    ...DEFAULT_SETTINGS,
    physics: { model: 'ideal' },
    gasPresets: DEFAULT_SETTINGS.gasPresets.map(preset => ({ ...preset })),
    cylinderPresets: DEFAULT_SETTINGS.cylinderPresets.map(preset => ({ ...preset })),
    booster: { ...DEFAULT_SETTINGS.booster }
  };

  saveSettings(settings, storage);

  assert.deepEqual(loadSettings(storage).physics, { model: 'ideal' });
});

test('unsupported gas models are rejected before storage changes', () => {
  const storage = memoryStorage();

  assert.throws(() => saveSettings({
    ...DEFAULT_SETTINGS,
    physics: { model: 'peng-robinson' }
  }, storage), /gas model.*ideal.*vdw/i);
  assert.equal(storage.getItem('simplex-gas-remixer-settings'), null);
});

test('saved gas and cylinder presets survive a load/save round trip', () => {
  const storage = memoryStorage();
  const settings = {
    physics: { model: 'vdw' },
    gasPresets: [{ name: 'Tx 16/50', oxygenPercent: 16, heliumPercent: 50 }],
    cylinderPresets: [{
      name: 'Custom 11 L',
      volumeL: 11,
      material: 'aluminum',
      massKg: 12.4,
      workingPressureBar: 300
    }],
    booster: { ...DEFAULT_SETTINGS.booster },
    compressorPresets: DEFAULT_SETTINGS.compressorPresets.map(preset => ({ ...preset })),
    boosterPresets: DEFAULT_SETTINGS.boosterPresets.map(preset => ({ ...preset }))
  };
  saveSettings(settings, storage);
  assert.deepEqual(loadSettings(storage), settings);
});

test('saved settings preserve the shared booster minimum source pressure', () => {
  const storage = memoryStorage();
  const settings = {
    physics: { model: 'vdw' },
    gasPresets: [{ name: 'Tx 16/50', oxygenPercent: 16, heliumPercent: 50 }],
    cylinderPresets: [{
      name: '11 L Steel',
      volumeL: 11,
      material: 'steel',
      massKg: 14,
      workingPressureBar: 232
    }],
    booster: { ...DEFAULT_SETTINGS.booster, minimumSourcePressureBar: 27 },
    compressorPresets: DEFAULT_SETTINGS.compressorPresets.map(preset => ({ ...preset })),
    boosterPresets: DEFAULT_SETTINGS.boosterPresets.map(preset => ({
      ...preset,
      minimumSourcePressureBar: 27
    }))
  };
  saveSettings(settings, storage);
  assert.deepEqual(loadSettings(storage), settings);
});

test('old settings gain the default shared booster minimum', () => {
  const storage = memoryStorage([[
    'simplex-gas-remixer-settings',
    JSON.stringify({
      gasPresets: [{ name: 'Air', oxygenPercent: 21, heliumPercent: 0 }],
      volumePresets: [12]
    })
  ]]);
  assert.equal(loadSettings(storage).booster.minimumSourcePressureBar, 20);
});

test('old settings gain all thermodynamic booster defaults', () => {
  const storage = memoryStorage([[
    'simplex-gas-remixer-settings',
    JSON.stringify({
      gasPresets: [{ name: 'Air', oxygenPercent: 21, heliumPercent: 0 }],
      volumePresets: [12],
      booster: { minimumSourcePressureBar: 25 }
    })
  ]]);

  const settings = loadSettings(storage);

  assert.deepEqual(settings.booster, {
    minimumSourcePressureBar: 25,
    cylinderVolumeCm3: 9,
    oxygenBoostBpm: 50,
    otherBoostBpm: 50,
    oxygenDecantRateBarPerMin: 5,
    otherDecantRateBarPerMin: 5,
    compressorInletFlowLPerMin: 100,
    maxCompressorPressureBar: 232,
    maxBoosterOutputPressureBar: 200,
    boosterTemperatureModifierC: 0,
    compressorTemperatureModifierC: 0,
    drainingRateBarPerMin: 5
  });
});

test('temperature modifiers survive settings round trip', () => {
  const settings = {
    ...DEFAULT_SETTINGS,
    gasPresets: DEFAULT_SETTINGS.gasPresets.map(preset => ({ ...preset })),
    cylinderPresets: DEFAULT_SETTINGS.cylinderPresets.map(preset => ({ ...preset })),
    booster: {
      ...DEFAULT_SETTINGS.booster,
      boosterTemperatureModifierC: 12,
      compressorTemperatureModifierC: 28
    }
  };
  const storage = memoryStorage();

  saveSettings(settings, storage);

  assert.deepEqual(loadSettings(storage).booster, settings.booster);
});

test('temperature modifiers are bounded', () => {
  const storage = memoryStorage();
  for (const field of ['boosterTemperatureModifierC', 'compressorTemperatureModifierC']) {
    assert.throws(() => saveSettings({
      ...DEFAULT_SETTINGS,
      booster: { ...DEFAULT_SETTINGS.booster, [field]: 101 }
    }, storage), /temperature modifier.*-100.*100/i);
  }
  assert.equal(storage.getItem('simplex-gas-remixer-settings'), null);
});

test('invalid thermodynamic booster settings are rejected before storage changes', () => {
  const storage = memoryStorage();
  assert.throws(() => saveSettings({
    ...DEFAULT_SETTINGS,
    booster: {
      ...DEFAULT_SETTINGS.booster,
      cylinderVolumeCm3: 0,
      oxygenDecantRateBarPerMin: -1,
      drainingRateBarPerMin: 0
    }
  }, storage), /cylinder.*cm|decant|draining/i);
  assert.equal(storage.getItem('simplex-gas-remixer-settings'), null);
});

test('thermodynamic booster settings survive a save/load round trip', () => {
  const settings = {
    ...DEFAULT_SETTINGS,
    gasPresets: DEFAULT_SETTINGS.gasPresets.map(preset => ({ ...preset })),
    cylinderPresets: DEFAULT_SETTINGS.cylinderPresets.map(preset => ({ ...preset })),
    booster: {
      ...DEFAULT_SETTINGS.booster,
      minimumSourcePressureBar: 18,
      cylinderVolumeCm3: 12,
      oxygenBoostBpm: 40,
      otherBoostBpm: 55,
      oxygenDecantRateBarPerMin: 3,
      otherDecantRateBarPerMin: 7,
      compressorInletFlowLPerMin: 160,
      maxCompressorPressureBar: 245,
      maxBoosterOutputPressureBar: 185,
      drainingRateBarPerMin: 9
    }
  };
  const storage = memoryStorage();

  saveSettings(settings, storage);

  assert.deepEqual(loadSettings(storage).booster, settings.booster);
});

test('unreadable or invalid saved settings fall back to defaults', () => {
  const storage = memoryStorage([['simplex-gas-remixer-settings', '{bad json']]);
  assert.deepEqual(loadSettings(storage), DEFAULT_SETTINGS);
  storage.setItem('simplex-gas-remixer-settings', JSON.stringify({ gasPresets: [], volumePresets: [-1] }));
  assert.deepEqual(loadSettings(storage), DEFAULT_SETTINGS);
});

test('unusable saved settings report the fallback cause', () => {
  const storage = memoryStorage([['simplex-gas-remixer-settings', '{bad json']]);
  let reportedFailure;
  const loaded = loadSettings(storage, error => {
    reportedFailure = error;
  });
  assert.deepEqual(loaded, DEFAULT_SETTINGS);
  assert.ok(reportedFailure instanceof SyntaxError);
});

test('invalid preset lists are rejected before storage is changed', () => {
  const invalidSettings = [
    {
      gasPresets: [
        { name: 'Air', oxygenPercent: 21, heliumPercent: 0 },
        { name: 'air', oxygenPercent: 20, heliumPercent: 0 }
      ],
      cylinderPresets: [DEFAULT_SETTINGS.cylinderPresets[0]]
    },
    {
      gasPresets: [{ name: 'Invalid', oxygenPercent: 70, heliumPercent: 40 }],
      cylinderPresets: [DEFAULT_SETTINGS.cylinderPresets[0]]
    },
    {
      gasPresets: [{ name: 'Air', oxygenPercent: 21, heliumPercent: 0 }],
      cylinderPresets: [{ ...DEFAULT_SETTINGS.cylinderPresets[0], material: 'carbon' }]
    },
    {
      gasPresets: [{ name: 'Air', oxygenPercent: 21, heliumPercent: 0 }],
      cylinderPresets: [{ ...DEFAULT_SETTINGS.cylinderPresets[0], massKg: 0 }]
    },
    {
      gasPresets: [{ name: 'Air', oxygenPercent: 21, heliumPercent: 0 }],
      cylinderPresets: [{ ...DEFAULT_SETTINGS.cylinderPresets[0], workingPressureBar: 351 }]
    }
  ];

  for (const settings of invalidSettings) {
    const storage = memoryStorage();
    assert.throws(() => saveSettings(settings, storage), RangeError);
    assert.equal(storage.getItem('simplex-gas-remixer-settings'), null);
  }
});

test('applying a gas preset changes only the bank gas and name', () => {
  const bank = {
    id: 'source-1',
    name: 'Existing name',
    volumeL: 40,
    pressureBar: 220,
    minimumPressureBar: 15,
    oxygenPercent: 21,
    heliumPercent: 0,
    enabled: false
  };
  applyGasPresetToBank(bank, { name: 'EAN32', oxygenPercent: 32, heliumPercent: 0 });
  assert.deepEqual(bank, {
    id: 'source-1',
    name: 'EAN32',
    volumeL: 40,
    pressureBar: 220,
    minimumPressureBar: 15,
    oxygenPercent: 32,
    heliumPercent: 0,
    enabled: false
  });
});

test('a changed preset is not shown as applied to an unchanged bank', () => {
  const bank = {
    name: 'EAN32',
    gasPresetName: 'EAN32',
    oxygenPercent: 32,
    heliumPercent: 0
  };
  const preset = { name: 'EAN32', oxygenPercent: 32, heliumPercent: 0 };
  assert.deepEqual(getSelectedGasPreset(bank, [preset]), preset);
  assert.equal(getSelectedGasPreset(bank, [{ ...preset, oxygenPercent: 31 }]), null);
});

test('a preset named Custom is distinguishable from the custom-mix choice', () => {
  const preset = { name: 'Custom', oxygenPercent: 25, heliumPercent: 10 };
  const bank = { gasPresetName: 'Custom', oxygenPercent: 25, heliumPercent: 10 };
  assert.deepEqual(getSelectedGasPreset(bank, [preset]), preset);
});

test('gas presets are ordered by increasing helium while retaining tie order', () => {
  const presets = [
    { name: 'Pure He', oxygenPercent: 0, heliumPercent: 100 },
    { name: 'Air', oxygenPercent: 21, heliumPercent: 0 },
    { name: 'Tx 18/30', oxygenPercent: 18, heliumPercent: 30 },
    { name: 'Tx 21/30', oxygenPercent: 21, heliumPercent: 30 }
  ];
  const ordered = sortGasPresetEntries(presets);
  assert.deepEqual(ordered.map(entry => [entry.preset.name, entry.index]), [
    ['Air', 1],
    ['Tx 18/30', 2],
    ['Tx 21/30', 3],
    ['Pure He', 0]
  ]);
  assert.deepEqual(presets.map(preset => preset.name), ['Pure He', 'Air', 'Tx 18/30', 'Tx 21/30']);
});

test('cylinder presets are ordered numerically without losing duplicate edit indices', () => {
  const presets = [
    { name: '24 L', volumeL: 24 },
    { name: '7 L A', volumeL: 7 },
    { name: '12 L', volumeL: 12 },
    { name: '7 L B', volumeL: 7 }
  ];
  const ordered = sortCylinderPresetEntries(presets);
  assert.deepEqual(ordered.map(entry => [entry.preset.name, entry.index]), [
    ['7 L A', 1],
    ['7 L B', 3],
    ['12 L', 2],
    ['24 L', 0]
  ]);
  assert.deepEqual(presets.map(preset => preset.name), ['24 L', '7 L A', '12 L', '7 L B']);
});

test('legacy volume settings migrate to steel cylinder presets', () => {
  const storage = memoryStorage([[
    'simplex-gas-remixer-settings',
    JSON.stringify({
      gasPresets: [{ name: 'Air', oxygenPercent: 21, heliumPercent: 0 }],
      volumePresets: [12, 24]
    })
  ]]);

  assert.deepEqual(loadSettings(storage).cylinderPresets, [
    { name: '12 L Steel 232 bar', volumeL: 12, material: 'steel', massKg: 14, workingPressureBar: 232 },
    { name: '24 L Steel 232 bar', volumeL: 24, material: 'steel', massKg: 14, workingPressureBar: 232 }
  ]);
});

test('settings draft copies own independent equipment preset collections', () => {
  const source = loadSettings(memoryStorage());

  const draft = copySettings(source);
  draft.compressorPresets[0].name = 'Draft compressor';
  draft.boosterPresets[0].maxOutputPressureBar = 250;

  assert.equal(source.compressorPresets[0].name, 'Standard compressor');
  assert.equal(source.boosterPresets[0].maxOutputPressureBar, 200);
});
