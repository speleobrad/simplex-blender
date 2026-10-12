# Recipe and Settings Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore explicit oxygen-rich transfer reporting and implement the requested recipe, graph, form, water-pressure, cylinder-settings, and equipment-preset improvements.

**Architecture:** Preserve the current optimizer/settings/UI module boundaries. Extend protocol steps with source-end metadata, render that metadata in result cards, and keep all visual changes local to their existing renderers. Add pure equipment-clone helpers to `settings.js`; `main.js` only generates a unique name, mutates the draft, and rerenders.

**Tech Stack:** Browser-native ES modules, vanilla DOM/SVG/canvas, Tailwind CDN utility classes, Node built-in test runner.

**Spec:** `docs/superpowers/specs/2026-10-13-recipe-and-settings-improvements-design.md`

## Global Constraints

- Preserve the oxygen-rich threshold as source oxygen `> 40%`; a source at exactly `40%` has no ratio.
- Preserve the existing oxygen-transfer safety limit and shared booster minimum semantics.
- Compressor Air remains implicit/unlimited and MUST NOT be marked exhausted.
- Existing localStorage keys and serialized preset shapes MUST NOT change.
- Settings edits remain drafts until Save; Cancel MUST discard newly added presets.
- Existing accessible labels, roles, warning titles, and keyboard behavior MUST remain intact.
- Run each focused test after its failing-test step and run `npm test` after all tasks.

---

### Task 1: Add source-end protocol metadata and explicit oxygen-ratio reporting

**Files:**
- Modify: `js/optimizer.js:1405-1488` (protocol-step construction)
- Modify: `tests/optimizer.test.js` near the existing oxygen-ratio tests and protocol-step tests

**Interfaces:**
- Consumes: `minimumSourcePressureFor(bank)`, `stage.sourceEndPressureBar`, `stage.type`, existing `oxygenCompressionRatio`.
- Produces: Each transfer protocol step has `minimumSourcePressureBar: number|null` and `sourceExhausted: boolean`; exhausted descriptions use the exact bank/minimum wording; oxygen-rich boost descriptions include source and receiver pressures plus ratio.

- [ ] **Step 1: Write failing optimizer tests**

Add tests that call `optimizeBlend` with a finite non-Air bank whose available gas is fully drawn to the configured booster minimum. Assert:

```js
const step = result.protocolSteps.find(candidate => candidate.type === 'boost');
assert.equal(step.minimumSourcePressureBar, 20);
assert.equal(step.sourceExhausted, true);
assert.match(step.description, /This empties Oxygen bank and leaves only 20\.0 bar of gas\./);
```

Add a compressor-Air case asserting `minimumSourcePressureBar === null` and `sourceExhausted === false`. Strengthen the existing >40% test to assert the description contains source pressure, destination pressure, and `O2 compression ratio`, while the exactly-40% case remains null and has no ratio sentence.

- [ ] **Step 2: Run the focused tests and verify the expected failure**

Run:

```sh
node --test tests/optimizer.test.js
```

Expected: the new metadata assertions fail because protocol steps currently only contain the generic leftover text and no minimum/exhaustion fields.

- [ ] **Step 3: Implement the minimal optimizer change**

Inside the stage loop, compute a scale-aware comparison against `minimumSourcePressureFor(bank)` for non-Air banks. Add the two metadata properties to every transfer step. Replace only the generic source-leftover sentence when `sourceExhausted` is true. Keep the existing `oxygenCompressionRatio` threshold and value. Expand its description sentence to include the numeric source-end and receiver-end pressures without changing the stored ratio.

- [ ] **Step 4: Run focused optimizer tests**

Run:

```sh
node --test tests/optimizer.test.js
```

Expected: all optimizer tests pass, including safety, maximum-pressure, ratio, and protocol tests.

- [ ] **Step 5: Commit the calculation change**

```sh
git add js/optimizer.js tests/optimizer.test.js
git commit -m "feat: report exhausted sources and oxygen ratios"
```

---

### Task 2: Render source-end warnings and reorder water-pressure warnings

**Files:**
- Modify: `js/ui/results.js:101-140`
- Modify: `js/ui/water-pressure.js:64-76`
- Modify: `tests/water-pressure.test.js`
- Modify: `tests/results.test.js` using its existing DOM-test conventions

