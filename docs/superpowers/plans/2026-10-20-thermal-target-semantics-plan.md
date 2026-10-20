# Thermal Target Semantics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Optimize mode target pressure at the requested in-water temperature, model mixing and ordinary waits at ambient temperature, and automatically keep every hot transfer within the cylinder working pressure.

**Architecture:** Normalize the user’s in-water target to an internal ambient-settled target using the existing pressure-at-temperature thermodynamics. Keep ambient as the convergence temperature for transfer cooling and waits; retain target-medium waits as a separate, ambient-or-warmer wait control. Add a safety-aware thermal protocol scheduler that extends waits and splits transfers before any working-pressure violation, then report hot, ambient-settled, and in-water states separately.

**Tech Stack:** Browser JavaScript ES modules, Node `node:test`, Playwright browser tests, existing ideal-gas/Van der Waals thermodynamics.

**Spec:** `docs/superpowers/specs/2026-10-20-thermal-target-semantics-design.md`

## Global Constraints

- Ambient temperature is 5–40°C and is the convergence temperature for mixing and ordinary waits for both air and water.
- Target in-water temperature is 1–30°C and may be below ambient.
- Target medium temperature is 5–40°C and must be greater than or equal to ambient.
- Inlet gas temperature is 5–40°C.
- The TARGET pressure is pressure at the target in-water temperature, not ambient-settled pressure.
- The selected cylinder working pressure is a hard upper bound for every modeled transfer endpoint and intermediate state.
- Automatic wait extensions must be minimum-duration adjustments, visible with an exclamation-mark warning and added duration.
- Reuse the existing ideal-gas/Van der Waals pressure projection; do not add a second conversion formula.
- Follow TDD: write each regression test, run it failing, implement the smallest fix, then run it passing.

---

## File map

- Modify `js/input-validation.js`: shared thermal ranges and temperature relationships.
- Modify `js/main.js`: input names, labels, form collection, and normalized Optimize input.
- Modify `js/optimizer.js`: in-water target normalization, thermal search target/result fields, and safe protocol scheduling integration.
- Modify `js/thermodynamics.js`: ambient convergence, equal-temperature waits, safe-stage simulation inputs, and final in-water projection.
- Modify `js/ui/results.js`: hot/ambient/in-water result presentation and automatic-wait warnings.
- Modify `js/ui/thermal-charts.js`: explicit ambient final state and in-water projection endpoint.
- Modify `js/ui/compare-recipe.js` and `js/compare-recipe.js`: target-medium naming and shared temperature constraints without changing Compare pressure semantics.
- Modify `tests/input-validation.test.js`: range and relationship regressions.
- Modify `tests/optimizer.test.js`: canonical in-water target, projections, and safety scheduling.
- Modify `tests/thermodynamics.test.js`: ambient convergence and equal-target behavior.
- Modify `tests/compare-recipe.test.js`: target-medium constraints.
- Modify `tests/results.test.js` and `tests/thermal-charts.test.js`: result labels/state rendering.
- Modify or add `browser/blending.spec.js` and related helpers: end-to-end target fields, result states, and warning presentation.

---

### Task 1: Normalize thermal input semantics and validation

**Files:**
- Modify: `js/input-validation.js`
- Modify: `js/main.js`
- Modify: `index.html`
- Modify: `js/compare-recipe.js`
- Modify: `js/ui/compare-recipe.js`
- Test: `tests/input-validation.test.js`
- Test: `tests/compare-recipe.test.js`
- Test: `tests/onboarding-markup.test.js`

**Interfaces:**
- Input thermal fields use `ambientTemperatureC`, `inletTemperatureC`, `targetMediumTemperatureC`, and `targetInWaterTemperatureC`.
- `validateCalculatorInputs(cylinder, physics, thermal)` returns the existing string-array error contract.
- Compare wait rows continue to use their row-level `targetTemperatureC` field internally, but validation and UI call it target-medium temperature.

- [ ] **Step 1: Write failing validation tests**

Add tests covering:

