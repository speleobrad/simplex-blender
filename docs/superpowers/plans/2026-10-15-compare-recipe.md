# Compare Recipe Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an in-memory Compare recipe mode that replays user-entered Keep, Drain, Add gas, and Wait rows through the existing thermodynamic model and shows both recipe-end and ambient-settled states.

**Architecture:** Keep optimizer mode unchanged. Add a pure `js/compare-recipe.js` adapter that validates manual rows, calculates cumulative receiver composition, and produces normalized protocol data. Add compare-specific thermodynamic simulation in `js/thermodynamics.js` by reusing the existing rate, heat-transfer, cooling, and pressure-projection helpers; route browser state through a mode branch in `js/main.js`, render the editor in `js/ui/compare-recipe.js`, and extend the existing result, chart, and ternary surfaces with explicit compare data instead of duplicating them.

**Tech Stack:** Browser-native ES modules, vanilla DOM/SVG/canvas, Tailwind CDN utility classes, Node built-in test runner.

**Spec:** `docs/superpowers/specs/2026-10-15-compare-recipe-design.md`

## Global Constraints

- Existing optimizer behavior and optimizer protocol simulation MUST remain unchanged.
- Compare mode MUST preserve entered row order and explicit waits; configured optimizer waits MUST NOT be inserted between compare transfer rows.
- Compare mode MUST use existing physics, cylinder, thermal, and equipment settings rather than a second thermal engine.
- Gas preset and equipment localStorage formats MUST remain unchanged.
- In-progress compare recipes MUST remain in memory only and MUST NOT be persisted.
- Compressor compare rows MUST accept only Air (`21/0`); Boost rows MUST require a finite positive source pressure.
- Compare Boost source pressure MUST be treated as constant during that transfer; finite source-cylinder depletion MUST NOT be invented.
- Invalid compare edits MUST NOT replace the most recent successful compare result.
- All new permanent tests MUST assert consumer-visible behavior, boundaries, transitions, or invariants rather than DOM wiring or tautological values.
- Run focused tests after each failing-test step and run `npm test` after all implementation tasks.

---

### Task 1: Add the pure compare-recipe model

**Files:**
- Create: `js/compare-recipe.js`
- Create: `tests/compare-recipe.test.js`

**Interfaces:**
- Consumes: current cylinder state `{ volumeL, initialPressureBar, initialOxygenPercent, initialHeliumPercent }`, physics `{ model, temperatureC }`, and `settings.gasPresets`.
- Produces:
  - `createCompareRow(type, id)` returning a fresh row for `keep`, `drain`, `add`, or `wait`.
  - `validateCompareRecipe(rows, { cylinder, gasPresets })` returning `{ valid, errors, normalizedRows }`, where each error is `{ rowId, field, message }`.
  - `buildCompareProtocol(rows, { cylinder, physics, gasPresets })` returning `{ protocolSteps, trajectory, initialMix }` after validation; it MUST throw only when called with an invalid draft that was not validated first.
  - `COMPARE_ROW_TYPES` and `COMPARE_METHODS` constants for UI rendering.

- [ ] **Step 1: Write failing model tests**

Create `tests/compare-recipe.test.js` with these behaviors:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCompareProtocol,
  createCompareRow,
  validateCompareRecipe
} from '../js/compare-recipe.js';

const cylinder = {
  volumeL: 12,
  workingPressureBar: 232,
  initialPressureBar: 50,
  initialOxygenPercent: 21,
  initialHeliumPercent: 0
};
const physics = { model: 'ideal', temperatureC: 20 };
const gasPresets = [
  { name: 'EAN32', oxygenPercent: 32, heliumPercent: 0 },
  { name: 'Trimix 18/45', oxygenPercent: 18, heliumPercent: 45 }
];

test('creates a keep row with independent state', async () => {
  const { createCompareRow: create } = await import('../js/compare-recipe.js');
  const first = create('keep', 'row-1');
  const second = create('keep', 'row-2');
  assert.deepEqual(first, { id: 'row-1', type: 'keep' });
  assert.notEqual(first, second);
});

