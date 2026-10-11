# Cylinder Presets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace independent working-tank volume/material inputs with saved cylinder presets that drive blending volume, thermodynamic material and mass, and working-pressure safety validation.

**Architecture:** Normalize Settings to `cylinderPresets`, migrating legacy `volumePresets` on load. The browser controller resolves one selected preset into the existing `cylinder` and `thermal` calculation inputs; the optimizer keeps using `cylinder.volumeL`, while thermodynamics receives `thermal.tankMassKg`. Input validation rejects pressures above the selected preset's working pressure before optimization.

**Tech Stack:** Browser-native HTML dialog and DOM controllers, ES modules, Node built-in test runner, existing physics/thermodynamics modules, localStorage JSON persistence.

**Spec:** `docs/superpowers/specs/2026-10-11-cylinder-presets-design.md`

## Global Constraints

- Preserve existing blending equations, optimizer constraints, supply-bank behavior, gas model behavior, and gas inlet-temperature behavior.
- Cylinder preset material values are limited to `steel` and `aluminum` because those are the supported thermal models.
- Cylinder mass means the empty cylinder assembly mass, including the valve.
- Initial and target pressure must be no greater than the selected cylinder's working pressure; equality is valid.
- Legacy `volumePresets` are accepted only as a load-time migration and are not written by new saves.
- Invalid settings must leave existing saved settings unchanged.
- Do not retain custom working-tank volume or independent main-screen material controls.

---

### Task 1: Normalize Settings Around Cylinder Presets

**Files:**
- Modify: `js/settings.js`
- Test: `tests/settings.test.js`

**Interfaces:**
- `DEFAULT_SETTINGS.cylinderPresets` is an array of `{ name, volumeL, material, massKg, workingPressureBar }`.
- `validateSettings(settings)` validates `cylinderPresets` and returns messages.
- `loadSettings(storage, onFallback)` migrates legacy `volumePresets` into cylinder presets before validation.
- `saveSettings(settings, storage)` writes normalized settings without `volumePresets`.
- `sortCylinderPresetEntries(presets)` returns `{ preset, index }` entries sorted by volume, then original index.

- [x] **Step 1: Add failing settings tests for the normalized preset shape.**

Add tests in `tests/settings.test.js` that assert:

```js
assert.deepEqual(DEFAULT_SETTINGS.cylinderPresets[0], {
  name: '12 L Steel 232 bar',
  volumeL: 12,
  material: 'steel',
  massKg: 14,
  workingPressureBar: 232
});
```

Also add tests asserting:

- `loadSettings` converts `{ volumePresets: [12, 24] }` to two steel presets with `14` kg and `232` bar;
- `saveSettings` and `loadSettings` round-trip custom cylinder presets;
- invalid names, duplicate names, unsupported materials, non-positive/non-finite volume or mass, and working pressure outside 10–350 bar throw `RangeError` without writing storage;
- a saved object containing both `volumePresets` and `cylinderPresets` uses `cylinderPresets` and does not retain `volumePresets` after save;
- cylinder preset sorting is numeric and stable.

- [x] **Step 2: Run the focused settings tests and verify the new assertions fail.**

Run:

```bash
node --test tests/settings.test.js
```

Expected: failures because the current settings schema still requires `volumePresets` and has no cylinder preset validator or migration.

- [x] **Step 3: Implement the settings schema and migration.**

In `js/settings.js`:

1. Replace `volumePresets` in `DEFAULT_SETTINGS` with the standard cylinder presets, preserving the existing standard volumes `[3, 5, 7, 10, 12, 15, 18, 24]` as steel, 14 kg, 232 bar entries and including `12 L Steel 232 bar` as the default selection target.
2. Update `copySettings` to deep-copy `cylinderPresets` and never emit `volumePresets`.
3. Add `legacyVolumePresetsToCylinders(volumePresets)` that maps each valid legacy volume to `{ name: `${volume} L Steel 232 bar`, volumeL: volume, material: 'steel', massKg: 14, workingPressureBar: 232 }`.
4. Update normalization so a saved object with `cylinderPresets` uses that list; otherwise a saved `volumePresets` list is converted; otherwise the normalized object is invalid and falls back to defaults.
5. Validate at least one cylinder preset, unique non-empty case-insensitive names, finite volume at least 0.1 L, supported material, finite mass greater than 0 kg, and finite working pressure from 10 through 350 bar.
6. Add `sortCylinderPresetEntries` and remove the obsolete volume sorter.
7. Keep gas, physics, booster defaults and validation unchanged.

