# Filling Cost Calculator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show the cost of a fill (gas by source, operations, total) in the Tank summary tab for Optimize, Compare and What-if, with per-bank prices that an on-demand recipe calculation can suggest.

**Architecture:** Planners stamp every executed transfer step with `sourceConsumedMoles`, `costOperation` and a planner-owned `costOperationId`. A pure `js/cost.js` turns steps plus stored bank prices and Settings prices into a cost breakdown. A pure `js/bank-pricing.js` builds a bank's gas from virtual pure O₂/He banks and compressor Air with the existing optimizer, costs that recipe, and returns a suggested price that the user applies explicitly. Cost is display-only.

**Tech Stack:** Browser-native ES modules, Node `node --test`, Playwright (Chromium).

**Spec:** `docs/superpowers/specs/2026-10-26-filling-cost-calculator-design.md` (committed, approved). Read it first; the plan implements it and does not repeat every rule.

## Global Constraints

- No bundler; plain ES modules under `js/`. Tests are `tests/*.test.js` run with `npm test`.
- Cost never changes optimizer objectives, the helium-retention invariant (`docs/development.md`), or any existing result number.
- Free-gas litre = `moles × GAS_CONSTANT × (temperatureC + 273.15)` with the flow's ambient `physics.temperatureC`.
- Prices are stored per litre, in currency units. Display converts through `js/units.js`. The top-up fee is flat and never unit-converted.
- Settings defaults are all zero; currency symbol defaults to `''`.
- `AGENTS.md`: read `docs/ci-reproduction.md` before touching any screenshot baseline; never raise `maxDiffPixelRatio`; never claim GitHub Actions passed from a local run; never push to `origin/master`.
- Commit after each task. Run `npm test` before each commit; it must stay green.

## File Structure

| File | Responsibility |
|---|---|
| `js/units.js` (modify) | `pricePerVolumeL` unit quantity |
| `js/settings.js` (modify) | `costs` defaults, normalization, copy, validation hook |
| `js/input-validation.js` (modify) | `validateCostSettings`, bank `pricePerLitre` validation |
| `js/bank-storage.js` (modify) | persist optional bank `pricePerLitre` |
| `js/optimizer.js` (modify) | stamp cost fields on protocol steps |
| `js/compare-recipe.js` (modify) | stamp cost fields on Compare/What-if steps |
| `js/plan-with-readings.js` (modify) | namespace suffix operation IDs |
| `js/cost.js` (create) | `computeFillCost`, `litresPerMole` |
| `js/bank-pricing.js` (create) | `virtualBankCount`, `priceBankByRecipe` |
| `js/ui/cost-summary.js` (create) | render Costs section |
| `js/ui/settings-dialog.js`, `index.html`, `js/main.js` (modify) | Settings → Costs |
| `js/ui/supply-banks.js`, `js/main.js` (modify) | bank price input, Calculate/Apply |
| `index.html`, `js/main.js` (modify) | Costs section markup and wiring for three flows |
| `scripts/bench-bank-pricing.mjs` (create, kept) | runtime benchmark for the spec's 2 s / 10 s targets |
| `docs/*` (modify) | architecture, optimizer, development, UI |

---

### Task 1: Price-per-volume unit

**Files:**
- Modify: `js/units.js:10-19` (`UNIT_DEFINITIONS`), `canonicalQuantity` map
- Test: `tests/units.test.js`

**Interfaces:**
- Produces: quantity `'pricePerVolumeL'` for `convertToDisplay`, `convertFromDisplay`, `unitLabel`. Metric label `/L`, imperial `/cu ft`. Display = stored × `28.316846592` in imperial.

- [ ] **Step 1: Write the failing test** (append to `tests/units.test.js`; mirror its existing imports)

```js
import { convertFromDisplay, convertToDisplay, unitLabel } from '../js/units.js';

test('price per litre converts to price per cubic foot and back', () => {
  assert.equal(convertToDisplay(0.02, 'pricePerVolumeL', 'metric'), 0.02);
  const perCubicFoot = convertToDisplay(0.02, 'pricePerVolumeL', 'imperial');
  assert.ok(Math.abs(perCubicFoot - 0.02 * 28.316846592) < 1e-12);
  assert.ok(Math.abs(convertFromDisplay(perCubicFoot, 'pricePerVolumeL', 'imperial') - 0.02) < 1e-12);
  assert.equal(unitLabel('pricePerVolumeL', 'metric'), '/L');
  assert.equal(unitLabel('pricePerVolumeL', 'imperial'), '/cu ft');
});
```

- [ ] **Step 2:** `node --test tests/units.test.js` → FAIL (`unitLabel` returns `''`).

- [ ] **Step 3: Implement.** In `UNIT_DEFINITIONS` add:

```js
  pricePerVolumeL: { metric: ['/L', value => value], imperial: ['/cu ft', value => value * LITRES_PER_CUBIC_FOOT, value => value / LITRES_PER_CUBIC_FOOT] },
```

- [ ] **Step 4:** `node --test tests/units.test.js` → PASS.
- [ ] **Step 5:** `git add js/units.js tests/units.test.js && git commit -m "feat: add price-per-volume unit (refs #3)"`

---

### Task 2: Settings `costs`

**Files:**
- Modify: `js/settings.js` (`DEFAULT_SETTINGS` at line 22, `copySettings` at 163, `validateSettings` at 272, `loadSettings` at 444, `saveSettings` at 471 — follow how `interimPressureTolerancePercent` is defaulted by `addDefaultInterimPressureTolerance`)
- Modify: `js/input-validation.js` (add `validateCostSettings`)
- Test: `tests/settings.test.js`, `tests/input-validation.test.js`

**Interfaces:**
- Produces: `settings.costs` shaped exactly as in the spec (`currencySymbol`, `pricePerLitre {oxygen, helium}`, `leftoverDiscountPercent`, `operationPrices {boostPerLitre, decantPerLitre, equalizePerLitre, topUpPerOperation}`); `validateCostSettings(costs) → string[]`; `addDefaultCosts(settings)` (exported for tests).

- [ ] **Step 1: Write failing tests**

```js
// tests/input-validation.test.js
import { validateCostSettings } from '../js/input-validation.js';
const validCosts = () => ({
  currencySymbol: '€',
  pricePerLitre: { oxygen: 0.01, helium: 0.05 },
  leftoverDiscountPercent: 20,
  operationPrices: { boostPerLitre: 0.002, decantPerLitre: 0, equalizePerLitre: 0, topUpPerOperation: 5 }
});
test('valid cost settings pass', () => assert.deepEqual(validateCostSettings(validCosts()), []));
test('cost settings reject negative, non-finite, oversized prices and bad discount', () => {
  for (const mutate of [
    c => { c.pricePerLitre.oxygen = -1; },
    c => { c.pricePerLitre.helium = NaN; },
    c => { c.operationPrices.topUpPerOperation = 1e7; },
    c => { c.leftoverDiscountPercent = 101; },
    c => { c.currencySymbol = 'WAYTOOLONGSYMBOL'; },
    c => { c.currencySymbol = 5; }
  ]) {
    const c = validCosts(); mutate(c);
    assert.ok(validateCostSettings(c).length > 0);
  }
});
```