test('validates ordered drain, add, and wait rows and normalizes preset gas', () => {
  const rows = [
    { id: 'keep', type: 'keep' },
    { id: 'drain', type: 'drain', targetPressureBar: 30 },
    {
      id: 'add', type: 'add',
      gas: { presetName: 'EAN32', name: '', oxygenPercent: 0, heliumPercent: 0 },
      targetPressureBar: 100, method: 'decant', sourcePressureBar: null
    },
    { id: 'wait', type: 'wait', waitMinutes: 7 }
  ];
  const result = validateCompareRecipe(rows, { cylinder, gasPresets });
  assert.equal(result.valid, true);
  assert.deepEqual(result.errors, []);
  assert.equal(result.normalizedRows[2].gas.name, 'EAN32');
  assert.equal(result.normalizedRows[2].gas.oxygenPercent, 32);
});

test('calculates cumulative composition from an add-gas target pressure', () => {
  const result = buildCompareProtocol([
    { id: 'keep', type: 'keep' },
    {
      id: 'add', type: 'add',
      gas: { presetName: null, name: 'EAN32', oxygenPercent: 32, heliumPercent: 0 },
      targetPressureBar: 100, method: 'decant', sourcePressureBar: null
    }
  ], { cylinder, physics, gasPresets });
  const add = result.protocolSteps[1];
  assert.equal(add.receiverStartPressureBar, 50);
  assert.equal(add.receiverEndPressureBar, 100);
  assert.ok(add.resultingMix.oxygenPercent > 21);
  assert.equal(result.trajectory.length, 2);
});
```

Also assert that validation rejects: an empty recipe; O₂ + He above 100%; an Add target below current pressure; a Drain target above current pressure; a negative wait; a Boost without positive source pressure; and a non-Air Compressor row. Assert each error identifies the offending row and field.

- [ ] **Step 2: Run the focused test and verify failure**

Run:

```sh
node --test tests/compare-recipe.test.js
```

Expected: FAIL because `js/compare-recipe.js` and its exported functions do not exist.

- [ ] **Step 3: Implement the row factory and validation**

Implement fresh row values:

```js
export function createCompareRow(type = 'keep', id = `compare-${Date.now()}-${Math.random()}`) {
  if (type === 'drain') return { id, type, targetPressureBar: 0 };
  if (type === 'add') return {
    id, type,
    gas: { presetName: null, name: 'Custom gas', oxygenPercent: 21, heliumPercent: 0 },
    targetPressureBar: 0,
    method: 'decant',
    sourcePressureBar: null
  };
  if (type === 'wait') return { id, type, waitMinutes: 0 };
  return { id, type: 'keep' };
}
```

Use `isValidGasComposition` from `js/gas-input.js` and the existing 0–350 bar / 0–1440 minute bounds. Resolve a preset by exact name, copy its name and percentages into `normalizedRows`, and never mutate the caller’s rows or settings. Validate ordered pressure transitions by simulating pressure-only row endpoints from the current initial pressure. For Compressor, compare percentages exactly to `21` and `0`; for Boost, require `sourcePressureBar > 0`.

- [ ] **Step 4: Implement ideal/VDW receiver composition conversion**

Import `calcMolarDensity` and `calcPressure` from `js/physics.js`. Track total, oxygen, and helium moles for the receiver. For an Add row, calculate current moles at the current pressure/mix and target moles at the target pressure/add-gas mix at `physics.temperatureC`; add the difference to each component. For Drain, scale all current moles by target/current total. Derive the resulting mix from cumulative component moles and emit `receiverStartPressureBar`, `receiverEndPressureBar`, `resultingPressureBar`, `resultingMix`, `sourceOxygenPercent`, `sourceHeliumPercent`, `recipeAction`, and `recipeGas`.

Emit one trajectory point for the initial state and one for every non-Keep protocol row:

```js
{
  step,
  label,
  oxygenPercent,
  heliumPercent,
  nitrogenPercent,
  pressureBar,
  pressureDeltaBar,
  color
}
```

Use `null`/empty source-bank fields for compare rows; do not fabricate bank IDs or source-end pressures.

- [ ] **Step 5: Run the focused model tests**

Run:

```sh
node --test tests/compare-recipe.test.js
```

Expected: PASS, including gas normalization, cumulative composition, transition validation, and method constraints.

- [ ] **Step 6: Commit the pure model**

```sh
git add js/compare-recipe.js tests/compare-recipe.test.js
git commit -m "feat: add compare recipe protocol model"
```

---

### Task 2: Simulate explicit compare protocol timing and endpoints

**Files:**
- Modify: `js/thermodynamics.js` near `simulateThermalProtocol` and its shared rate/sample helpers.
- Modify: `tests/thermodynamics.test.js` near existing sequential protocol tests.

**Interfaces:**
- Consumes: `buildCompareProtocol()` protocol steps with `type: 'keep' | 'drain' | 'add' | 'wait'`, `method`, receiver endpoints, source composition, and optional `sourcePressureBar`.
- Produces: `simulateCompareProtocol({ protocolSteps, cylinder, physics, thermal, settings })` returning `{ protocolSteps, final: { recipeEnd, ambientSettled, ambientSettledDurationMinutes } }`.
- Preserves: `simulateThermalProtocol()` output and optimizer-specific automatic final cool-off behavior.

- [ ] **Step 1: Write failing compare-thermal tests**

Add tests that assert:

```js
test('compare simulation honors an explicit wait instead of configured inter-step wait', () => {
  const result = simulateCompareProtocol({
    protocolSteps: [
      { type: 'keep', operation: 'Keep', resultingPressureBar: 50, resultingMix: { oxygenPercent: 21, heliumPercent: 0 } },
      { type: 'add', method: 'decant', operation: 'Decant', receiverStartPressureBar: 50, receiverEndPressureBar: 100, resultingPressureBar: 100, resultingMix: { oxygenPercent: 32, heliumPercent: 0 }, sourceOxygenPercent: 32, sourceHeliumPercent: 0 },
      { type: 'wait', operation: 'Wait', receiverStartPressureBar: 100, receiverEndPressureBar: 100, resultingPressureBar: 100, resultingMix: { oxygenPercent: 32, heliumPercent: 0 }, waitMinutes: 7 }
    ],
    cylinder: { initialPressureBar: 50, volumeL: 12 },
    physics: { model: 'ideal', temperatureC: 20 },
    thermal: { tankMaterial: 'steel', coolingMedium: 'air', ambientTemperatureC: 20, inletTemperatureC: 20 },
    settings: { booster: { otherDecantRateBarPerMin: 5, drainingRateBarPerMin: 5 } }
  });
  assert.equal(result.protocolSteps[2].thermal.waitMinutes, 7);
  assert.equal(result.final.recipeEnd.pressureBar, result.protocolSteps.at(-1).thermal.pressureAfterWaitBar);
  assert.equal(result.final.ambientSettled.temperatureC, 20);
});
```

Cover: a Drain uses the configured draining rate and signed cooling; a Decant uses its configured rate; a Boost uses `sourcePressureBar` as a constant source pressure; a Compressor uses the compressor rate; a Wait cools at fixed pressure; a final transfer returns a hot recipe endpoint; and the ambient-settled pressure is lower than the hot endpoint when cooling is required. Assert that an optimizer `simulateThermalProtocol()` regression fixture still has its existing full final wait.

- [ ] **Step 2: Run the focused tests and verify failure**

Run:

```sh
node --test tests/thermodynamics.test.js
```

Expected: FAIL because `simulateCompareProtocol` is not exported and explicit compare timing is not implemented.

- [ ] **Step 3: Extract reusable simulation flow without changing optimizer semantics**

Keep the existing `simulateThermalProtocol()` call path and its configured-wait/final-cool-off rules intact. Add a sibling `simulateCompareProtocol()` loop that reuses `rateForProtocolStep`, `estimateTransferTemperatureSamples`, `buildThermalStepSamples`, `calculateTemperatureAfterWait`, and `calculatePressureAtTemperature`. Keep compare-only wait policy in this sibling function rather than adding a mode flag to the optimizer path.

For compare steps:

- `keep`: append no transfer and no wait thermal step, preserving the row for result cards but allowing chart builders to omit a zero-change keep if existing behavior requires it.
- `drain`: map the configured draining rate and signed pressure change.
- `add` with Decant: map to the existing decant rate path.
- `add` with Boost: set the source start and source end values used by rate calculation to `sourcePressureBar`, so the source pressure is constant and no source depletion is implied.
- `add` with Compressor: map to the existing compressor rate path.
- `wait`: set duration to zero, transfer-end pressure/temperature equal to the current state, and use `waitMinutes` as the sole cooling interval.

Do not read `thermal.waitMinutes` or `thermal.waitMode` for finite compare waits. Carry post-wait pressure and temperature into the next row.

- [ ] **Step 4: Add endpoint projection**

After the last compare row, derive `recipeEnd` from the final simulated row’s post-row state and composition. Calculate `ambientSettled` with `calculatePressureAtTemperature` using the recipe-end pressure, mix, recipe-end temperature, ambient temperature, cylinder volume, and selected physics model. The settled temperature is `thermal.ambientTemperatureC`; O₂/He percentages remain unchanged. Include `ambientSettledDurationMinutes: 4.6 * tauMinutes` in the returned final object so chart rendering can place the projection at the correct elapsed time without duplicating the cooling-time-constant rules.

- [ ] **Step 5: Run focused thermodynamic tests**

Run:

```sh
node --test tests/thermodynamics.test.js
```

Expected: PASS with compare endpoint assertions and all existing optimizer thermal tests.

- [ ] **Step 6: Commit the simulation change**

```sh
git add js/thermodynamics.js tests/thermodynamics.test.js
git commit -m "feat: simulate compare recipe timing"
```

---

### Task 3: Add the compare recipe editor renderer and markup

**Files:**
- Create: `js/ui/compare-recipe.js`
- Create: `tests/compare-recipe-ui.test.js`
- Modify: `index.html` in the working-tank/results input area.
- Modify: `css/app.css` only for a focused editor rule that cannot be expressed with existing utilities.

**Interfaces:**
- Consumes: draft rows, gas presets, and `{ rowId, field, message }` validation errors.
- Produces: `renderCompareRecipe(container, { rows, gasPresets, errors })` and editor elements carrying delegated `data-action` values for `add-compare-row`, `remove-compare-row`, `move-compare-row-up`, `move-compare-row-down`, `run-compare`, and row-field input metadata.

- [ ] **Step 1: Write failing renderer tests**

Use the existing fake DOM style from `tests/results.test.js`. Assert that rendering rows produces:

- one row card for Keep, Drain, Add gas, and Wait;
- an Add gas card with preset selector, gas name, O₂, He, target pressure, method selector, and source pressure control;
- source pressure visible only for Boost;
- Compressor validation text visible for a non-Air row;
- move-up disabled for the first row and move-down disabled for the last row;
- an Add row button and Run comparison button;
- inline error text associated with its row field.

- [ ] **Step 2: Run the focused UI test and verify failure**

Run:

```sh
node --test tests/compare-recipe-ui.test.js
```

Expected: FAIL because the renderer module and compare editor markup do not exist.

- [ ] **Step 3: Add accessible compare-mode markup**

In `index.html` add:

- a mode control with two mutually exclusive buttons or tabs, `data-action="select-mode"`, `data-mode="optimize"|"compare"`, and visible selected state;
- a Compare recipe section with `id="compare-recipe-section"`, an explanatory description, `id="compare-recipe-editor"`, `id="compare-recipe-errors"`, and an explicit `data-action="run-compare"` button;
- a hidden compare summary container alongside the existing optimizer summary fields, with IDs for start, recipe-end, and ambient-settled state text;
- no removal of existing optimizer IDs or tab targets.

Use native labels, fieldset/legend or heading relationships, button types, and `aria-live="polite"` for run status/errors. Keep the existing responsive two-column layout.

- [ ] **Step 4: Implement `renderCompareRecipe`**

Render each row from current state rather than concatenating user-controlled HTML. Use `textContent` for names/errors, `input`/`select` values from the row, and `data-row-id` plus `data-compare-field` attributes for delegated main-controller updates. Gas preset selection must offer `Custom` and all current presets. When a row is custom, render editable name/O₂/He values; when preset-backed, still render the same editable values after normalization.

Set `aria-label` values that include the row number and field name. Keep invalid fields marked with `aria-invalid="true"` and render their exact error message beside the control.

- [ ] **Step 5: Run focused UI tests**

Run:

```sh
node --test tests/compare-recipe-ui.test.js
```

Expected: PASS.

- [ ] **Step 6: Commit editor markup and renderer**

```sh
git add index.html js/ui/compare-recipe.js tests/compare-recipe-ui.test.js css/app.css
git commit -m "feat: add compare recipe editor"
```

---

### Task 4: Integrate compare mode into the main controller

**Files:**
- Modify: `js/main.js` state, input collection, recalculation, event delegation, initialization, and tab/mode rendering paths.
- Modify: `js/ui/compare-recipe.js` for the renderer callback contract used by the controller.
- Create: `tests/compare-mode-markup.test.js`.

**Interfaces:**
- Consumes: `createCompareRow`, `validateCompareRecipe`, `buildCompareProtocol`, `simulateCompareProtocol`, and `renderCompareRecipe`.
- Produces: mode state with `optimize` and `compare`, independent in-memory compare rows, last successful compare result, and delegated row/mode actions.

- [ ] **Step 1: Add failing static/controller contract tests**

Add markup assertions that the mode selector has both mode values, the compare editor container exists, and the run action exists. Add pure tests where possible for a compare result branch helper rather than importing `main.js`, whose module initialization requires a browser DOM.

- [ ] **Step 2: Run focused static tests and verify failure**

Run:

```sh
node --test tests/compare-mode-markup.test.js tests/onboarding-markup.test.js
```

Expected: the new compare IDs/actions are absent before integration.

- [ ] **Step 3: Add state and mode rendering**

Extend `state` with:

```js
mode: 'optimize',
compareRows: [createCompareRow('keep', 'compare-row-1')],
compareErrors: [],
lastCompareInput: null,
lastCompareResult: null,
compareHasRun: false
```

Add `setMode(mode)` that accepts only `optimize` or `compare`, updates selected mode controls, toggles the optimizer-only target/supply-bank surfaces and compare editor, and renders the currently active result without changing either form’s values. Keep the existing `activeTab` behavior; entering Compare sets the Recipe tab only when a successful comparison is run.

- [ ] **Step 4: Add delegated compare editor actions**

Extend `handleInputOrChange` to update only the matching `state.compareRows` field using `data-row-id` and `data-compare-field`. On gas preset selection, copy the preset values into that row. Extend `handleClick` for Add/remove/move/run/mode actions. Re-render only the compare editor after draft edits; do not invoke simulation until Run comparison.

Generate unique row IDs in `main.js` with a monotonic counter rather than relying on timestamp collisions. Moving rows swaps array entries and preserves row objects/IDs.

- [ ] **Step 5: Add compare recalculation**

Implement `runCompare()`:

1. Collect the shared cylinder, physics, thermal, and settings values without requiring optimizer target fields or supply-bank feasibility.
2. Call `validateCompareRecipe` with current gas presets.
3. If invalid, store `compareErrors`, render the editor errors, and keep `lastCompareResult` unchanged.
4. If valid, call `buildCompareProtocol`, then `simulateCompareProtocol`.
5. Store the compare input/result, clear errors, render results/charts/ternary, and select the Recipe tab.

Refactor the existing `recalculate()` only enough to branch on `state.mode`; the optimizer branch must continue to call `validateCalculatorInputs` and `optimizeBlend` exactly as before. Update supply-bank/equipment rendering in both branches, but hide finite supply-bank controls while Compare is active because compare gas rows are not source-bank inventory.

- [ ] **Step 6: Run focused tests and the existing suite**

Run:

```sh
node --test tests/compare-mode-markup.test.js tests/compare-recipe.test.js tests/thermodynamics.test.js
npm test
```

Expected: PASS. A browser smoke check is required after the UI result tasks below because `main.js` has no isolated DOM test harness.

- [ ] **Step 7: Commit controller integration**

```sh
git add js/main.js index.html tests/compare-mode-markup.test.js
git commit -m "feat: route compare recipes through the app"
```

---

### Task 5: Render compare summaries and protocol results

**Files:**
- Modify: `js/ui/results.js` result dispatch, summary rendering, and protocol-card field handling.
- Modify: `index.html` compare summary markup if IDs/classes need alignment with the renderer.
- Modify: `tests/results.test.js` with compare fixtures.

**Interfaces:**
- Consumes: `{ mode: 'compare', compare: { protocolSteps, trajectory, initialMix, final } }`, where `final.recipeEnd` and `final.ambientSettled` have the exact fields specified in the design and `final.ambientSettledDurationMinutes` is the modeled full-cool-off duration.
- Produces: compare summary text and cards without optimizer-only accounting; optimizer result rendering remains byte-compatible in behavior.

- [ ] **Step 1: Write failing compare result tests**

Add a fixture with a Keep, Add, and Wait step plus:

```js
final: {
  recipeEnd: { pressureBar: 145.2, temperatureC: 38.1, oxygenPercent: 25.4, heliumPercent: 12.0 },
  ambientSettled: { pressureBar: 132.8, temperatureC: 25, oxygenPercent: 25.4, heliumPercent: 12.0 }
}
```

Assert the rendered compare summary contains both endpoint labels and values, contains no `Retained Gas`/`Helium salvaged` accounting, and renders each modeled row’s operation/pressure. Keep the existing exhausted-source and interim-reading tests passing.

- [ ] **Step 2: Run focused results tests and verify failure**

Run:

```sh
node --test tests/results.test.js
```

Expected: FAIL because `renderResults` currently assumes optimizer `blend` data and has no compare summary branch.

- [ ] **Step 3: Implement compare result dispatch**

Add a `mode`/compare branch before the existing optimizer feasibility branch. Toggle `summary-banner` and `compare-summary` visibility, clear optimizer-only fields while Compare is active, and render compare cards using the same DOM-safe card helpers. Format O₂/He as `Tx O₂/He`, pressure and temperature to one decimal place, and retain the existing thermal detail line vocabulary where it applies.

Do not alter optimizer result handling, maximum-pressure fallback rendering, source-end warnings, or interim-reading controls.

- [ ] **Step 4: Run focused results tests**

Run:

```sh
node --test tests/results.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit result rendering**