- [x] **Step 4: Run the focused settings tests and verify they pass.**

Run:

```bash
node --test tests/settings.test.js
```

Expected: PASS, including all existing gas/physics/booster tests updated to use `cylinderPresets`.

- [x] **Step 5: Commit the settings model.**

```bash
git add js/settings.js tests/settings.test.js
git commit -m "feat: add saved cylinder preset settings"
```

---

### Task 2: Wire Material and Mass Into Thermodynamics

**Files:**
- Modify: `js/input-validation.js`
- Modify: `js/thermodynamics.js`
- Test: `tests/input-validation.test.js`
- Test: `tests/thermodynamics.test.js`

**Interfaces:**
- `validateCalculatorInputs(cylinder, physics, thermal)` additionally validates `cylinder.workingPressureBar` and rejects initial/target pressure above it.
- `estimateTransferTemperature({ ..., tankMassKg, ... })` uses the supplied positive mass in the tank heat-capacity term.
- `simulateThermalProtocol` passes `thermal.tankMassKg` into every transfer-temperature estimate.

- [x] **Step 1: Add failing pressure and mass-behavior tests.**

In `tests/input-validation.test.js`, add cases that assert:

```js
const cylinder = {
  volumeL: 12,
  workingPressureBar: 232,
  initialPressureBar: 80,
  targetPressureBar: 210
};
assert.deepEqual(validateCalculatorInputs(cylinder, defaultPhysics, defaultThermal), []);
assert.match(
  validateCalculatorInputs({ ...cylinder, targetPressureBar: 232.1 }, defaultPhysics, defaultThermal).join(' '),
  /working pressure/i
);
assert.match(
  validateCalculatorInputs({ ...cylinder, initialPressureBar: 232.1 }, defaultPhysics, defaultThermal).join(' '),
  /working pressure/i
);
```

Add a boundary case for target pressure exactly equal to 232 bar.

In `tests/thermodynamics.test.js`, call `estimateTransferTemperature` with equal inputs and `tankMassKg: 10` versus `tankMassKg: 20`, and assert the lighter tank reaches a higher transfer-end temperature. Add a `simulateThermalProtocol` case whose output contains the configured mass-sensitive result.

- [x] **Step 2: Run focused validation and thermodynamics tests to verify failure.**

Run:

```bash
node --test tests/input-validation.test.js tests/thermodynamics.test.js
```

Expected: failures because working-pressure validation and the explicit mass parameter do not exist.

- [x] **Step 3: Implement pressure validation and explicit tank mass.**

In `js/input-validation.js`:

1. Require a finite `cylinder.workingPressureBar` between 10 and 350 bar when present in the normalized calculator input.
2. Keep the existing generic initial and target pressure bounds.
3. Add clear errors when either pressure exceeds the working pressure, for example `Initial pressure cannot exceed the selected cylinder working pressure of 232 bar.` and the equivalent target message.
4. Preserve the direct-call compatibility used by existing tests that omit `workingPressureBar` by making the rating check conditional when the field is absent; the browser path always supplies it from a preset.

In `js/thermodynamics.js`:

1. Add `tankMassKg` to `estimateTransferTemperature` with a positive numeric fallback only for direct legacy callers that omit it; use `Math.max(0.1, Number(tankMassKg) || material default)` so current direct API callers remain valid while browser calculations use the preset value.
2. Remove the material-only hard-coded mass selection from the normal path.
3. Add `tankMassKg` to the `simulateThermalProtocol` thermal input flow and pass it to `estimateTransferTemperature`.
4. Leave material-specific heat, area, and cooling-time behavior unchanged.

- [x] **Step 4: Run the focused tests and verify they pass.**

Run:

```bash
node --test tests/input-validation.test.js tests/thermodynamics.test.js
```

