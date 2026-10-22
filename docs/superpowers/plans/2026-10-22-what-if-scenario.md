# What-if Scenario Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the minimal What-if result card with an independent, editable scenario planner that reuses the manual protocol engine and exposes the complete result surface without target-blend or Record actual behavior.

**Architecture:** Keep `js/compare-recipe.js` and `js/thermodynamics.js` as the manual planning/simulation core. Add a pure What-if scenario state/adapter module for snapshot ownership, shared-input signatures, terminal in-water projection, and result shaping. Extract the existing result markup into one cloneable result-panel template and make renderers root-scoped so Blending and What-if share the same result contract without duplicated DOM behavior. Route the new scenario editor and result panel through `js/main.js`.

**Tech Stack:** Browser-native ES modules, vanilla DOM/SVG/canvas, Tailwind CDN utility classes, Node built-in test runner, Playwright browser tests.

**Spec:** `docs/superpowers/specs/2026-10-22-what-if-scenario-design.md`

## Global Constraints

- What-if MUST initialize from Blending once and remain independent until explicit `Copy from Blending`.
- What-if MUST expose current pressure, O₂%, He%, ambient temperature, cylinder preset, surrounding medium, and in-water temperature, but MUST NOT expose a target blend or target pressure.
- What-if MUST use current shared Supply banks and equipment at run time without mutating persisted inventory or settings.
- What-if MUST model waits only from explicit Wait rows and MUST NOT inherit or insert the Blending global wait.
- Invalid drafts and shared-input changes MUST preserve the last successful result while clearly marking it stale.
- Manual Recipe results MUST include technical calculations and MUST omit `Record actual` controls.
- Optimize behavior, persistence formats, onboarding behavior, and existing Blending result semantics MUST remain unchanged.
- Existing thermodynamic helpers MUST remain the single implementation of transfer heating, cooling, and pressure-at-temperature projection.
- Permanent tests MUST assert behavior, boundaries, transitions, or invariants rather than DOM wiring or tautological values.
- Run focused tests after each task and run `npm test`, `npm run test:ui`, and `git diff --check` before completion.

## File map and responsibilities

- Create `js/what-if-scenario.js`: pure scenario draft construction, Blending snapshot conversion, shared-input signature construction, scenario input assembly, terminal in-water projection, and result-contract shaping.
- Create `js/ui/what-if-scenario.js`: render the independent starting tank, scenario conditions, snapshot status, Copy from Blending action, and the existing manual-row editor host.
- Create `js/ui/result-panel.js`: clone the one result-panel template, prefix instance IDs where needed, expose scoped logical result elements, and configure the result-tab set for Optimize or What-if.
- Modify `js/compare-recipe.js`: return source-bank start/end metadata required by What-if Tank summary without changing persisted bank values or existing planning decisions.
- Modify `js/thermodynamics.js`: preserve existing simulation behavior while exposing the final state data needed by the What-if adapter; do not create a second simulator.
- Modify `js/result-tabs.js`: support a scoped panel root and a caller-provided tab list; preserve existing Blending tab behavior.
- Modify `js/ui/results.js`: render through a supplied result root, add the What-if Summary contract, and route What-if Recipe data through the existing technical-details renderer with actual-reading controls disabled.
- Modify `js/ui/thermal-charts.js`, `js/ui/ternary.js`, and `js/ui/water-pressure.js` only where needed to accept scoped containers and What-if terminal/source data.
- Modify `index.html`: replace the single hard-coded result block with one shared template and two result hosts; replace the minimal What-if card with editor/result hosts.
- Modify `js/main.js`: own `whatIfScenario`, initialize/copy the snapshot, route scenario edits and runs, detect stale shared inputs, and render each screen’s scoped panel.
- Create `tests/what-if-scenario.test.js`: pure scenario state, signatures, terminal projection, and result-contract tests.
- Modify `tests/compare-recipe.test.js`: source-bank summary invariants.
- Modify `tests/results.test.js`: scoped result renderer and What-if Recipe behavior.
- Modify `tests/compare-mode-markup.test.js`: shared template, What-if controls, and result hosts.
- Create `tests/browser/what-if.spec.js`: end-to-end What-if behavior.
- Modify `tests/browser/blending.spec.js`, browser helpers, and navigation helpers: remove obsolete minimal-card assumptions and keep Blending coverage focused on Blending.
- Modify `docs/UI.md`, `docs/architecture.md`, and `docs/development.md`: document the independent scenario and verified user flow.

