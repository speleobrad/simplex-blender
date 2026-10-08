# Modular HTML App Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Separate the scuba gas remixer into markup, CSS, and functional native JavaScript modules while preserving its calculations and interactions, then document the project in focused pages under `docs/`.

**Architecture:** Keep the existing HTML entry filename and load native ES modules from a no-build static site. Isolate physics, simplex, and blend planning from DOM-rendering modules; `main.js` owns UI state and coordinates renderers. Preserve the existing Tailwind CDN and fonts.

**Tech Stack:** HTML, CSS, browser ES modules, Node.js built-in test runner, existing Tailwind CDN.

**Spec:** `docs/superpowers/specs/2026-10-07-modular-refactor-design.md`

## Global Constraints

- Use browser-native ES modules without a bundler or runtime dependencies.
- Keep the existing HTML filename and serve it over HTTP; module imports do not work from `file://`.
- Keep the existing Tailwind CDN and Google Fonts dependencies unchanged.
- Keep equation constants, objective weights, LP constraints, bank defaults, feasible/infeasible behavior, protocol ordering, and displayed units unchanged.
- Limit optimization to eliminating repeated reads/calculations and scoping view renders; do not redesign equations, the objective, solver, or UX.
- Keep calculation code DOM-free, pass explicit data across the domain/UI boundary, remove implicit globals/inline handlers, and render user-entered bank names as text.
- Keep documentation topic-focused; link between pages instead of duplicating full explanations.

---

## File Map

- Modify `scuba_gas_remixer_simplex_optimizer.html`: markup and external asset references only.
- Create `css/app.css`: custom scrollbar and tableau cell rules.
- Create `js/tailwind-config.js`: existing Tailwind theme configuration as a classic script.
- Create `js/physics.js`: pure gas-model functions.
- Create `js/simplex.js`: two-phase simplex solver.
- Create `js/optimizer.js`: LP assembly, solver call, blend metrics, protocol steps, and trajectory.
- Create `js/ui/supply-banks.js`: supply-bank table rendering.
- Create `js/ui/results.js`: status, result summary, and protocol rendering.
- Create `js/ui/tableau.js`: simplex snapshot rendering and step controls.
- Create `js/ui/ternary.js`: canvas drawing, pointer composition readout, and resize observer setup.
- Create `js/main.js`: form reads, event delegation, mutable UI state, optimization orchestration, and initial render.
- Create `package.json`: native ESM mode and `node --test` script; no dependencies.
- Create `tests/physics.test.js`, `tests/optimizer.test.js`, and `tests/simplex.test.js`: pure-domain and solver behavior contracts.
- Create `docs/README.md`, `docs/architecture.md`, `docs/gas-physics.md`, `docs/optimizer.md`, and `docs/development.md`.
- Retain `docs/superpowers/specs/2026-10-07-modular-refactor-design.md` as the design contract.

## Task 1: Extract gas physics behind tested pure functions

**Files:**
- Create: `tests/physics.test.js`
- Create: `js/physics.js`
- Create: `package.json`

**Interfaces:**
- Produces `getMixParams(o2Percent, heliumPercent)`, `calcPressure(molarDensity, o2Percent, heliumPercent, temperatureC, useVdw = true)`, `calcMolarDensity(pressureBar, o2Percent, heliumPercent, temperatureC, useVdw = true)`, `calcZ(pressureBar, o2Percent, heliumPercent, temperatureC, useVdw = true)`, and `calcZFromDensity(pressureBar, molarDensity, temperatureC, useVdw = true)` from `js/physics.js`.
- Exports `GAS_CONSTANT = 0.083144626` in bar·L/(mol·K).
- Tests use literal characterization values from the current app: ideal-gas pressure at 1 mol/L, 21/0 mix, 20 °C is 24.3738471119 bar; VDW density at 200 bar, 18/45, 20 °C is 7.263268210473831 mol/L.

- [ ] **Step 1: Configure the native Node test runner**

Create `package.json` with exactly this project setup and no dependencies:

```json
{
  "type": "module",
  "scripts": {
    "test": "node --test"
  }
}
```

- [ ] **Step 2: Write the failing physics tests**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { calcMolarDensity, calcPressure, calcZ, calcZFromDensity } from '../js/physics.js';

test('ideal-gas pressure uses kelvin and bar-litres per mole', () => {
  assert.ok(Math.abs(calcPressure(1, 21, 0, 20, false) - 24.3738471119) < 1e-10);
});

test('VDW density matches the current 200-bar trimix calculation', () => {
  assert.ok(Math.abs(calcMolarDensity(200, 18, 45, 20, true) - 7.263268210473831) < 1e-10);
});

test('VDW pressure round-trips the requested state and zero pressure is neutral', () => {
  const density = calcMolarDensity(200, 18, 45, 20, true);
  assert.ok(Math.abs(calcPressure(density, 18, 45, 20, true) - 200) < 1e-8);
  assert.equal(calcMolarDensity(0, 18, 45, 20, true), 0);
  assert.equal(calcZ(0, 18, 45, 20, true), 1);
});

test('compressibility uses an already calculated density with the same model', () => {
  assert.ok(Math.abs(calcZFromDensity(200, 7.263268210473831, 20, true) - 1.1297278403662991) < 1e-12);
  assert.equal(calcZFromDensity(0, 0, 20, true), 1);
  assert.equal(calcZFromDensity(200, 3, 20, false), 1);
});
```

- [ ] **Step 3: Run the tests to observe the missing module**

Run: `node --test tests/physics.test.js`
Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `js/physics.js`; this names the unimplemented module boundary.

- [ ] **Step 4: Create the gas physics module**

Move the real-gas constants and equations from the current `RealGasEngine` into exported functions. Preserve the VDW mixture rules (`aMix = (Σ yi√ai)²`, `bMix = Σ yi bi`), ideal-gas branch, Newton-Raphson limits (40 iterations, current convergence/clamp thresholds), and `Z = P/(ρRT)`. Replace `this.R`/`this.params` with module constants and keep all functions DOM-free.

- [ ] **Step 5: Run the physics tests**

Run: `node --test tests/physics.test.js`
Expected: PASS, 4 tests, 0 failures.

## Task 2: Characterize and extract blend optimization and simplex behavior

**Files:**
- Create: `tests/optimizer.test.js`
- Create: `tests/simplex.test.js`
- Create: `js/simplex.js`
- Create: `js/optimizer.js`
- Modify: `js/physics.js` only if its public API needs a directly evidenced correction from Task 2 tests.

**Interfaces:**
- `solveTwoPhaseSimplex(tableau, decisionVariableCount, constraintCount, variableNames, costVector)` returns `{ feasible, solution?, steps, cost?, error? }` and mutates only the local tableau passed by `optimizeBlend`.
- `optimizeBlend(input)` accepts:

```js
{
  cylinder: {
    volumeL, initialPressureBar, initialOxygenPercent, initialHeliumPercent,
    targetPressureBar, targetOxygenPercent, targetHeliumPercent
  },
  physics: { model: 'vdw' | 'ideal', temperatureC },
  banks: [{ id, name, volumeL, pressureBar, minimumPressureBar,
            oxygenPercent, heliumPercent, enabled }]
}
```

- It returns `{ feasible, error, gas, bankMetrics, solution, tableauSteps, blend, protocolSteps, trajectory }`. `gas` always contains initial/target moles and compressibility factors. `bankMetrics` contains one compressibility factor and available-mole limit per bank, shared by the optimizer and supply-table renderer. On success `blend` contains retained pressure/percent, vented pressure/moles/equivalent litres at 1 bar, pure-helium-equivalent litres saved, and final pressure/fractions; `protocolSteps` and `trajectory` contain all display data and no DOM nodes. On infeasibility, `blend` is `null`, `protocolSteps` and `trajectory` are empty, and solver snapshots/error remain available.

- [ ] **Step 1: Write tests against the established current-page result**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { optimizeBlend } from '../js/optimizer.js';

const defaultInput = {
  cylinder: {
    volumeL: 12,
    initialPressureBar: 80,
    initialOxygenPercent: 21,
    initialHeliumPercent: 35,
    targetPressureBar: 210,
    targetOxygenPercent: 18,
    targetHeliumPercent: 45
  },
  physics: { model: 'vdw', temperatureC: 20 },
  banks: [
    { id: 'bank-he', name: 'Pure Helium', volumeL: 50, pressureBar: 200, minimumPressureBar: 15, oxygenPercent: 0, heliumPercent: 100, enabled: true },
    { id: 'bank-1845', name: 'Tx 18/45 Bank', volumeL: 50, pressureBar: 200, minimumPressureBar: 20, oxygenPercent: 18, heliumPercent: 45, enabled: true },
    { id: 'bank-o2', name: 'Pure Oxygen', volumeL: 40, pressureBar: 180, minimumPressureBar: 10, oxygenPercent: 100, heliumPercent: 0, enabled: true },
    { id: 'bank-air', name: 'Air Top-off', volumeL: 80, pressureBar: 230, minimumPressureBar: 1, oxygenPercent: 21, heliumPercent: 0, enabled: true }
  ]
};

test('default 18/45 blend retains gas and orders boost banks as before', () => {
  const result = optimizeBlend(defaultInput);
  assert.equal(result.feasible, true);
  assert.ok(Math.abs(result.gas.initialMoles - 38.4) < 0.1);
  assert.ok(Math.abs(result.gas.targetMoles - 90.8) < 0.1);
  assert.ok(Math.abs(result.blend.retainedPressureBar - 80) < 0.1);
  assert.ok(Math.abs(result.blend.ventedPressureBar) < 0.1);
  assert.ok(Math.abs(result.blend.finalPressureBar - 210) < 0.1);
  assert.deepEqual(result.protocolSteps.map(step => step.title), [
    'Preserve 100% of Cylinder Gas',
    'Step 1: Boost with Tx 18/45 Bank',
    'Step 2: Boost with Pure Helium',
    'Step 3: Boost with Pure Oxygen'
  ]);
  assert.equal(result.trajectory.length, 4);
});

test('optimizer returns bank Z factors for the supply table from shared gas calculations', () => {
  const result = optimizeBlend(defaultInput);
  assert.deepEqual(result.bankMetrics.map(bank => [bank.id, Number(bank.compressibilityFactor.toFixed(3))]), [
    ['bank-he', 1.187],
    ['bank-1845', 1.130],
    ['bank-o2', 0.890],
    ['bank-air', 1.009]
  ]);
});

test('nitrox preset reports vented gas as equivalent litres at one bar', () => {
  const input = {
    ...defaultInput,
    cylinder: {
      ...defaultInput.cylinder,
      initialPressureBar: 100,
      initialOxygenPercent: 32,
      initialHeliumPercent: 0,
      targetPressureBar: 220,
      targetOxygenPercent: 21,
      targetHeliumPercent: 30
    }
  };
  const result = optimizeBlend(input);
  assert.equal(result.feasible, true);
  assert.ok(Math.abs(result.blend.ventedGasLitres - 838.377979816809) < 1e-8);
});


test('unavailable banks report infeasible without a fabricated blend protocol', () => {
  const result = optimizeBlend({ ...defaultInput, banks: [] });
  assert.equal(result.feasible, false);
  assert.equal(result.blend, null);
  assert.deepEqual(result.protocolSteps, []);
  assert.ok(result.error.length > 0);
  assert.ok(result.tableauSteps.length > 0);
});
```

