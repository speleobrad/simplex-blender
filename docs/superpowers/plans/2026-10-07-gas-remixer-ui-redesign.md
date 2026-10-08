# Gas Remixer UI Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Simplify the gas remixer UI, add configurable gas/volume presets and faster mix input, and make the ternary diagram show feasible and full composition regions with path-safe zoom.

**Architecture:** Keep the static HTML and browser-native modules. Add a small settings/preset model, an accessible dialog renderer, direct preset selectors for cylinder mixes and banks, and pure ternary geometry helpers exercised by Node tests. `main.js` remains the event/state coordinator; calculations remain unchanged.

**Tech Stack:** HTML, Tailwind CDN already in use, browser-native ES modules, `localStorage`, Node.js built-in test runner, browser smoke via the existing app.

**Spec:** `docs/superpowers/specs/2026-10-07-gas-remixer-ui-design.md`

## Global Constraints

- Keep the existing static-page and native-module architecture.
- Add an accessible native `<dialog>` for configurable presets, save those settings in `localStorage`, and use native form controls for preset choice and custom entry.
- Do not add a framework, server, or dependency.
- Preserve current blend equations, solver behavior, and editable bank values; remove the supply-table-only N₂/Z metrics.
- Gas presets are selectable for the cylinder's current mix, target mix, and each supply bank. Choosing a preset fills its O₂ and He values; those values remain directly editable afterward.
- The cylinder capacity control offers configured volumes while accepting a typed custom numeric value. Preset membership is not required.
- Typing `/` in a cylinder O₂ field keeps the O₂ value and moves focus to the paired He field. Pasting a value such as `21/35` splits it across the two fields. Do not change the supply-bank input format.
- Remove both top quick-blend buttons and their `applyPreset()` action; gas composition presets remain available in Settings and the cylinder/bank selectors.
- Draw the full O₂/N₂/He simplex as a dotted outer triangle and the feasible solid triangle through Air (21/0/79), pure O₂, and pure He.
- Persist every supply-bank record in `localStorage`, saving after bank edits, enable/disable, gas preset selection, additions, and removals.
- Center mouse-wheel zoom on the complete trajectory and limit maximum zoom so every trajectory point remains visible. Recompute the limit when trajectory data or canvas dimensions change; do not add pan.

---

## File Map

- Create `js/settings.js`: default gas/volume presets, validation, and persistence functions.
- Create `js/gas-input.js`: pure slash-delimited gas-input splitter.
- Create `js/ui/settings-dialog.js`: settings dialog rendering and preset option refresh.
- Modify `scuba_gas_remixer_simplex_optimizer.html`: compact labels, settings dialog, explicit gas/volume preset controls, and removal of redundant explanatory UI.
- Modify `js/main.js`: load settings, own draft/committed setting state, coordinate preset selection and dialog actions, parse the paired gas fields, and read custom/preset volume values.
- Modify `js/ui/supply-banks.js`: render one gas-preset selector per bank alongside editable name/O₂/He fields.
- Modify `js/ui/ternary.js`: draw both triangle boundaries and use bounded trajectory-centered wheel zoom.
- Modify `js/ui/results.js`: remove the successful “Optimal Solution” status text while preserving infeasible feedback.
- Create `tests/settings.test.js`, `tests/gas-input.test.js`, and `tests/ternary.test.js` for pure settings/input/geometry contracts.
- Create `js/bank-storage.js` and `tests/banks.test.js` for validated supply-bank persistence.
- Modify `js/optimizer.js`, `tests/optimizer.test.js`, and `docs/optimizer.md` to remove the display-only bank Z metric.
- Modify `docs/development.md`: document preset storage and ternary zoom behavior.
- Modify `docs/architecture.md`: update settings, preset data flow, and chart responsibilities.

## Task 1: Add tested settings data and gas-pair parsing

**Files:**
- Create: `tests/settings.test.js`
- Create: `tests/gas-input.test.js`
- Create: `js/settings.js`
- Create: `js/gas-input.js`