```sh
git add js/ui/results.js index.html tests/results.test.js
git commit -m "feat: render compare recipe outcomes"
```

---

### Task 6: Extend thermal charts and composition views for compare output

**Files:**
- Modify: `js/ui/thermal-charts.js` series/result adaptation and status wording.
- Modify: `js/ui/ternary.js` compare labels and empty-bank handling.
- Modify: `js/main.js` compare ternary-data adapter.
- Modify: `tests/thermal-charts.test.js` and `tests/ternary.test.js`.

**Interfaces:**
- Consumes: compare protocol steps, `final.recipeEnd`, `final.ambientSettled`, initial mix, and compare trajectory.
- Produces: thermal series containing manual rows and a terminal ambient-settled projection; ternary chart data with `banks: []`, initial mix, final mix, and manual trajectory.

- [ ] **Step 1: Write failing chart/trajectory tests**

Extend thermal tests with a compare series fixture containing an explicit Wait row and a terminal projection. Assert that:

- transfer and Wait rows produce start/transfer-end/settled points in order;
- explicit Wait duration appears in elapsed time;
- the final point is labelled `ambient-settled` and uses `final.ambientSettled` rather than the last entered row’s recipe-end state;
- bands cover only entered rows, while the terminal projection remains a distinct key point.

Add a ternary test that passes an empty bank list and a manual trajectory to the data adapter/helper and asserts the initial/final mix rows and trajectory rows remain available.

