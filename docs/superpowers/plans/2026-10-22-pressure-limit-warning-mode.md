# Pressure-Limit Warning Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a persisted Hard stop/Warning cylinder-pressure policy, with an exact-phrase unlock, across calculator/Optimize and Compare.

**Architecture:** Persist one global `pressureLimitMode` plus a `pressureWarningUnlocked` boolean. Share cylinder-limit calculation and exceedance classification between validation, thermal scheduling, Compare, and warning reporting; keep independent equipment and supported-input constraints unchanged. Present an accessible mode notice and actual exceedances in calculator and Compare results.

**Tech Stack:** Browser JavaScript ES modules, Node `node:test`, Playwright browser tests, browser `localStorage`; no new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-22-pressure-limit-warning-mode-design.md`

## Global Constraints

- One policy applies to calculator/Optimize and Compare; there are no per-flow modes.
- Warning mode bypasses only cylinder working-pressure and hot-overfill enforcement.
- Existing per-field pressure bounds (maximum 350 bar; calculator target minimum 10 bar) and independent compressor/booster equipment limits remain enforced.
- Hard stop preserves the current behavior, including automatic Optimize waits/splits when possible.
- At ambient or settled/target-temperature states, the ceiling is working pressure.
- Only above-ambient transient states may use `workingPressureBar × (1 + hotOverfillPercent / 100)`.
- An above-ambient transient pressure between working pressure and its hot-overfill ceiling is permitted and is not an exceedance.
- Only the boolean unlock state is persisted; the phrase is not.
- The confirmation is a user-intent gate in local browser settings, not an authorization or tamper-resistance mechanism.
- Follow TDD: write each regression test, run it failing, implement the smallest fix, then run it passing.

---

## File map

- Modify `js/settings.js`: defaults, legacy normalization, copy, validation, and persistence for the mode and unlock flag.
- Modify `index.html`, `js/ui/settings-dialog.js`, and `js/main.js`: General controls, shared case-insensitive phrase matching with apostrophe/backtick/double-quote variants, draft/save/cancel behavior, and policy propagation.
- Create `js/pressure-limits.js`: pure applicable-ceiling, exceedance, and warning aggregation functions.
- Create `tests/pressure-limits.test.js`: threshold, transient-state, and warning aggregation boundaries.
- Modify `js/input-validation.js` and `tests/input-validation.test.js`: mode-aware calculator pressure validation, with existing domain bounds retained.
- Modify `js/optimizer.js` and `tests/optimizer.test.js`: mode-aware thermal safety scheduling, preserving equipment constraints and current Hard stop behavior.
- Modify `js/compare-recipe.js` and `tests/compare-recipe.test.js`: mode-aware Add and initial pressure checks in both validation and protocol construction.
- Modify `js/ui/results.js`, `js/main.js`, and `tests/results.test.js`: active-policy notice and actual over-limit reporting for Optimize and What-if results.
- Modify `tests/browser/settings.spec.js` and `tests/browser/blending.spec.js`: exercise the actual unlock, persistence, Optimize, and What-if flows.
- Modify `docs/UI.md`, `docs/optimizer.md`, and `docs/architecture.md`: document the setting and its exact scope.

## Shared interfaces

`js/settings.js` adds these persisted fields:

```js
pressureLimitMode: 'hard-stop' | 'warning';
pressureWarningUnlocked: boolean;
```

Both default to the safe state: `'hard-stop'` and `false`. Legacy records missing either field receive those defaults. Warning with `pressureWarningUnlocked !== true` is invalid.

`js/pressure-limits.js` exports these functions:

```js
getCylinderPressureLimit({
  cylinder,
  isTransientHot = false
}) -> null | { kind: 'working-pressure' | 'hot-overfill', limitBar }

getCylinderPressureExceedance({
  pressureBar,
  cylinder,
  isTransientHot = false,
  toleranceBar = 1e-9
}) -> null | { kind, pressureBar, limitBar }

