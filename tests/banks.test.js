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

test('saved banks preserve gas, pressure, volume, enable, and preset state', () => {
  const storage = memoryStorage();
  const banks = [{
    id: 'source-a',
    name: 'Custom mix',
    volumeL: 36,
    pressureBar: 217,
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