---

### Task 1: Add pure What-if scenario state and terminal projection

**Files:**
- Create: `js/what-if-scenario.js`
- Create: `tests/what-if-scenario.test.js`
- Modify: `js/thermodynamics.js` only if a small exported projection helper is required by the new pure module

**Interfaces:**
- Consumes a Blending input shaped like `{ cylinder, physics, thermal }`, shared `{ settings, banks }`, and scenario draft values.
- Produces:
  - `createWhatIfScenario()` returning `{ initialized: false, start: null, rows: [createCompareRow('drain', 'compare-row-1')], result: null, draftRevision: 0, resultRevision: -1, sharedInputSignature: null }`.
  - `snapshotWhatIfFromBlending(blendingInput)` returning independent `start` values for pressure, O₂, He, ambient temperature, cylinder preset name, cooling medium, and in-water temperature.
  - `applyWhatIfStartPatch(scenario, patch)` returning a new scenario with incremented `draftRevision`, without mutating the input.
  - `whatIfDraftSignature(scenario)` returning a stable JSON signature of independent start values and ordered rows.
  - `whatIfSharedInputSignature({ settings, banks, cylinderPresetName })` returning a stable signature of the shared values used for a run.
  - `buildWhatIfInput(scenario, { settings, banks })` returning `{ cylinder, physics, thermal, banks, settings }`, with no target-pressure or target-mix properties.
  - `projectWhatIfInWater(finalState, { inWaterTemperatureC, volumeL, useVdw })` returning `{ pressureBar, temperatureC, oxygenPercent, heliumPercent }` from the ambient-settled state.

- [ ] **Step 1: Write failing pure-model tests**

Add tests that prove:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyWhatIfStartPatch,
  buildWhatIfInput,
  createWhatIfScenario,
  projectWhatIfInWater,
  snapshotWhatIfFromBlending,
  whatIfDraftSignature,
  whatIfSharedInputSignature
} from '../js/what-if-scenario.js';

const blendingInput = {
  cylinder: {
    presetName: 'Catalina S80',
    volumeL: 11.1,
    workingPressureBar: 207,
    hotOverfillPercent: 2,
    initialPressureBar: 50,
    initialOxygenPercent: 21,
    initialHeliumPercent: 0,
    targetPressureBar: 200,
    targetOxygenPercent: 18,
    targetHeliumPercent: 45
  },
  physics: { model: 'vdw', temperatureC: 25 },
  thermal: {
    tankMaterial: 'aluminum',
    tankMassKg: 14.3,
    coolingMedium: 'water',
    ambientTemperatureC: 25,
    targetInWaterTemperatureC: 10,
    inletTemperatureC: 25,
    waitMode: 'minutes',
    waitMinutes: 7
  }
};

test('snapshots only What-if starting fields and omits all targets', () => {
  const start = snapshotWhatIfFromBlending(blendingInput);
  assert.deepEqual(start, {
    pressureBar: 50,
    oxygenPercent: 21,
    heliumPercent: 0,
    ambientTemperatureC: 25,
    cylinderPresetName: 'Catalina S80',
    coolingMedium: 'water',
    inWaterTemperatureC: 10
  });
  assert.equal('targetPressureBar' in start, false);
  assert.equal('targetOxygenPercent' in start, false);
});

test('scenario patches are independent and advance the draft revision', () => {
  const first = createWhatIfScenario();
  const initialized = { ...first, initialized: true, start: snapshotWhatIfFromBlending(blendingInput) };
  const updated = applyWhatIfStartPatch(initialized, { pressureBar: 80 });
  assert.equal(updated.start.pressureBar, 80);
  assert.equal(initialized.start.pressureBar, 50);
  assert.equal(updated.draftRevision, initialized.draftRevision + 1);
});