- [ ] **Step 2: Run focused chart tests and verify failure**

Run:

```sh
node --test tests/thermal-charts.test.js tests/ternary.test.js
```

Expected: the terminal compare projection and compare trajectory contract are absent.

- [ ] **Step 3: Extend `buildThermalSeries` with an optional terminal projection**

Preserve the existing call signature behavior for optimizer results. Add an optional third argument:

```js
buildThermalSeries(protocolSteps, initial, terminalProjection = null)
```

When present, append a distinct point after the entered series with phase `ambient-settled`, the terminal projection’s pressure/temperature, elapsed time equal to the entered endpoint elapsed time plus the modeled full-cool-off duration, and a label `Ambient-settled projection`. Keep existing three-point-per-entered-step table grouping intact; update the data-table builder to render the terminal point as its own accessible row rather than assuming every point belongs to a three-point group.

Update `renderThermalCharts` to read compare results, pass the projection, and say `compare recipe` in the status text. Existing optimizer status wording and measured-path behavior remain unchanged.

- [ ] **Step 4: Adapt ternary compare data**

In `main.js`, build compare ternary data from the current initial mix, the final recipe-end mix, the compare trajectory, and `banks: []`. In `js/ui/ternary.js`, replace optimizer-specific summary text such as `boost vectors` with a generic `recipe stages` label only when the input is Compare; preserve bank source rows and wording for optimizer input.