collectCylinderPressureWarnings({
  cylinder,
  observations,
  toleranceBar = 1e-9
}) -> Array<{
  kind: 'working-pressure' | 'hot-overfill',
  pressureBar: number,
  limitBar: number,
  source: string,
  stepIdentifier: string | null
}>
```

Each observation is `{ pressureBar, isTransientHot, source, stepIdentifier? }`. The collector keeps only the maximum exceedance for each source/step/limit kind so minute-resolution samples do not create duplicate notices. Callers set `isTransientHot` only for actual above-ambient transient measurements or modeled transfer/cooling states; target and settled projections always pass `false`, even when their temperature is above ambient.

The shared default tolerance is 1e-9 bar, matching the existing thermal-safety tolerance. Calculator input validation passes `toleranceBar: 0` to preserve its existing strict `pressure > limit` behavior.

`validateCalculatorInputs` keeps its current three arguments and gains an optional fourth argument:

```js
validateCalculatorInputs(cylinder, physics, thermal, {
  pressureLimitMode = 'hard-stop'
} = {})
```

`optimizeBlend` and Compare functions continue to read `pressureLimitMode` from their existing `settings` input. `pressureLimitWarnings` uses the event shape above and is attached to result objects before rendering.

---

### Task 1: Persist the mode and one-time unlock

**Files:**
- Modify: `js/settings.js`
- Test: `tests/settings.test.js`

**Interfaces:**
- Produces: `DEFAULT_SETTINGS.pressureLimitMode`, `DEFAULT_SETTINGS.pressureWarningUnlocked`, normalized equivalents from `loadSettings`, and enum/unlock checks from `validateSettings`.
- Existing callers continue to receive independent settings copies; no caller needs to supply these fields for Hard stop.

- [ ] **Step 1: Write failing settings tests**

Add a legacy migration test based on `copySettings(DEFAULT_SETTINGS)` with the two new fields deleted before JSON serialization. Add default, round-trip, and unlock-invariant assertions:

```js
test('pressure limit mode defaults safely and validates the warning unlock', () => {
assert.equal(DEFAULT_SETTINGS.pressureLimitMode, 'hard-stop');
assert.equal(DEFAULT_SETTINGS.pressureWarningUnlocked, false);

const legacy = copySettings(DEFAULT_SETTINGS);
delete legacy.pressureLimitMode;
delete legacy.pressureWarningUnlocked;
const storage = memoryStorage([[
  'simplex-gas-remixer-settings', JSON.stringify(legacy)
]]);
const loaded = loadSettings(storage);
assert.equal(loaded.pressureLimitMode, 'hard-stop');
assert.equal(loaded.pressureWarningUnlocked, false);

const lockedWarning = {
  ...DEFAULT_SETTINGS,
  pressureLimitMode: 'warning',
  pressureWarningUnlocked: false
};
assert.match(validateSettings(lockedWarning).join(' '), /unlock/i);
assert.match(validateSettings({
  ...DEFAULT_SETTINGS, pressureLimitMode: 'ignore'
}).join(' '), /pressure.*mode/i);
assert.match(validateSettings({
  ...DEFAULT_SETTINGS, pressureWarningUnlocked: 'true'
}).join(' '), /unlock.*boolean/i);
const savedStorage = memoryStorage();
saveSettings({
  ...DEFAULT_SETTINGS,
  pressureLimitMode: 'warning',
  pressureWarningUnlocked: true
}, savedStorage);
assert.equal(loadSettings(savedStorage).pressureLimitMode, 'warning');
assert.equal(loadSettings(savedStorage).pressureWarningUnlocked, true);

for (const invalid of [
  { ...DEFAULT_SETTINGS, pressureLimitMode: 'ignore' },
  { ...DEFAULT_SETTINGS, pressureLimitMode: 'warning', pressureWarningUnlocked: false }
]) {
  const invalidStorage = memoryStorage([[
    'simplex-gas-remixer-settings', JSON.stringify(invalid)
  ]]);
  assert.deepEqual(loadSettings(invalidStorage), DEFAULT_SETTINGS);
}
});
```

The migration and validation cases above cover missing fields, invalid enum values, and a warning mode saved without its permanent unlock flag.

- [ ] **Step 2: Run the settings tests and confirm the new assertions fail**

Run:

```bash
node --test tests/settings.test.js
```

Expected: new assertions fail because the fields are not yet in defaults, normalization, or validation.

- [ ] **Step 3: Implement settings normalization and validation**

Add the fields to `DEFAULT_SETTINGS` and `copySettings`. Add a normalizer that defaults only missing fields, preserving explicitly invalid values so `validateSettings` rejects them. Add validation for the two legal mode strings, boolean unlock type, and the invariant that Warning requires a saved unlock. Apply the normalizer in both `loadSettings` and `saveSettings`.

```js
function addDefaultPressureLimitPolicy(settings) {
  return {
    ...settings,
    pressureLimitMode: Object.hasOwn(settings ?? {}, 'pressureLimitMode')
      ? settings.pressureLimitMode
      : DEFAULT_SETTINGS.pressureLimitMode,
    pressureWarningUnlocked: Object.hasOwn(settings ?? {}, 'pressureWarningUnlocked')
      ? settings.pressureWarningUnlocked
      : DEFAULT_SETTINGS.pressureWarningUnlocked
  };
}
```

Place this normalizer in the existing load/save normalization chain. Keep Hard stop with `pressureWarningUnlocked: true` valid so users can permanently unlock, switch back to Hard stop, and later select Warning without retyping.

- [ ] **Step 4: Run the settings tests and verify migration and validation**

Run:

```bash
node --test tests/settings.test.js
```

Expected: PASS, including legacy records defaulting to Hard stop/locked and Warning-without-unlock being rejected.

- [ ] **Step 5: Commit the settings model**

```bash
git add js/settings.js tests/settings.test.js
git commit -m "feat: persist pressure-limit warning mode"
```

---

### Task 2: Add shared cylinder-limit classification

**Files:**
- Create: `js/pressure-limits.js`
- Create: `tests/pressure-limits.test.js`

**Interfaces:**
- Consumes: the cylinder object's existing `workingPressureBar` and optional `hotOverfillPercent`.
- Produces: `getCylinderPressureLimit`, `getCylinderPressureExceedance`, and `collectCylinderPressureWarnings` with the contracts above.

- [ ] **Step 1: Write failing boundary and aggregation tests**

Test ambient/settled working-pressure limits, transient hot-overfill limits, exact-limit equality, and aggregation by source/step/kind. Use a 100-bar cylinder with 2% hot overfill. Do not statically import the new module: the loader below catches only a missing `pressure-limits.js`, so RED is an assertion mismatch rather than an uncaught module-load error.

```js
async function pressureLimitApiForRedTest() {
  try {
    return await import('../js/pressure-limits.js');
  } catch (error) {
    if (error.code === 'ERR_MODULE_NOT_FOUND'
      && error.message.includes('pressure-limits.js')) return null;
    throw error;
  }
}