**Interfaces:**
- `DEFAULT_SETTINGS` is `{ gasPresets: [{ name, oxygenPercent, heliumPercent }], volumePresets: [number] }` with the approved defaults.
- `loadSettings(storage, onFallback)` reads `simplex-gas-remixer-settings`, returns validated saved lists or a copy of defaults, and reports unreadable/invalid saved data through `onFallback` before using defaults.
- `validateSettings(settings)` returns an array of validation messages; require non-empty unique preset names, finite gas percentages from 0 through 100 with O₂ + He ≤ 100, and finite positive unique cylinder volumes.
- `saveSettings(settings, storage)` validates then writes JSON; invalid settings throw `RangeError`, and storage write errors are not silently discarded.
- `applyGasPresetToBank(bank, preset)` updates only bank name/O₂/He fields; `getSelectedGasPreset(bank, gasPresets)` reports a selected preset only when its name and gas fractions still match.
- `splitGasInput(value)` returns `null` when there is no slash, or `{ oxygenText, heliumText }` containing trimmed text on either side of the first slash.

- [x] **Step 1: Write settings and gas-split tests first**

```js
// tests/settings.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS, loadSettings, saveSettings, validateSettings } from '../js/settings.js';

function memoryStorage(initialEntries = []) {
  const values = new Map(initialEntries);
  return {
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, String(value)); }
  };
}

test('missing settings return independent copies of the built-in presets', () => {
  const first = loadSettings(memoryStorage());
  first.gasPresets[0].name = 'Changed';
  const second = loadSettings(memoryStorage());
  assert.equal(second.gasPresets[0].name, DEFAULT_SETTINGS.gasPresets[0].name);
  assert.deepEqual(second.volumePresets, [3, 5, 7, 10, 12, 15, 18, 24]);
});

test('saved gas and volume presets survive a load/save round trip', () => {
  const storage = memoryStorage();
  const settings = {
    gasPresets: [{ name: 'Tx 16/50', oxygenPercent: 16, heliumPercent: 50 }],
    volumePresets: [11, 22]
  };
  saveSettings(settings, storage);
  assert.deepEqual(loadSettings(storage), settings);
});

test('unreadable or invalid saved settings fall back to defaults', () => {
  const storage = memoryStorage([['simplex-gas-remixer-settings', '{bad json']]);
  assert.deepEqual(loadSettings(storage), DEFAULT_SETTINGS);
  storage.setItem('simplex-gas-remixer-settings', JSON.stringify({ gasPresets: [], volumePresets: [-1] }));
  assert.deepEqual(loadSettings(storage), DEFAULT_SETTINGS);
});

test('preset validation rejects duplicate names, invalid fractions, and non-positive volumes', () => {
  const errors = validateSettings({
    gasPresets: [
      { name: 'Air', oxygenPercent: 21, heliumPercent: 0 },
      { name: 'air', oxygenPercent: 101, heliumPercent: 0 }
    ],
    volumePresets: [12, 0, 12]
  });
  assert.ok(errors.length > 0);
});
```

```js
// tests/gas-input.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { splitGasInput } from '../js/gas-input.js';

test('slash-delimited O2/He input separates both values and trims whitespace', () => {
  assert.deepEqual(splitGasInput(' 21 / 35 '), { oxygenText: '21', heliumText: '35' });
});

test('ordinary O2 input does not split', () => {
  assert.equal(splitGasInput('21'), null);
});
```

- [x] **Step 2: Run only the new tests and observe the missing-module failures**

Run: `node --test tests/settings.test.js tests/gas-input.test.js`
Expected: FAIL because `js/settings.js` and `js/gas-input.js` do not exist.

- [x] **Step 3: Implement the minimum settings and parser APIs**

In `js/settings.js`, define the default gases Air 21/0, EAN32 32/0, Tx 18/45, Tx 21/35, pure O₂ 100/0, and pure He 0/100; define volume presets `[3, 5, 7, 10, 12, 15, 18, 24]`. Implement deep-enough cloning, JSON parsing, validation, default fallback for malformed or invalid saved data, and explicit validated writes under `simplex-gas-remixer-settings`. Do not catch and discard `setItem` failures.

