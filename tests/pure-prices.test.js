import test from 'node:test';
import assert from 'node:assert/strict';
import { calcMolarDensity } from '../js/physics.js';
import { litresPerMole } from '../js/cost.js';
import {
  bankFreeGasLitres,
  isPureBank,
  isPureComposition,
  isPureHeliumBank,
  isPureOxygenBank,
  pricePerLitreFromFullTank,
  pureGasPrices
} from '../js/pure-prices.js';

const T = 21;
const ideal = { model: 'ideal', temperatureC: T };
const vdw = { model: 'vdw', temperatureC: T };
const bank = (over) => ({
  id: 'b', name: 'B', volumeL: 10, pressureBar: 100, oxygenPercent: 100, heliumPercent: 0,
  enabled: true, pricePerLitre: 0.02, ...over
});
const O2 = (over) => bank({ oxygenPercent: 100, heliumPercent: 0, ...over });
const HE = (over) => bank({ oxygenPercent: 0, heliumPercent: 100, ...over });

// Ideal gas: free-gas litres = (P / (R·T)) × V × (R·T) = P × V, so the weights below are
// exact: 10 L at 150 bar -> 1500 L, 20 L at 100 bar -> 2000 L.
test('oxygen price is the free-gas-litre weighted average of priced pure O2 banks', () => {
  const prices = pureGasPrices({
    banks: [O2({ id: 'a', volumeL: 10, pressureBar: 150, pricePerLitre: 0.02 }), O2({ id: 'b', volumeL: 20, pressureBar: 100, pricePerLitre: 0.03 })],
    physics: ideal,
    inventoryTemperatureC: T
  });
  // Litre weighting gives 90 / 3500 = 0.025714; the volume-only average (0.026667) differs by > 5e-4.
  assert.ok(Math.abs(prices.oxygen - 90 / 3500) < 1e-12);
  assert.ok(Math.abs(prices.oxygen - (10 * 0.02 + 20 * 0.03) / 30) > 5e-4);
  assert.equal(prices.helium, null);
});
test('disabled, unpriced and non-pure banks are excluded from the average', () => {
  const prices = pureGasPrices({
    banks: [
      O2({ id: 'a', volumeL: 10, pressureBar: 150, pricePerLitre: 0.02 }),
      O2({ id: 'off', volumeL: 50, pressureBar: 200, pricePerLitre: 9, enabled: false }),
      O2({ id: 'free', volumeL: 30, pressureBar: 200, pricePerLitre: null }),
      bank({ id: 'tx', oxygenPercent: 21, heliumPercent: 35, volumeL: 40, pressureBar: 200, pricePerLitre: 7 }),
      bank({ id: 'near', oxygenPercent: 99, heliumPercent: 0, volumeL: 40, pressureBar: 200, pricePerLitre: 7 })
    ],
    physics: ideal,
    inventoryTemperatureC: T
  });
  // Only bank a counts: 1500 × 0.02 / 1500
  assert.ok(Math.abs(prices.oxygen - 0.02) < 1e-12);
});
test('helium price uses only pure helium banks with the same weighting', () => {
  const prices = pureGasPrices({
    banks: [HE({ id: 'h1', volumeL: 5, pressureBar: 200, pricePerLitre: 0.1 }), HE({ id: 'h2', volumeL: 10, pressureBar: 100, pricePerLitre: 0.2 })],
    physics: ideal,
    inventoryTemperatureC: T
  });
  // (1000 × 0.1 + 1000 × 0.2) / 2000
  assert.ok(Math.abs(prices.helium - 0.15) < 1e-12);
  assert.equal(prices.oxygen, null);
});
test('no priced pure bank of a gas gives null for that gas', () => {
  const prices = pureGasPrices({
    banks: [O2({ pricePerLitre: undefined }), HE({ enabled: false }), bank({ oxygenPercent: 21, heliumPercent: 35 })],
    physics: ideal,
    inventoryTemperatureC: T
  });
  assert.deepEqual(prices, { oxygen: null, helium: null });
  assert.deepEqual(pureGasPrices({ banks: [], physics: ideal, inventoryTemperatureC: T }), { oxygen: null, helium: null });
});
test('a priced pure bank with no free gas contributes no weight and yields null', () => {
  const prices = pureGasPrices({
    banks: [O2({ pressureBar: 0, pricePerLitre: 0.02 })],
    physics: ideal,
    inventoryTemperatureC: T
  });
  assert.equal(prices.oxygen, null);
});
test('vdw physics weights by the vdw free-gas litres at the inventory temperature', () => {
  const low = O2({ id: 'a', volumeL: 10, pressureBar: 150, pricePerLitre: 0.02 });
  const high = O2({ id: 'b', volumeL: 10, pressureBar: 300, pricePerLitre: 0.04 });
  const weightOf = b => calcMolarDensity(b.pressureBar, b.oxygenPercent, b.heliumPercent, 15, true) * b.volumeL * litresPerMole(15);
  const expected = (weightOf(low) * 0.02 + weightOf(high) * 0.04) / (weightOf(low) + weightOf(high));
  const prices = pureGasPrices({ banks: [low, high], physics: vdw, inventoryTemperatureC: 15 });
  assert.ok(Math.abs(prices.oxygen - expected) < 1e-12);
});
test('isPureOxygenBank and isPureHeliumBank require an enabled bank at exactly 100/0 or 0/100', () => {
  assert.equal(isPureOxygenBank(O2()), true);
  assert.equal(isPureOxygenBank(HE()), false);
  assert.equal(isPureOxygenBank(O2({ enabled: false })), false);
  assert.equal(isPureOxygenBank(O2({ oxygenPercent: 99.9, heliumPercent: 0 })), false);
  assert.equal(isPureHeliumBank(HE()), true);
  assert.equal(isPureHeliumBank(O2()), false);
  assert.equal(isPureHeliumBank(HE({ enabled: false })), false);
  assert.equal(isPureHeliumBank(bank({ oxygenPercent: 0, heliumPercent: 99.5 })), false);
});
test('isPureBank is true for either pure gas and false for mixes', () => {
  assert.equal(isPureBank(O2()), true);
  assert.equal(isPureBank(HE()), true);
  assert.equal(isPureBank(bank({ oxygenPercent: 21, heliumPercent: 35 })), false);
  assert.equal(isPureBank(O2({ enabled: false })), false);
});
test('isPureComposition ignores enabled and is true only for exact pure O2 or He', () => {
  assert.equal(isPureComposition(O2()), true);
  assert.equal(isPureComposition(HE()), true);
  assert.equal(isPureComposition(O2({ enabled: false })), true);
  assert.equal(isPureComposition(bank({ oxygenPercent: 21, heliumPercent: 35 })), false);
  assert.equal(isPureComposition(bank({ oxygenPercent: 99.9, heliumPercent: 0 })), false);
});
test('bankFreeGasLitres is the free-gas litres a bank holds at the inventory temperature', () => {
  assert.ok(Math.abs(bankFreeGasLitres(O2({ volumeL: 10, pressureBar: 150 }), ideal, T) - 1500) < 1e-9);
  const expected = calcMolarDensity(150, 100, 0, 15, true) * 10 * litresPerMole(15);
  assert.ok(Math.abs(bankFreeGasLitres(O2({ volumeL: 10, pressureBar: 150 }), vdw, 15) - expected) < 1e-9);
  assert.equal(bankFreeGasLitres(O2({ pressureBar: 0 }), ideal, T), 0);
});
test('pricePerLitreFromFullTank divides the tank price by the free-gas litres once', () => {
  assert.ok(Math.abs(pricePerLitreFromFullTank(30, 1500) - 0.02) < 1e-12);
  assert.equal(pricePerLitreFromFullTank(0, 1500), 0);
  assert.equal(pricePerLitreFromFullTank(30, 0), null);
  assert.equal(pricePerLitreFromFullTank(30, -1), null);
  assert.equal(pricePerLitreFromFullTank(-1, 1500), null);
  assert.equal(pricePerLitreFromFullTank(Number.NaN, 1500), null);
  assert.equal(pricePerLitreFromFullTank(30, Number.NaN), null);
});

test('a full-tank price converts at the inventory temperature, not the ambient temperature', () => {
  // Real gas: free-gas litres depend on temperature, so the same full-tank price gives a
  // different per-litre price at 5 °C than at 35 °C. Ambient is irrelevant to the conversion.
  const cold = bankFreeGasLitres(O2({ volumeL: 10, pressureBar: 150 }), vdw, 5);
  const warm = bankFreeGasLitres(O2({ volumeL: 10, pressureBar: 150 }), vdw, 35);
  assert.ok(cold > warm, 'colder gas holds more free litres');
  const expectedCold = calcMolarDensity(150, 100, 0, 5, true) * 10 * litresPerMole(5);
  assert.ok(Math.abs(cold - expectedCold) < 1e-9);
  assert.ok(Math.abs(pricePerLitreFromFullTank(30, cold) - 30 / expectedCold) < 1e-12);
  assert.notEqual(pricePerLitreFromFullTank(30, cold), pricePerLitreFromFullTank(30, warm));
});