test('classifies working and transient hot-overfill boundaries', async () => {
  const helpers = await pressureLimitApiForRedTest();
  const cylinder = { workingPressureBar: 100, hotOverfillPercent: 2 };
  assert.deepEqual(helpers?.getCylinderPressureLimit?.({ cylinder }), {
    kind: 'working-pressure', limitBar: 100
  });
  assert.deepEqual(helpers?.getCylinderPressureLimit?.({ cylinder, isTransientHot: true }), {
    kind: 'hot-overfill', limitBar: 102
  });
  assert.equal(helpers?.getCylinderPressureExceedance?.({
    pressureBar: 102, cylinder, isTransientHot: true
  }), null);
  assert.deepEqual(helpers?.getCylinderPressureExceedance?.({
    pressureBar: 102.1, cylinder, isTransientHot: true
  }), { kind: 'hot-overfill', pressureBar: 102.1, limitBar: 102 });
  assert.deepEqual(helpers?.getCylinderPressureExceedance?.({
    pressureBar: 100.1, cylinder
  }), { kind: 'working-pressure', pressureBar: 100.1, limitBar: 100 });
});

test('aggregates the highest limit exceedance per source and step', async () => {
  const helpers = await pressureLimitApiForRedTest();
  const cylinder = { workingPressureBar: 100, hotOverfillPercent: 2 };
  const warnings = helpers?.collectCylinderPressureWarnings?.({
    cylinder,
    observations: [
      { pressureBar: 102.1, isTransientHot: true, source: 'transfer', stepIdentifier: 'Transfer 2' },
      { pressureBar: 103, isTransientHot: true, source: 'transfer', stepIdentifier: 'Transfer 2' },
      { pressureBar: 100.1, isTransientHot: false, source: 'settled', stepIdentifier: null }
    ]
  });
assert.equal(warnings?.length, 2);
assert.ok(warnings.some(warning => (
  warning.kind === 'hot-overfill'
    && warning.pressureBar === 103
    && warning.limitBar === 102
    && warning.source === 'transfer'
    && warning.stepIdentifier === 'Transfer 2'
)));
assert.ok(warnings.some(warning => (
  warning.kind === 'working-pressure'
    && warning.pressureBar === 100.1
    && warning.limitBar === 100
    && warning.source === 'settled'
    && warning.stepIdentifier === null
)));
});
```

- [ ] **Step 2: Run the helper tests and confirm they fail**

Run:

```bash
node --test tests/pressure-limits.test.js
```

Expected: the behavior assertions fail with `undefined` results because `pressure-limits.js` and its exports are absent; no module-load error.

- [ ] **Step 3: Implement the pure helper functions**

Use `isTransientHot` explicitly; do not infer it from temperature inside the helper. That prevents a warm target-temperature projection from receiving the transient allowance. Use the existing 2% default when hot overfill is omitted, and preserve current invalid-hot-overfill handling. A finite pressure exceeds a limit only when `pressureBar > limitBar + toleranceBar`. The collector returns the maximum event per source/step/kind and never formats UI strings.
Implement `getCylinderPressureExceedance` by applying that shared limit and tolerance:

```js
const limit = getCylinderPressureLimit({ cylinder, isTransientHot });
if (!limit || !Number.isFinite(pressureBar)
  || pressureBar <= limit.limitBar + toleranceBar) return null;
