# Gas Model Settings and Ambient Calculation Temperature Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist the gas-model choice in Settings and use the working tank ambient temperature as the browser application's calculation/start temperature without changing the existing calculation APIs or equations.

**Architecture:** Extend the existing persisted settings object with `physics.model`, including legacy migration and validation. The Settings dialog owns editing this model as a draft; `main.js` reads the saved model and maps the existing ambient input to both `thermal.ambientTemperatureC` and browser-level `physics.temperatureC`. The optimizer, thermodynamics, and direct-call contracts remain unchanged.

**Tech Stack:** Browser-native ES modules, native HTML dialog and controls, Tailwind CDN classes, Node.js built-in test runner.

**Spec:** `docs/superpowers/specs/2026-10-11-gas-model-settings-design.md`

## Global Constraints

- Default gas model remains real gas (`vdw`).
- Allowed gas models remain exactly `vdw` and `ideal`.
- Existing direct optimizer/thermodynamics callers retain `physics: { model, temperatureC }`.
- Browser ambient temperature supplies `physics.temperatureC`.
- Inlet gas temperature remains independent.
- Do not change gas equations, optimizer constraints, thermal integration, result shapes, or unrelated pre-existing worktree changes.
- Use the existing Settings draft/save/cancel and localStorage conventions.
- Write regression tests before production code and observe the expected failure.

---

### Task 1: Add failing Settings persistence and validation coverage

**Files:**
- Modify: `tests/settings.test.js`
- Test target: `tests/settings.test.js`

**Interfaces:**
- Consumes: `DEFAULT_SETTINGS`, `loadSettings`, `saveSettings` from `js/settings.js`.
- Produces: executable regression coverage for the new `settings.physics.model` contract.

- [ ] **Step 1: Add the default-model assertion**

Add this test next to the existing default-settings assertions:

```js
test('settings default to the real-gas physics model', () => {
  assert.deepEqual(DEFAULT_SETTINGS.physics, { model: 'vdw' });
});
```

- [ ] **Step 2: Add migration, round-trip, and invalid-model tests**

Add these tests to `tests/settings.test.js`:

```js
test('legacy settings gain the default real-gas physics model', () => {
  const storage = memoryStorage([[
    'simplex-gas-remixer-settings',
    JSON.stringify({
      gasPresets: [{ name: 'Air', oxygenPercent: 21, heliumPercent: 0 }],
      volumePresets: [12]
    })
  ]]);

  assert.deepEqual(loadSettings(storage).physics, { model: 'vdw' });
});

test('selected gas model survives a settings round trip', () => {
  const storage = memoryStorage();
  const settings = {
    ...DEFAULT_SETTINGS,
    physics: { model: 'ideal' },
    gasPresets: DEFAULT_SETTINGS.gasPresets.map(preset => ({ ...preset })),
    volumePresets: [...DEFAULT_SETTINGS.volumePresets],
    booster: { ...DEFAULT_SETTINGS.booster }
  };

  saveSettings(settings, storage);

  assert.deepEqual(loadSettings(storage).physics, { model: 'ideal' });
});

test('unsupported gas models are rejected before storage changes', () => {
  const storage = memoryStorage();

  assert.throws(() => saveSettings({
    ...DEFAULT_SETTINGS,
    physics: { model: 'peng-robinson' }
  }, storage), /gas model.*ideal.*vdw/i);
  assert.equal(storage.getItem('simplex-gas-remixer-settings'), null);
});
```

- [ ] **Step 3: Run the focused test file and verify RED**

Run: `node --test tests/settings.test.js`

Expected: FAIL because `DEFAULT_SETTINGS.physics` is currently absent and the new persistence/validation contract is not implemented. Do not change the assertions to match the old behavior.

- [ ] **Step 4: Commit is intentionally omitted**

The repository contains pre-existing unrelated uncommitted changes. Keep this test change in the working tree and do not stage or commit unrelated files.

---

### Task 2: Implement persisted physics settings and Settings-dialog editing

**Files:**
- Modify: `js/settings.js:4-64,66-182`
- Modify: `js/ui/settings-dialog.js:104-124`
- Modify: `scuba_gas_remixer_simplex_optimizer.html:66-177`
- Test: `tests/settings.test.js`

