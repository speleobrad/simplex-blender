import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS, copySettings } from '../js/settings.js';
import { calcMolarDensity } from '../js/physics.js';
import { litresPerMole } from '../js/cost.js';
import { priceBankByRecipe, virtualBankCount } from '../js/bank-pricing.js';

const physics = { model: 'vdw', temperatureC: 20 };
const INVENTORY_TEMPERATURE_C = 20;
const costs = () => ({
  currencySymbol: '', leftoverDiscountPercent: 0,
  operationPrices: { boost: 2, decant: 1, topUp: 5 }
});
const zeroCosts = () => ({
  currencySymbol: '', leftoverDiscountPercent: 0,
  operationPrices: { boost: 0, decant: 0, topUp: 0 }
});
const settingsWith = (mutate = () => {}) => {
  const s = copySettings(DEFAULT_SETTINGS);
  s.costs = costs();
  mutate(s);
  return s;
};
const bank = (over) => ({ id: 'real', name: 'Real', volumeL: 12, pressureBar: 150, oxygenPercent: 32, heliumPercent: 0, enabled: true, ...over });
// Priced pure banks. Each gas has one bank, so its weighted price is exactly its stored price.
const inventory = () => [
  bank({ id: 'o2', name: 'O2', volumeL: 10, pressureBar: 150, oxygenPercent: 100, heliumPercent: 0, pricePerLitre: 0.02 }),
  bank({ id: 'he', name: 'He', volumeL: 10, pressureBar: 150, oxygenPercent: 0, heliumPercent: 100, pricePerLitre: 0.05 })
];
const priceWith = (over = {}) => priceBankByRecipe({
  bank: bank(),
  costs: costs(),
  settings: settingsWith(),
  physics,
  inventoryBanks: inventory(),
  inventoryTemperatureC: INVENTORY_TEMPERATURE_C,
  ...over
});
const MIN_SOURCE_BAR = DEFAULT_SETTINGS.booster.minimumSourcePressureBar;
// Hand-computed virtual source count for one gas, independent of js/bank-pricing.js sizing:
//   needMoles    = calcMolarDensity(bankP, O2%, He%, 20 C, vdw) × volumeL × (that gas's percent / 100)
//   perBankMoles = (calcMolarDensity(200 bar, pure gas) − calcMolarDensity(minSourceBar, pure gas)) × 200 L
//   count        = ceil(2 × needMoles / perBankMoles), or 0 when needMoles is 0
function gasCount(gas, { volumeL, pressureBar, oxygenPercent, heliumPercent }) {
  const [pureO2, pureHe] = gas === 'O2' ? [100, 0] : [0, 100];
  const percent = gas === 'O2' ? oxygenPercent : heliumPercent;
  const needMoles = calcMolarDensity(pressureBar, oxygenPercent, heliumPercent, 20, true) * volumeL * percent / 100;
  if (!(needMoles > 0)) return 0;
  const perBankMoles = (calcMolarDensity(200, pureO2, pureHe, 20, true) - calcMolarDensity(MIN_SOURCE_BAR, pureO2, pureHe, 20, true)) * 200;
  return Math.ceil(2 * needMoles / perBankMoles);
}

test('virtualBankCount is 0 for an absent gas and 2x margin otherwise', () => {
  assert.equal(virtualBankCount({ needMoles: 0, perBankMoles: 1000 }), 0);
  assert.equal(virtualBankCount({ needMoles: 100, perBankMoles: 1000 }), 1);
  assert.equal(virtualBankCount({ needMoles: 1000, perBankMoles: 1000 }), 2);
  assert.equal(virtualBankCount({ needMoles: 1001, perBankMoles: 1000 }), 3);
});

test('a pure bank is refused: pure banks have no Calculate price', () => {
  const result = priceWith({ bank: bank({ oxygenPercent: 100, heliumPercent: 0 }) });
  assert.equal(result.ok, false);
  assert.match(result.reason, /Pure banks/);
});

test('discount applies once and 100 percent gives zero', () => {
  const base = priceWith();
  assert.equal(base.ok, true, base.reason);
  assert.ok(base.pricePerLitre > 0);
  const half = priceWith({ costs: { ...costs(), leftoverDiscountPercent: 50 } });
  assert.ok(Math.abs(half.pricePerLitre - base.pricePerLitre / 2) < 1e-12);
  const free = priceWith({ costs: { ...costs(), leftoverDiscountPercent: 100 } });
  assert.equal(free.pricePerLitre, 0);
});