return { ...limit, pressureBar };
```

- [ ] **Step 4: Run the helper tests and verify exact boundaries**

Run:

```bash
node --test tests/pressure-limits.test.js
```

Expected: PASS; equality is not an exceedance, and a transient between 100 and 102 bar is not over the hot limit.

- [ ] **Step 5: Commit the shared classifier**

```bash
git add js/pressure-limits.js tests/pressure-limits.test.js
git commit -m "feat: centralize cylinder pressure limit checks"
```

---

### Task 3: Apply policy to calculator input validation

**Files:**
- Modify: `js/input-validation.js`
- Modify: `js/main.js`
- Test: `tests/input-validation.test.js`

**Interfaces:**
- Consumes: Task 1's `settings.pressureLimitMode` and Task 2's pressure classifier.
- Produces: the optional fourth `validateCalculatorInputs` options argument. Omitted mode means Hard stop.

- [ ] **Step 1: Write failing Hard stop and Warning input tests**

Keep the existing Hard stop assertions. Add Warning cases that accept initial and target pressures above a 100-bar cylinder rating, accept an interim hot reading above the configured hot-overfill ceiling, and still reject target pressure 351 bar, initial pressure 351 bar, and invalid interim temperature.

```js
test('Warning mode bypasses only cylinder ceilings, not supported calculator inputs', () => {
const warning = { pressureLimitMode: 'warning' };
const rated = { ...defaultCylinder, workingPressureBar: 100, hotOverfillPercent: 2 };
const thermal = {
  tankMaterial: 'steel',
  coolingMedium: 'air',
  ambientTemperatureC: 20,
  inletTemperatureC: 20,
  targetMediumTemperatureC: 20,
  targetInWaterTemperatureC: 10,
  waitMode: 'minutes',
  waitMinutes: 0,
  interimMeasurements: [null]
};
assert.deepEqual(validateCalculatorInputs(
  { ...rated, initialPressureBar: 101, targetPressureBar: 110 },
  defaultPhysics,
  thermal,
  warning
), []);
assert.match(validateCalculatorInputs(
  { ...rated, targetPressureBar: 351 }, defaultPhysics, thermal, warning
).join(' '), /target pressure/i);
assert.match(validateCalculatorInputs(
  { ...rated, initialPressureBar: 351 }, defaultPhysics, thermal, warning
).join(' '), /initial pressure/i);
assert.match(validateCalculatorInputs(
  { ...rated, targetPressureBar: 100.0000000005 },
  defaultPhysics,
  thermal
).join(' '), /working pressure/i);
assert.match(validateCalculatorInputs(
  rated,
  defaultPhysics,
  { ...thermal, interimMeasurements: [{ pressureBar: 90, temperatureC: 100.1 }] },
  warning
).join(' '), /measured temperature/i);
assert.deepEqual(validateCalculatorInputs(
  rated,
  defaultPhysics,
  { ...thermal, interimMeasurements: [{ pressureBar: 103, temperatureC: 40 }] },
  warning
), []);
assert.match(validateCalculatorInputs(
  rated,
  defaultPhysics,
  { ...thermal, interimMeasurements: [{ pressureBar: 351, temperatureC: 40 }] },
  warning
).join(' '), /measured pressure/i);
assert.match(validateCalculatorInputs(
  { ...rated, hotOverfillPercent: 2.25 },
  defaultPhysics,
  thermal,
  warning
).join(' '), /hot overfill/i);
const invalidHotCylinder = { ...rated, hotOverfillPercent: 2.25 };
const overLimitReading = {
  ...thermal,
  interimMeasurements: [{ pressureBar: 103, temperatureC: 40 }]
};
const hardStopInvalidHotErrors = validateCalculatorInputs(
  invalidHotCylinder, defaultPhysics, overLimitReading
);
assert.match(hardStopInvalidHotErrors.join(' '), /hot overfill/i);
assert.match(hardStopInvalidHotErrors.join(' '), /measured.*hot overfill/i);
const warningInvalidHotErrors = validateCalculatorInputs(
  invalidHotCylinder, defaultPhysics, overLimitReading, warning
);
assert.match(warningInvalidHotErrors.join(' '), /hot overfill/i);
assert.doesNotMatch(warningInvalidHotErrors.join(' '), /measured.*hot overfill/i);
});
```

Also assert that the same above-rating values still produce working-pressure errors when the fourth argument is omitted.

- [ ] **Step 2: Run the input-validation tests and confirm the new Warning cases fail**

Run:

```bash
node --test tests/input-validation.test.js
```

Expected: current cylinder checks reject the Warning-mode cases.

- [ ] **Step 3: Implement the mode-aware validation contract**

Add the fourth options argument with Hard stop as the default. Keep supported ranges, hot-overfill field validation, thermal checks, and gas checks unchanged. Skip only initial/target/interim cylinder-ceiling errors when mode is Warning. For initial, target, and interim readings, call the shared exceedance helper with `toleranceBar: 0` to preserve existing strict input comparisons. For interim readings, set `isTransientHot` only when the measured temperature is above ambient. If `hotOverfillPercent` is invalid, keep the existing validation error and use the existing 2% fallback for the interim diagnostic instead of throwing from the helper.

Pass `{ pressureLimitMode: state.settings.pressureLimitMode }` at both `main.js` call sites: `compareSharedInputErrors()` for What-if's shared starting state (including interim readings), and `recalculate()` for Optimize.

```js
const targetPressureExceedance = getCylinderPressureExceedance({
  pressureBar: cylinder.targetPressureBar,
  cylinder,
  isTransientHot: false,
  toleranceBar: 0
});
if (pressureLimitMode !== 'warning' && targetPressureExceedance) {
  errors.push(`Target pressure cannot exceed ${targetPressureExceedance.limitBar} bar.`);
}
```

- [ ] **Step 4: Run input validation and settings tests**

Run:

```bash
node --test tests/input-validation.test.js tests/settings.test.js tests/pressure-limits.test.js
```

Expected: PASS; default calls still enforce the rating, Warning calls bypass only the rating, and 351-bar/thermal errors remain.

- [ ] **Step 5: Commit calculator validation**

```bash
git add js/input-validation.js js/main.js tests/input-validation.test.js
git commit -m "feat: support warning-mode calculator pressure inputs"
```

---

### Task 4: Apply Warning mode to Optimize thermal scheduling

**Files:**
- Modify: `js/optimizer.js`
- Test: `tests/optimizer.test.js`

**Interfaces:**
- Consumes: Task 1's `settings.pressureLimitMode` and Task 2's cylinder-limit helper.
- Produces: unchanged `scheduleSafeThermalProtocol` call signature; its `settings` input selects the policy. Optimize results retain thermal protocol states needed by the warning collector.

- [ ] **Step 1: Write failing scheduler and optimizer tests**

Add an end-to-end `optimizeBlend` case based on the existing 100-bar hot-transfer fixture: set `pressureLimitMode: 'warning'`, use a 100-bar cylinder with zero hot overfill, a 105-bar target, 20°C ambient, 40°C inlet, and zero configured wait. Assert the result is feasible, the hot transfer exceeds 100 bar, and no automatic wait or split was added solely for the cylinder limit. Keep the existing Hard stop test proving that the same style of crossing adds an automatic wait.

Add a separate equipment-cap case with Warning enabled and a 100-bar compressor maximum below the 105-bar requested pressure. Assert `result.feasible === false` and `result.maximumPressure.pressureBar <= 100 + 1e-6`; Warning must not turn that equipment overrun into a feasible fill.

```js
const warningInput = (maxCompressorPressureBar = 232) => ({
  cylinder: {
    volumeL: 12,
    initialPressureBar: 0,
    initialOxygenPercent: 21,
    initialHeliumPercent: 0,
    targetPressureBar: 105,
    targetOxygenPercent: 21,
    targetHeliumPercent: 0,
    workingPressureBar: 100,
    hotOverfillPercent: 0
  },
  physics: { model: 'ideal', temperatureC: 20 },
  thermal: {
    tankMaterial: 'steel',
    coolingMedium: 'air',
    ambientTemperatureC: 20,
    inletTemperatureC: 40,
    targetMediumTemperatureC: 20,
    targetInWaterTemperatureC: 20,
    waitMode: 'minutes',
    waitMinutes: 0
  },
  settings: {
    pressureLimitMode: 'warning',
    booster: {
      compressorInletFlowLPerMin: 100,
      maxCompressorPressureBar,
      maxBoosterOutputPressureBar: 230,
      otherBoostBpm: 50,
      oxygenBoostBpm: 50,
      otherDecantRateBarPerMin: 5,
      oxygenDecantRateBarPerMin: 5,
      cylinderVolumeCm3: 9,
      minimumSourcePressureBar: 0
    }
  },
  banks: []
});