In `js/gas-input.js`, implement `splitGasInput` by splitting only at the first slash and trimming each side. Return `null` when no slash exists.

- [x] **Step 4: Run the new tests and verify the contracts**

Run: `node --test tests/settings.test.js tests/gas-input.test.js`
Expected: PASS, including isolation of default objects, persistence round trip, corrupted-data fallback, invalid-setting rejection, and slash parsing.

## Task 2: Add the settings dialog and cylinder selectors/shortcuts

**Files:**
- Create: `js/ui/settings-dialog.js`
- Modify: `scuba_gas_remixer_simplex_optimizer.html`
- Modify: `js/main.js`
- Modify: `tests/settings.test.js` only if a new pure selector helper is extracted.

**Interfaces:**
- `renderSettingsDialog(settings)` fills the dialog's gas and volume preset rows with DOM nodes and `textContent`; user-provided names are never interpolated as HTML.
- `main.js` owns `state.settings`, `state.settingsDraft`, and `state.settingsLoadFailure`. Opening edits a clone; Save validates/writes and commits; Cancel/close discards the draft. If saved settings cannot be read, show a warning that built-in defaults are active.
- The dialog uses delegated `data-action` controls for adding/removing gas and volume rows and an inline accessible validation message.
- Cylinder O₂/He controls use text inputs with decimal input mode so `/` is received. `splitGasInput` handles pasted pairs; keydown on `/` keeps the current O₂ text and focuses its matching He field.
- The cylinder capacity UI uses a select populated from `volumePresets` plus a `Custom…` option and a numeric input shown for custom mode. `readInput()` uses the selected preset value or the custom numeric value.

- [x] **Step 1: Add the dialog and controls before wiring behavior**

In the HTML, add a header Settings button and a native `<dialog id="settings-dialog">` containing separate gas and volume preset lists, add/remove controls, Save/Cancel buttons, and a `role="alert"` validation area. Replace the cylinder number-only volume input with `#cyl-vol-preset` and `#cyl-vol-custom`. Add `#init-gas-preset` and `#target-gas-preset` selectors above the existing two-field compositions. Keep the current two quick-blend buttons and remove only the `Preset:` prefix.

- [x] **Step 2: Wire settings draft behavior and cylinder input interactions**

In `main.js`, load settings at initialization. Implement open/edit/add/remove/save/cancel dialog actions through the existing document-level event delegation. On successful save, refresh gas and volume options without changing any currently entered mix or volume. On validation failure, keep the dialog open and show the messages. Selecting a cylinder gas preset writes its O₂/He values and recalculates; manual composition edits select the `Custom` option. On slash keydown, prevent inserting `/` and focus the corresponding He input. On input containing a slash, use `splitGasInput`, retain the O₂ portion, copy a non-empty He portion, and move focus to He. Choosing `Custom…` reveals the numeric field initialized to the current cylinder volume; choosing a volume preset hides the custom field and recalculates.

- [x] **Step 3: Exercise the new cylinder/settings workflow in a browser**

Serve the app with `python3 -m http.server 8000`, open the existing HTML entry, and verify: the dialog opens and closes with Cancel; Add/Remove and Save update the displayed options; reload preserves settings; malformed local storage falls back to defaults; choosing a gas preset fills both fields; manually editing either field changes the selector to Custom; typing `/` and pasting `21/35` split values; preset and custom tank sizes both update calculation output.

## Task 3: Apply gas presets to banks and simplify redundant interface copy

**Files:**
- Modify: `scuba_gas_remixer_simplex_optimizer.html`
- Modify: `js/main.js`
- Modify: `js/ui/supply-banks.js`
- Modify: `js/ui/results.js`
- Create: `js/bank-storage.js`
- Create: `tests/banks.test.js`
- Modify: `js/optimizer.js`
- Modify: `tests/optimizer.test.js`
- Modify: `docs/optimizer.md`

