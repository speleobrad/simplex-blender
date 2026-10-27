import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_BANKS, loadSupplyBanks, saveSupplyBanks } from '../js/bank-storage.js';

function memoryStorage(initialEntries = []) {
  const values = new Map(initialEntries);
  return {
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, String(value)); }
  };
}

test('missing saved banks return independent copies of all default fields', () => {
  const first = loadSupplyBanks(memoryStorage());
  first[0].enabled = false;
  const next = loadSupplyBanks(memoryStorage());
  assert.deepEqual(next, DEFAULT_BANKS);
  assert.equal(next[0].enabled, true);
});
test('default banks exclude compressor Air', () => {
  assert.equal(DEFAULT_BANKS.some(bank => bank.oxygenPercent === 21 && bank.heliumPercent === 0), false);
});
test('built-in supply banks match the requested defaults', () => {
  assert.deepEqual(DEFAULT_BANKS, [
    { id: 'bank-helium', name: 'Helium', volumeL: 40, pressureBar: 150, maxPressureBar: 200, oxygenPercent: 0, heliumPercent: 100, enabled: true },
    { id: 'bank-oxygen', name: 'Oxygen', volumeL: 50, pressureBar: 200, maxPressureBar: 200, oxygenPercent: 100, heliumPercent: 0, enabled: true },
    { id: 'bank-sample-scrap', name: 'Sample scrap', volumeL: 12, pressureBar: 45, maxPressureBar: 200, oxygenPercent: 19, heliumPercent: 40, enabled: true, gasPresetName: null }
  ]);
});


test('previous built-in supply banks migrate to the current defaults', () => {
  const storage = memoryStorage([[
    'simplex-gas-remixer-banks',
    JSON.stringify([
      { id: 'bank-he', name: 'Pure Helium', volumeL: 50, pressureBar: 200, oxygenPercent: 0, heliumPercent: 100, enabled: true },
      { id: 'bank-1845', name: 'Tx 18/45 Bank', volumeL: 50, pressureBar: 200, oxygenPercent: 18, heliumPercent: 45, enabled: true },
      { id: 'bank-o2', name: 'Pure Oxygen', volumeL: 40, pressureBar: 180, oxygenPercent: 100, heliumPercent: 0, enabled: true }
    ])
  ]]);
  assert.deepEqual(loadSupplyBanks(storage), DEFAULT_BANKS);
});

test('empty saved bank list is valid', () => {
  const storage = memoryStorage([['simplex-gas-remixer-banks', '[]']]);
  assert.deepEqual(loadSupplyBanks(storage), []);
});

test('legacy Air records are removed when banks are loaded', () => {
  const storage = memoryStorage([[
    'simplex-gas-remixer-banks',
    JSON.stringify([
      { ...DEFAULT_BANKS[0], id: 'bank-heirloom' },
      {
        id: 'bank-air',
        name: 'Air Top-off',
        volumeL: 80,
        pressureBar: 230,
        oxygenPercent: 21,
        heliumPercent: 0,
        enabled: true
      }
    ])
  ]]);
  assert.deepEqual(loadSupplyBanks(storage).map(bank => bank.id), ['bank-heirloom']);
});

test('saved banks preserve gas, pressure, volume, enable, and preset state', () => {
  const storage = memoryStorage();
  const banks = [{
    id: 'source-a',
    name: 'Custom mix',
    volumeL: 36,
    pressureBar: 217,
    maxPressureBar: 250,
    oxygenPercent: 19,
    heliumPercent: 42,
    enabled: false,
    gasPresetName: null
  }];
  saveSupplyBanks(banks, storage);
  assert.deepEqual(loadSupplyBanks(storage), banks);
});

test('legacy per-bank minimum pressure is discarded when banks are loaded', () => {
  const storage = memoryStorage([[
    'simplex-gas-remixer-banks',
    JSON.stringify([{ ...DEFAULT_BANKS[0], minimumPressureBar: 15 }])
  ]]);
  const [bank] = loadSupplyBanks(storage);
  assert.equal('minimumPressureBar' in bank, false);
});