test('EAN32 at 150 bar: O2 litres at the O2 price plus one top-up and one decant', () => {
  const result = priceWith();
  assert.equal(result.ok, true, result.reason);
  // Hand check, vdw at 20 C, 12 L. M = total moles = calcMolarDensity(150, 32, 0, 20, true) × 12.
  // Air (21% O2, 79% N2) supplies N2 = 0.68·M, so air = 0.68·M / 0.79 and its O2 = 0.21 × 0.68 × M / 0.79.
  // Pure O2 supplies the rest: 0.32·M − 0.21 × 0.68·M / 0.79 = b·M, with b = 0.32 − 0.21 × 0.68 / 0.79.
  // Cost = one top-up (5) + one decant (1) + b·M·litresPerMole(20) × 0.02 (O2 price).
  const perMole = litresPerMole(20);
  const M = calcMolarDensity(150, 32, 0, 20, true) * 12;
  assert.ok(Math.abs(result.litres - M * perMole) < 1e-9);
  const b = 0.32 - 0.21 * 0.68 / 0.79;
  assert.ok(Math.abs(result.recipeCost - (6 + b * M * perMole * 0.02)) < 1e-6, `${result.recipeCost}`);
  assert.ok(Math.abs(result.pricePerLitre - result.recipeCost / result.litres) < 1e-12);
  assert.equal(result.operationCount.topUp, 1);
  assert.equal(result.operationCount.decant, 1);
  assert.equal(result.operationCount.boost, undefined);
});

test('Tx21/35 at 150 bar uses O2 and He sources: one decant per source bank plus one top-up', () => {
  const result = priceWith({ bank: bank({ oxygenPercent: 21, heliumPercent: 35, pressureBar: 150 }) });
  assert.equal(result.ok, true, result.reason);
  // The planner decants O2 and He separately (two distinct costOperationIds), so each is one decant fee.
  assert.equal(result.operationCount.topUp, 1);
  assert.equal(result.operationCount.decant, 2);
  assert.ok(result.recipeCost >= 5);
});

test('ideal and vdw physics give different litres for the same bank', () => {
  const vdw = priceWith();
  const ideal = priceWith({ physics: { model: 'ideal', temperatureC: 20 } });
  assert.equal(ideal.ok, true, ideal.reason);
  const idealMoles = calcMolarDensity(150, 32, 0, 20, false) * 12;
  assert.ok(Math.abs(ideal.litres - idealMoles * litresPerMole(20)) < 1e-9);
  assert.ok(Math.abs(vdw.litres - ideal.litres) > 1e-6);
});

test('compressor ceiling: a top-up within the ceiling is priced with one fee', () => {
  const result = priceWith({ settings: settingsWith(s => { s.booster.maxCompressorPressureBar = 140; }) });
  assert.equal(result.ok, true, result.reason);
  assert.equal(result.operationCount.topUp, 1);
});

test('compressor ceiling below the target makes the mix unpriceable', () => {
  const result = priceWith({ settings: settingsWith(s => { s.booster.maxCompressorPressureBar = 100; }) });
  assert.equal(result.ok, false);
  assert.match(result.reason, /Compressor Air cannot top up/);
  assert.equal(result.missingGas, undefined, 'an equipment failure names no pure gas');
});

test('a bank below 10 bar fails without a price', () => {
  const result = priceWith({ bank: bank({ pressureBar: 9.5 }) });
  assert.equal(result.ok, false);
  assert.match(result.reason, /10 bar/);
});

test('a hypoxic mix that air plus pure O2 and He cannot make fails without a price', () => {
  const result = priceWith({ bank: bank({ oxygenPercent: 10, heliumPercent: 0 }) });
  assert.equal(result.ok, false);
  assert.match(result.reason, /exact target mix cannot be made/);
});

test('more than 6 virtual banks for one gas fails without a price', () => {
  const result = priceWith({
    bank: bank({ oxygenPercent: 99.5, heliumPercent: 0, volumeL: 200, pressureBar: 350 }),
    settings: settingsWith(s => { s.booster.minimumSourcePressureBar = 150; s.booster.maxBoosterOutputPressureBar = 350; })
  });
  assert.equal(result.ok, false);
  assert.match(result.reason, /more than 6 virtual oxygen sources/);
  assert.equal(result.missingGas, undefined, 'a source-count failure names no pure gas');
});

test('zero flat fees with no priced pure bank name the needed oxygen', () => {
  const result = priceWith({ costs: zeroCosts(), inventoryBanks: [] });
  assert.equal(result.ok, false);
  assert.match(result.reason, /Set a price on a pure oxygen bank first/);
  assert.equal(result.missingGas, 'oxygen');
});