**Interfaces:**
- `renderSupplyBanks(banks, gasPresets)` renders editable bank fields and gas-preset selectors; it displays neither derived N₂% nor Z.
- `loadSupplyBanks(storage, onFallback)` restores saved banks or default banks; `saveSupplyBanks(banks, storage)` validates and stores each bank mutation.
- Bank selector values use the `gas:` prefix so a user preset named `Custom` does not collide with the built-in Custom choice. A bank preset appears selected only while its name and O₂/He values match the current bank.

- [x] **Step 1: Add the bank gas-preset control**

Render configured gas presets in each bank row alongside the editable name and O₂/He inputs. Save bank names, gas, volume, pressures, enabled state, and selected/custom gas-preset state after each mutation. Keep the remaining table columns limited to bank, volume, pressure, minimum pressure, O₂, He, and delete.

- [x] **Step 2: Remove only redundant labels and successful-state clutter**

Remove the top quick-blend buttons and `applyPreset()` handler. Remove the `N₂%` and `Z` supply-bank columns and the optimizer's bank-only compressibility calculation/output. Keep the physics model and temperature controls; label model choices `Real gas` and `Ideal gas`, remove the successful status badge and helium-weighting explainer, and shorten section/tab/solver headings while retaining error feedback.

- [x] **Step 3: Browser-check bank persistence and remaining workflows**

Verify the quick-blend buttons are gone, bank edits and toggles persist after reload, and the bank table has no derived N₂/Z columns. Verify both physics modes, all remaining tabs, infeasible feedback, and direct gas-preset editing.

## Task 4: Draw feasible and full triangles and add bounded path-centered zoom

**Files:**
- Modify: `js/ui/ternary.js`
- Create: `tests/ternary.test.js`

**Interfaces:**
- Export pure `createVertices(width, height)` and `toCanvasPoint(oxygenPercent, heliumPercent, nitrogenPercent, vertices)` helpers for geometry tests; `createVertices` includes the full-simplex vertices and an `air` coordinate derived from 21/0/79.
- Export pure `calculateMaxZoom(trajectory, toPoint, width, height, margin = 96)` and `transformPointForZoom(point, center, zoom, maxZoom, width, height)`. The maximum scale fits the projected trajectory bounding box inside the width/height inset by `margin`; unzoomed geometry remains at its full-simplex positions and the path moves toward canvas center as zoom increases.
- Canvas zoom state is per canvas, wheel zoom is centered on the trajectory bounding-box center, and every redraw clamps it to `[1, calculateMaxZoom(...)]`.

- [x] **Step 1: Write geometry and zoom tests before chart edits**

```js
// tests/ternary.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateMaxZoom, createVertices, toCanvasPoint, transformPointForZoom } from '../js/ui/ternary.js';

test('air is the solid-region vertex on the O2/N2 edge', () => {
  const vertices = createVertices(300, 300);
  const air = toCanvasPoint(21, 0, 79, vertices);
  assert.ok(Math.abs(air.x - vertices.air.x) < 1e-9);
  assert.ok(Math.abs(air.y - vertices.air.y) < 1e-9);
  assert.notDeepEqual(air, vertices.nitrogen);
});

test('15/0 lies beyond the feasible Air/O2 edge', () => {
  const vertices = createVertices(300, 300);
  const lowOxygen = toCanvasPoint(15, 0, 85, vertices);
  assert.ok(lowOxygen.y > vertices.air.y);
});

test('maximum zoom keeps every projected trajectory point inside the inset canvas', () => {
  const trajectory = [
    { x: 30, y: 30 },
    { x: 40, y: 38 },
    { x: 50, y: 40 }
  ];
  const project = point => point;
  const width = 220;
  const height = 140;
  const margin = 20;
  const zoom = calculateMaxZoom(trajectory, project, width, height, margin);
  const center = { x: 40, y: 35 };
  assert.ok(zoom >= 1);
  for (const point of trajectory) {
    const x = (point.x - center.x) * zoom + width / 2;
    const y = (point.y - center.y) * zoom + height / 2;
    assert.ok(x >= margin - 1e-9 && x <= width - margin + 1e-9);
    assert.ok(y >= margin - 1e-9 && y <= height - margin + 1e-9);
  }
});

test('empty and point-sized paths cannot create an unbounded zoom', () => {
  assert.equal(calculateMaxZoom([], point => point, 220, 140), 1);
  assert.equal(calculateMaxZoom([{ x: 10, y: 10 }], point => point, 220, 140), 1);
});

test('zoom preserves the full view at 1x and centers the path at maximum zoom', () => {
  const point = { x: 30, y: 30 };
  const center = { x: 40, y: 35 };
  assert.deepEqual(transformPointForZoom(point, center, 1, 9, 220, 140), { x: 30, y: 30 });
  assert.deepEqual(transformPointForZoom(point, center, 9, 9, 220, 140), { x: 20, y: 25 });
});
```