test('scenario input resolves the selected shared cylinder but retains independent start values', () => {
  const scenario = {
    ...createWhatIfScenario(),
    initialized: true,
    start: { ...snapshotWhatIfFromBlending(blendingInput), pressureBar: 80 }
  };
  const settings = {
    physics: { model: 'ideal' },
    cylinderPresets: [{ name: 'Catalina S80', volumeL: 11.1, material: 'aluminum', massKg: 14.3, workingPressureBar: 207, hotOverfillPercent: 2 }]
  };
  const input = buildWhatIfInput(scenario, { settings, banks: [] });
  assert.equal(input.cylinder.initialPressureBar, 80);
  assert.equal(input.cylinder.targetPressureBar, undefined);
  assert.equal(input.thermal.targetInWaterTemperatureC, undefined);
  assert.equal(input.thermal.inWaterTemperatureC, 10);
});

test('in-water projection uses the explicit scenario temperature', () => {
  const projection = projectWhatIfInWater({
    pressureBar: 200,
    temperatureC: 25,
    oxygenPercent: 18,
    heliumPercent: 45
  }, { inWaterTemperatureC: 10, volumeL: 11.1, useVdw: false });
  assert.equal(projection.temperatureC, 10);
  assert.ok(projection.pressureBar < 200);
  assert.equal(projection.oxygenPercent, 18);
  assert.equal(projection.heliumPercent, 45);
});
```

Also assert that draft signatures change for an edited start value or reordered row, while shared signatures change for a bank/equipment change and not for an unrelated UI-only field.

- [ ] **Step 2: Run focused tests and verify failure**

Run:

```sh
node --test tests/what-if-scenario.test.js
```

Expected: FAIL because `js/what-if-scenario.js` does not yet exist.

- [ ] **Step 3: Implement the pure scenario functions**

Copy only the seven approved start fields from the Blending input. Build the cylinder from the selected current Settings preset plus independent initial pressure/composition. Build thermal input with ambient temperature and surrounding medium, preserve the existing shared inlet-gas temperature required by the thermal model, and place the scenario in-water temperature in a separate field. Do not carry target pressure, target composition, or global wait values into the scenario input.

Use `calculatePressureAtTemperature` from `js/thermodynamics.js` for the in-water projection. Return fresh objects and fresh row arrays from every state update. Keep signatures deterministic by serializing only behavior-affecting fields in stable object order.

- [ ] **Step 4: Run focused tests**

Run:

```sh
node --test tests/what-if-scenario.test.js
```

Expected: PASS for snapshot omission, independence, input assembly, projection, and signatures.

- [ ] **Step 5: Commit the scenario model**

```sh
git add js/what-if-scenario.js tests/what-if-scenario.test.js
git commit -m "feat: add independent what-if scenario model"
```

---

### Task 2: Add source-bank summaries to the existing manual protocol

**Files:**
- Modify: `js/compare-recipe.js`
- Modify: `tests/compare-recipe.test.js`

**Interfaces:**
- Consumes: existing `buildCompareProtocol(rows, { cylinder, physics, banks, settings, waitStates })` inputs.
- Produces: the existing `{ protocolSteps, trajectory, initialMix }` fields unchanged, plus `sourceBanks` containing only banks used by at least one Add row:

```js
[
  {
    id,
    name,
    initial: { pressureBar, moles, oxygenPercent, heliumPercent },
    final: { pressureBar, moles, oxygenPercent, heliumPercent }
  }
]
```

Compressor Air is represented with `initial` and `final` pressure/moles set to `null` and its composition retained; it is not treated as a finite inventory bank.

- [ ] **Step 1: Write failing source-summary tests**

Extend `tests/compare-recipe.test.js` with a finite-bank transfer that asserts:

```js
const result = buildCompareProtocol([{
  id: 'add-he',
  type: 'add',
  bankId: 'he-bank',
  pressureAddedBar: 150,
  targetPressureBar: 200,
  pressureInputMode: 'target'
}], { cylinder, banks, physics, settings });