```js
assert.deepEqual(validateCalculatorInputs(cylinder, { temperatureC: 5 }, {
  tankMaterial: 'steel', coolingMedium: 'air', ambientTemperatureC: 5,
  inletTemperatureC: 5, targetMediumTemperatureC: 5,
  targetInWaterTemperatureC: 1, waitMode: 'minutes', waitMinutes: 0
}), []);

assert.match(validateCalculatorInputs(cylinder, { temperatureC: 4 }, thermal).join(' '), /5 and 40/);
assert.match(validateCalculatorInputs(cylinder, { temperatureC: 25 }, {
  ...thermal, targetInWaterTemperatureC: 31
}).join(' '), /1 and 30/);
assert.match(validateCalculatorInputs(cylinder, { temperatureC: 25 }, {
  ...thermal, ambientTemperatureC: 25, targetMediumTemperatureC: 24
}).join(' '), /below ambient/);
assert.deepEqual(validateCalculatorInputs(cylinder, { temperatureC: 25 }, {
  ...thermal, ambientTemperatureC: 25, targetMediumTemperatureC: 25
}), []);
assert.match(validateCalculatorInputs(cylinder, { temperatureC: 25 }, {
  ...thermal, inletTemperatureC: 41
}).join(' '), /inlet.*5 and 40/i);
```

Use a finite `targetInWaterTemperatureC` in every valid fixture. Keep a separate test proving that target in-water temperature below ambient is valid.

- [ ] **Step 2: Run the validation tests and confirm the expected failures**

Run:

```bash
node --test tests/input-validation.test.js tests/compare-recipe.test.js
```

Expected: failures for the new field names/ranges and for equal target-medium temperature if the current implementation still requires strictly above ambient.

- [ ] **Step 3: Implement the input contract**

Update validation to:

- require ambient in 5–40°C;
- require target in-water temperature in 1–30°C;
- require target medium temperature in 5–40°C and `>= ambientTemperatureC`;
- require inlet temperature in 5–40°C;
- keep target in-water temperature independent of ambient;
- preserve existing invalid-result behavior.

Update `index.html` input `min`, `max`, labels, and IDs. Update `main.js` to collect the semantic fields. Keep any existing DOM/storage compatibility at the current calculation boundary, but expose only one user-editable target-temperature meaning.

Update Compare validation/UI wording to target-medium temperature while retaining the existing row schema and row-level `targetTemperatureC` property.

- [ ] **Step 4: Run focused validation tests**

Run:

```bash
node --test tests/input-validation.test.js tests/compare-recipe.test.js tests/onboarding-markup.test.js
```

Expected: all focused validation, Compare, and markup tests pass.

- [ ] **Step 5: Commit**

```bash
git add index.html js/input-validation.js js/main.js js/compare-recipe.js js/ui/compare-recipe.js tests/input-validation.test.js tests/compare-recipe.test.js tests/onboarding-markup.test.js
git commit -m "feat: separate thermal target temperatures"
```

---

### Task 2: Convert the in-water target and expose three thermal states

**Files:**
- Modify: `js/optimizer.js`
- Modify: `js/thermodynamics.js`
- Test: `tests/optimizer.test.js`
- Test: `tests/thermodynamics.test.js`

**Interfaces:**
- Add an internal normalization helper in `js/optimizer.js` that receives the requested in-water pressure/temperature, ambient temperature, volume, and physics model and returns `ambientSettledTargetPressureBar` using `calculatePressureAtTemperature`.
- Extend thermal result data with `finalInWaterPressureBar`, `finalInWaterTemperatureC`, `requestedInWaterPressureBar`, `requestedInWaterTemperatureC`, and `ambientSettledTargetPressureBar`.
- Keep `simulateThermalProtocol` responsible for transfer and ambient-settled states; use the shared projection helper for the in-water state.

- [ ] **Step 1: Write the failing conversion and result tests**

Add an optimizer test using the approved scenario and assert:

```js
assert.equal(result.feasible, true);
assert.ok(Math.abs(result.thermal.ambientSettledTargetPressureBar - 200) < 0.2);
assert.ok(Math.abs(result.thermal.finalAmbientPressureBar - 200) < 0.2);
assert.ok(Math.abs(result.thermal.finalAmbientTemperatureC - 25) < 1e-9);
assert.ok(Math.abs(result.thermal.finalInWaterTemperatureC - 10) < 1e-9);
assert.ok(Math.abs(result.thermal.finalInWaterPressureBar - 188.6) < 0.2);
```

Add ideal-gas and Van der Waals conversion assertions against the existing projection function. Add a test that a target in-water temperature below ambient is accepted while target-medium below ambient remains invalid.

Add thermodynamics tests proving normal waiting converges to ambient for both `coolingMedium: 'air'` and `'water'`, and equal target-medium/ambient does not produce `NaN`.