- [ ] **Step 5: Run focused chart tests**

Run:

```sh
node --test tests/thermal-charts.test.js tests/ternary.test.js
```

Expected: PASS with existing optimizer chart tests and new compare endpoint/trajectory coverage.

- [ ] **Step 6: Commit chart and diagram support**

```sh
git add js/ui/thermal-charts.js js/ui/ternary.js js/main.js tests/thermal-charts.test.js tests/ternary.test.js
git commit -m "feat: show compare thermal and composition history"
```

---

### Task 7: Update documentation and verify the complete feature

**Files:**
- Modify: `README.md`
- Modify: `docs/architecture.md`
- Modify: `docs/development.md`
- No permanent temporary scripts or fixtures.

**Interfaces:**
- Consumes: implemented compare mode and verified browser behavior.
- Produces: concise user-facing and maintainer-facing documentation with no unverified claims.

- [ ] **Step 1: Run the complete automated suite before documentation edits**

Run:

```sh
npm test
```

Expected: PASS for every existing and new test. Fix implementation/test defects before documenting behavior; do not weaken assertions.

- [ ] **Step 2: Run the browser smoke scenario**

Serve the app:

```sh
python3 -m http.server 8000
```

Open `http://127.0.0.1:8000/index.html` in a clean browser profile and verify:

1. Existing onboarding consent/tour behavior still works.
2. Optimize blend remains the default and reproduces the existing recipe flow.
3. Switching to Compare keeps the current cylinder/thermal/settings values and shows the editor.
4. Run `Keep → Drain → Add EAN32 by Decant → Wait 7 min → Add custom gas by Boost` with a valid source pressure.
5. Confirm compare cards show ordered rows and modeled transfer/wait values.
6. Confirm the summary shows recipe-end and ambient-settled pressure/mix/temperature separately.
7. Open Thermal graphs and verify drain, transfer, and Wait rows plus the terminal settled projection.
8. Open Diagram and Tank summary and verify the manual trajectory appears without fabricated bank rows.
9. Enter invalid O₂/He, non-Air Compressor, missing Boost source pressure, and reversed pressure targets; confirm inline errors and that the last successful comparison remains visible.
10. Switch back to Optimize blend and verify the existing optimizer result, supply banks, target fields, and tabs remain functional.
11. Confirm the browser console has no app module/runtime errors.

Stop the local server after verification.

- [ ] **Step 3: Update documentation**

In `README.md`, add a short Compare recipe section describing the mode switch, row types, gas presets/custom composition, transfer methods, Boost source pressure, and recipe-end versus ambient-settled output.

In `docs/architecture.md`, add `js/compare-recipe.js` and `js/ui/compare-recipe.js` to JavaScript boundaries and describe the optimizer/compare branch in data flow. State that compare rows are in-memory and that compare simulation reuses the thermodynamic engine without finite source-bank depletion.

In `docs/development.md`, add the verified Compare browser scenario and its validation/error checks. Do not claim persistence, import/export, source depletion, or side-by-side optimizer comparison.

- [ ] **Step 4: Run the final suite and inspect the diff**

Run:

```sh
npm test
```

Expected: PASS. Review the documentation against the committed spec and the observed browser scenario; remove any statement not exercised.

- [ ] **Step 5: Commit documentation and final verification**

```sh
git add README.md docs/architecture.md docs/development.md
git commit -m "docs: describe compare recipe mode"
```