assert.deepEqual(result.sourceBanks.map(bank => bank.id), ['he-bank']);
assert.equal(result.sourceBanks[0].initial.pressureBar, 200);
assert.ok(result.sourceBanks[0].final.pressureBar < 200);
assert.equal(banks[0].pressureBar, 200);
```

Also assert that an unused enabled bank is absent and Compressor Air does not report finite depletion.

- [ ] **Step 2: Run the focused test and verify failure**

Run:

```sh
node --test tests/compare-recipe.test.js
```

Expected: FAIL because `sourceBanks` is not returned.

- [ ] **Step 3: Implement source summary accumulation**

Record the first copied finite source state when a bank is first used and the final copied state after all rows have been processed. Preserve current source accounting, pressure floors, stage selection, and caller-bank immutability. Return summaries in first-use order for deterministic rendering.

- [ ] **Step 4: Run focused tests**

Run:

```sh
node --test tests/compare-recipe.test.js
```

Expected: PASS, including all existing planning behavior and the new summary invariants.

- [ ] **Step 5: Commit the protocol metadata**

```sh
git add js/compare-recipe.js tests/compare-recipe.test.js
git commit -m "feat: expose what-if source bank summaries"
```

---

### Task 3: Extract a shared, scoped result panel

**Files:**
- Create: `js/ui/result-panel.js`
- Modify: `index.html`
- Modify: `js/result-tabs.js`
- Modify: `js/ui/results.js`
- Modify: `js/ui/thermal-charts.js`
- Modify: `js/ui/ternary.js`
- Modify: `js/ui/water-pressure.js` only if a scoped container call is needed
- Modify: `tests/compare-mode-markup.test.js`
- Modify: `tests/results.test.js`

**Interfaces:**
- `createResultPanel(document, host, { mode: 'optimize' | 'what-if', instancePrefix })` clones the one `#result-panel-template` into `host` and returns a panel root.
- `getResultElement(root, key)` returns the element carrying `data-result-key={key}` within that panel.
- `getResultTabs(mode)` returns the existing five Blending tabs for Optimize and `[scenario-summary, recipe, thermal, water-pressure, summary, ternary]` for What-if.
- `setResultTab(root, tabId, tabs = getResultTabs('optimize'))` scopes all pane/button lookups to `root` and preserves ARIA selection and keyboard behavior.
- `renderResults(result, calculation, { root = document, mode = 'optimize' } = {})` renders only inside `root` and keeps its current two-argument call valid for existing tests.
- `renderThermalCharts(result, input, units, { root = document } = {})` scopes chart/status/readout elements to `root`.
- `renderTernaryDiagram(canvas, data, { root = document } = {})` scopes accessible tables, hover readout, and status to `root`.

- [ ] **Step 1: Write markup and scoping tests**

Update markup tests to assert one `result-panel-template`, separate Blending/What-if result hosts, What-if start/result hosts, the scenario-summary tab, and no What-if target controls. Add renderer tests that create two panel roots and prove a What-if render does not change the Blending root’s result text.

Add a result test that calls:

```js
renderResults(whatIfResult, whatIfInput, {
  root: whatIfRoot,
  mode: 'what-if'
});
```

and asserts technical details render without `/record actual/i`.

- [ ] **Step 2: Run focused tests and verify failure**

Run:

```sh
node --test tests/compare-mode-markup.test.js tests/results.test.js
```

Expected: FAIL because the template/hosts and scoped renderer interfaces do not exist.

- [ ] **Step 3: Move the current result markup into one template**

Move the current Blending right-column result navigation/panes into `#result-panel-template`. Preserve all existing logical result keys and accessible labels. Add a `scenario-summary` pane and add a source-bank summary host to the existing Tank summary pane. Mount the template once in the Blending host and once in the What-if host through `createResultPanel`; use the existing logical IDs for Blending compatibility and prefixed IDs/data keys for What-if.

Do not create a second hand-maintained copy of the result markup. Keep all existing Blending pane labels and layout classes unless the shared two-panel layout requires a scoped wrapper.

- [ ] **Step 4: Refactor tab and renderer lookups to use panel roots**

Replace `document.getElementById` calls in result-specific renderers with `getResultElement(root, logicalKey)` or a passed container. Keep default `root = document` behavior so existing unit tests and Blending callers remain valid. Ensure the ternary pointer readout and accessible tables are bound to the canvas’s panel, not the first document-global match. Ensure thermal hover bindings are per panel and do not share the other screen’s readout.

