import test from 'node:test';
import assert from 'node:assert/strict';
import { applyGasPresetToBank, DEFAULT_SETTINGS, getSelectedGasPreset, loadSettings, saveSettings, sortGasPresetEntries, sortVolumePresetEntries } from '../js/settings.js';

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
  assert.deepEqual(second.volumePresets, [3, 5, 7, 10, 12, 15, 18, 24]);
});

test('saved gas and volume presets survive a load/save round trip', () => {
  const storage = memoryStorage();
  const settings = {
    gasPresets: [{ name: 'Tx 16/50', oxygenPercent: 16, heliumPercent: 50 }],
    volumePresets: [11, 22],
    booster: { ...DEFAULT_SETTINGS.booster }
  };
  saveSettings(settings, storage);
  assert.deepEqual(loadSettings(storage), settings);
});

test('saved settings preserve the shared booster minimum source pressure', () => {
  const storage = memoryStorage();
  const settings = {
    gasPresets: [{ name: 'Tx 16/50', oxygenPercent: 16, heliumPercent: 50 }],
    volumePresets: [11, 22],
    booster: { ...DEFAULT_SETTINGS.booster, minimumSourcePressureBar: 27 }
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
    compressorInletFlowLPerMin: 100
  });
});

test('invalid thermodynamic booster settings are rejected before storage changes', () => {
  const storage = memoryStorage();
  assert.throws(() => saveSettings({
    ...DEFAULT_SETTINGS,
    booster: {
      ...DEFAULT_SETTINGS.booster,
      cylinderVolumeCm3: 0,
      oxygenDecantRateBarPerMin: -1
    }
  }, storage), /cylinder.*cm|decant/i);
  assert.equal(storage.getItem('simplex-gas-remixer-settings'), null);
});

test('thermodynamic booster settings survive a save/load round trip', () => {
  const settings = {
    ...DEFAULT_SETTINGS,
    gasPresets: DEFAULT_SETTINGS.gasPresets.map(preset => ({ ...preset })),
    volumePresets: [...DEFAULT_SETTINGS.volumePresets],
    booster: {
      minimumSourcePressureBar: 18,
      cylinderVolumeCm3: 12,
      oxygenBoostBpm: 40,
      otherBoostBpm: 55,
      oxygenDecantRateBarPerMin: 3,
      otherDecantRateBarPerMin: 7,
      compressorInletFlowLPerMin: 160
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
      volumePresets: [12]
    },
    {
      gasPresets: [{ name: 'Invalid', oxygenPercent: 70, heliumPercent: 40 }],
      volumePresets: [12]
    },
    {
      gasPresets: [{ name: 'Air', oxygenPercent: 21, heliumPercent: 0 }],
      volumePresets: [12, 0]
    },
    {
      gasPresets: [{ name: 'Air', oxygenPercent: 21, heliumPercent: 0 }],
      volumePresets: [0.05]
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

test('cylinder sizes are ordered numerically without losing duplicate edit indices', () => {
  const sizes = [24, 7, 12, 7];
  const ordered = sortVolumePresetEntries(sizes);
  assert.deepEqual(ordered.map(entry => [entry.volume, entry.index]), [[7, 1], [7, 3], [12, 2], [24, 0]]);
  assert.deepEqual(sizes, [24, 7, 12, 7]);
});