- [ ] **Step 2: Run the new tests and confirm failure**

Run:

```bash
node --test tests/optimizer.test.js tests/thermodynamics.test.js --test-name-pattern='in-water|ambient|target medium|thermal target'
```

Expected: the current optimizer reports the requested pressure as ambient pressure and does not provide the new in-water result fields.

- [ ] **Step 3: Implement target normalization and result projection**

Before `optimizeThermalBlend` searches target pressure, calculate the ambient-settled target from the requested in-water target. Run the existing thermal search against that derived pressure. Preserve the user-facing requested pressure in the final result while labeling the derived pressure as ambient-settled.

At the end of the thermal simulation, project the final ambient state from `finalAmbientTemperatureC` to `targetInWaterTemperatureC` with `calculatePressureAtTemperature`. Do not use the target in-water temperature as the cooling convergence temperature.

Handle target-medium equal to ambient as a finite convergence wait using the existing convergence approximation, rather than passing an equal denominator into `calculateCoolingTime`.

- [ ] **Step 4: Run focused tests**

Run:

```bash
node --test tests/optimizer.test.js tests/thermodynamics.test.js --test-name-pattern='in-water|ambient|target medium|thermal target'
```

Expected: all new conversion, result-state, ambient convergence, and existing thermal tests pass.

- [ ] **Step 5: Commit**

```bash
git add js/optimizer.js js/thermodynamics.js tests/optimizer.test.js tests/thermodynamics.test.js
git commit -m "feat: optimize pressure at in-water temperature"
```

---

### Task 3: Add working-pressure-safe wait extension and transfer splitting

**Files:**
- Modify: `js/optimizer.js`
- Modify: `js/thermodynamics.js`
- Test: `tests/optimizer.test.js`
- Test: `tests/thermodynamics.test.js`

**Interfaces:**
- Add a scheduler helper in `js/optimizer.js` that accepts the static protocol, thermal input, cylinder working pressure, and settings and returns a safe protocol plus metadata for automatic waits.
- Each automatic wait metadata item includes the affected step identifier/index, configured wait minutes, actual wait minutes, and added wait minutes.
- Protocol steps carry enough thermal metadata for UI rendering without recomputing safety decisions.

- [ ] **Step 1: Write a failing hot-pressure safety test**

Construct a recipe whose final transfer pressure is below the working pressure after ambient settling but whose modeled hot transfer pressure exceeds it. Assert that the optimizer does not return a protocol containing a transfer endpoint above `workingPressureBar` and that the returned step includes an automatic wait extension.

Also add a case where one transfer cannot be safe as a single stage and must be split into two transfer stages with a wait between them. Assert every transfer endpoint is within the working pressure and the final in-water target remains within tolerance.

- [ ] **Step 2: Run the safety tests and confirm failure**

Run:

```bash
node --test tests/optimizer.test.js tests/thermodynamics.test.js --test-name-pattern='working pressure|extended wait|split transfer|safe'
```

Expected: the current protocol either exceeds the working pressure or has no automatic wait metadata.

- [ ] **Step 3: Implement the minimum safe scheduler**

For each candidate transfer:

1. Simulate the current state and candidate transfer endpoint.
2. If the hot endpoint is safe, retain it.
3. If it is unsafe and a preceding wait can lower pressure, solve for the minimum added wait using the existing ambient-cooling and pressure projection functions.
4. Re-simulate and repeat until safe or the supported wait limit is reached.
5. If the transfer still crosses the working-pressure boundary, cap/split it at the safe endpoint, insert the required wait, then continue with the remaining amount.
6. Preserve gas composition, source accounting, and transfer rates across split stages.
7. Attach automatic wait metadata and an exclamation-mark warning marker to affected protocol steps.

Check pressure at every transfer endpoint and modeled intermediate stage. Do not accept a candidate based only on final ambient or in-water pressure. Use the existing 1440-minute supported wait ceiling rather than introducing an unbounded loop.

- [ ] **Step 4: Run safety and existing optimizer tests**

Run:

```bash
node --test tests/optimizer.test.js tests/thermodynamics.test.js
```

Expected: all tests pass, including existing source-accounting, thermal-search, and working-pressure tests.

- [ ] **Step 5: Commit**

```bash
git add js/optimizer.js js/thermodynamics.js tests/optimizer.test.js tests/thermodynamics.test.js
git commit -m "feat: keep thermal recipes below working pressure"
```