test('Warning mode ignores cylinder-only thermal waits but retains equipment caps', () => {
  const result = optimizeBlend(warningInput());
  assert.equal(result.feasible, true, result.error);
  assert.ok(result.thermal.finalTransferEndPressureBar > 100);
  assert.equal(result.protocolSteps.some(step => step.automaticWaitMetadata), false);
  assert.equal(result.protocolSteps.filter(step => step.thermal?.rateSource === 'compressor').length, 1);

  const capped = optimizeBlend(warningInput(100));
  assert.equal(capped.feasible, false);
  assert.ok(capped.maximumPressure);
  assert.ok(capped.maximumPressure.pressureBar <= 100 + 1e-6);
});
```

- [ ] **Step 2: Run the optimizer tests and confirm the Warning scheduler case fails**

Run:

```bash
node --test tests/optimizer.test.js
```

Expected: the current scheduler still waits, splits, or rejects based on cylinder pressure in Warning mode.

- [ ] **Step 3: Make the thermal safety predicate policy-aware**

Use the cylinder limit only in Hard stop. Continue evaluating `thermalEquipmentPressureLimit` in both modes. In Warning mode, omit only the cylinder component from the combined threshold and skip the initial working-pressure rejection; preserve invalid hot-overfill validation, non-finite pressure handling, the automatic-wait ceiling, and all transfer/equipment safety checks.
Also update `validateBlendInput` in `js/optimizer.js` to pass `{ pressureLimitMode: input.settings?.pressureLimitMode }` into `validateCalculatorInputs`; otherwise the inner Optimize validation still rejects above-rating initial/target values before scheduling.

```js
const configuredCylinderLimit = getCylinderPressureLimit({
  cylinder: context.cylinder,
  isTransientHot
});
const cylinderLimit = context.settings?.pressureLimitMode === 'warning'
  ? Infinity
  : (configuredCylinderLimit?.limitBar ?? Infinity);