test('no fees and no pure price, with no pure gas needed, report that no prices are configured', () => {
  // A bank with no oxygen and no helium needs no pure gas, so no gas is named.
  const result = priceWith({ bank: bank({ oxygenPercent: 0, heliumPercent: 0 }), costs: zeroCosts(), inventoryBanks: [] });
  assert.equal(result.ok, false);
  assert.match(result.reason, /^No prices set\. Set bank prices in Inventory and fees in Settings → Costs\.$/);
  assert.equal(result.missingGas, undefined);
});

test('zero flat fees still price a bank from the pure-gas prices alone', () => {
  const result = priceWith({ costs: zeroCosts() });
  assert.equal(result.ok, true, result.reason);
  assert.ok(result.recipeCost > 0);
  const base = priceWith();
  assert.equal(result.recipeCost, base.recipeCost - (5 + base.operationCount.decant), 'removing the default fees: one top-up (5) plus one fee per decant');
});

test('a needed pure oxygen gas with no priced pure O2 bank fails naming oxygen', () => {
  const result = priceWith({ inventoryBanks: inventory().filter(b => b.id !== 'o2') });
  assert.equal(result.ok, false);
  assert.match(result.reason, /Set a price on a pure oxygen bank first/);
  assert.equal(result.missingGas, 'oxygen');
});

test('a needed pure helium gas with no priced pure He bank fails naming helium', () => {
  const result = priceWith({ bank: bank({ oxygenPercent: 21, heliumPercent: 35 }), inventoryBanks: inventory().filter(b => b.id !== 'he') });
  assert.equal(result.ok, false);
  assert.match(result.reason, /Set a price on a pure helium bank first/);
  assert.equal(result.missingGas, 'helium');
});

test('a disabled pure bank is not a price source and names its gas', () => {
  const disabled = inventory().map(b => (b.id === 'o2' ? { ...b, enabled: false } : b));
  const result = priceWith({ inventoryBanks: disabled });
  assert.equal(result.ok, false);
  assert.match(result.reason, /pure oxygen bank/);
  assert.equal(result.missingGas, 'oxygen');
});

test('real banks, inventory and settings are not mutated', () => {
  const b = bank();
  const s = settingsWith();
  const inv = inventory();
  const before = JSON.stringify([b, s, inv]);
  priceBankByRecipe({ bank: b, costs: costs(), settings: s, physics, inventoryBanks: inv, inventoryTemperatureC: INVENTORY_TEMPERATURE_C });
  assert.equal(JSON.stringify([b, s, inv]), before);
});

test('200 L at 350 bar: default equipment fails, a 350 bar booster limit prices it with the counted sources', () => {
  const big = bank({ oxygenPercent: 10, heliumPercent: 60, volumeL: 200, pressureBar: 350 });
  const defaults = priceWith({ bank: big });
  assert.equal(defaults.ok, false);
  assert.match(defaults.reason, /Maximum safe pressure|Booster output cannot exceed/);
  const raised = priceWith({ bank: big, settings: settingsWith(s => { s.booster.maxBoosterOutputPressureBar = 350; }) });
  assert.equal(raised.ok, true, raised.reason);
  assert.equal(raised.sourceCount, gasCount('O2', big) + gasCount('He', big), 'hand check: ceil(2 × need / perBank) per gas');
  assert.ok(raised.exhaustedSources < raised.sourceCount, 'supply must not be the binding limit');
});

test('12 L O2 99.5% at 150 bar needs one O2 virtual bank and no He banks', () => {
  const b = bank({ oxygenPercent: 99.5, heliumPercent: 0 });
  const result = priceWith({ bank: b });
  assert.equal(result.ok, true, result.reason);
  // needMoles ≈ 82.9 mol × 0.995; perBank ≈ 1795 mol at the 5 bar minimum, so ceil(2 × 82.5 / 1795) = 1.
  // A perBank computed with bank.volumeL (12 L) would give ceil(2 × 82.5 / 107.7) = 2.
  assert.equal(result.sourceCount, 1);
  assert.equal(gasCount('He', b), 0);
  assert.equal(result.sourceCount, gasCount('O2', b));
});

test('Tx21/35 at 150 bar: sourceCount is the O2 count plus the He count', () => {
  const b = bank({ oxygenPercent: 21, heliumPercent: 35, pressureBar: 150 });
  const result = priceWith({ bank: b });
  assert.equal(result.ok, true, result.reason);
  assert.ok(gasCount('O2', b) > 0 && gasCount('He', b) > 0);
  assert.equal(result.sourceCount, gasCount('O2', b) + gasCount('He', b));
});