Expected: PASS, including old direct thermodynamics callers and new preset-mass behavior.

- [x] **Step 5: Commit the calculation changes.**

```bash
git add js/input-validation.js js/thermodynamics.js tests/input-validation.test.js tests/thermodynamics.test.js
git commit -m "feat: apply cylinder ratings and mass to calculations"
```

---

### Task 3: Replace Working-Tank and Settings UI

**Files:**
- Modify: `scuba_gas_remixer_simplex_optimizer.html`
- Modify: `js/ui/settings-dialog.js`
- Modify: `js/main.js`
- Test: `tests/settings.test.js` for any pure option helpers exposed by the settings UI module, if needed

**Interfaces:**
- `renderSettingsDialog(settings)` renders cylinder preset rows in `#settings-cylinder-presets`.
- `renderPresetOptions(settings, selectedCylinderName)` renders the working-tank cylinder selector and gas preset selectors, preserving the requested cylinder name when it exists and otherwise selecting the first cylinder preset.
- `main.js` resolves `#cylinder-preset` to a normalized settings preset and uses its volume/material/mass/rating.

- [x] **Step 1: Update the settings dialog markup and working-tank markup.**

In `scuba_gas_remixer_simplex_optimizer.html`:

1. Replace the “Cylinder sizes (L)” Settings section with “Cylinder presets”, Add cylinder button, and `#settings-cylinder-presets` container.
2. Replace `#cyl-vol-preset` and `#cyl-vol-custom` with `#cylinder-preset` and a visible rating hint next to it.
3. Remove `#tank-material` and its independent Steel/Aluminum selector.
4. Keep the cooling-medium selector, ambient/calc temperature, wait mode, and wait target unchanged.
5. Keep the existing pressure and gas composition fields unchanged.

- [x] **Step 2: Update the settings renderer for cylinder rows.**

In `js/ui/settings-dialog.js`:

1. Replace the volume-row renderer with rows containing name, volume, material select, mass, and working-pressure inputs.
2. Use `data-settings-collection="cylinderPresets"`, the row index, and exact fields `name`, `volumeL`, `material`, `massKg`, and `workingPressureBar`.
3. Keep remove-button behavior consistent with gas presets.
4. Render cylinder options sorted by volume while preserving the original settings array order.
5. Render option text in a readable form such as `${preset.name} — ${preset.volumeL} L / ${preset.material} / ${preset.workingPressureBar} bar`.

- [x] **Step 3: Update the controller state and event handlers.**

In `js/main.js`:

1. Replace `cylinderVolumeValue` with a resolver that returns the selected cylinder preset, falling back to the named default 12 L preset and then the first preset if the DOM value is missing or stale.
2. Update `copySettings` to deep-copy `cylinderPresets`.
3. Update `updateSettingsDraft` to handle the `cylinderPresets` collection and preserve material strings instead of converting them to numbers.
4. Replace `addVolumePreset` with `addCylinderPreset`, generating a unique name and defaults `{ volumeL: 12, material: 'steel', massKg: 14, workingPressureBar: 232 }`.
5. Replace the volume remove action with the cylinder remove action.
6. After saving settings, refresh the cylinder selector while preserving the current selected name when still present; on first initialization select the `12 L Steel 232 bar` preset when present, otherwise select the first cylinder preset before recalculation.
7. In `readInput`, put the selected preset's `volumeL` and `workingPressureBar` in `cylinder`, and its `material` and `massKg` in `thermal`.
8. Remove all reads of `#tank-material`, `#cyl-vol-custom`, and `#cyl-vol-preset`.
9. Update event routing for the new cylinder selection action and remove custom-volume event handling.
10. Keep gas preset, supply-bank, theme, settings-save, and recalculate behavior unchanged.

- [x] **Step 4: Run JavaScript syntax checks and the existing test suite.**

Run:

```bash
node --check js/main.js
node --check js/settings.js
node --check js/ui/settings-dialog.js
node --check js/thermodynamics.js
npm test
```

Expected: syntax checks pass; any remaining test failures should be limited to tests or docs still referring to `volumePresets` or the removed material/custom-volume IDs, which must be updated before continuing.