const effectiveLimit = Math.min(cylinderLimit, equipmentLimit);
```

Pass the mode through `isSafeSimulation`, `firstUnsafeThermalIndex`, and `scheduleSafeThermalProtocol` via their existing settings/context argument. Do not change behavior when settings omit the mode.

- [ ] **Step 4: Run optimizer and pressure-helper tests**

Run:

```bash
node --test tests/optimizer.test.js tests/pressure-limits.test.js
```

Expected: PASS; Hard stop still adds safety waits/splits, Warning permits cylinder overage without cylinder-only waits, and equipment caps remain effective.

- [ ] **Step 5: Commit Optimize policy**

```bash
git add js/optimizer.js tests/optimizer.test.js
git commit -m "feat: honor pressure warning mode in optimizer"
```

---

### Task 5: Apply Warning mode to Compare validation and protocol construction

**Files:**
- Modify: `js/compare-recipe.js`
- Test: `tests/compare-recipe.test.js`

**Interfaces:**
- Consumes: Task 1's `settings.pressureLimitMode` and Task 2's applicable-cylinder-limit behavior.
- Produces: existing `validateCompareRecipe` and `buildCompareProtocol` return shapes; Warning changes only their cylinder-pressure ceiling.

- [ ] **Step 1: Write failing Compare tests**

Keep the existing Hard stop test for an Add target above working pressure. Add a Warning case with a 100-bar cylinder and a `bankId: 'compressor-air'` Add target of 150 bar (configured compressor maximum 232 bar); assert validation succeeds and `buildCompareProtocol` returns a trajectory ending at 150 bar. Add an initial-pressure case above working pressure using one Keep row and assert protocol construction succeeds within the supported range. Add Warning-mode Add target 233 and target 351 cases: 233 must still fail the 232-bar Compressor Air cap, and 351 must still fail the supported pressure range rather than the cylinder ceiling.

```js
test('Compare Warning mode bypasses only cylinder pressure', () => {
const warningSettings = { ...settings, pressureLimitMode: 'warning' };
const warningCylinder = { ...cylinder, workingPressureBar: 100 };
const addAt150 = {
  id: 'warning-add',
  type: 'add',
  bankId: 'compressor-air',
  pressureAddedBar: 100,
  targetPressureBar: 150,
  pressureInputMode: 'target'
};
const warningOptions = {
  cylinder: warningCylinder, banks, physics, settings: warningSettings
};
assert.equal(validateCompareRecipe([addAt150], warningOptions).valid, true);
assert.equal(
  buildCompareProtocol([addAt150], warningOptions).trajectory.at(-1).pressureBar,
  150
);

const initialAboveRating = buildCompareProtocol([{ id: 'keep', type: 'keep' }], {
  ...warningOptions,
  cylinder: { ...warningCylinder, initialPressureBar: 110 }
});
assert.equal(initialAboveRating.trajectory[0].pressureBar, 110);

const compressorOverCap = validateCompareRecipe([{
  ...addAt150, targetPressureBar: 233, pressureAddedBar: 183
}], warningOptions);
assert.ok(compressorOverCap.errors.some(error => /Compressor Air.*232 bar/i.test(error.message)));
const outsideRange = validateCompareRecipe([{
  ...addAt150, targetPressureBar: 351, pressureAddedBar: 301
}], warningOptions);
assert.ok(outsideRange.errors.some(error => /between 0 and 350 bar/i.test(error.message)));
});
```

- [ ] **Step 2: Run Compare tests and confirm the new Warning cases fail**

Run:

```bash
node --test tests/compare-recipe.test.js
```

Expected: cylinder working-pressure checks reject the Warning-mode initial or Add target.

- [ ] **Step 3: Make both Compare cylinder checks mode-aware**

Update the ceiling used by `validateCompareRecipe`/`validateAddRow` and the redundant initial/Add checks in `buildCompareProtocol`. Use the existing 350-bar pressure bound as the Warning-mode receiver ceiling, without changing `validPressure`, source minimums, Compressor Air maximum pressure, or booster equipment limits. Missing policy continues to mean Hard stop.
Pass `settings` at both call sites so Add-row validation and protocol construction use the same policy.

```js
function receiverPressureCeiling(cylinder, settings) {
  if (settings?.pressureLimitMode === 'warning') return MAX_PRESSURE_BAR;
  return Number.isFinite(cylinder?.workingPressureBar) && cylinder.workingPressureBar >= 0
    ? Math.min(MAX_PRESSURE_BAR, cylinder.workingPressureBar)
    : MAX_PRESSURE_BAR;
}
```

- [ ] **Step 4: Run Compare, settings, and shared pressure-limit tests**

Run:

```bash
node --test tests/compare-recipe.test.js tests/settings.test.js tests/pressure-limits.test.js
```

Expected: PASS; Hard stop rejects above-rating targets, Warning accepts a 150-bar target for a 100-bar cylinder, and source/equipment/350-bar bounds still reject their existing invalid cases.

- [ ] **Step 5: Commit Compare policy**

```bash
git add js/compare-recipe.js tests/compare-recipe.test.js
git commit -m "feat: honor pressure warning mode in Compare"
```

---

### Task 6: Add the General setting and exact-phrase unlock UI

**Files:**
- Modify: `index.html`
- Modify: `js/ui/settings-dialog.js`
- Modify: `js/main.js`
- Test: `tests/browser/settings.spec.js`

**Interfaces:**
- Consumes: Task 1's `pressureLimitMode` and `pressureWarningUnlocked` draft fields.
- Produces: a General select named **Cylinder pressure limit behavior**, a phrase field, and an **Unlock warning mode** action. The phrase is transient DOM/controller input and never enters settings data.

- [ ] **Step 1: Write failing browser tests for locking, normalized phrase matching, and persistence**

Add Playwright coverage that opens General and asserts Hard stop is selected while Warning is disabled. Wrong words or altered spacing leave Unlock disabled. Letter case is ignored, and a straight apostrophe, backtick, or double quote is accepted in “I'm”. Typing one accepted variant enables Unlock; clicking it enables Warning in the draft and displays the amber settings explanation. Save in Warning mode, reload, and assert Warning remains selected without retyping. Then switch back to Hard stop and re-enable Warning without typing again. Invoke the existing Reset to factory settings action, accept its confirmation dialog, reopen General, and assert Hard stop is selected and Warning is locked. In a separate case, unlock in a draft and Cancel; reload and assert Warning is still locked. Inspect the saved settings JSON and assert it contains the unlock boolean but not the phrase text.

```js
test('unlocks warning mode with exact phrase and persists only the unlock flag', async ({ appPage }) => {
const page = await appPage.goto('tourSeen');
const general = await openSettingsCategory(page, 'general');
const policy = general.getByRole('combobox', { name: 'Cylinder pressure limit behavior' });
const phrase = general.getByRole('textbox', { name: "Type I KNOW WHAT I'M DOING" });
const unlock = general.getByRole('button', { name: 'Unlock warning mode' });
await expect(policy.locator('option[value="warning"]')).toBeDisabled();
await phrase.fill("i know what i'm doing");
await expect(unlock).toBeEnabled();
await phrase.fill('I KNOW WHAT I AM DOING');
await expect(unlock).toBeDisabled();
await phrase.fill('I KNOW WHAT I`M DOING');
await expect(unlock).toBeEnabled();
await phrase.fill('i know what i"m doing');
await expect(unlock).toBeEnabled();
await unlock.click();
await policy.selectOption('warning');
await expect(general.getByText(/cylinder limits are not enforced/i)).toBeVisible();
await saveSettings(page);
await page.reload();
const persistedGeneral = await openSettingsCategory(page, 'general');
await expect(persistedGeneral.getByRole('combobox', { name: 'Cylinder pressure limit behavior' }))
  .toHaveValue('warning');
const saved = await page.evaluate(() => JSON.parse(
  localStorage.getItem('simplex-gas-remixer-settings')
));
expect(saved.pressureWarningUnlocked).toBe(true);
expect(JSON.stringify(saved)).not.toContain(`I KNOW WHAT I'M DOING`);
});
```

- [ ] **Step 2: Run the settings browser tests and confirm they fail**

Run:

```bash
npm run test:ui -- tests/browser/settings.spec.js
```

Expected: the new controls and unlock behavior are absent.

- [ ] **Step 3: Implement General controls and draft-only unlock**

Add an empty confirmation input and an Unlock button disabled unless the shared matcher accepts the phrase case-insensitively with the allowed apostrophe variants. The click handler uses the same matcher, sets only `state.settingsDraft.pressureWarningUnlocked = true`, rerenders General, and does not write storage until Save. Handle the new mode field explicitly in `updateSettingsDraft`; do not route it to `units` or gas presets. Add the amber settings notice when the selected mode is Warning. Save/Cancel continues to use the existing settings draft lifecycle.

```html
<select id="settings-pressure-limit-mode"
  data-settings-collection="general"
  data-settings-field="pressureLimitMode"
  aria-label="Cylinder pressure limit behavior">
  <option value="hard-stop">Hard stop</option>
  <option value="warning" disabled>Warning</option>
