// Benchmarks priceBankByRecipe on the default banks and on the worst-case bank.
// Usage: node scripts/bench-bank-pricing.mjs
import { performance } from 'node:perf_hooks';
import { DEFAULT_SETTINGS, copySettings } from '../js/settings.js';
import { DEFAULT_BANKS } from '../js/bank-storage.js';
import { priceBankByRecipe } from '../js/bank-pricing.js';

const DEFAULT_BANK_TARGET_MS = 2000;
const WORST_BANK_TARGET_MS = 10000;
const RUNS = 3;

const physics = { model: 'vdw', temperatureC: 20 };
const costs = {
  currencySymbol: '',
  pricePerLitre: { oxygen: 0.01, helium: 0.05 },
  leftoverDiscountPercent: 0,
  operationPrices: { boostPerLitre: 0.002, decantPerLitre: 0.001, equalizePerLitre: 0.0005, topUpPerOperation: 5 }
};

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
  ...DEFAULT_BANKS.map(bank => ({ label: `default: ${bank.name}`, bank: structuredClone(bank), settings: baseSettings(), target: DEFAULT_BANK_TARGET_MS })),
  {
    label: 'worst: 200 L 350 bar O2 (350 bar booster)',
    bank: { id: 'worst-o2', name: 'Worst O2', volumeL: 200, pressureBar: 350, oxygenPercent: 100, heliumPercent: 0, enabled: true },
    settings: raisedSettings(),
    target: WORST_BANK_TARGET_MS
  },
  {
    label: 'worst: 200 L 350 bar He (350 bar booster)',
    bank: { id: 'worst-he', name: 'Worst He', volumeL: 200, pressureBar: 350, oxygenPercent: 0, heliumPercent: 100, enabled: true },
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
    result = priceBankByRecipe({ bank, costs: structuredClone(costs), settings, physics });
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