```js
// tests/settings.test.js
test('settings default costs to zero prices and survive save, load and copy', () => {
  assert.equal(DEFAULT_SETTINGS.costs.pricePerLitre.oxygen, 0);
  assert.equal(DEFAULT_SETTINGS.costs.currencySymbol, '');
  const storage = memoryStorage();
  const settings = copySettings(DEFAULT_SETTINGS);
  settings.costs.pricePerLitre.helium = 0.07;
  settings.costs.operationPrices.topUpPerOperation = 4.5;
  saveSettings(settings, storage);
  const loaded = loadSettings(storage);
  assert.equal(loaded.costs.pricePerLitre.helium, 0.07);
  assert.equal(loaded.costs.operationPrices.topUpPerOperation, 4.5);
  const copy = copySettings(loaded); copy.costs.pricePerLitre.helium = 9;
  assert.equal(loaded.costs.pricePerLitre.helium, 0.07);
});
test('legacy saved settings without costs load with zero-price defaults', () => {
  const legacy = copySettings(DEFAULT_SETTINGS); delete legacy.costs;
  const storage = memoryStorage([['simplex-gas-remixer-settings', JSON.stringify(legacy)]]);
  assert.deepEqual(loadSettings(storage).costs, DEFAULT_SETTINGS.costs);
});
test('saving settings with invalid costs throws', () => {
  const settings = copySettings(DEFAULT_SETTINGS); settings.costs.leftoverDiscountPercent = -1;
  assert.throws(() => saveSettings(settings, memoryStorage()), RangeError);
});
```

- [ ] **Step 2:** `node --test tests/settings.test.js tests/input-validation.test.js` → FAIL.

- [ ] **Step 3: Implement.** In `js/input-validation.js`:

```js
const MAX_COST_PRICE = 1_000_000;
const priceOk = value => Number.isFinite(value) && value >= 0 && value <= MAX_COST_PRICE;

export function validateCostSettings(costs) {
  if (!costs || typeof costs !== 'object') return ['Cost settings are missing.'];
  const errors = [];
  if (typeof costs.currencySymbol !== 'string' || costs.currencySymbol.trim().length > 8) {
    errors.push('Currency symbol must be text of at most 8 characters.');
  }
  const prices = [
    costs.pricePerLitre?.oxygen, costs.pricePerLitre?.helium,
    costs.operationPrices?.boostPerLitre, costs.operationPrices?.decantPerLitre,
    costs.operationPrices?.equalizePerLitre, costs.operationPrices?.topUpPerOperation
  ];
  if (!prices.every(priceOk)) errors.push('Prices must be numbers from 0 to 1,000,000.');
  if (!Number.isFinite(costs.leftoverDiscountPercent)
    || costs.leftoverDiscountPercent < 0 || costs.leftoverDiscountPercent > 100) {
    errors.push('Leftover discount must be between 0 and 100%.');
  }
  return errors;
}
```

In `js/settings.js`: add `costs` to `DEFAULT_SETTINGS` with deep-frozen zeros (`currencySymbol: ''`, `pricePerLitre: {oxygen:0, helium:0}`, `leftoverDiscountPercent: 0`, `operationPrices: {boostPerLitre:0, decantPerLitre:0, equalizePerLitre:0, topUpPerOperation:0}`); add exported `addDefaultCosts(settings)` that returns `{ ...settings, costs: copyCosts(settings.costs ?? DEFAULT_SETTINGS.costs) }` with `copyCosts` doing a field-by-field copy (trim the symbol); include `costs: copyCosts(settings.costs)` in `copySettings`; wrap `saveSettings`' normalization chain with `addDefaultCosts(...)`, and apply it in `loadSettings` the same place the other `addDefault*` normalizers run; in `validateSettings` append `...validateCostSettings(settings.costs)` (import it).

- [ ] **Step 4:** both test files PASS; `npm test` green.
- [ ] **Step 5:** `git add js/settings.js js/input-validation.js tests && git commit -m "feat: add cost settings (refs #3)"`

---

### Task 3: Bank price field

**Files:**
- Modify: `js/bank-storage.js` (`BANK_FIELDS` line 21 is for the legacy check only — leave it; change `copyBanks` at 33), `js/input-validation.js` (`validateSupplyBankInput` at 143)
- Test: `tests/banks.test.js`, `tests/input-validation.test.js`

**Interfaces:**
- Produces: optional `bank.pricePerLitre` (finite number 0–1,000,000, or `null`/absent = unpriced). Saved banks without it load unchanged and unpriced.

- [ ] **Step 1: Failing tests**

```js
// tests/banks.test.js
test('bank price per litre persists and legacy banks stay unpriced', () => {
  const storage = memoryStorage();
  const banks = loadSupplyBanks(storage);
  banks[0].pricePerLitre = 0.0123;
  saveSupplyBanks(banks, storage);
  assert.equal(loadSupplyBanks(storage)[0].pricePerLitre, 0.0123);
  assert.equal('pricePerLitre' in loadSupplyBanks(memoryStorage())[0], false);
});
// tests/input-validation.test.js
test('supply bank price must be a non-negative finite number or null', () => {
  const bank = { id: 'b', name: 'B', volumeL: 10, pressureBar: 100, oxygenPercent: 100, heliumPercent: 0, enabled: true };
  assert.deepEqual(validateSupplyBankInput({ ...bank, pricePerLitre: 0.5 }), []);
  assert.deepEqual(validateSupplyBankInput({ ...bank, pricePerLitre: null }), []);
  assert.ok(validateSupplyBankInput({ ...bank, pricePerLitre: -1 }).length > 0);
  assert.ok(validateSupplyBankInput({ ...bank, pricePerLitre: 'x' }).length > 0);
});
```

- [ ] **Step 2:** FAIL.
- [ ] **Step 3: Implement.** In `copyBanks` add after the `gasPresetName` line: `if (bank.pricePerLitre !== undefined) copy.pricePerLitre = bank.pricePerLitre;`. In `validateSupplyBankInput`, before the final `return []`:

```js
  if (bank.pricePerLitre !== undefined && bank.pricePerLitre !== null
    && !(Number.isFinite(bank.pricePerLitre) && bank.pricePerLitre >= 0 && bank.pricePerLitre <= 1_000_000)) {
    return ['Supply bank price must be a number from 0 to 1,000,000.'];
  }
```

- [ ] **Step 4:** PASS; `npm test`. Confirm `saveSupplyBanks`/`loadSupplyBanks` keep the field (read the rest of `js/bank-storage.js:80-end` and extend any whitelist if present).
- [ ] **Step 5:** commit `feat: add optional bank price (refs #3)`.

---

### Task 4: Step contract — Optimize

**Files:**
- Modify: `js/optimizer.js` — the stage loop at 2242–2328 (`protocolSteps.push` at 2298)
- Test: `tests/optimizer.test.js`

**Interfaces:**
- Produces on every `type` ∈ {`boost`,`decant`} protocol step: `sourceConsumedMoles` (number), `costOperation` (`'boost'|'decant'|'topUp'`), `costOperationId` (`'op-N'`, unique per stage of `pressureTransferStages`). Thermal-split stages (built at ~468–520 via `...transferStep`) inherit `costOperationId` and `costOperation`; they already set their own `sourceConsumedMoles`.

- [ ] **Step 1: Failing tests** (use an existing optimizer fixture from `tests/optimizer.test.js`; reuse its input builder)

