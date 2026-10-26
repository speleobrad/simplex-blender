import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS, copySettings } from '../js/settings.js';
import { calcMolarDensity } from '../js/physics.js';
import { litresPerMole } from '../js/cost.js';
import { priceBankByRecipe, virtualBankCount } from '../js/bank-pricing.js';

const physics = { model: 'vdw', temperatureC: 20 };
const costs = () => ({
  currencySymbol: '', pricePerLitre: { oxygen: 0.01, helium: 0.05 }, leftoverDiscountPercent: 0,
  operationPrices: { boostPerLitre: 0.002, decantPerLitre: 0.001, equalizePerLitre: 0, topUpPerOperation: 5 }
});
const settingsWith = (mutate = () => {}) => {
  const s = copySettings(DEFAULT_SETTINGS);
  s.costs = costs();
  mutate(s);
  return s;
};
const bank = (over) => ({ id: 'real', name: 'Real', volumeL: 12, pressureBar: 150, oxygenPercent: 100, heliumPercent: 0, enabled: true, ...over });

test('virtualBankCount is 0 for an absent gas and 2x margin otherwise', () => {
  assert.equal(virtualBankCount({ needMoles: 0, perBankMoles: 1000 }), 0);
  assert.equal(virtualBankCount({ needMoles: 100, perBankMoles: 1000 }), 1);
  assert.equal(virtualBankCount({ needMoles: 1000, perBankMoles: 1000 }), 2);
  assert.equal(virtualBankCount({ needMoles: 1001, perBankMoles: 1000 }), 3);
});

test('pure O2 at 150 bar: price is the O2 price plus the decant rate, exactly', () => {
  const result = priceBankByRecipe({ bank: bank(), costs: costs(), settings: settingsWith(), physics });
  assert.equal(result.ok, true, result.reason);
  // One decant from a pure O2 virtual bank; no top-up, no air.
  assert.equal(result.operationCount.topUp, undefined);
  assert.ok(Math.abs(result.pricePerLitre - 0.011) < 1e-9);
});

test('discount applies once and 100 percent gives zero', () => {
  const base = priceBankByRecipe({ bank: bank(), costs: costs(), settings: settingsWith(), physics });
  const half = priceBankByRecipe({ bank: bank(), costs: { ...costs(), leftoverDiscountPercent: 50 }, settings: settingsWith(), physics });
  assert.ok(Math.abs(half.pricePerLitre - base.pricePerLitre / 2) < 1e-12);
  const free = priceBankByRecipe({ bank: bank(), costs: { ...costs(), leftoverDiscountPercent: 100 }, settings: settingsWith(), physics });
  assert.equal(free.pricePerLitre, 0);
});

test('EAN32 at 150 bar: one top-up fee plus oxygen decant, hand-checked', () => {
  const result = priceBankByRecipe({ bank: bank({ oxygenPercent: 32, pressureBar: 150 }), costs: costs(), settings: settingsWith(), physics });
  assert.equal(result.ok, true, result.reason);
  // Hand check, vdw at 20 C, 12 L:
  //   M = calcMolarDensity(150, 32, 0, 20, true) * 12 total moles.
  //   Pure O2 draw x and air a satisfy x + a = M and x + 0.21 a = 0.32 M,
  //   so x = 0.11 M / 0.79 (about 10.881 mol, matching the optimizer's decant).
  //   litres = M * litresPerMole(20).
  //   recipeCost = 5 (one top-up) + x * litresPerMole(20) * (0.01 + 0.001).
  const perMole = litresPerMole(20);
  const M = calcMolarDensity(150, 32, 0, 20, true) * 12;
  const x = 0.11 * M / 0.79;
  const expectedCost = 5 + x * perMole * 0.011;
  assert.ok(Math.abs(result.litres - M * perMole) < 1e-9);
  assert.ok(Math.abs(result.recipeCost - expectedCost) < 1e-6, `${result.recipeCost} vs ${expectedCost}`);
  assert.ok(Math.abs(result.pricePerLitre - expectedCost / (M * perMole)) < 1e-9);
  assert.equal(result.operationCount.topUp, 1);
  assert.equal(result.operationCount.decant, 1);
  assert.equal(result.operationCount.boost, undefined);
});

test('Tx21/35 at 150 bar uses both O2 and He sources plus one top-up', () => {
  const result = priceBankByRecipe({ bank: bank({ oxygenPercent: 21, heliumPercent: 35, pressureBar: 150 }), costs: costs(), settings: settingsWith(), physics });
  assert.equal(result.ok, true, result.reason);
  assert.equal(result.operationCount.topUp, 1);
  assert.equal(result.operationCount.decant, 1);
  assert.ok(result.recipeCost >= 5);
});

