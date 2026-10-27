import test from 'node:test';
import assert from 'node:assert/strict';
import { computeSavings } from '../js/savings.js';
import { DEFAULT_SETTINGS } from '../js/settings.js';
import { litresPerMole } from '../js/cost.js';

// Ideal physics makes every free-gas litre count exactly P × V, independent of temperature.
const physics = { model: 'ideal', temperatureC: 20 };
const inventoryTemperatureC = 20;
const costs = { currencySymbol: '', leftoverDiscountPercent: 10, operationPrices: { boost: 2, decant: 1, topUp: 5 } };
const bank = over => ({ id: 'b', name: 'B', volumeL: 10, pressureBar: 150, oxygenPercent: 32, heliumPercent: 0, enabled: true, ...over });
const pureO2 = bank({ id: 'o2', name: 'O2 bottle', oxygenPercent: 100, pricePerLitre: 0.02 });
const pureHe = bank({ id: 'he', name: 'He bottle', oxygenPercent: 0, heliumPercent: 100, pricePerLitre: 0.05 });
const real = bank({ id: 'real', name: 'EAN32', volumeL: 12, pricePerLitre: 0.001 });
const perMole = litresPerMole(physics.temperatureC);
// A decant from `sourceBankId` that consumed `litres` of free gas.
const decantFrom = (sourceBankId, litres, id = 'op-1') => ({
  costOperation: 'decant', costOperationId: id, sourceBankId, sourceConsumedMoles: litres / perMole
});
const run = ({ banks, steps = [], blend = { heliumRetainedLitres: 100 }, feasible }) => computeSavings({
  result: { blend, protocolSteps: steps, feasible },
  banks, costs, settings: DEFAULT_SETTINGS, physics, inventoryTemperatureC
});

test('saved cost is retained helium litres times the weighted pure helium price', () => {
  // Two He banks, weights 10 L × 150 bar = 1500 and 5 L × 150 bar = 750 (ideal litres = P·V).
  // Weighted He = (1500 × 0.05 + 750 × 0.11) / 2250 = 0.07. Saved = 100 × 0.07 = 7.
  const heSmall = bank({ id: 'he2', name: 'He small', volumeL: 5, oxygenPercent: 0, heliumPercent: 100, pricePerLitre: 0.11 });
  const result = run({ banks: [pureO2, pureHe, heSmall] });
  assert.ok(Math.abs(result.savedCost - 7) < 1e-9, `${result.savedCost}`);
  assert.deepEqual(result.missing, []);
});

test('no helium price with helium retained makes saved cost null and names helium as a pure-price gap', () => {
  const result = run({ banks: [pureO2, real] });
  assert.equal(result.savedCost, null);
  assert.deepEqual(result.missing, [{ code: 'pure-price', gas: 'helium' }]);
});

test('no helium retained gives zero saved cost without asking for a helium price', () => {
  const result = run({ banks: [pureO2, real], blend: { heliumRetainedLitres: 0 } });
  assert.equal(result.savedCost, 0);
  assert.deepEqual(result.missing, []);
});

test('no feasible result gives null savings and no gas prompt', () => {
  const result = run({ banks: [pureO2, real], steps: [decantFrom('real', 360)], feasible: false });
  assert.deepEqual(result, { savedCost: null, salvagedSaving: null, missing: [] });
  const noBlend = computeSavings({ result: { protocolSteps: [] }, banks: [pureO2, real], costs, settings: DEFAULT_SETTINGS, physics, inventoryTemperatureC });
  assert.deepEqual(noBlend, { savedCost: null, salvagedSaving: null, missing: [] });
});

// EAN32 at 150 bar, 12 L, ideal: litres = 1800. Recipe cost = 6 (top-up 5 + decant 1) + 0.02·b·1800,
// with b = 0.32 − 0.21 × 0.68 / 0.79 (O2 needed beyond air). Per litre = 6/1800 + 0.02·b.
const EAN32_RECIPE_PER_LITRE = 6 / 1800 + 0.02 * (0.32 - 0.21 * 0.68 / 0.79);
const USED_L = 360;
const EAN32_SALVAGE = USED_L * EAN32_RECIPE_PER_LITRE;

test('salvage is litres used × discount-0 recipe price per litre, with no subtraction of the stored price', () => {
  // The stored price 0.001 is not subtracted: the value is the avoided purchase of the same litres.
  const result = run({ banks: [pureO2, pureHe, real], steps: [decantFrom('real', USED_L)] });
  assert.ok(Math.abs(result.salvagedSaving - EAN32_SALVAGE) < 1e-6, `${result.salvagedSaving} vs ${EAN32_SALVAGE}`);
  assert.deepEqual(result.missing, []);
});