Create `tests/simplex.test.js` as a separate solver contract:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { solveTwoPhaseSimplex } from '../js/simplex.js';

test('phase-one pivot notes identify the capacity row slack basis', () => {
  const decisionVariableCount = 1;
  const constraintCount = 4;
  const variableNames = ['x', 's_eq1', 's_eq2', 's_eq3', 's_cyl', 'a_tot', 'a_o2', 'a_he'];
  const tableau = Array.from({ length: constraintCount + 2 }, () => Array(9).fill(0));

  tableau[0][0] = 1;
  tableau[0][5] = 1;
  tableau[0][8] = 10;
  tableau[1][6] = 1;
  tableau[2][7] = 1;
  tableau[3][0] = 1;
  tableau[3][4] = 1;
  tableau[3][8] = 1;
  tableau[constraintCount][0] = -1;

  const result = solveTwoPhaseSimplex(tableau, decisionVariableCount, constraintCount, variableNames, [0]);
  const capacityPivot = result.steps.find(step => step.note.startsWith('Phase 1 Pivot:'));
  assert.equal(capacityPivot.note, 'Phase 1 Pivot: Enter x, Leave Row 4 (s_cyl)');
});
```

- [ ] **Step 2: Run the optimizer tests to observe the missing module**
Run: `node --test tests/optimizer.test.js tests/simplex.test.js`
Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `js/optimizer.js` and `js/simplex.js`.

- [ ] **Step 3: Extract the simplex solver and implement the explicit-input optimizer**

Move the existing `solveTwoPhaseSimplex` pivots, feasibility check, reduced-cost calculations, and tableau snapshots to `js/simplex.js` with its stated export. Initialize each capacity-row basis entry with its matching slack column (`numDecisionVars + rowIndex`). In `js/optimizer.js`, derive physics settings and gas quantities once, build the same total/O₂/He equality rows and cylinder/bank upper-bound rows, preserve the current objective coefficients and the 80-iteration phase limits, and call the solver. Derive the blend summary, stable boost priority (premix, helium, oxygen, air; then descending draw), protocol steps, and trajectory from the solution. Import only the functions/constants needed from `physics.js` and `simplex.js`; do not access `document` or `window`.

- [ ] **Step 4: Run domain and solver tests**

Run: `node --test tests/physics.test.js tests/optimizer.test.js tests/simplex.test.js`
Expected: PASS, 9 tests, 0 failures; the default blend matches the current browser baseline, bank metrics match current values, the vented-volume summary is correct, capacity slack notes are accurate, and empty supply banks remain infeasible.

## Task 3: Split assets and wire the browser app through focused UI modules

**Files:**
- Modify: `scuba_gas_remixer_simplex_optimizer.html`
- Create: `css/app.css`
- Create: `js/tailwind-config.js`
- Create: `js/ui/supply-banks.js`
- Create: `js/ui/results.js`
- Create: `js/ui/tableau.js`
- Create: `js/ui/ternary.js`
- Create: `js/main.js`

**Interfaces:**
- `renderSupplyBanks(banks, bankMetrics)` renders bank rows from the optimizer's compressibility/availability metrics; delegated handlers update the matching bank in app state.
- `renderResults(result)` renders current status, metrics, and protocol IDs; user-entered values are inserted as text.
- `renderTableau(steps, index)` renders the selected solver snapshot; `main.js` owns and bounds the index.
- `renderTernaryDiagram(canvas, { banks, initialMix, targetMix, trajectory })` draws supplied values and updates pointer coordinates; `observeTernaryCanvas(canvas, redraw)` owns and returns its `ResizeObserver`.
- `main.js` captures form values once per recalculation, invokes `optimizeBlend(input)`, and passes one result to the view modules. It owns default bank records, tableau index, delegated events, and startup.

- [ ] **Step 1: Move the Tailwind setup and custom CSS, then update the HTML shell**

Copy the existing Tailwind theme object to `js/tailwind-config.js` without changing values. Put the existing four scrollbar rules and `.tableau-table td, .tableau-table th` rule in `css/app.css`. Keep all existing IDs, text, and utility classes in the HTML. Add `<link rel="stylesheet" href="css/app.css">`; load the current Tailwind CDN, then `js/tailwind-config.js` as a classic script, then `js/main.js` with `type="module"`. The HTML keeps markup and asset references only.

- [ ] **Step 2: Replace inline event attributes with delegated-action data attributes**

Map recalculating inputs to `data-recalculate`; buttons to explicit `data-action` values (`add-bank`, `apply-preset`, `select-tab`, `tableau-step`, `toggle-bank`, `remove-bank`); and dynamic bank fields to `data-bank-id` plus `data-bank-field`. Keep both preset identifiers and all current controls. Remove every `onclick`, `oninput`, and `onchange`.

- [ ] **Step 3: Implement the focused DOM renderers**

Move supply-table rendering to `js/ui/supply-banks.js`, status/summary/protocol rendering to `js/ui/results.js`, tableau display to `js/ui/tableau.js`, and all canvas drawing/pointer-coordinate handling to `js/ui/ternary.js`. Preserve current IDs, classes, units, chart geometry, labels, colors, and resize behavior. Pass banks/mixes/trajectory explicitly to the canvas renderer; do not read shared globals or form values there. Use DOM text nodes/`textContent` for user-editable bank names instead of interpolating them into `innerHTML`.

- [ ] **Step 4: Implement the main controller and retire the old script**

In `js/main.js`, read form values into the Task 2 input shape, preserving legitimate numeric zero and applying defaults only to empty/non-finite form input. Own mutable bank state and tableau navigation index; bind delegated input/change/click handlers; restore the last valid bank value when a numeric bank edit is empty/non-finite; preserve both presets; call `optimizeBlend`; and update the renderers. On infeasibility, clear all prior summary metrics and the ternary canvas/readouts. Keep the existing recalculation and tab behavior; redraw the ternary chart on activation and canvas resize. Remove the inline `RealGasEngine`, solver, optimizer, renderers, and `window.onload` implementation rather than retaining aliases or globals.

- [ ] **Step 5: Smoke the integrated browser app before writing docs**

Run `python3 -m http.server 8000` from the project root and open `http://127.0.0.1:8000/scuba_gas_remixer_simplex_optimizer.html` in Chromium. Verify the default outputs and four-step order recorded in Task 4, including `0.0 L lost`; both presets, with the nitrox preset showing `838.4 L lost`; both physics modes; zero-helium and 0 °C inputs; blank bank numeric fields restoring their prior values; bank enable/edit/add/delete; all result tabs; tableau previous/next bounds; pointer coordinates and pointer-leave reset; ternary resize; and an infeasible case clearing prior metrics and chart. Confirm no app errors in the browser console.