</select>
<input id="settings-pressure-limit-confirmation"
  aria-label="Type I KNOW WHAT I'M DOING">
<button type="button" data-action="unlock-pressure-warning" disabled>
  Unlock warning mode
</button>
```

Render the Warning option enabled only after `pressureWarningUnlocked` is true.

- [ ] **Step 4: Run settings browser and unit tests**

Run:

```bash
npm run test:ui -- tests/browser/settings.spec.js
node --test tests/settings.test.js
```

Expected: PASS across desktop/tablet/mobile browser projects; unlock is exact-match, saved once, not stored as phrase text, and discarded by Cancel.

- [ ] **Step 5: Commit the settings UI**

```bash
git add index.html js/ui/settings-dialog.js js/main.js tests/browser/settings.spec.js
git commit -m "feat: gate pressure warning mode behind confirmation"
```

---

### Task 7: Collect and render active-policy and exceedance notices

**Files:**
- Modify: `js/main.js`
- Modify: `js/ui/results.js`
- Test: `tests/results.test.js`
- Test: `tests/browser/blending.spec.js`

**Interfaces:**
- Consumes: Task 2's `collectCylinderPressureWarnings`, plus Optimize/Compare thermal protocol data from Tasks 4–5.
- Produces: `result.pressureLimitWarnings` entries using the shared event shape. Optimize and What-if results visibly identify Warning mode and actual cylinder-limit exceedances.

- [ ] **Step 1: Write failing result and browser tests**

In `tests/results.test.js`, render a feasible result with `calculation.settings.pressureLimitMode === 'warning'` and one `pressureLimitWarnings` item; assert the visible status names Warning mode, the measured pressure, the applicable limit, and the affected step. Assert a Warning-mode result with no crossings still announces that cylinder limits are not enforced.

```js
assert.match(document.elements.get('blend-status').textContent, /warning mode/i);
assert.match(document.elements.get('blend-status').textContent, /103\.0 bar/);
assert.match(document.elements.get('blend-status').textContent, /102\.0 bar/);
assert.match(document.elements.get('blend-status').textContent, /Transfer 2/);
```

In `tests/browser/blending.spec.js`, add two consumer flows. For Optimize, set all cylinder preset working pressures to 100 bar and hot overfill to 0, unlock/select Warning, and run a 99-bar target with hot 40°C transfer gas; assert feasibility, a pressure-limit notice, and no automatic-wait notice solely for cylinder pressure. For What-if, independently set a 100-bar cylinder and unlock/select Warning, set the starting pressure to 110 bar, run the existing default drain-to-20 recipe, and assert the run succeeds while `#what-if-result` announces the working-pressure exceedance.
After the corresponding flows run, assert:

```js
await expect(page.locator('#blend-status')).toContainText(/warning mode/i);
await expect(page.locator('#blend-status')).toContainText(/hot-overfill limit/i);
await expect(page.locator('#what-if-result')).toContainText(/working pressure/i);
```