test('salvage does not depend on the leftover discount', () => {
  // The fixture costs use leftoverDiscountPercent 10; the avoided purchase is undiscounted.
  const result = run({ banks: [pureO2, pureHe, real], steps: [decantFrom('real', USED_L)] });
  assert.ok(Math.abs(result.salvagedSaving - EAN32_SALVAGE) < 1e-6, `${result.salvagedSaving} vs ${EAN32_SALVAGE}`);
});

test('salvage is independent of the stored price of the leftover bank', () => {
  // A stored price far above the recipe price (5 vs ~0.0077/L) gives the same avoided purchase.
  const farAbove = bank({ id: 'real', name: 'EAN32', volumeL: 12, pricePerLitre: 5 });
  const result = run({ banks: [pureO2, pureHe, farAbove], steps: [decantFrom('real', USED_L)] });
  assert.ok(Math.abs(result.salvagedSaving - EAN32_SALVAGE) < 1e-6, `${result.salvagedSaving} vs ${EAN32_SALVAGE}`);
  assert.deepEqual(result.missing, []);
});

test('an unpriced leftover bank is included in salvage and raises no missing entry', () => {
  const unpriced = bank({ id: 'real', name: 'EAN32', volumeL: 12, pricePerLitre: null });
  const result = run({ banks: [pureO2, pureHe, unpriced], steps: [decantFrom('real', USED_L)] });
  assert.ok(Math.abs(result.salvagedSaving - EAN32_SALVAGE) < 1e-6, `${result.salvagedSaving} vs ${EAN32_SALVAGE}`);
  assert.deepEqual(result.missing, []);
});

test('salvage sums the avoided purchase over every used leftover bank', () => {
  const unpriced = bank({ id: 'real2', name: 'EAN32 two', volumeL: 12, pricePerLitre: null });
  const result = run({
    banks: [pureO2, pureHe, real, unpriced],
    steps: [decantFrom('real', USED_L, 'op-1'), decantFrom('real2', 100, 'op-2')]
  });
  assert.ok(Math.abs(result.salvagedSaving - (EAN32_SALVAGE + 100 * EAN32_RECIPE_PER_LITRE)) < 1e-6, `${result.salvagedSaving}`);
  assert.deepEqual(result.missing, []);
});

test('a used pure bank is not a salvage source', () => {
  const result = run({ banks: [pureO2, pureHe, real], steps: [decantFrom('o2', 100)] });
  assert.equal(result.salvagedSaving, 0);
  assert.deepEqual(result.missing, []);
});

test('a missing pure oxygen price makes salvage null and names oxygen as a pure-price gap', () => {
  const result = run({ banks: [pureHe, real], steps: [decantFrom('real', USED_L)] });
  assert.equal(result.salvagedSaving, null);
  assert.deepEqual(result.missing, [{ code: 'pure-price', gas: 'oxygen', bankId: 'real', name: 'EAN32' }]);
});

test('a bank the recipe cannot price for equipment reasons makes salvage null and names the bank', () => {
  const low = bank({ id: 'real', name: 'EAN32', volumeL: 12, pressureBar: 9.5, pricePerLitre: 0.001 });
  const result = run({ banks: [pureO2, pureHe, low], steps: [decantFrom('real', USED_L)] });
  assert.equal(result.salvagedSaving, null);
  assert.deepEqual(result.missing, [{ code: 'recipe-unavailable', bankId: 'real', name: 'EAN32' }]);
});

test('missing entries are deduplicated', () => {
  const low = bank({ id: 'real', name: 'EAN32', volumeL: 12, pressureBar: 9.5, pricePerLitre: 0.001 });
  const result = run({ banks: [pureO2, pureHe, low], steps: [decantFrom('real', 100, 'op-1'), decantFrom('real', 100, 'op-2')] });
  assert.deepEqual(result.missing, [{ code: 'recipe-unavailable', bankId: 'real', name: 'EAN32' }]);
});

test('computeSavings does not mutate the result, banks or costs', () => {
  const banks = [pureO2, pureHe, real];
  const steps = [decantFrom('real', 360)];
  const before = JSON.stringify({ banks, steps, costs });
  run({ banks, steps });
  assert.equal(JSON.stringify({ banks, steps, costs }), before);
});