Keep the existing five-tab Optimize contract unchanged. Add the What-if Summary tab only when the What-if tab set is supplied.

- [ ] **Step 5: Run focused tests**

Run:

```sh
node --test tests/compare-mode-markup.test.js tests/results.test.js
```

Expected: PASS, including existing Optimize technical-detail and Record actual tests plus scoped What-if rendering.

- [ ] **Step 6: Commit the shared result panel**

```sh
git add index.html js/ui/result-panel.js js/result-tabs.js js/ui/results.js js/ui/thermal-charts.js js/ui/ternary.js js/ui/water-pressure.js tests/compare-mode-markup.test.js tests/results.test.js
git commit -m "refactor: share scoped result panels"
```

---

### Task 4: Build the independent What-if editor

**Files:**
- Create: `js/ui/what-if-scenario.js`
- Modify: `js/ui/compare-recipe.js`
- Modify: `index.html`
- Modify: `tests/compare-mode-markup.test.js`

**Interfaces:**
- `renderWhatIfScenarioEditor(container, { scenario, cylinderPresets, units, errors, sharedInputChanged })` renders the start/conditions controls and the manual editor host.
- Controls use `data-action="copy-what-if-from-blending"`, `data-action="run-what-if"`, `data-what-if-field`, and the existing `data-row-id`/`data-compare-field` attributes for rows.
- `renderCompareRecipe` continues to render ordered drain/add/wait rows, but its run button label becomes `Run scenario` when called from What-if and it never adds an implicit wait.

- [ ] **Step 1: Write markup/editor tests**

Assert that the What-if screen contains labeled controls for:

- starting pressure;
- starting O₂ and He;
- cylinder preset;
- ambient temperature;
- surrounding medium;
- in-water temperature;
- Copy from Blending;
- Run scenario.

Assert that it does not contain `target-p`, `target-o2`, `target-he`, or the Blending global wait controls. Assert that changing the editor’s rendered field values does not require or expose a `Record actual` control.

- [ ] **Step 2: Run focused markup tests and verify failure**

Run:

```sh
node --test tests/compare-mode-markup.test.js
```

Expected: FAIL because the new controls and editor renderer are absent.

- [ ] **Step 3: Implement the editor renderer**

Render the current scenario values in canonical units converted to the active display units. Render cylinder options from current Settings and show the selected preset’s volume/material/mass/working-pressure hint. Render a copied-state status and shared-input-stale status with `role="status"`. Render the existing Compare row editor below the scenario fields, passing only current shared enabled banks and the scenario’s rows.

On a field change, preserve user-entered draft values until validation/run. On cylinder changes, keep the independent pressure/composition fields and only change the selected preset.

- [ ] **Step 4: Run focused markup tests**

Run:

```sh
node --test tests/compare-mode-markup.test.js
```

Expected: PASS for the What-if field set, absence of target controls, and row-editor contract.

- [ ] **Step 5: Commit the editor surface**

```sh
git add js/ui/what-if-scenario.js js/ui/compare-recipe.js index.html tests/compare-mode-markup.test.js
git commit -m "feat: add independent what-if editor"
```

---

### Task 5: Integrate scenario lifecycle, calculations, and full results

**Files:**
- Modify: `js/main.js`
- Modify: `js/ui/results.js`
- Modify: `js/ui/thermal-charts.js`
- Modify: `js/ui/ternary.js`
- Modify: `js/ui/water-pressure.js`
- Modify: `js/ui/what-if-scenario.js`
- Modify: `tests/what-if-scenario.test.js`
- Modify: `tests/results.test.js`

**Interfaces:**
- `main.js` owns `state.whatIfScenario` and calls the pure functions from Task 1.
- `runWhatIf()` reads current scenario state and shared Settings/banks, validates with `compareSharedInputErrors` adapted to the scenario input, calls `buildCompareProtocol`, calls `simulateCompareProtocol`, projects in-water state, and stores:

```js
{
  mode: 'what-if',
  input: scenarioInput,
  sharedInputSignature,
  pressureLimitWarnings,
  compare: {
    ...protocol,
    ...simulation,
    final: { ...simulation.final, inWater }
  }
}
```

- `renderResults(..., { mode: 'what-if' })` renders the complete panel; `renderWhatIfResult` and the old minimal `#what-if-result` renderer are removed after all callers migrate.

- [ ] **Step 1: Write failing integration tests**

Add pure result-contract tests that build a valid scenario with a drain and explicit wait, then assert:

```js
assert.equal(result.mode, 'what-if');
assert.equal(result.compare.final.inWater.temperatureC, 10);
assert.ok(Number.isFinite(result.compare.final.inWater.pressureBar));
assert.ok(result.compare.sourceBanks.length >= 0);
```

Assert that an invalid row leaves the prior `state.whatIfScenario.result` unchanged, increments the draft revision, and reports the row error. Assert that changing a shared bank produces a different shared signature and stale status.

- [ ] **Step 2: Run focused integration tests and verify failure**

Run:

```sh
node --test tests/what-if-scenario.test.js tests/results.test.js
```

Expected: FAIL because `main.js` still uses the minimal compare result path and the full What-if result contract is not assembled.

- [ ] **Step 3: Initialize and snapshot scenario state in `main.js`**

Initialize `state.whatIfScenario` with `createWhatIfScenario()`. On the first successful navigation to What-if, read current Blending values and set `initialized`, `start`, and the default row list exactly once. Implement the explicit Copy from Blending action to replace only `start`, clear errors/result, and advance `draftRevision`.

Route What-if field/row changes through immutable updates. Re-render only the What-if editor and its result-status state while leaving Blending inputs untouched. Keep current shared bank/settings changes available to both screens.

- [ ] **Step 4: Implement `runWhatIf()` and stale handling**

Resolve the selected current cylinder and shared bank/equipment values. Validate the scenario start, rows, and shared pressure policy before building the protocol. Use `compareWaitStates`, `buildCompareProtocol`, and `simulateCompareProtocol` so later Add rows consume complete modeled Wait states. Add the explicit in-water projection from Task 1 and collect pressure warnings with What-if step identifiers.

On success, store the complete result, set `resultRevision = draftRevision`, store the shared signature, clear scenario errors, and render all result panes. On validation or simulation failure, preserve the previous result, set stale status, and render errors. Mark the result stale whenever a scenario draft revision differs from the result revision or the current shared signature differs from the stored signature.

- [ ] **Step 5: Connect Summary, thermal, water-pressure, tank, and simplex panes**

Implement the What-if Summary pane from `compare.final`, duration/temperature aggregation, and warnings. Pass the scenario terminal projection into `renderThermalCharts` so its terminal points include ambient-settled and explicit in-water projection. Pass ambient-settled composition/pressure and the scenario cylinder into the existing water projection renderer, adding a highlighted explicit in-water row/label without calling it a target.

Pass `compare.sourceBanks` and the manual trajectory into Tank summary and Simplex. The Simplex pane must show an unavailable status for invalid/incomplete trajectory data, not throw or show optimizer target data. Ensure scoped canvases/tables/readouts render inside the What-if panel.

- [ ] **Step 6: Run focused tests**

Run:

```sh
node --test tests/what-if-scenario.test.js tests/results.test.js tests/compare-recipe.test.js
```

Expected: PASS, including snapshot independence, source summaries, full terminal states, technical Recipe details, stale preservation, and scoped result rendering.

- [ ] **Step 7: Commit end-to-end integration**

```sh
git add js/main.js js/ui/results.js js/ui/thermal-charts.js js/ui/ternary.js js/ui/water-pressure.js js/ui/what-if-scenario.js tests/what-if-scenario.test.js tests/results.test.js
git commit -m "feat: integrate full what-if scenario results"
```

---

### Task 6: Add browser acceptance coverage and update documentation

**Files:**
- Create: `tests/browser/what-if.spec.js`
- Modify: `tests/browser/helpers/blending.js`
- Modify: `tests/browser/helpers/navigation.js` if tab helpers need the scenario-summary tab
- Modify: `tests/browser/blending.spec.js`
- Modify: `docs/UI.md`
- Modify: `docs/architecture.md`
- Modify: `docs/development.md`