```js
test('optimizer steps carry cost contract fields', () => {
  const result = optimizeBlend(defaultRecipeInput);
  const transfers = result.protocolSteps.filter(s => s.type === 'boost' || s.type === 'decant');
  assert.ok(transfers.length > 0);
  for (const step of transfers) {
    assert.ok(Number.isFinite(step.sourceConsumedMoles) && step.sourceConsumedMoles > 0);
    assert.match(step.costOperationId, /^op-\d+$/);
    assert.ok(['boost', 'decant', 'topUp'].includes(step.costOperation));
    assert.equal(step.costOperation === 'topUp', step.sourceBankId === 'compressor-air');
  }
});
test('a thermally split transfer shares one operation id and its moles sum to the whole', () => {
  const result = optimizeBlend(schedulerSplitInput);
  const stages = result.protocolSteps.filter(s => s._thermalSplit);
  assert.equal(stages.length, 4);
  assert.equal(stages[0].costOperationId, stages[1].costOperationId);
  assert.equal(stages[2].costOperationId, stages[3].costOperationId);
  assert.notEqual(stages[0].costOperationId, stages[2].costOperationId);
  assert.ok(stages.every(s => s.sourceConsumedMoles > 0));
});
test('operation ids are unique per operation', () => {
  const ids = optimizeBlend(defaultRecipeInput).protocolSteps.filter(s => s.costOperationId)
    .filter(s => !/safe stage/.test(s.title ?? '')).map(s => s.costOperationId);
  assert.equal(new Set(ids).size, ids.length);
});
```
Fixtures, both in `tests/optimizer.test.js`: `defaultRecipeInput` is the object literal at `tests/plan-with-readings.test.js:9-24` (45 bar Air at 21 °C to 195 bar 18/45, `DEFAULT_BANKS`, `DEFAULT_SETTINGS`), copied to a top-level `const` with `import { DEFAULT_BANKS } from '../js/bank-storage.js'` and `import { DEFAULT_SETTINGS } from '../js/settings.js'` (add the imports if absent). `schedulerSplitInput` is the object literal currently inlined in the test `two scheduler-split transfers preserve stage order, inventories, and thermal safety` (`tests/optimizer.test.js:1898`, literal at 1901–1956, which yields four `_thermalSplit` stages titled `safe stage 1/2` for Oxygen then Helium); move it into a top-level `const schedulerSplitInput = {…}` and make that existing test call `optimizeBlend(schedulerSplitInput)`.

- [ ] **Step 2:** FAIL (fields missing).
- [ ] **Step 3: Implement.** Before the `for (const { bank, addedMoles } of recipeBoosts)` loop (line 2228) add `let costOperationCounter = 0;`. Inside `for (const stage of transferStages)` after `stepNumber++;` add `const costOperationId = \`op-${++costOperationCounter}\`;`. In the `protocolSteps.push({...})` at 2298 add:

```js
        sourceConsumedMoles: stageAddedMoles,
        costOperation: isCompressorAir(bank) ? 'topUp' : (stage.type === 'decant' ? 'decant' : 'boost'),
        costOperationId,
```

- [ ] **Step 4:** PASS, plus the whole `npm test` (the new fields must not change any existing snapshot-style assertion; if a deep-equal test on a step breaks, update that test to ignore the three fields rather than the code).
- [ ] **Step 5:** commit `feat: stamp cost operation fields on optimizer steps (refs #3)`.

---

### Task 5: Step contract — Compare and What-if

**Files:**
- Modify: `js/compare-recipe.js` — `buildCompareProtocol` (transfer sites at 793, 837, 883/897, 912)
- Test: `tests/compare-recipe.test.js`, `tests/what-if-scenario.test.js`, `tests/thermodynamics.test.js`

**Interfaces:**
- Produces on every transfer step (`type` ∈ {`add`/compressor, `decant`, `equalize`, `boost`}): `sourceConsumedMoles`, `costOperation` ∈ {`topUp`,`decant`,`equalize`,`boost`}, `costOperationId` (`'op-N'`, a fresh ID per step, i.e. an equalize and the boost after it are two operations).

- [ ] **Step 1: Failing tests** (follow the existing fixtures in `tests/compare-recipe.test.js`)

```js
test('compare steps carry cost fields; compressor add is topUp', () => {
  const protocol = planCompare([compressorRow]);
  const byKind = Object.groupBy(protocol.protocolSteps.filter(s => s.costOperation), s => s.costOperation);
  assert.equal(byKind.topUp.length, 1);
  for (const step of protocol.protocolSteps.filter(s => s.costOperation)) {
    assert.ok(step.sourceConsumedMoles > 0);
    assert.match(step.costOperationId, /^op-\d+$/);
  }
});
test('equalize then boost are two operations whose moles sum to the required moles', () => {
  const protocol = planCompare([heliumRow]);
  const [equalize, boost] = protocol.protocolSteps.filter(s => s.costOperation);
  assert.equal(equalize.costOperation, 'equalize');
  assert.equal(boost.costOperation, 'boost');
  assert.notEqual(equalize.costOperationId, boost.costOperationId);
});
test('source consumed moles match the finite source pressure drop', () => {
  const protocol = planCompare([heliumRow]);
  const consumed = protocol.protocolSteps.filter(s => s.costOperation).reduce((sum, s) => sum + s.sourceConsumedMoles, 0);
  const bankStart = calcMolarDensity(200, 0, 100, physics.temperatureC, false) * 40;
  const bankEnd = calcMolarDensity(protocol.protocolSteps.at(-1).sourceEndPressureBar, 0, 100, physics.temperatureC, false) * 40;
  assert.ok(Math.abs(consumed - (bankStart - bankEnd)) < 1e-6);
});
```
Shared fixtures at the top of the new tests in `tests/compare-recipe.test.js` (which already defines `cylinder`, `physics` (ideal, 20 °C), `settings` and `banks` including `he-bank` at lines 13–53; add `import { calcMolarDensity } from '../js/physics.js'` if absent):

```js
const planCompare = rows => buildCompareProtocol(
  validateCompareRecipe(rows, { cylinder, banks, physics, settings }).normalizedRows,
  { cylinder, banks, physics, settings }
);
const compressorRow = { id: 'air', type: 'add', bankId: 'compressor-air', pressureAddedBar: 150, targetPressureBar: 200, pressureInputMode: 'target' };
const heliumRow = { id: 'add', type: 'add', bankId: 'he-bank', pressureAddedBar: 150, targetPressureBar: 200, pressureInputMode: 'target' };
```