- [x] **Step 5: Commit the UI and browser-controller changes.**

```bash
git add scuba_gas_remixer_simplex_optimizer.html js/ui/settings-dialog.js js/main.js tests
 git commit -m "feat: select working tanks from cylinder presets"
```

---

### Task 4: Update Documentation and Regression Coverage

**Files:**
- Modify: `docs/architecture.md`
- Modify: `docs/development.md`
- Modify: `docs/optimizer.md`
- Modify: `README.md` if it documents the old working-tank controls
- Modify: affected current specs/plans only when they describe the current normalized settings contract
- Test: `tests/optimizer.test.js` if a public calculator-input fixture needs the working-pressure field

**Interfaces:**
- Documentation describes `cylinderPresets` and the selected working-tank preset as the source of volume, thermal properties, and pressure rating.
- Existing optimizer tests continue to exercise `cylinder.volumeL`; browser-level selection supplies that value from Settings.

- [x] **Step 1: Search current documentation and tests for obsolete volume/material UI contracts.**

Run:

```bash
grep -RIn --exclude-dir=.git --exclude='*.html' -E 'volumePresets|tank-material|cyl-vol-custom|Cylinder sizes|hard-coded mass|14\.2' docs README.md js tests
```

Update only current behavior documentation and implementation-plan references that would mislead maintainers. Leave historical completed specs intact unless they claim to define the current schema.

- [x] **Step 2: Add or update regression fixtures.**

Ensure browser-facing calculation fixtures include:

```js
cylinder: {
  volumeL: 12,
  workingPressureBar: 232,
  initialPressureBar: 80,
  targetPressureBar: 210
}
```

Keep direct optimizer tests that intentionally exercise the lower-level `volumeL` contract unchanged unless the new rating is required by the specific validation path.

- [x] **Step 3: Run the complete Node suite.**

Run:

```bash
npm test
```

Expected: all tests pass.

- [x] **Step 4: Run syntax and diff checks.**

Run:

```bash
node --check js/main.js && node --check js/settings.js && node --check js/ui/settings-dialog.js && node --check js/thermodynamics.js
 git diff --check
```

Expected: no syntax errors and no whitespace errors.

- [x] **Step 5: Commit documentation and regression updates.**

```bash
git add docs README.md tests
 git commit -m "docs: document cylinder preset calculations"
```

---

### Task 5: Browser Smoke Test and Final Verification

**Files:**
- No source changes unless the smoke test exposes a real implementation defect.

**Interfaces:**
- The actual browser surface must expose Settings cylinder management and Working tank selection.

- [x] **Step 1: Start the local static server.**

Run:

```bash
python3 -m http.server 8002
```

Serve the repository root and open `scuba_gas_remixer_simplex_optimizer.html` in the browser.

- [x] **Step 2: Verify the default working-tank selector.**

Confirm visually and via DOM inspection that:

- the Working tank card has a cylinder selector showing the default 12 L steel 232 bar preset;
- no custom-volume input exists;
- no independent tank-material selector exists;
- the settings dialog contains Cylinder presets with all five fields.

- [x] **Step 3: Verify preset selection changes calculations.**

Select a different-volume preset and confirm the result recalculates. Select an aluminum or different-mass preset and confirm the thermal result changes while the gas composition controls and supply-bank behavior remain available.

- [x] **Step 4: Verify settings CRUD and persistence.**

Add a cylinder preset, edit its name/volume/material/mass/working pressure, save Settings, reopen Settings, and confirm the values persist. Remove the currently selected preset and confirm the selector falls back to another preset without a browser error.

- [x] **Step 5: Verify overfill prevention.**

Select a preset rated at 232 bar, set target pressure above 232 bar, and confirm the result becomes an invalid-input error mentioning working pressure. Set target pressure exactly to 232 bar and confirm the pressure-rating validation no longer reports an overfill error.

- [x] **Step 6: Verify browser errors and close the smoke-test server.**

Confirm no console errors occurred, then stop the server. Record only observed test and smoke results.

- [x] **Step 7: Mark the implementation complete.**

After all tests and the browser smoke test pass, update the task checklist and report the exact commands and observed behavior.