**Interfaces:**
- Consumes: existing settings storage key, draft object, and dialog event delegation.
- Produces: `settings.physics.model` with default/migration/validation/copy behavior; a Settings-dialog select identified by `settings-physics-model` and tagged with `data-settings-collection="physics"` and `data-settings-field="model"`.

- [ ] **Step 1: Add the physics default and deep-copy field**

In `DEFAULT_SETTINGS`, add before `gasPresets`:

```js
physics: Object.freeze({ model: 'vdw' }),
```

In `copySettings`, return the corresponding independent object:

```js
physics: { model: settings.physics.model },
```

- [ ] **Step 2: Add legacy normalization and validation**

Update the legacy normalization path so saved objects without `physics` receive the default:

```js
function addDefaultPhysics(settings) {
  const physics = settings?.physics && typeof settings.physics === 'object'
    ? settings.physics
    : {};
  return {
    ...settings,
    physics: {
      ...DEFAULT_SETTINGS.physics,
      ...physics
    }
  };
}
```

Apply `addDefaultPhysics(addDefaultBooster(saved))` before `validateSettings` in `loadSettings`.

Normalize legacy objects in `saveSettings` before validation and copying so existing callers that omit the new field continue to work:

```js
export function saveSettings(settings, storage) {
  const normalized = addDefaultPhysics(settings);
  const errors = validateSettings(normalized);
  if (errors.length > 0) throw new RangeError(errors.join(' '));
  storage.setItem(STORAGE_KEY, JSON.stringify(copySettings(normalized)));
}
```

At the beginning of `validateSettings`, after the collection-shape check, add:

```js
if (!['ideal', 'vdw'].includes(settings.physics?.model)) {
  errors.push('Gas model must be either ideal or vdw.');
}
```

- [ ] **Step 3: Add the Settings-dialog gas-model control**

Inside the dialog grid, add a Calculation section before Gas presets:

```html
<section>
  <h3 class="mb-3 text-sm font-semibold text-slate-200">Calculation</h3>
  <label for="settings-physics-model" class="block text-xs text-slate-400">Gas model</label>
  <select id="settings-physics-model"
    data-settings-collection="physics"
    data-settings-field="model"
    aria-label="Gas model"
    class="mt-1 w-full rounded border border-ocean-700 bg-ocean-950 px-2 py-1 text-xs text-slate-100">
    <option value="vdw">Real gas</option>
    <option value="ideal">Ideal gas</option>
  </select>
  <p class="mt-1 text-[10px] text-slate-500">Real gas uses the Van der Waals model; ideal gas uses PV = nRT.</p>
</section>
```

- [ ] **Step 4: Render the draft model**

At the start of `renderSettingsDialog(settings)`, set the select value:

```js
const physicsModel = document.getElementById('settings-physics-model');
if (physicsModel) physicsModel.value = settings.physics.model;
```

Keep the existing preset and booster rendering unchanged.

- [ ] **Step 5: Run the focused test file and verify GREEN**

Run: `node --test tests/settings.test.js`

Expected: all Settings tests pass, including the new default, migration, round-trip, and rejection cases.

---

### Task 3: Rewire the browser controller and clarify temperature semantics

**Files:**
- Modify: `js/main.js:61-67,151-160,268-293,484-507`
- Modify: `scuba_gas_remixer_simplex_optimizer.html:32-47,206-256`
- Modify: `docs/architecture.md:12,18,29-33`
- Modify: `docs/development.md:27-30,41`
- Modify: `docs/gas-physics.md:1-3,31-41`
- Test: `tests/settings.test.js` and existing optimizer/thermodynamics tests

**Interfaces:**
- Consumes: `state.settings.physics.model`, main-screen `ambient-temperature`, and the existing Settings draft event flow.
- Produces: browser input objects with `physics.model` from saved Settings and `physics.temperatureC` equal to `thermal.ambientTemperatureC`; no header gas-model or separate calculation-temperature controls.

- [ ] **Step 1: Extend the controller Settings copy**

Update `main.js` `copySettings` to preserve the physics object:

```js
physics: { ...settings.physics },
```

- [ ] **Step 2: Support select values in Settings drafts**

Update `updateSettingsDraft(input)` so the physics model is stored as text rather than parsed as a number:

```js
const value = collection === 'physics' || field === 'name'
  ? input.value
  : Number.parseFloat(input.value);
if (collection === 'physics') state.settingsDraft.physics[field] = value;
else if (collection === 'volumePresets') state.settingsDraft.volumePresets[index] = value;
else if (collection === 'booster') state.settingsDraft.booster[field] = value;
else state.settingsDraft.gasPresets[index][field] = value;
```

- [ ] **Step 3: Update Settings input event handling**

Change the first branch of `handleInputOrChange(event)` to process both input and change events for Settings controls:

```js
if ((event.type === 'input' || event.type === 'change') && target.dataset.settingsCollection) {
  updateSettingsDraft(target);
  return;
}
```

This preserves numeric draft editing and enables the new select.

- [ ] **Step 4: Read the saved model and ambient temperature**

Replace the current physics read in `readInput()` with:

```js
physics: {
  model: state.settings.physics.model,
  temperatureC: numberValue('ambient-temperature')
},
```

Keep `thermal.ambientTemperatureC` reading the same DOM value. This intentionally makes the two values equal in browser-generated input.

- [ ] **Step 5: Remove the obsolete header controls**

Delete the header `gas-physics-model` select and `blend-temp` input. Keep the header calculation-controls wrapper only if it has useful remaining content; otherwise remove the empty wrapper. Do not add a replacement calculation-temperature control.

- [ ] **Step 6: Clarify ambient temperature in the thermal UI**

Change the label to `Ambient / calculation temperature` and add helper text explaining that it is used for the surrounding temperature and starting gas calculation state. Keep the inlet gas-temperature control independent.

- [ ] **Step 7: Update documentation**

Document that:

- the gas model is selected and persisted in Settings;
- the browser UI uses ambient temperature as `physics.temperatureC`;
- direct optimizer callers may still provide an independent `physics.temperatureC`;
- inlet gas temperature remains separate;
- the selected model affects density, moles, compressibility, transfer estimates, and thermal pressure projection.

Remove references describing a separate header gas-model or calculation-temperature control.

- [ ] **Step 8: Run the full Node suite and syntax checks**

Run:

```sh
npm test
for file in js/*.js js/ui/*.js; do node --check "$file" || exit 1; done
```

Expected: all existing and new tests pass; every module parses successfully.

---

### Task 4: Browser smoke verification and final review

**Files:**
- Verify: `scuba_gas_remixer_simplex_optimizer.html`, `js/main.js`, `js/settings.js`, `js/ui/settings-dialog.js`
- Verify: `docs/superpowers/specs/2026-10-11-gas-model-settings-design.md`

**Interfaces:**
- Consumes: the implemented browser UI and localStorage-backed Settings flow.
- Produces: observed evidence that Settings save/cancel/reload, both gas models, ambient temperature, and thermal calculations work without runtime errors.

- [ ] **Step 1: Start a local HTTP server**

Run a static server from the repository root, for example:

```sh
python3 -m http.server 8000
```

Open `http://127.0.0.1:8000/scuba_gas_remixer_simplex_optimizer.html` in Chromium.

- [ ] **Step 2: Verify the initial surface**

Confirm visually and through the DOM that:

- the header has no `gas-physics-model` or `blend-temp` controls;
- the thermal card contains the ambient/calculation temperature input;
- the inlet gas-temperature input remains present;
- the Settings button opens the dialog;
- Settings shows Real gas selected by default.

- [ ] **Step 3: Verify Settings persistence and cancel behavior**

Select Ideal gas and click Cancel; confirm the next calculation still uses Real gas. Reopen Settings, select Ideal gas, click Save, and confirm the result recalculates. Reload the page and confirm Ideal gas remains selected. Select Real gas, save, and confirm restoration.

- [ ] **Step 4: Verify ambient-temperature wiring**

Change ambient temperature and confirm the app recalculates without a missing `blend-temp` error. Compare the result at two ambient temperatures and confirm the displayed recipe/thermal estimates update. Change inlet gas temperature independently and confirm it remains an available separate control.

- [ ] **Step 5: Check browser diagnostics**

Confirm there are no application module errors or uncaught exceptions in the browser console. The existing Tailwind CDN warning is expected and unchanged.

- [ ] **Step 6: Review only the intended diff**

Inspect the final changed files and confirm no unrelated pre-existing files were reverted or reformatted. Report any existing worktree changes separately from the implementation changes.
