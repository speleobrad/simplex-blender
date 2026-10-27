// Benchmarks priceBankByRecipe on the priceable default banks and on worst-case mixed banks.
// Pure banks are refused by design, so they are not benchmarked.
// Usage: node scripts/bench-bank-pricing.mjs
import { performance } from 'node:perf_hooks';
import { DEFAULT_SETTINGS, copySettings } from '../js/settings.js';
import { DEFAULT_BANKS } from '../js/bank-storage.js';
import { priceBankByRecipe } from '../js/bank-pricing.js';
import { isPureBank } from '../js/pure-prices.js';

const DEFAULT_BANK_TARGET_MS = 2000;
const WORST_BANK_TARGET_MS = 10000;
const RUNS = 3;

const physics = { model: 'vdw', temperatureC: 20 };
const inventoryTemperatureC = 21;
const costs = {
  currencySymbol: '',
  leftoverDiscountPercent: 0,
  operationPrices: { boost: 1.5, decant: 0.75, topUp: 5 }
};
// Priced pure O2 and He inventory banks supply the virtual sources.
const inventoryBanks = [
  { id: 'pure-o2', name: 'Pure O2', volumeL: 200, pressureBar: 200, oxygenPercent: 100, heliumPercent: 0, enabled: true, pricePerLitre: 0.01 },
  { id: 'pure-he', name: 'Pure He', volumeL: 200, pressureBar: 200, oxygenPercent: 0, heliumPercent: 100, enabled: true, pricePerLitre: 0.05 }
];

const baseSettings = () => {
  const settings = copySettings(DEFAULT_SETTINGS);
  settings.costs = structuredClone(costs);
  return settings;
};
const raisedSettings = () => {
  const settings = baseSettings();
  settings.booster.maxBoosterOutputPressureBar = 350;
  return settings;
};

const cases = [
  ...DEFAULT_BANKS.filter(bank => !isPureBank(bank)).map(bank => ({
    label: `default: ${bank.name}`,
    bank: structuredClone(bank),
    settings: baseSettings(),
    target: DEFAULT_BANK_TARGET_MS
  })),
  {
    label: 'worst: 200 L 350 bar EAN 50 (350 bar booster)',
    bank: { id: 'worst-ean50', name: 'Worst EAN 50', volumeL: 200, pressureBar: 350, oxygenPercent: 50, heliumPercent: 0, enabled: true },
    settings: raisedSettings(),
    target: WORST_BANK_TARGET_MS
  },
  {
    label: 'worst: 200 L 350 bar Tx 21/35 (350 bar booster)',
    bank: { id: 'worst-tx', name: 'Worst Tx 21/35', volumeL: 200, pressureBar: 350, oxygenPercent: 21, heliumPercent: 35, enabled: true },
    settings: raisedSettings(),
    target: WORST_BANK_TARGET_MS
  }
];

let failed = false;
for (const { label, bank, settings, target } of cases) {
  const times = [];
  let result;
  for (let run = 0; run < RUNS; run += 1) {
    const start = performance.now();
    result = priceBankByRecipe({ bank, costs: structuredClone(costs), settings, physics, inventoryBanks, inventoryTemperatureC });
    times.push(performance.now() - start);
  }
  const worst = Math.max(...times);
  const pass = result.ok === true && worst <= target;
  failed ||= !pass;
  const outcome = result.ok ? `ok, pricePerLitre=${result.pricePerLitre.toFixed(6)}` : `not ok: ${result.reason}`;
  console.log(`${pass ? 'PASS' : 'FAIL'} ${label}: max ${worst.toFixed(1)} ms over ${RUNS} runs (target <= ${target} ms), ${outcome}`);
}

if (failed) {
  console.error('Benchmark target missed.');
  process.exitCode = 1;
}