- [ ] **Step 2: Run the focused result and browser tests and confirm they fail**

Run:

```bash
node --test tests/results.test.js
npm run test:ui -- tests/browser/blending.spec.js
```

Expected: Warning-mode policy and exceedances are not yet shown.

- [ ] **Step 3: Build warnings from input and modeled pressure observations**

In `main.js`, map initial/target/interim inputs and the semantic pressure points already returned by Optimize and Compare thermal steps. Mark initial, target, settled, ambient, and target-temperature states non-transient; mark only above-ambient measured/transfer/cooling states transient. In Warning mode, collect events; in Hard stop mode, attach an empty list so existing result status and wait behavior remain unchanged.

```js
const pressureLimitWarnings = input.settings.pressureLimitMode === 'warning'
  ? collectCylinderPressureWarnings({
    cylinder: input.cylinder,
    observations
  })
  : [];
const resultWithWarnings = { ...result, pressureLimitWarnings };
```

- [ ] **Step 4: Render notices in calculator and What-if surfaces**

In `js/ui/results.js`, extend the existing result status to state that Warning mode disables cylinder-limit enforcement even when no event exists, then include observed pressure, threshold, kind, and step/input for each aggregated event. Use the selected units and existing status/alert semantics. In `main.js`'s `renderWhatIfResult`, append an equivalent accessible notice to the actual What-if result; do not rely only on the hidden shared Recipe panel. Keep `#compare-run-status` for the run outcome rather than duplicating the warning. Do not turn an exceedance into an error or change the feasible result.

Format each event as an amber notice such as `Transient hot-overfill limit exceeded: 103.0 bar > 102.0 bar (Transfer 2)`. When the event list is empty but Warning mode is active, show only the policy notice that cylinder limits are not enforced.

- [ ] **Step 5: Run focused result, optimizer, Compare, and browser tests**

Run:

```bash
node --test tests/results.test.js tests/optimizer.test.js tests/compare-recipe.test.js tests/pressure-limits.test.js
npm run test:ui -- tests/browser/settings.spec.js tests/browser/blending.spec.js
```

Expected: PASS; both surfaces show the active policy, over-limit cases identify actual thresholds, within-hot-ceiling transients remain unreported, and Hard stop results keep their existing status/wait behavior.

- [ ] **Step 6: Commit warning presentation**

```bash
git add js/main.js js/ui/results.js tests/results.test.js tests/browser/blending.spec.js
git commit -m "feat: report cylinder pressure limit warnings"
```

---

### Task 8: Update user and architecture documentation

**Files:**
- Modify: `docs/UI.md`
- Modify: `docs/optimizer.md`
- Modify: `docs/architecture.md`

**Interfaces:**
- Consumes: the implemented mode, settings unlock, pressure policy, and warning presentation.
- Produces: consistent user and developer documentation; no runtime API changes.

- [ ] **Step 1: Update the settings and safety descriptions**

Document in `docs/UI.md` that General offers Hard stop (default) and Warning, that Warning requires the case-insensitive phrase (accepting the stated apostrophe variants), and that only cylinder working-pressure/hot-overfill enforcement is bypassed. State that supported input bounds and compressor/booster caps remain active, and explain that hot overfill applies only to above-ambient transients. Update `docs/optimizer.md` to describe Hard stop's existing wait/split behavior and Warning's no-cylinder-only-wait behavior. Update `docs/architecture.md` to include the persisted policy fields, shared helper, mode propagation, and result notices.

- [ ] **Step 2: Review documentation against the approved spec**

Check that no page says Warning mode makes an over-limit cylinder safe, that no text implies equipment limits are bypassed, and that every old unconditional claim about cylinder working pressure is qualified by the selected mode.

- [ ] **Step 3: Commit documentation**

```bash
git add docs/UI.md docs/optimizer.md docs/architecture.md
git commit -m "docs: explain pressure-limit warning mode"
```

---

### Task 9: Run complete verification and smoke the changed flows

**Files:**
- Verify: all files in this plan; no additional code changes unless a check exposes a defect.

**Interfaces:**
- Consumes: all completed implementation tasks.
- Produces: passing unit/browser suites and observed end-to-end Settings, Optimize, and What-if behavior.

- [ ] **Step 1: Run the complete Node suite**

Run:

```bash
npm test
```

Expected: all unit tests pass.

- [ ] **Step 2: Run the complete browser suite**

Run:

```bash
npm run test:ui
```

Expected: all Playwright projects pass, including desktop, tablet, and mobile.

- [ ] **Step 3: Smoke actual behavior through the browser**

Use the Playwright-run application and confirm this sequence: fresh/legacy settings show Hard stop and locked Warning; the case-insensitive phrase or accepted apostrophe variant unlocks and persists; Cancel discards unsaved unlock; Warning mode permits a calculator or Compare cylinder overrun and visibly reports the applicable threshold; 351-bar input remains invalid; compressor/booster caps remain enforced; Hard stop restores existing validation and Optimize wait/split behavior.

- [ ] **Step 4: Fix only failures in the approved scope and rerun affected checks**

If a check fails, preserve its failing output, fix the affected policy path, and rerun its focused command before repeating the full suite. Do not remove constraints or weaken assertions to make the suite pass.