**Interfaces:**
- Consumes: protocol-step `sourceEndPressureBar`, `sourceExhausted`, and `minimumSourcePressureBar` from Task 1.
- Produces: Recipe cards show a source-end value for transfer steps; exhausted source-end values have an orange `fa-solid fa-circle-exclamation` before the value. Water-pressure warning cells place the icon before the pressure span.

- [ ] **Step 1: Write failing renderer tests**

Extend the existing fake-DOM tests to render a transfer step with `sourceEndPressureBar: 20` and `sourceExhausted: true`. Assert the source-end container contains an `<i>` before its value, with classes including `fa-solid`, `fa-circle-exclamation`, and `text-orange-400`. Assert the displayed source-end text includes `20.0 bar`.

Render an over-working-pressure projection through the existing water-pressure renderer and assert the pressure-cell children order is `[warningIcon, pressureSpan]`; assert the icon has `mr-1` and does not have `ml-1`.

- [ ] **Step 2: Run focused renderer tests to verify failure**

Run:

```sh
node --test tests/results.test.js tests/water-pressure.test.js
```

Expected: source-end markup is absent and the water warning is currently after the pressure span.

- [ ] **Step 3: Implement result-card source-end markup**

Add a small source-end line in the existing right-hand result block for transfer steps. Build the icon as a DOM element, set `role="img"`, an accessible label/title naming the minimum source pressure, and append it before the source-end pressure text only when `sourceExhausted` is true. Do not put a warning icon on compressor Air or on the receiver Result pressure.

- [ ] **Step 4: Reorder water-pressure warning construction**

In `appendPressureValue`, create and append the warning icon before creating/appending the pressure span. Change only the spacing class from `ml-1` to `mr-1`.

- [ ] **Step 5: Run focused renderer tests**

Run:

```sh
node --test tests/results.test.js tests/water-pressure.test.js
```

Expected: PASS with the required DOM order and warning semantics.

- [ ] **Step 6: Commit renderer changes**

```sh
git add js/ui/results.js js/ui/water-pressure.js tests/results.test.js tests/water-pressure.test.js
git commit -m "fix: mark exhausted recipe sources and water pressure warnings"
```

---

### Task 3: Fix ternary boundary styling and thermal caption rows

**Files:**
- Modify: `js/ui/ternary.js:474-496`
- Modify: `js/ui/thermal-charts.js:63-68,215-230`
- Modify: `tests/ternary.test.js`
- Modify: `tests/thermal-charts.test.js`

**Interfaces:**
- Consumes: existing ternary vertices and thermal `bands` array.
- Produces: N₂/air/He shaded region and dashed Air/O₂/He boundary; each thermal band exposes `labelRow` alternating `0,1,0,1...`, and both SVG charts use it for caption y positions.

- [ ] **Step 1: Write failing pure-behavior tests**

Add a thermal-series test:

```js
assert.deepEqual(series.bands.map(band => band.labelRow), [0, 1, 0]);
```

Add a ternary test for a new exported pure helper `getInfeasibleRegionVertices(vertices)` that returns the shaded polygon in `[nitrogen, air, helium]` order. Assert it uses the `0/0`, `21/0`, and `0/100` points. Keep existing vertex and zoom tests unchanged.

- [ ] **Step 2: Run focused tests and verify failure**

Run:

```sh
node --test tests/ternary.test.js tests/thermal-charts.test.js
```

Expected: `labelRow` is undefined and the region helper is unavailable.

- [ ] **Step 3: Implement thermal row metadata and SVG positions**

Set `labelRow: index % 2` when building each band. In `renderChart`, use `CHART_MARGIN.top + 14 + band.labelRow * 12` for the caption baseline. Keep horizontal centering at `x + width / 2` and use the same band metadata for both charts.

- [ ] **Step 4: Implement ternary fill and dashed feasible boundary**

Add/export the pure region-point helper used by the test. Before grid/boundary drawing, fill the N₂/air/He polygon with the full-boundary gray color and low opacity. Keep the full simplex dashed boundary. Change the Air/O₂/He boundary to the same dashed pattern, reset line dash before subsequent grid/vector/marker drawing, and preserve the existing direct vector order.

- [ ] **Step 5: Run focused visual-module tests**

Run:

```sh
node --test tests/ternary.test.js tests/thermal-charts.test.js
```