---

### Task 4: Render explicit thermal states and automatic-wait warnings

**Files:**
- Modify: `js/ui/results.js`
- Modify: `js/ui/thermal-charts.js`
- Modify: `index.html` if result hosts or labels require changes
- Test: `tests/results.test.js`
- Test: `tests/thermal-charts.test.js`

**Interfaces:**
- Result renderers consume the extended `thermal` result contract from Task 2.
- Automatic wait metadata is rendered from protocol-step/result metadata; UI must not infer it from text.

- [ ] **Step 1: Write failing renderer tests**

Add assertions that result output contains distinct labels for:

- hot mix pressure/temperature;
- ambient-settled pressure/temperature;
- in-water target pressure/temperature.

Add an assertion that an automatically extended wait renders visible text beginning with `!` and includes configured, actual, or added minutes plus the working-pressure reason. Add thermal-chart assertions for the ambient final point and separately labeled in-water projection.

- [ ] **Step 2: Run focused UI tests and confirm failure**

Run:

```bash
node --test tests/results.test.js tests/thermal-charts.test.js
```

Expected: the current renderer lacks the new state labels and warning output.

- [ ] **Step 3: Implement result and chart rendering**

Update the result summary and step cards to use the new fields. Keep the requested target pressure labeled as in-water pressure. Show the derived ambient target only as ambient-settled information. Render automatic wait warnings from metadata with the literal exclamation-mark prefix.

Keep thermal chart transfer/wait curves converging to ambient. Add or retain a distinct terminal in-water projection point/label without changing the ambient endpoint semantics.

- [ ] **Step 4: Run focused UI tests**

Run:

```bash
node --test tests/results.test.js tests/thermal-charts.test.js
```

Expected: all renderer and chart tests pass.

- [ ] **Step 5: Commit**

```bash
git add js/ui/results.js js/ui/thermal-charts.js index.html tests/results.test.js tests/thermal-charts.test.js
git commit -m "feat: show ambient and in-water thermal states"
```

---

### Task 5: Verify the browser workflow and complete documentation

**Files:**
- Modify: `browser/blending.spec.js`
- Modify: `browser/helpers/blending.js`
- Modify: `docs/UI.md`
- Test: browser specs listed below

- [ ] **Step 1: Add browser regression coverage**

Add an end-to-end scenario that fills:

- current pressure 50 bar Air;
- ambient 25°C;
- target 18/45;
- target pressure 188.6 bar;
- target in-water temperature 10°C;
- target-medium wait settings that exercise the wait controls.

Assert the page reports a feasible recipe, shows ambient-settled pressure near 200 bar, and shows in-water pressure near 188.6 bar at 10°C. Add a scenario that triggers automatic wait extension and assert the visible `!` warning includes the added duration and working-pressure reason. Assert input boundaries and target-medium-below-ambient validation.

- [ ] **Step 2: Run browser regressions**

Run:

```bash
npx playwright test browser/blending.spec.js browser/results.spec.js browser/layout-invariants.spec.js
```

Expected: the updated Optimize flow, result states, warnings, and layout all pass.

- [ ] **Step 3: Update user-facing documentation**

Document that target pressure is specified at target in-water temperature, that ambient is the mixing/wait convergence temperature, and that the optimizer may automatically extend waits to remain below working pressure. Include the exclamation-mark warning behavior.

- [ ] **Step 4: Run the complete verification suite**

Run:

```bash
npm test
git diff --check
npx playwright test
```

Expected: all Node tests pass, no whitespace errors are reported, and the full browser suite passes.

- [ ] **Step 5: Commit final tests and documentation**

```bash
git add browser docs
git commit -m "test: verify thermal target workflow"
```

## Final review checklist

- [ ] Every spec section has an implementation task.
- [ ] No code path treats target in-water temperature as ambient cooling convergence.
- [ ] Target-medium equality with ambient cannot produce `NaN`.
- [ ] Target-medium below ambient remains invalid.
- [ ] In-water target below ambient is valid.
- [ ] All hot/intermediate transfer states respect working pressure.
- [ ] Automatic wait extensions are visible with `!` and duration/reason.
- [ ] Optimize and the in-water tab agree on the final in-water projection.
- [ ] Existing Compare pressure semantics remain unchanged.
- [ ] Full unit and browser suites pass.