- [x] **Step 2: Run the geometry tests to observe missing exports**

Run: `node --test tests/ternary.test.js`
Expected: FAIL because `calculateMaxZoom`, `transformPointForZoom`, and the Air vertex are not implemented/exported.

- [x] **Step 3: Implement the pure helpers and chart behavior**

Add `air` from `toCanvasPoint(21, 0, 79, vertices)` to `createVertices`. Implement `calculateMaxZoom` by projecting each trajectory point, finding its bounding box, using `min((width - 2 * margin) / spanX, (height - 2 * margin) / spanY)`, treating zero spans as unbounded on that axis, and returning `max(1, min(finiteAxisLimits))`; use a 96 px inset for chart rendering and return 1 for no points or no finite limit. Implement `transformPointForZoom` to preserve the existing full-simplex layout at 1× and move the path center smoothly to canvas center at the computed maximum.

In `renderTernaryDiagram`, draw the full O₂/N₂/He boundary dashed first, then draw the solid Air/O₂/He triangle. Register one non-passive wheel listener per canvas; zoom in on negative `deltaY`, out on positive `deltaY`, prevent page scrolling only over the chart, and redraw. Recompute the path center and max after each render/resize and clamp the current factor. Apply the same transform to grid, boundaries, banks, initial/target mixes, trajectory, labels, and pointer hit-test geometry so the pointer readout remains aligned.

- [x] **Step 4: Run the ternary tests and then the full Node suite**

Run: `node --test tests/ternary.test.js`
Expected: PASS, 5 tests, 0 failures.

Run: `npm test`
Expected: all physics, optimizer, simplex, settings, parser, and ternary tests pass.

- [x] **Step 5: Smoke the diagram in a browser**

Open the Diagram tab and confirm the solid boundary joins Air, pure O₂, and pure He, while the dotted outer boundary reaches pure N₂. Enter a 15/0 mix and confirm its point lies outside the solid boundary. Wheel in/out over the canvas; confirm zoom centers on the path, the full path remains visible at the zoom limit, the page does not scroll over the canvas, pointer readout stays aligned, and resize/recalculation clamps the zoom correctly.

## Task 5: Update user-facing development notes and complete integrated verification

**Files:**
- Modify: `docs/development.md`
- Modify: `docs/architecture.md`
- Modify: `docs/optimizer.md`

- [x] **Step 1: Document only the new user-visible behavior**

Update development smoke checks for bank persistence and removal of quick presets/N₂/Z values; update optimizer and architecture docs for the remaining bank-availability calculation and storage flow.

- [x] **Step 2: Run the complete automated suite**

Run: `npm test`
Expected: exit code 0 with no failing tests.

- [x] **Step 3: Run the integrated browser smoke**

Start a local HTTP server, load the app in Chromium, and verify the default blend, custom and preset cylinder capacities, slash/paste entry, bank save/reload for all editable fields, add/delete/enable actions, both physics models, all tabs, infeasible handling, absence of quick-preset buttons and bank N₂/Z columns, light/dark persistence, diagram boundaries, maximum zoom, pointer readout, and responsive resize. Confirm no app runtime errors.

- [x] **Step 4: Remove temporary verification scaffolding**

Remove any throwaway scripts created for browser/manual verification. Keep only permanent tests that assert settings persistence, gas splitting, and ternary geometry/zoom behavior.