test('ideal and vdw physics give different litres for the same bank', () => {
  const vdw = priceBankByRecipe({ bank: bank({ oxygenPercent: 32 }), costs: costs(), settings: settingsWith(), physics });
  const ideal = priceBankByRecipe({ bank: bank({ oxygenPercent: 32 }), costs: costs(), settings: settingsWith(), physics: { model: 'ideal', temperatureC: 20 } });
  assert.equal(ideal.ok, true, ideal.reason);
  const idealMoles = calcMolarDensity(150, 32, 0, 20, false) * 12;
  assert.ok(Math.abs(ideal.litres - idealMoles * litresPerMole(20)) < 1e-9);
  assert.ok(Math.abs(vdw.litres - ideal.litres) > 1e-6);
});

test('compressor ceiling: a top-up within the ceiling is priced with one fee', () => {
  const result = priceBankByRecipe({
    bank: bank({ oxygenPercent: 32, pressureBar: 150 }),
    costs: costs(),
    settings: settingsWith(s => { s.booster.maxCompressorPressureBar = 140; }),
    physics
  });
  assert.equal(result.ok, true, result.reason);
  assert.equal(result.operationCount.topUp, 1);
});

test('compressor ceiling below the target makes the mix unpriceable', () => {
  const result = priceBankByRecipe({
    bank: bank({ oxygenPercent: 32, pressureBar: 150 }),
    costs: costs(),
    settings: settingsWith(s => { s.booster.maxCompressorPressureBar = 100; }),
    physics
  });
  assert.equal(result.ok, false);
  assert.match(result.reason, /Compressor Air cannot top up/);
});

test('a bank below 10 bar fails without a price', () => {
  const result = priceBankByRecipe({ bank: bank({ pressureBar: 9.5 }), costs: costs(), settings: settingsWith(), physics });
  assert.equal(result.ok, false);
  assert.match(result.reason, /10 bar/);
});

test('a hypoxic mix that air plus pure O2 and He cannot make fails without a price', () => {
  const result = priceBankByRecipe({ bank: bank({ oxygenPercent: 10, heliumPercent: 0 }), costs: costs(), settings: settingsWith(), physics });
  assert.equal(result.ok, false);
  assert.match(result.reason, /exact target mix cannot be made/);
});

test('more than 6 virtual banks for one gas fails without a price', () => {
  const big = bank({ volumeL: 200, pressureBar: 350 });
  const result = priceBankByRecipe({
    bank: big,
    costs: costs(),
    settings: settingsWith(s => { s.booster.minimumSourcePressureBar = 100; s.booster.maxBoosterOutputPressureBar = 350; }),
    physics
  });
  assert.equal(result.ok, false);
  assert.match(result.reason, /more than 6 virtual oxygen sources/);
});

test('all-zero prices report that no prices are configured', () => {
  const zero = {
    currencySymbol: '', pricePerLitre: { oxygen: 0, helium: 0 }, leftoverDiscountPercent: 0,
    operationPrices: { boostPerLitre: 0, decantPerLitre: 0, equalizePerLitre: 0, topUpPerOperation: 0 }
  };
  const result = priceBankByRecipe({ bank: bank(), costs: zero, settings: settingsWith(), physics });
  assert.equal(result.ok, false);
  assert.match(result.reason, /no prices/i);
});

test('real banks and settings are not mutated', () => {
  const b = bank();
  const s = settingsWith();
  const before = JSON.stringify([b, s]);
  priceBankByRecipe({ bank: b, costs: costs(), settings: s, physics });
  assert.equal(JSON.stringify([b, s]), before);
});

for (const [label, composition] of [['O2', { oxygenPercent: 100, heliumPercent: 0 }], ['He', { oxygenPercent: 0, heliumPercent: 100 }]]) {
  test(`${label} 200 L at 350 bar: default equipment fails, a 350 bar booster limit prices it`, () => {
    const big = bank({ ...composition, volumeL: 200, pressureBar: 350 });
    const defaults = priceBankByRecipe({ bank: big, costs: costs(), settings: settingsWith(), physics });
    assert.equal(defaults.ok, false);
    assert.match(defaults.reason, /Maximum safe pressure/);
    if (label === 'He') assert.match(defaults.reason, /Booster output cannot exceed/);
    if (label === 'O2') assert.match(defaults.reason, /Unsafe 100% O₂ transfer/);
    const raised = priceBankByRecipe({
      bank: big,
      costs: costs(),
      settings: settingsWith(s => { s.booster.maxBoosterOutputPressureBar = 350; }),
      physics
    });
    assert.equal(raised.ok, true, raised.reason);
    assert.ok(raised.exhaustedSources < raised.sourceCount, 'supply must not be the binding limit');
  });
}