`heliumRow` is the row of the existing test `plans decant equalize and boost stages without mutating bank inventory` (line 232), which already yields `['equalize', 'boost']`; `compressorRow` is the row of `accepts unlimited compressor Air…` (line 76). In `tests/thermodynamics.test.js` add, next to `compare simulation maps drain, decant, boost, and compressor transfer rates` (line 882), a test that calls `simulateCompareProtocol` with an `equalize` step and a compressor `add` step that each carry `costOperation`, `costOperationId` and `sourceConsumedMoles` (copy that test's `cylinder`/`physics`/`thermal`/`settings` arguments) and asserts the returned `protocolSteps` still carry the same three values after the `equalize`→`decant` and compressor→`boost` rewrites. In `tests/what-if-scenario.test.js` add, next to the test at line 90 that runs `buildCompareProtocol` then `simulateCompareProtocol` on a What-if scenario's rows, the same assertion on that simulation's `protocolSteps`.

- [ ] **Step 2:** FAIL.
- [ ] **Step 3: Implement.** Add near `plannedCompressorStep`:

```js
function withCostFields(step, costOperation, sourceConsumedMoles, costOperationId) {
  return { ...step, costOperation, sourceConsumedMoles, costOperationId };
}
```
At the top of `buildCompareProtocol` (after `const protocolSteps = [];`): `let costOperationCounter = 0; const nextCostOperationId = () => \`op-${++costOperationCounter}\`;`. Then at each site:

- compressor (line 793): `const step = withCostFields(plannedCompressorStep(row, receiverStart, receiverFinal), 'topUp', requiredMoles, nextCostOperationId());`
- decant (837): wrap `plannedTransferStep('decant', …)` with `'decant', requiredMoles`.
- equalize (883): wrap with `'equalize', equalizationMoles`.
- boost after equalize (897): wrap with `'boost', requiredMoles - equalizationMoles`.
- plain boost (912): wrap with `'boost', requiredMoles`.

- [ ] **Step 4:** PASS; `npm test` (fix any deep-equal tests the same way as Task 4).
- [ ] **Step 5:** commit `feat: stamp cost operation fields on Compare steps (refs #3)`.

---

### Task 6: Step contract — interim readings

**Files:**
- Modify: `js/plan-with-readings.js` — `applyReading` (suffix steps at line 264)
- Test: `tests/plan-with-readings.test.js`

**Interfaces:**
- Consumes: Task 4 fields on `optimizeBlend` steps.
- Produces: merged plans in which no two distinct operations share a `costOperationId`. Suffix IDs become `r<index>-op-N`; prefix IDs are unchanged. The re-solved previous step (line 220) keeps its `costOperationId` through its spread.

- [ ] **Step 1: Failing test** (in `tests/plan-with-readings.test.js`, using its existing `input`, `withReadings`, `scrapIndex`, `base`)

```js
test('merged plans keep one operation id per operation and consumed moles on every transfer', () => {
  const plan = planWithReadings(withReadings({ [scrapIndex]: { pressureBar: 54, temperatureC: 22 } }));
  const transfers = plan.protocolSteps.filter(s => s.costOperationId);
  const logical = transfers.filter(s => !/safe stage/.test(s.title ?? ''));
  assert.equal(new Set(logical.map(s => s.costOperationId)).size, logical.length);
  for (const step of transfers) assert.ok(Number.isFinite(step.sourceConsumedMoles));
});
test('a second chained reading never collides', () => {
  const first = { [scrapIndex]: { pressureBar: 54, temperatureC: 22 } };
  const afterFirst = planWithReadings(withReadings(first));
  const laterIndex = afterFirst.protocolSteps.at(-2)._measurementIndex;
  const laterPlanned = stepAt(afterFirst, laterIndex).thermal;
  const afterBoth = planWithReadings(withReadings({ ...first, [laterIndex]: {
    pressureBar: laterPlanned.plannedStartPressureBar - 2,
    temperatureC: laterPlanned.plannedStartTemperatureC + 0.3
  } }));
  const logical = afterBoth.protocolSteps.filter(s => s.costOperationId && !/safe stage/.test(s.title ?? ''));
  assert.equal(new Set(logical.map(s => s.costOperationId)).size, logical.length);
  for (const step of afterBoth.protocolSteps.filter(s => s.costOperationId)) {
    assert.ok(Number.isFinite(step.sourceConsumedMoles));
  }
});
```

- [ ] **Step 2:** FAIL (suffix IDs restart at `op-1` and collide with prefix IDs).
- [ ] **Step 3: Implement.** Change the suffix mapping at line 264–265:

```js
  const suffixSteps = suffix.logicalPlan.protocolSteps.slice(firstIndex)
    .map((candidate, offset) => renumberStep(candidate, index + offset))
    .map(step => step.costOperationId
      ? { ...step, costOperationId: `r${index}-${step.costOperationId}` }
      : step);
```

- [ ] **Step 4:** PASS; `npm test`.
- [ ] **Step 5:** commit `feat: namespace cost operation ids across interim readings (refs #3)`.

---

### Task 7: `cost.js`

**Files:**
- Create: `js/cost.js`, `tests/cost.test.js`

**Interfaces:**
- Consumes: step fields from Tasks 4–6; `bank.pricePerLitre`; `settings.costs`.
- Produces: `litresPerMole(temperatureC)`, `computeFillCost({ steps, banks, costs, temperatureC })` returning `{ gasLines, operationLines, gasTotal, operationTotal, total, unpricedSources, incomplete, configured }` exactly as in the spec.

- [ ] **Step 1: Write the failing test** `tests/cost.test.js`

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { computeFillCost, litresPerMole } from '../js/cost.js';

const costs = () => ({
  currencySymbol: '', pricePerLitre: { oxygen: 0, helium: 0 }, leftoverDiscountPercent: 0,
  operationPrices: { boostPerLitre: 0.002, decantPerLitre: 0.001, equalizePerLitre: 0.0005, topUpPerOperation: 5 }
});
const T = 20;
const perMole = litresPerMole(T);
const step = (over) => ({ sourceConsumedMoles: 1, costOperation: 'boost', costOperationId: 'op-1', sourceBankId: 'a', ...over });
const banks = [{ id: 'a', name: 'A', pricePerLitre: 0.01 }, { id: 'b', name: 'B' }];

test('gas lines use stored price and litres from consumed moles', () => {
  const cost = computeFillCost({ steps: [step({}), step({ costOperationId: 'op-2' })], banks, costs: costs(), temperatureC: T });
  const line = cost.gasLines.find(l => l.sourceBankId === 'a');
  assert.ok(Math.abs(line.litres - 2 * perMole) < 1e-9);
  assert.ok(Math.abs(line.cost - 2 * perMole * 0.01) < 1e-9);
});
test('per-litre operations sum all stages; splitting does not change cost', () => {
  const whole = computeFillCost({ steps: [step({ sourceConsumedMoles: 2 })], banks, costs: costs(), temperatureC: T });
  const split = computeFillCost({ steps: [step({}), step({})], banks, costs: costs(), temperatureC: T });
  assert.ok(Math.abs(whole.operationTotal - split.operationTotal) < 1e-12);
});
test('top-up fee is charged once per operation id and has no gas line', () => {
  const top = { costOperation: 'topUp', sourceBankId: 'compressor-air', costOperationId: 'op-1' };
  const cost = computeFillCost({ steps: [step(top), step({ ...top, sourceConsumedMoles: 3 })], banks, costs: costs(), temperatureC: T });
  assert.equal(cost.operationLines.find(l => l.operation === 'topUp').cost, 5);
  assert.equal(cost.gasLines.length, 0);
  const two = computeFillCost({ steps: [step(top), step({ ...top, costOperationId: 'op-2' })], banks, costs: costs(), temperatureC: T });
  assert.equal(two.operationLines.find(l => l.operation === 'topUp').cost, 10);
});
test('decant and equalize use their own rates', () => {
  const cost = computeFillCost({ steps: [step({ costOperation: 'decant' }), step({ costOperation: 'equalize', costOperationId: 'op-2' })], banks, costs: costs(), temperatureC: T });
  assert.ok(Math.abs(cost.operationLines.find(l => l.operation === 'decant').cost - perMole * 0.001) < 1e-9);
  assert.ok(Math.abs(cost.operationLines.find(l => l.operation === 'equalize').cost - perMole * 0.0005) < 1e-9);
});
test('unpriced and missing banks are flagged and the total is incomplete', () => {
  const cost = computeFillCost({ steps: [step({ sourceBankId: 'b' }), step({ sourceBankId: 'gone', costOperationId: 'op-2' })], banks, costs: costs(), temperatureC: T });
  assert.equal(cost.incomplete, true);
  assert.deepEqual(cost.unpricedSources.map(s => s.sourceBankId).sort(), ['b', 'gone']);
  assert.equal(cost.gasTotal, 0);
});
test('total is gas plus operations and configured is false with no prices', () => {
  const none = { ...costs(), operationPrices: { boostPerLitre: 0, decantPerLitre: 0, equalizePerLitre: 0, topUpPerOperation: 0 } };
  assert.equal(computeFillCost({ steps: [step({ sourceBankId: 'b' })], banks, costs: none, temperatureC: T }).configured, false);
  const cost = computeFillCost({ steps: [step({})], banks, costs: costs(), temperatureC: T });
  assert.ok(Math.abs(cost.total - (cost.gasTotal + cost.operationTotal)) < 1e-12);
  assert.equal(cost.configured, true);
});
test('steps without a cost operation are ignored', () => {
  const cost = computeFillCost({ steps: [{ type: 'drain' }, { type: 'wait' }], banks, costs: costs(), temperatureC: T });
  assert.equal(cost.total, 0);
});
```

- [ ] **Step 2:** `node --test tests/cost.test.js` → FAIL (module missing).
- [ ] **Step 3: Implement `js/cost.js`**

```js
import { GAS_CONSTANT } from './physics.js';

const PER_LITRE_RATE = { boost: 'boostPerLitre', decant: 'decantPerLitre', equalize: 'equalizePerLitre' };
const OPERATION_ORDER = ['boost', 'decant', 'equalize', 'topUp'];

export function litresPerMole(temperatureC) {
  return GAS_CONSTANT * (temperatureC + 273.15);
}

const hasPrice = value => Number.isFinite(value) && value >= 0;

function anySettingsPrice(costs) {
  return [
    costs?.pricePerLitre?.oxygen, costs?.pricePerLitre?.helium,
    ...Object.values(costs?.operationPrices ?? {})
  ].some(value => Number.isFinite(value) && value > 0);
}

export function computeFillCost({ steps = [], banks = [], costs, temperatureC }) {
  const perMole = litresPerMole(temperatureC);
  const bankById = new Map(banks.map(bank => [bank.id, bank]));
  const gas = new Map();
  const operationLitres = { boost: 0, decant: 0, equalize: 0, topUp: 0 };
  const topUpIds = new Set();

  for (const step of steps) {
    const operation = step?.costOperation;
    if (!operation) continue;
    const litres = (Number.isFinite(step.sourceConsumedMoles) ? step.sourceConsumedMoles : 0) * perMole;
    operationLitres[operation] += litres;
    if (operation === 'topUp') {
      topUpIds.add(step.costOperationId);
      continue;
    }
    const bank = bankById.get(step.sourceBankId);
    const line = gas.get(step.sourceBankId) ?? {
      sourceBankId: step.sourceBankId,
      name: bank?.name ?? step.sourceBankName ?? step.recipeGas ?? step.sourceBankId,
      litres: 0,
      unitPrice: hasPrice(bank?.pricePerLitre) ? bank.pricePerLitre : null,
      cost: 0
    };
    line.litres += litres;
    gas.set(step.sourceBankId, line);
  }

  const gasLines = [...gas.values()].map(line => ({
    ...line,
    cost: line.unitPrice === null ? 0 : line.litres * line.unitPrice
  }));
  const unpricedSources = gasLines.filter(line => line.unitPrice === null)
    .map(({ sourceBankId, name }) => ({ sourceBankId, name }));

  const prices = costs?.operationPrices ?? {};
  const operationLines = OPERATION_ORDER
    .filter(operation => operation === 'topUp' ? topUpIds.size > 0 : operationLitres[operation] > 0)
    .map(operation => {
      if (operation === 'topUp') {
        const rate = prices.topUpPerOperation ?? 0;
        return { operation, litres: operationLitres.topUp, count: topUpIds.size, rate, cost: topUpIds.size * rate };
      }
      const rate = prices[PER_LITRE_RATE[operation]] ?? 0;
      return { operation, litres: operationLitres[operation], count: null, rate, cost: operationLitres[operation] * rate };
    });

  const gasTotal = gasLines.reduce((sum, line) => sum + line.cost, 0);
  const operationTotal = operationLines.reduce((sum, line) => sum + line.cost, 0);
  return {
    gasLines,
    operationLines,
    gasTotal,
    operationTotal,
    total: gasTotal + operationTotal,
    unpricedSources,
    incomplete: unpricedSources.length > 0,
    configured: anySettingsPrice(costs) || gasLines.some(line => line.unitPrice !== null)
  };
}
```

- [ ] **Step 4:** PASS; `npm test`.
- [ ] **Step 5:** commit `feat: add pure fill-cost model (refs #3)`.

---

### Task 8: Bank pricing by recipe

**Files:**
- Create: `js/bank-pricing.js`, `tests/bank-pricing.test.js`, `scripts/bench-bank-pricing.mjs`

**Interfaces:**
- Consumes: `optimizeBlend` (result: `feasible`, `error`, `protocolSteps`, `maximumPressure`), `computeFillCost`, `litresPerMole`, `calcMolarDensity` from `js/physics.js`, Task 4 fields.
- Produces:

```js
export const VIRTUAL_BANK_VOLUME_L = 200;
export const VIRTUAL_BANK_PRESSURE_BAR = 200;
export const MAX_VIRTUAL_BANKS_PER_GAS = 6;
export function virtualBankCount({ needMoles, perBankMoles }) // → integer ≥ 0
export function priceBankByRecipe({ bank, costs, settings, physics })
// physics = { model, temperatureC }; settings = full settings object (booster, pressureLimitMode)
// → { ok: true, pricePerLitre, recipeCost, litres, operationCount }
//   | { ok: false, reason }
```

- [ ] **Step 1: First, pin down the real result contract with a throwaway check** (do not commit): run `node -e` against `optimizeBlend` with the spec's virtual setup for an empty 12 L tank to 150 bar EAN 32, print `feasible`, `error`, `Object.keys(result)`, and the step types. Confirm `feasible === true` for success and that an infeasible target (default equipment, 350 bar O₂) has `feasible === false` or only `maximumPressure` populated. Adjust `isUsableRecipe` below to what you observe.

- [ ] **Step 2: Failing tests** `tests/bank-pricing.test.js`

```js
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
const settingsWith = (mutate = () => {}) => { const s = copySettings(DEFAULT_SETTINGS); s.costs = costs(); mutate(s); return s; };
const bank = (over) => ({ id: 'real', name: 'Real', volumeL: 12, pressureBar: 150, oxygenPercent: 100, heliumPercent: 0, enabled: true, ...over });

test('virtualBankCount is 0 for an absent gas and 2x margin otherwise', () => {
  assert.equal(virtualBankCount({ needMoles: 0, perBankMoles: 1000 }), 0);
  assert.equal(virtualBankCount({ needMoles: 100, perBankMoles: 1000 }), 1);
  assert.equal(virtualBankCount({ needMoles: 1000, perBankMoles: 1000 }), 2);
  assert.equal(virtualBankCount({ needMoles: 1001, perBankMoles: 1000 }), 3);
});
test('pure O2 bank price is the O2 price plus recipe operation rates, per litre', () => {
  const result = priceBankByRecipe({ bank: bank(), costs: costs(), settings: settingsWith(), physics });
  assert.equal(result.ok, true);
  assert.ok(result.pricePerLitre > 0.01 && result.pricePerLitre < 0.01 + 0.002 + 1e-9);
});
test('discount applies once and 100 percent gives zero', () => {
  const base = priceBankByRecipe({ bank: bank(), costs: costs(), settings: settingsWith(), physics });
  const half = priceBankByRecipe({ bank: bank(), costs: { ...costs(), leftoverDiscountPercent: 50 }, settings: settingsWith(), physics });
  assert.ok(Math.abs(half.pricePerLitre - base.pricePerLitre / 2) < 1e-12);
  const free = priceBankByRecipe({ bank: bank(), costs: { ...costs(), leftoverDiscountPercent: 100 }, settings: settingsWith(), physics });
  assert.equal(free.pricePerLitre, 0);
});
test('EAN32 within the compressor ceiling combines one top-up fee with oxygen', () => {
  const result = priceBankByRecipe({ bank: bank({ oxygenPercent: 32, pressureBar: 150 }), costs: costs(), settings: settingsWith(), physics });
  assert.equal(result.ok, true);
  assert.equal(result.operationCount.topUp, 1);
  assert.ok(result.recipeCost >= 5);
});
test('a bank below 10 bar and a hypoxic mix fail without a price', () => {
  assert.equal(priceBankByRecipe({ bank: bank({ pressureBar: 5 }), costs: costs(), settings: settingsWith(), physics }).ok, false);
  assert.equal(priceBankByRecipe({ bank: bank({ oxygenPercent: 10, heliumPercent: 0 }), costs: costs(), settings: settingsWith(), physics }).ok, false);
});
test('all-zero prices report that no prices are configured', () => {
  const zero = { currencySymbol: '', pricePerLitre: { oxygen: 0, helium: 0 }, leftoverDiscountPercent: 0,
    operationPrices: { boostPerLitre: 0, decantPerLitre: 0, equalizePerLitre: 0, topUpPerOperation: 0 } };
  const result = priceBankByRecipe({ bank: bank(), costs: zero, settings: settingsWith(), physics });
  assert.equal(result.ok, false);
  assert.match(result.reason, /no prices/i);
});
test('real banks and settings are not mutated', () => {
  const b = bank(); const s = settingsWith(); const before = JSON.stringify([b, s]);
  priceBankByRecipe({ bank: b, costs: costs(), settings: s, physics });
  assert.equal(JSON.stringify([b, s]), before);
});
for (const [label, composition] of [['O2', { oxygenPercent: 100, heliumPercent: 0 }], ['He', { oxygenPercent: 0, heliumPercent: 100 }]]) {
  test(`${label} 200 L at 350 bar: outcome under default equipment is established, and prices with a 350 bar booster limit`, () => {
    const big = bank({ ...composition, volumeL: 200, pressureBar: 350 });
    const defaults = priceBankByRecipe({ bank: big, costs: costs(), settings: settingsWith(), physics });
    assert.equal(defaults.ok, false);
    assert.match(defaults.reason, /Maximum safe pressure/);
    if (label === 'He') assert.match(defaults.reason, /Booster output cannot exceed 200/);
    if (label === 'O2') assert.match(defaults.reason, /Unsafe 100% O₂ transfer/);
    const raised = priceBankByRecipe({ bank: big, costs: costs(), settings: settingsWith(s => { s.booster.maxBoosterOutputPressureBar = 350; }), physics });
    assert.equal(raised.ok, true, raised.reason);
    assert.ok(raised.exhaustedSources < raised.sourceCount, 'a recipe may empty some virtual banks in turn, but supply must not be the binding limit');
  });
}
```
Observed with the real optimizer on 4 virtual 200 L, 200 bar banks, an empty 200 L tank and a 350 bar target: default equipment fails for He (`Booster output cannot exceed 200.0 bar. Maximum safe pressure … is 200.0 bar`) and for O₂ (`Unsafe 100% O₂ transfer … exceeding the 4:1 limit. Maximum safe pressure … is 230.0 bar`); with `maxBoosterOutputPressureBar = 350` both are feasible, and the He recipe empties one of the four virtual banks while using the others. The optimizer ran in milliseconds per call.

- [ ] **Step 3:** FAIL (module missing).
- [ ] **Step 4: Implement `js/bank-pricing.js`**

```js
import { optimizeBlend } from './optimizer.js';
import { computeFillCost, litresPerMole } from './cost.js';
import { calcMolarDensity } from './physics.js';

export const VIRTUAL_BANK_VOLUME_L = 200;
export const VIRTUAL_BANK_PRESSURE_BAR = 200;
export const MAX_VIRTUAL_BANKS_PER_GAS = 6;
const DEFAULT_MINIMUM_SOURCE_PRESSURE_BAR = 20;
const SAFETY_MARGIN = 2;
const MIN_TARGET_PRESSURE_BAR = 10;

export function virtualBankCount({ needMoles, perBankMoles }) {
  if (!(needMoles > 1e-12)) return 0;
  return Math.ceil(SAFETY_MARGIN * needMoles / perBankMoles);
}

const anyPrice = costs => [
  costs.pricePerLitre.oxygen, costs.pricePerLitre.helium, ...Object.values(costs.operationPrices)
].some(value => value > 0);

function virtualBanks(gasId, composition, count, costs, price) {
  return Array.from({ length: count }, (_, index) => ({
    id: `virtual-${gasId}-${index + 1}`,
    name: `Virtual ${gasId} ${index + 1}`,
    volumeL: VIRTUAL_BANK_VOLUME_L,
    pressureBar: VIRTUAL_BANK_PRESSURE_BAR,
    enabled: true,
    pricePerLitre: price,
    ...composition
  }));
}

export function priceBankByRecipe({ bank, costs, settings, physics }) {
  if (!anyPrice(costs)) return { ok: false, reason: 'No prices are configured in Settings → Costs.' };
  if (bank.pressureBar < MIN_TARGET_PRESSURE_BAR) {
    return { ok: false, reason: `Banks below ${MIN_TARGET_PRESSURE_BAR} bar cannot be priced by recipe. Enter a price manually.` };
  }
  const useVdw = physics.model !== 'ideal';
  const temperatureC = physics.temperatureC;
  const targetMolesPerL = calcMolarDensity(bank.pressureBar, bank.oxygenPercent, bank.heliumPercent, temperatureC, useVdw);
  const totalMoles = targetMolesPerL * bank.volumeL;
  const minimumPressureBar = Number.isFinite(settings?.booster?.minimumSourcePressureBar)
    ? settings.booster.minimumSourcePressureBar : DEFAULT_MINIMUM_SOURCE_PRESSURE_BAR;

  const sources = [];
  for (const [gasId, composition, fraction, price] of [
    ['oxygen', { oxygenPercent: 100, heliumPercent: 0 }, bank.oxygenPercent / 100, costs.pricePerLitre.oxygen],
    ['helium', { oxygenPercent: 0, heliumPercent: 100 }, bank.heliumPercent / 100, costs.pricePerLitre.helium]
  ]) {
    const perBankMoles = (
      calcMolarDensity(VIRTUAL_BANK_PRESSURE_BAR, composition.oxygenPercent, composition.heliumPercent, temperatureC, useVdw)
      - calcMolarDensity(minimumPressureBar, composition.oxygenPercent, composition.heliumPercent, temperatureC, useVdw)
    ) * VIRTUAL_BANK_VOLUME_L;
    const count = virtualBankCount({ needMoles: totalMoles * fraction, perBankMoles });
    if (count > MAX_VIRTUAL_BANKS_PER_GAS) {
      return { ok: false, reason: `This bank needs more than ${MAX_VIRTUAL_BANKS_PER_GAS} virtual ${gasId} sources and cannot be priced by recipe. Enter a price manually.` };
    }
    sources.push(...virtualBanks(gasId, composition, count, costs, price));
  }

  const result = optimizeBlend({
    cylinder: {
      volumeL: bank.volumeL,
      initialPressureBar: 0,
      initialOxygenPercent: 21,
      initialHeliumPercent: 0,
      targetPressureBar: bank.pressureBar,
      targetOxygenPercent: bank.oxygenPercent,
      targetHeliumPercent: bank.heliumPercent,
      workingPressureBar: bank.pressureBar
    },
    physics: { model: physics.model, temperatureC },
    banks: sources,
    settings
  });
  if (result.feasible !== true || !Array.isArray(result.protocolSteps)) {
    return { ok: false, reason: result.error ?? 'The optimizer cannot build this mix from pure gases.' };
  }

  const cost = computeFillCost({ steps: result.protocolSteps, banks: sources, costs, temperatureC });
  const litres = totalMoles * litresPerMole(temperatureC);
  const exhaustedSources = new Set(result.protocolSteps.filter(step => step.sourceExhausted).map(step => step.sourceBankId)).size;
  const recipeCost = cost.total;
  return {
    ok: true,
    pricePerLitre: recipeCost * (1 - costs.leftoverDiscountPercent / 100) / litres,
    recipeCost,
    litres,
    exhaustedSources,
    sourceCount: sources.length,
    operationCount: Object.fromEntries(cost.operationLines.map(line => [line.operation, line.count ?? 1]))
  };
}
```
`operationCount.topUp` is the distinct-operation count; per-litre operations report 1 per line, which is only a presence flag. If a test needs the stage count, read it from `cost.operationLines`.

- [ ] **Step 5: Benchmark script** `scripts/bench-bank-pricing.mjs`: load default settings with zero→example prices, loop over `DEFAULT_BANKS` plus the worst bank (200 L, 350 bar O₂ and He, `maxBoosterOutputPressureBar = 350`), print milliseconds per call with `performance.now()`. Run `node scripts/bench-bank-pricing.mjs`; record the numbers.
  - Targets from the spec: ≤ 2000 ms per default bank, ≤ 10000 ms for the worst bank. **If a target is missed, stop and report the measured times to the user; do not raise the cap or loosen the target.**

- [ ] **Step 6:** `npm test` green; commit `feat: add recipe-based bank pricing (refs #3)`.

---

### Task 9: Settings → Costs UI

**Files:**
- Modify: `index.html` (category rail at lines 73–79; add `settings-pane-costs` beside the other panes), `js/main.js` (`setSettingsCategory` list at 309), `js/ui/settings-dialog.js`
- Test: `tests/settings-dialog.test.js`, `tests/browser/settings.spec.js`

**Interfaces:**
- Consumes: `settings.costs`; `convertToDisplay/convertFromDisplay('pricePerVolumeL')`.
- Produces: pane `settings-pane-costs` with inputs `settings-cost-currency`, `settings-cost-price-oxygen`, `settings-cost-price-helium`, `settings-cost-discount`, `settings-cost-boost`, `settings-cost-decant`, `settings-cost-equalize`, `settings-cost-topup`.

- [ ] **Step 1:** Read how the General pane edits `interimPressureTolerancePercent` (`grep -n interimPressureTolerancePercent js/main.js js/ui/settings-dialog.js index.html`). The Costs inputs follow that exact draft/save/cancel path; per-litre inputs show `convertToDisplay(value, 'pricePerVolumeL', units)` with the unit label next to them and write back `convertFromDisplay(...)`; the top-up input is labelled “Top-up, per operation (includes compressor air)” and is not converted. Draft errors reuse `validateSettings`’ messages.
- [ ] **Step 2: Failing test** in `tests/settings-dialog.test.js` (mirror its existing DOM harness): rendering with `units: 'imperial'` shows `/cu ft` and a converted value; reading the pane back into a draft yields stored per-litre values; the top-up value is unchanged by units.
- [ ] **Step 3:** Implement the pane markup (one `<button data-settings-category="costs" ... aria-controls="settings-pane-costs">Costs</button>` copied from the Equipment button, and a `<div id="settings-pane-costs" class="hidden ...">` copied from the General pane structure), add `'costs'` to the `categories` array in `setSettingsCategory`, and add render/read functions in `js/ui/settings-dialog.js`.
- [ ] **Step 4:** `npm test`; Playwright check in `tests/browser/settings.spec.js` (follow its existing Save/reload case): enter prices in Costs, Save, reload, values persist; Cancel discards.
- [ ] **Step 5:** `npm run test:ui -- tests/browser/settings.spec.js --project=desktop`; commit `feat: add Settings costs category (refs #3)`.

---

### Task 10: Inventory price input and Calculate / Apply

**Files:**
- Modify: `js/ui/supply-banks.js` (`renderSupplyBanks` at 75), `js/main.js` (delegated actions near `case 'select-settings-category'` at 2185; bank edit path — find with `grep -n "add-bank\|updateBankField" js/main.js`)
- Test: `tests/supply-banks-ui.test.js`, `tests/browser/inventory.spec.js`

**Interfaces:**
- Consumes: `priceBankByRecipe`, `bank.pricePerLitre`, `state.settings`, the current ambient `readInput().physics`.
- Produces: per bank row a price input (`data-bank-field="pricePerLitre"`, displayed in `pricePerVolumeL`), a button `data-action="calculate-bank-price"`, and an `aria-live` suggestion area with `data-action="apply-bank-price"`.

- [ ] **Step 1: Failing UI test** in `tests/supply-banks-ui.test.js` (mirror its harness): rows render the price input and Calculate button; a bank with a price shows it converted for imperial units; a bank without a price shows an empty input with placeholder “Not set”; the suggestion note renders text from a `suggestion` prop and the button reads **Replace** when a price already exists.
- [ ] **Step 2:** Extend `renderSupplyBanks(banks, gasPresets, units, { suggestions } = {})` with the price column and suggestion area. Typing a price follows the existing bank-field edit path (validate with `validateSupplyBankInput`, persist, recalculate); an empty input stores `null`.
- [ ] **Step 3:** In `main.js` add:

```js
case 'calculate-bank-price': calculateBankPrice(actionElement.dataset.bankId); break;
case 'apply-bank-price': applyBankPrice(actionElement.dataset.bankId); break;
```
`calculateBankPrice(bankId)`: find the bank; set `state.bankPriceStatus[bankId] = 'calculating'` and re-render supply banks (button disabled, “Calculating…”); then `setTimeout(() => { … }, 0)` runs `priceBankByRecipe({ bank, costs: state.settings.costs, settings: state.settings, physics: readInput().physics })`, stores `state.bankSuggestions[bankId]` (success text or failure reason), and re-renders. Nothing is persisted. The `setTimeout` only lets the status paint before the synchronous call; it does not cancel anything. `applyBankPrice(bankId)` writes `suggestion.pricePerLitre` through the same edit path as typing, clears the suggestion, and recalculates. Any edit to a bank discards its suggestion.
- [ ] **Step 4:** Add browser tests in `tests/browser/inventory.spec.js` that assert behavior, not module calls: after a bank has a stored price, changing a Settings price and saving leaves the stored bank price unchanged; pressing Calculate leaves the price field and stored value unchanged and shows a suggestion; Apply stores the suggested price and it survives reload; a bank that already had a price shows **Replace** instead of **Apply**; editing the bank discards the suggestion; a bank below 10 bar shows the failure reason and keeps its price.
- [ ] **Step 5:** `npm test`, `npm run test:ui -- tests/browser/inventory.spec.js --project=desktop`; commit `feat: add bank price input and on-demand recipe suggestion (refs #3)`.

---

### Task 11: Costs section in results

**Files:**
- Create: `js/ui/cost-summary.js`, `tests/cost-summary.test.js`
- Modify: `index.html` (inside `#tab-pane-summary`, after the “Blend trajectory” table, line ~650), `js/main.js` (`recalculate` at 1576, `runCompare` at 1553, What-if result assembly — find with `grep -n "whatIfScenario.result =" js/main.js`), `js/ui/results.js` (`renderResults` at 915 calls the new renderer)
- Test: `tests/browser/results.spec.js`, `tests/browser/what-if.spec.js`

**Interfaces:**
- Consumes: `computeFillCost`, `result.cost`.
- Produces: `renderCostSummary(cost, { root, units, currencySymbol })`; markup `[data-result-key="cost-summary"]` with tables captioned “Gas cost” and “Operation cost”.

- [ ] **Step 1: Failing tests** `tests/cost-summary.test.js` (mirror a small existing renderer test such as `tests/water-pressure.test.js` for the DOM harness):
  - priced result renders a gas row with name, litres, price per litre (unit-converted) and cost, an operations row, and a total with the currency prefix (`'€12.40'`; `'CHF'` symbol gives `'CHF 12.40'`);
  - `incomplete` renders “incomplete” plus the unpriced names and a “no price set” gas row;
  - top-up renders `count × fee` and “includes compressor air”, and compressor air never appears as a gas row;
  - `configured: false` renders the “Set prices in Settings → Costs” prompt; a missing cost (invalid/no plan) renders the empty state.
- [ ] **Step 2:** Implement `renderCostSummary` (build DOM with `textContent`, never `innerHTML`, as the other renderers do); amounts via `toFixed(2)`; prices per litre via `convertToDisplay(...,'pricePerVolumeL', units).toFixed(4)` with `unitLabel`.
- [ ] **Step 3:** Markup in `index.html`: a `<section data-result-key="cost-summary" aria-label="Costs">` with an `h3`, a status paragraph, and two empty tables, using `data-result-key` hooks (not ids) so both result hosts get their own copy.
- [ ] **Step 4: Wire the three flows.** Add in `main.js`:

```js
function attachCost(result, input, steps) {
  return {
    ...result,
    cost: computeFillCost({
      steps: steps ?? [],
      banks: input.banks ?? [],
      costs: state.settings.costs,
      temperatureC: input.physics.temperatureC
    })
  };
}
```
  - Optimize: in `recalculate`, `resultWithWarnings` gets `cost` from `result.protocolSteps` only when `result.feasible !== false`.
  - Compare: in `runCompare`, `state.lastCompareResult.cost` from `protocol.protocolSteps` after simulation (use the simulated steps in `{ ...protocol, ...simulation }.protocolSteps`).
  - What-if: at the place the terminal result is stored, attach `cost` from its simulated `protocolSteps`, using the scenario's own banks (the same ones used for the run).
  `renderResults` calls `renderCostSummary(result.cost ?? null, { root, units: settings.units, currencySymbol })` inside its existing tab-pane update. Compare's retained last-successful result and What-if's stale label need no extra code.
- [ ] **Step 5: Browser tests.** In `tests/browser/results.spec.js` set a Settings price, run the default Optimize recipe, open Tank summary, assert the gas table, operations table and total render and the total equals the sum of displayed per-line costs within one cent; with an unpriced bank assert the “incomplete” label; switch to Compare and What-if and assert the section appears in each (follow `tests/browser/what-if.spec.js` for its run helper); unit switch to imperial shows `/cu ft`.
- [ ] **Step 6:** `npm test`; `npm run test:ui:results` and `npm run test:ui:blending` (desktop); commit `feat: show fill costs in the Tank summary (refs #3)`.

---

### Task 12: Docs, benchmark record, baselines, final verification

**Files:**
- Modify: `docs/architecture.md`, `docs/optimizer.md`, `docs/development.md`, `docs/UI.md`, `README.md` if it lists features
- Possibly modify: `tests/browser/screenshots.spec.js-snapshots/*` (only after reading `docs/ci-reproduction.md`)

- [ ] **Step 1: Docs.** `docs/architecture.md`: add `js/cost.js`, `js/bank-pricing.js`, `js/ui/cost-summary.js`, the step contract, and the Costs settings/Inventory behavior to the module list and data flow. `docs/optimizer.md`: document the three step fields and the `costOperationId` rules. `docs/development.md`: add Costs smoke checks (Settings → Costs persists; Calculate price suggests without writing; Apply stores; Replace on existing price; unpriced bank gives an incomplete total; Costs section in Optimize, Compare and What-if; unit switch) and the recorded benchmark numbers from Task 8. `docs/UI.md`: the Costs section and Inventory price controls.
- [ ] **Step 2: Full verification.**
  - `npm test` (all green).
  - `npm run test:ui` (desktop, tablet, mobile). Screenshot failures: read `docs/ci-reproduction.md` first. Update a baseline only if the diff is the intended Tank summary/Inventory/Settings change, never raise `maxDiffPixelRatio`, and report any updated baseline to the user. Do not claim GitHub Actions passed from a local or Docker run.
  - Manual smoke: serve with `python3 -m http.server 8000`, set prices, run the default recipe, open Tank summary; press Calculate price on the default Oxygen bank and confirm the suggestion appears with no change until Apply; confirm no console errors.
- [ ] **Step 3:** commit `docs: document fill cost calculator (refs #3)`. Do not push to `origin/master`.

---

## Self-Review

- **Spec coverage:** scope across three flows (Tasks 4–6, 11); settings and unit conversion (1–2, 9); stored bank price (3, 10); `costOperationId` contract and thermal-split sharing (4, 6, tests in 4–6); readings namespace (6); cost model with unpriced/incomplete (7); top-up flat fee with included air and no gas line (7, 11); recipe pricing with virtual banks, empty tank, no thermal block, discount-once, apply-not-write (8, 10); source-count function and cap 6 (8); benchmark targets with stop-and-report (8); default-vs-raised booster limit for O₂ and He with He established by test (8); vented value dropped (no task, none present); docs, baselines rules (12).
- **Placeholders:** none remain in the test code; Tasks 9–11 specify UI by exact hooks, ids and behavior rather than full markup, and their implementers read the adjacent markup named in each step.
- **Type consistency:** `costOperation` values `boost|decant|equalize|topUp`, `costOperationId`, `sourceConsumedMoles`, `pricePerLitre`, `computeFillCost`, `priceBankByRecipe`, `virtualBankCount`, `litresPerMole` are used identically across tasks. `operationCount.topUp` in Task 8 tests is produced by the `operationLines` count in the same task.
- **Settled by probe:** the He and O₂ default-equipment outcomes in Task 8 are recorded from real optimizer runs; no spec follow-up is pending.