**Interfaces:**
- Browser helpers expose user-level actions such as `openWhatIf(page)`, `fillWhatIfStart(page, values)`, `setWhatIfRow(page, rowId, values)`, `runWhatIf(page)`, and `assertWhatIfResultPanelExclusive(page, tabName)`.
- Existing Blending helpers continue to target the Blending result root and must not depend on What-if hosts.

- [ ] **Step 1: Add the failing browser scenarios**

Create tests that cover:

1. entering What-if copies current Blending pressure, composition, ambient, cylinder, medium, and in-water temperature;
2. editing What-if start values leaves Blending values unchanged;
3. Copy from Blending explicitly replaces edited scenario start values;
4. a drain, add-gas, and explicit wait sequence runs successfully;
5. Summary shows start/recipe-end/ambient/in-water states;
6. Recipe shows technical details and no Record actual control;
7. Thermal Graph, In-water pressure, Tank summary, and Simplex tabs render or show their documented unavailable state;
8. changing a shared bank after a run marks the result stale;
9. disabling/removing a selected bank identifies the affected row;
10. invalid draft reruns preserve the previous valid result;
11. keyboard tab navigation and narrow layout remain contained.

Use the existing fixture and storage helpers. Do not add a second storage format or rely on test order.

- [ ] **Step 2: Run the new browser file and verify failure**

Run:

```sh
npx playwright test tests/browser/what-if.spec.js
```

Expected: FAIL against the unimplemented full scenario surface.

- [ ] **Step 3: Implement browser helpers and migrate obsolete tests**

Add the new What-if helpers using role/data-action selectors. Move the current What-if tests out of `tests/browser/blending.spec.js` or rewrite them against the new screen contract; remove assertions against `#what-if-result`, `run-compare`, and the old minimal-card wording. Preserve the existing Warning-mode pressure coverage in the new What-if suite with the full result panel.

- [ ] **Step 4: Run focused browser coverage**

Run:

```sh
npx playwright test tests/browser/what-if.spec.js tests/browser/blending.spec.js tests/browser/results.spec.js
```

Expected: PASS with no same-origin console errors, failed requests, or accessibility/runtime failures.

- [ ] **Step 5: Update product and architecture documentation**

Document in `docs/UI.md` that What-if is an independent snapshot scenario with explicit in-water temperature, manual waits, a full right-side result navigation, and no Record actual controls. Document in `docs/architecture.md` the scenario/result-panel boundaries, shared run-time bank/equipment inputs, scoped result renderers, and terminal projection contract. Add the verified browser scenario and exact stale/error checks to `docs/development.md`; do not claim persistence or inventory depletion.

- [ ] **Step 6: Run the complete verification suite**

Run:

```sh
npm test
npm run test:ui
git diff --check
```

Expected: all Node and Playwright tests pass, and `git diff --check` emits no whitespace errors.

- [ ] **Step 7: Commit browser coverage and documentation**

```sh
git add tests/browser/what-if.spec.js tests/browser/helpers/blending.js tests/browser/helpers/navigation.js tests/browser/blending.spec.js docs/UI.md docs/architecture.md docs/development.md
git commit -m "test: verify independent what-if scenarios"
```

---

## Final review checklist

- [ ] `npm test` passes.
- [ ] `npm run test:ui` passes.
- [ ] `git diff --check` passes.
- [ ] Optimize and existing Blending flows remain unchanged.
- [ ] What-if has independent start state and explicit Copy from Blending.
- [ ] What-if has no target blend/target pressure controls.
- [ ] Current shared banks/equipment are used without persistence mutation.
- [ ] Explicit waits are the only waits in a manual scenario.
- [ ] Full result navigation renders in the What-if panel.
- [ ] Recipe technical details render without Record actual controls.
- [ ] In-water pressure uses explicit scenario temperature.
- [ ] Tank summary includes source-bank projections and stage states.
- [ ] Simplex unavailable states are explicit and non-throwing.
- [ ] Invalid drafts and shared-input changes preserve and label the last valid result.
- [ ] UI, architecture, and development documentation match verified behavior.