Expected: PASS.

- [ ] **Step 6: Commit graph changes**

```sh
git add js/ui/ternary.js js/ui/thermal-charts.js tests/ternary.test.js tests/thermal-charts.test.js
git commit -m "fix: clarify ternary regions and thermal labels"
```

---

### Task 4: Align transfer-condition and cylinder-preset controls

**Files:**
- Modify: `index.html:385-394` (Transfer conditions)
- Modify: `js/ui/settings-dialog.js:121-183` (cylinder table widths/classes)
- Modify: `tests/settings-dialog.test.js` (class and value assertions for the rendered cylinder table)

**Interfaces:**
- Consumes: existing markup and settings dialog renderer.
- Produces: Transfer conditions inherit `text-xs`, inlet input uses explicit `text-xs`, cylinder mass accepts `14.3` without clipping, and max-pressure controls use compact numeric columns.

- [ ] **Step 1: Add a failing settings-renderer assertion**

Extend the fake-DOM test to render a cylinder with `massKg: 14.3`, find the mass input, and assert its value remains `14.3` and its class includes the widened compact numeric width. Assert the pressure header/cell uses the reduced compact width class. Add a minimal recursive element walker in the test to inspect generated elements because the fake DOM has no selector engine.

- [ ] **Step 2: Run the focused test and verify failure**

Run:

```sh
node --test tests/settings-dialog.test.js
```

Expected: the current mass/pressure width classes do not satisfy the new assertions.

- [ ] **Step 3: Implement the CSS/markup sizing changes**

Add `text-xs` to the Transfer conditions content wrapper and explicit `text-xs` to its number input. Keep the label class and font-sans section. Set the cylinder mass column to `w-16`, set the max-pressure column to `w-16` instead of `w-20`, and use `px-0.5` on cylinder number inputs so the browser number spinner and decimal value both fit.

- [ ] **Step 4: Run focused UI tests**

Run:

```sh
node --test tests/settings-dialog.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit form changes**

```sh
git add index.html js/ui/settings-dialog.js tests/settings-dialog.test.js
git commit -m "fix: fit transfer and cylinder setting controls"
```

---

### Task 5: Add clone helpers and New compressor/New booster actions

**Files:**
- Modify: `js/settings.js` near equipment-preset application helpers
- Modify: `js/main.js:1-15,189-241,597-635`
- Modify: `index.html:101-143` (equipment headers/buttons)
- Modify: `tests/settings.test.js`
- Modify: `tests/settings-dialog.test.js` (equipment action button markup assertions)

**Interfaces:**
- Consumes: `copySettings`, `normalizePresetName`, active `settingsDraft.booster`, existing equipment collections.
- Produces:
  - `createCompressorPreset(settings, name)` returns a new plain object with the compressor preset fields copied from active settings.
  - `createBoosterPreset(settings, name)` returns a new plain object with all booster preset fields copied from active settings.
  - `createUniquePresetName(baseName, presets)` returns the first unique name using existing normalized-name matching.
  - `addEquipmentPresetToDraft(settingsDraft, category, baseName)` appends a uniquely named clone to `compressorPresets` or `boosterPresets` and returns the new name.
  - Delegated actions `add-compressor-preset` and `add-booster-preset` call the draft helper, rerender the Equipment pane, and select that category.

- [ ] **Step 1: Write failing clone-helper tests**

In `tests/settings.test.js`, add tests that call both helpers and assert exact field values, the requested name, no extra active-only fields, and clone independence:

```js
const clone = createCompressorPreset(settings, 'New compressor');
assert.deepEqual(clone, {
  name: 'New compressor',
  inletFlowLPerMin: settings.booster.compressorInletFlowLPerMin,
  maxPressureBar: settings.booster.maxCompressorPressureBar,
  temperatureModifierC: settings.booster.compressorTemperatureModifierC
});
clone.inletFlowLPerMin = 1;
assert.notEqual(clone.inletFlowLPerMin, settings.booster.compressorInletFlowLPerMin);
```

Add the equivalent complete booster-field assertion and ensure the two helper results do not share object state.

- [ ] **Step 2: Run focused settings tests and verify failure**

Run:

```sh
node --test tests/settings.test.js
```

Expected: helper imports/functions are unavailable.

- [ ] **Step 3: Implement pure clone helpers**

Export all four pure settings helpers from `js/settings.js`. Build fresh objects from scalar active fields; do not return references to the settings object. `addEquipmentPresetToDraft` selects the requested collection, calls `createUniquePresetName`, pushes the matching clone, and returns the name. Keep the serialized preset field names exactly as the existing validators expect.

- [ ] **Step 4: Add failing action/markup coverage**

Add buttons beside each equipment selector with `data-action="add-compressor-preset"` and `data-action="add-booster-preset"`. Add failing settings tests for `createUniquePresetName` and `addEquipmentPresetToDraft`: an existing `New compressor` produces `New compressor 2`, case-insensitively, and adding either category appends a clone without changing active fields.

- [ ] **Step 5: Run the focused UI/settings tests and verify the action coverage fails**

Run:

```sh
node --test tests/settings.test.js tests/settings-dialog.test.js
```

Expected: button markup and unique-name/helper coverage fail before the new actions/helpers exist.

- [ ] **Step 6: Implement the delegated actions**

Add `addCompressorPreset` and `addBoosterPreset` functions that call `addEquipmentPresetToDraft(state.settingsDraft, 'compressorPresets', 'New compressor')` or `addEquipmentPresetToDraft(state.settingsDraft, 'boosterPresets', 'New booster')`, then call `renderSettingsDraft()` and select the Equipment category. Add both cases to `handleClick`. The active scalar fields remain unchanged; Save persists the draft and Cancel closes it without persistence.

- [ ] **Step 7: Run focused settings tests**

Run:

```sh
node --test tests/settings.test.js tests/settings-dialog.test.js
```

Expected: PASS, including existing persistence/selection/migration tests.

- [ ] **Step 8: Commit equipment-preset changes**

```sh
git add index.html js/main.js js/settings.js tests/settings.test.js tests/settings-dialog.test.js
git commit -m "feat: add clone actions for equipment presets"
```

---

### Task 6: Update architecture and browser-check documentation

**Files:**
- Modify: `docs/architecture.md:17-25,31-34`
- Modify: `docs/development.md:31-52`

- [ ] **Step 1: Update architecture responsibilities and data flow**

Document that optimizer protocol steps carry source minimum/exhaustion metadata and explicit oxygen-rich ratios; results renders source-end warnings; ternary uses the gray complementary region and dashed Air/O₂/He boundary; thermal bands carry alternating caption rows; settings supports clone actions.

- [ ] **Step 2: Update browser smoke checks**

Add observable checks for the orange source warning, visible oxygen ratio, dashed/gray diagram regions, alternating chart captions, warning-before-pressure order, unclipped `14.3`, and New compressor/New booster clone/save/cancel behavior.

- [ ] **Step 3: Commit documentation**

```sh
git add docs/architecture.md docs/development.md
git commit -m "docs: describe recipe and preset improvements"
```

---

### Task 7: Full verification and browser smoke check

**Files:**
- No production files expected; only fix regressions discovered in the affected paths.

- [ ] **Step 1: Run the complete automated suite**

Run:

```sh
npm test
```

Expected: all tests pass with no failures, cancellations, or unhandled errors.

- [ ] **Step 2: Serve and exercise the actual page**

Run:

```sh
python3 -m http.server 8000
```

Open the page and verify:

1. A recipe with >40% oxygen source shows source/destination pressure and ratio; a source at 40% does not.
2. A bank exhausted to booster minimum shows the exact empty-bank message and orange icon before the source-end pressure.
3. Transfer conditions visually match Ambient / calculation temperature.
4. Diagram shows gray N₂/air/He region, dashed Air/O₂/He boundary, and visible `21/0 → 35/0` vector.
5. Narrow thermal bands alternate caption rows in both graphs.
6. In water pressure warning icon precedes the pressure.
7. Cylinder settings visibly show `14.3` and compact max-pressure controls.
8. New compressor/New booster create clone entries; Save/reload preserves them and Cancel discards unsaved additions.
9. Browser console has no app module/runtime errors.

- [ ] **Step 3: Run the complete suite once more after smoke-driven fixes**

Run:

```sh
npm test
```

Expected: PASS.

- [ ] **Step 4: Remove temporary server/process artifacts and report exercised verification**

Stop the local HTTP server, remove no project files other than temporary scaffolding created during testing, and report the exact automated and browser checks performed.