## Task 4: Add atomic docs and verify the complete app

**Files:**
- Create: `docs/README.md`
- Create: `docs/architecture.md`
- Create: `docs/gas-physics.md`
- Create: `docs/optimizer.md`
- Create: `docs/development.md`

- [ ] **Step 1: Document each topic in its owning page**

`docs/README.md` links to the focused pages. `architecture.md` documents module roles and data flow. `gas-physics.md` records the ideal/VDW equations, units, mixing rules, and numerical method matching `physics.js`. `optimizer.md` documents variables, equality/availability constraints, objective weights, simplex phases, and protocol ordering from `optimizer.js`. `development.md` gives the exact commands `python3 -m http.server 8000` and `node --test` plus browser-smoke steps. Keep each page focused and cross-link instead of repeating full details.

- [ ] **Step 2: Run the complete Node test suite**

Run: `node --test`
Expected: PASS, 9 tests, 0 failures.

- [ ] **Step 3: Verify the final page and assets over HTTP**

Reload `http://127.0.0.1:8000/scuba_gas_remixer_simplex_optimizer.html`. Confirm the default summary remains `38.4 mol` initial, `90.8 mol` target, `80.0 bar` retained, `0.0 L lost`, `328 L` helium saved, and `210.0 bar` final; check all local module/CSS requests resolve and there are no app console errors. The unchanged Tailwind CDN production warning is expected.

- [ ] **Step 4: Check final markup, docs, and cleanup**

Read the final HTML and confirm it contains markup/asset references only, with no inline style, application/config code, or event handlers. Confirm all five atomic docs accurately match the modules and commands. Remove only temporary smoke artifacts; retain production modules and focused tests.