test('unreadable bank data falls back and reports the failure', () => {
  const storage = memoryStorage([['simplex-gas-remixer-banks', '{bad json']]);
  let reportedFailure;
  const banks = loadSupplyBanks(storage, error => {
    reportedFailure = error;
  });
  assert.deepEqual(banks, DEFAULT_BANKS);
  assert.ok(reportedFailure instanceof SyntaxError);
});

test('invalid bank records are rejected before replacing saved banks', () => {
  const storage = memoryStorage();
  const invalidBanks = [
    { ...DEFAULT_BANKS[0], id: '' },
    { ...DEFAULT_BANKS[0], pressureBar: Number.NaN },
    { ...DEFAULT_BANKS[0], enabled: 'true' }
  ];
  assert.throws(() => saveSupplyBanks(invalidBanks, storage), RangeError);
  assert.equal(storage.getItem('simplex-gas-remixer-banks'), null);
});
test('rejects out-of-range banks and falls back when invalid saved records are loaded', () => {
  const invalidBanks = [
    { ...DEFAULT_BANKS[0], volumeL: 0.5 },
    { ...DEFAULT_BANKS[0], pressureBar: 351 },
    { ...DEFAULT_BANKS[0], name: '   ' },
    { ...DEFAULT_BANKS[0], oxygenPercent: -1 },
    { ...DEFAULT_BANKS[0], oxygenPercent: 30, heliumPercent: 71 }
  ];

  for (const bank of invalidBanks) {
    const storage = memoryStorage();
    assert.throws(() => saveSupplyBanks([bank], storage), RangeError);
    assert.equal(storage.getItem('simplex-gas-remixer-banks'), null);
  }

  const storage = memoryStorage([[
    'simplex-gas-remixer-banks',
    JSON.stringify([invalidBanks.at(-1)])
  ]]);
  let reportedFailure;
  assert.deepEqual(loadSupplyBanks(storage, error => {
    reportedFailure = error;
  }), DEFAULT_BANKS);
  assert.ok(reportedFailure instanceof RangeError);
});

test('every default bank carries a maximum pressure of 200 bar', () => {
  for (const bank of DEFAULT_BANKS) assert.equal(bank.maxPressureBar, 200);
});

test('stored banks without maxPressureBar migrate to the greater of 200 bar and current pressure', () => {
  const storage = memoryStorage([[
    'simplex-gas-remixer-banks',
    JSON.stringify([
      { id: 'bank-low', name: 'Low', volumeL: 20, pressureBar: 120, oxygenPercent: 0, heliumPercent: 100, enabled: true },
      { id: 'bank-high', name: 'High', volumeL: 20, pressureBar: 250, oxygenPercent: 0, heliumPercent: 100, enabled: true }
    ])
  ]]);
  const banks = loadSupplyBanks(storage);
  assert.equal(banks[0].maxPressureBar, 200);
  assert.equal(banks[1].maxPressureBar, 250);
});

test('stored valid maxPressureBar is kept when banks are loaded', () => {
  const storage = memoryStorage([[
    'simplex-gas-remixer-banks',
    JSON.stringify([
      { id: 'bank-roomy', name: 'Roomy', volumeL: 20, pressureBar: 120, maxPressureBar: 300, oxygenPercent: 0, heliumPercent: 100, enabled: true }
    ])
  ]]);
  assert.equal(loadSupplyBanks(storage)[0].maxPressureBar, 300);
});

test('saving a bank without a finite maximum pressure is rejected', () => {
  const storage = memoryStorage();
  const { maxPressureBar, ...withoutMax } = DEFAULT_BANKS[0];
  assert.throws(() => saveSupplyBanks([withoutMax], storage), RangeError);
  assert.equal(storage.getItem('simplex-gas-remixer-banks'), null);
});
