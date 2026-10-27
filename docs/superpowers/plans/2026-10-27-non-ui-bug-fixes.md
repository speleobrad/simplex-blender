# Non-UI Bug Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the confirmed non-UI defects found in the 2026-10-27 audit without changing any documented behavior, any screenshot baseline, or the optimizer's gas-retention priority.

**Architecture:** Each task is one defect cluster that ships on its own. A task starts with a test that fails on the current code, then makes the smallest fix, then re-runs the full suite. Fixes touch no LP cost, safety-candidate selection or unrelated numerics unless a task says so. Phase B holds the one fix (Task 10) that changes which recipe the optimizer emits; it was validated in a scratch copy against the full Node suite before being written down.

**Tech Stack:** Browser-native ES modules (no bundler), `node --test` for `tests/*.test.js`, Playwright for `tests/browser/*.spec.js`.

**Spec:** `docs/architecture.md`, `docs/optimizer.md`, `docs/gas-physics.md`, `docs/development.md` ("Priority invariant"), `AGENTS.md`.

**Implementation status:** All confirmed defects and the resolved decision items below are implemented. The task checkboxes remain as the original execution recipe; final verification is recorded in the session delivery rather than retroactively rewriting each historical step.

## Global Constraints

- Audit snapshot: `HEAD = ccd0df5` on `master`, clean tree. `npm test` at that commit: **681 tests, 681 pass, 0 fail** (bounded run, exit 0). Line numbers below were read at that commit. If HEAD moves, find functions by name, not by line.
- **Cost redesign is existing work, not part of this plan.** Commits `8d321de..ccd0df5` (issue #3: `js/cost.js`, `js/pure-prices.js`, `js/savings.js`, `js/bank-pricing.js`, `js/ui/cost-summary.js`, `docs/superpowers/plans/2026-10-27-cost-redesign.md`) predate this plan. No task edits or reverts them. The non-UI cost modules got a focused read at `ccd0df5` and no defect was found; see "Coverage".
- The priority invariant (`docs/development.md`): the test `default example keeps the cylinder gas when the safety ceiling is active` in `tests/optimizer.test.js` MUST pass unchanged after every task.
- Never change files under `tests/browser/screenshots.spec.js-snapshots/` without reading `docs/ci-reproduction.md` first. Never raise `maxDiffPixelRatio`. Never claim GitHub Actions passed from a local run. Do not push to `origin/master`.
- No shims or compatibility aliases. Update every caller. Only touch docs where behavior the docs describe changes.
- Run `npm test` after every task. Run the named Playwright spec for any task that touches `js/main.js`; `main.js` has no Node tests because it runs DOM code at import.
- Commit message convention in this repo: `fix: <what> (refs #N)`. These tasks have no issue number, so omit the suffix.

## Evidence legend

| Tag | Meaning |
|---|---|
| **Proven** | Reproduced by running code in this session (script output quoted) |
| **Code-read** | Confirmed by reading the cited code in this session; not executed |
| **Reported** | Reported by an audit agent from code reading; not independently re-read. Task step 1 is a failing test that proves or kills it |

Audit agents had no code-execution tool, so every finding not marked Proven is argued from code.

## Triage

| ID | Finding | Evidence | Task |
|---|---|---|---|
| O1-1 | `solveTwoPhaseSimplex` returns wrong `cost` after any phase-2 pivot | **Proven** (reported 14, true 6) | 1 |
| D8 | `loadSupplyBanks` throws on `[null,null,null]` at boot | **Proven** | 2 |
| P6 | `material: ["steel"]` passes preset validation | **Proven** | 2 |
| C4 | Blending `waitMinutes` / `waitMode` never validated | **Code-read** (no `wait` in `input-validation.js`) | 3 |
| C3 | Blank What-if wait field silently becomes 0 | Reported | 3 |
| D1/M1 | Cancel reverts a confirmed preset import and rewrites storage | **Code-read** (`cancelSettings` L1004-1032, `importSelectedPresets` L654-682) | 4 |
| M6/D6 | Save does not clear the load-failure banner; Cancel overwrites unreadable data | Reported (Cancel half Code-read) | 4 |
| D3 | Factory reset from Imperial leaves inputs in the old unit | Reported | 5 |
| M9 | Factory reset leaves bank price basis, suggestions and readings | Reported | 5 |
| D7/M10 | Same preset file cannot be loaded twice | Reported | 5 |
| M3 | What-if gas preset select does not re-run the scenario | **Code-read** (`applyWhatIfGasPreset` L961-972) | 6 |
| C2 | `comparePressureStarts` ignores drain rows | **Code-read** (L1154-1166) | 6 |
| C1 | Compare/What-if helium accounting wrong after Add then Drain | Reported | 7 |
| S1 | Re-plan fails "Invalid blend input" when a derived bank pressure drops under 1 bar | Reported, **not reproduced** | Appendix (unreproduced candidates) |
| S5 | Changing display units wipes interim readings | Code-read (`calculatorInputSignature` blanks only `costs`) | 8 |
| D4 | Analytics keeps running after factory reset | Reported | 9 |
| O1-2 | Max-pressure fallback drops cylinder gas that the same-pressure exact recipe keeps (priority-invariant violation) | **Proven** (retained 0% / vented 50 bar vs exact at 157.1 bar: 100% retained, 0 vented) | 10 |
| P1 | Thermal chart pressure curve uses reference-temperature pressure, not hot pressure | Reported | 11 |
| P3 | Target gas mass uses ambient temperature, initial mass uses start temperature | Reported | 12 |

**Needs a user decision (no task until decided):** see the section at the end.
**Deferred / rejected:** see the section at the end.

---

## Phase A: safe, test-first fixes

### Task 1: Correct the simplex objective value

`solveTwoPhaseSimplex` stores `+z0` in the phase-2 objective rhs. Pivots subtract `d_j·θ` with `d_j < 0`, so the stored value grows while the true cost falls. The returned `cost` equals `2·z0 − z_final`. It feeds `lpCost` in `js/optimizer.js` and the last tie-break in `js/salvage.js` (`compareAscending(a.variant.lpCost …)`).

**Files:**
- Modify: `js/simplex.js` (phase-2 setup, `tableau[phase2ObjectiveRow][rhsCol] = currentCost;`, and the final `return`)
- Test: `tests/simplex.test.js`

**Interfaces:**
- Consumes: `solveTwoPhaseSimplex(tableau, numDecisionVars, numConstraints, varNames, costVector)`
- Produces: `result.cost` equals `Σ costVector[j] · solution[varNames[j]]`. No signature change.

- [ ] **Step 1: Write the failing test** (append to `tests/simplex.test.js`)

```js
test('reported cost equals the objective value at the returned solution after phase-two pivots', () => {
  // minimize 5*x1 + 3*x2 subject to x1 + x2 = 2; phase 2 must pivot from x1 to x2.
  const decisionVariableCount = 2;
  const constraintCount = 3;
  const physicalCount = decisionVariableCount + constraintCount;
  const columnCount = physicalCount + 3 + 1;
  const tableau = Array.from({ length: constraintCount + 2 }, () => Array(columnCount).fill(0));
  tableau[0][0] = 1;
  tableau[0][1] = 1;
  tableau[0][columnCount - 1] = 2;
  tableau[0][physicalCount] = 1;
  tableau[1][physicalCount + 1] = 1;
  tableau[2][physicalCount + 2] = 1;
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < columnCount; j++) tableau[constraintCount][j] -= tableau[i][j];
  }
  for (let i = 0; i < 3; i++) tableau[constraintCount][physicalCount + i] = 0;
  const costVector = Array(physicalCount).fill(0);
  costVector[0] = 5;
  costVector[1] = 3;

  const result = solveTwoPhaseSimplex(
    tableau, decisionVariableCount, constraintCount,
    ['x1', 'x2', 's1', 's2', 's3'], costVector
  );

  assert.equal(result.feasible, true);
  assert.deepEqual(result.solution, { x1: 0, x2: 2 });
  assert.equal(result.cost, 5 * result.solution.x1 + 3 * result.solution.x2);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test tests/simplex.test.js`
Expected: FAIL, `14 !== 6`.

- [ ] **Step 3: Fix.** In `js/simplex.js`, store the negated cost, which is the convention the pivot arithmetic assumes, and negate on return.

```js
      tableau[phase2ObjectiveRow][rhsCol] = -currentCost;
```

```js
  return { feasible: true, solution, steps, cost: -tableau[phase2ObjectiveRow][rhsCol] };
```

- [ ] **Step 4: Run the full suite**

Run: `npm test`
Expected: 682 tests, all pass. The two optimizer tests that read `tableauSteps` (`tests/optimizer.test.js`, search `tableauSteps`) must still pass. If one asserts the phase-2 rhs sign, fix the assertion to the new convention and say so in the commit body.

- [ ] **Step 5: Commit**

```bash
git add js/simplex.js tests/simplex.test.js
git commit -m "fix: return the true objective value from the simplex solver"
```

### Task 2: Storage and material validation holes

D8 (proven): `isLegacyDefaultBanks` calls `Object.keys(bank)` on every element once the stored list has exactly three entries, so `[null,null,null]` throws a `TypeError` from module load in `main.js` and the app stays blank until site data is cleared. P6 (proven): `Object.hasOwn(MATERIALS, ["steel"])` coerces the array to `"steel"` and returns true.

**Files:**
- Modify: `js/bank-storage.js` (`isLegacyDefaultBanks`), `js/materials.js` (`isValidMaterial`)
- Test: `tests/banks.test.js`, `tests/materials.test.js`

- [ ] **Step 1: Write the failing tests**

`tests/banks.test.js` (reuse the file's existing imports; add `loadSupplyBanks` and `DEFAULT_BANKS` to the import if absent):

```js
test('loadSupplyBanks falls back instead of throwing when three stored entries include null', () => {
  const storage = { getItem: () => JSON.stringify([null, null, null]), setItem() {}, removeItem() {} };
  let fallbackCalls = 0;
  const banks = loadSupplyBanks(storage, () => { fallbackCalls += 1; });
  assert.equal(fallbackCalls, 1);
  assert.deepEqual(banks.map(bank => bank.id), DEFAULT_BANKS.map(bank => bank.id));
});
```

`tests/materials.test.js`:

```js
test('isValidMaterial accepts only string keys', () => {
  assert.equal(isValidMaterial('steel'), true);
  assert.equal(isValidMaterial(['steel']), false);
  assert.equal(isValidMaterial({ toString: () => 'steel' }), false);
});
```

- [ ] **Step 2: Run to verify both fail**

Run: `node --test tests/banks.test.js tests/materials.test.js`
Expected: the banks test fails with `TypeError: Cannot convert undefined or null to object`; the materials test fails on the array case.

- [ ] **Step 3: Fix**

`js/bank-storage.js`:

```js
    && banks.every((bank, index) => (
      bank !== null && typeof bank === 'object'
      && Object.keys(bank).length === LEGACY_BANK_FIELDS.length
      && BANK_FIELDS.every(field => bank[field] === LEGACY_DEFAULT_BANKS[index][field])
    ));
```

`js/materials.js`:

```js
export function isValidMaterial(material) {
  return typeof material === 'string' && Object.hasOwn(MATERIALS, material);
}
```

- [ ] **Step 4: Run** `npm test`. Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add js/bank-storage.js js/materials.js tests/banks.test.js tests/materials.test.js
git commit -m "fix: reject non-string materials and survive null entries in stored banks"
```

### Task 3: Validate wait inputs

C4: `validateCalculatorInputs` has no check on `thermal.waitMinutes` / `thermal.waitMode`. `thermodynamics.js` coerces NaN to 0 and clamps negatives, so an empty or negative "Wait time" is accepted although `docs/UI.md` says invalid values are reported. The existing test `rejects unsupported thermal selectors and negative fixed waits` does not cover it: its invalid material and medium already make `errors.length >= 2`.

C3: `expandWhatIfRows` turns a blank What-if wait (`NaN`) into 0 before `validateCompareRecipe` can reject it.

**Files:**
- Modify: `js/input-validation.js` (thermal block, after the cooling-medium check), `js/what-if-scenario.js` (`expandWhatIfRows`)
- Test: `tests/input-validation.test.js`, `tests/what-if-scenario.test.js`

**Interfaces:**
- Produces: new `validateCalculatorInputs` error strings, exactly `Thermal wait mode must be minutes or temperature.` and `Thermal wait must be between 0 and 1440 minutes.`

- [ ] **Step 1: Write the failing tests**

`tests/input-validation.test.js`:

```js
test('rejects a missing, negative, or oversized fixed wait and an unknown wait mode', () => {
  const base = {
    tankMaterial: 'steel',
    coolingMedium: 'air',
    ambientTemperatureC: 20,
    inletTemperatureC: 20,
    targetMediumTemperatureC: 25,
    targetInWaterTemperatureC: 20,
    waitMode: 'minutes',
    waitMinutes: 5,
    targetTemperatureC: 25
  };
  const cylinder = { volumeL: 12, initialPressureBar: 80, targetPressureBar: 210 };
  const physics = { temperatureC: 20 };
  const errorsFor = overrides => validateCalculatorInputs(cylinder, physics, { ...base, ...overrides }).join(' ');

  assert.doesNotMatch(errorsFor({}), /wait/i);
  assert.match(errorsFor({ waitMinutes: Number.NaN }), /Thermal wait must be between 0 and 1440 minutes\./);
  assert.match(errorsFor({ waitMinutes: -1 }), /Thermal wait must be between 0 and 1440 minutes\./);
  assert.match(errorsFor({ waitMinutes: 1441 }), /Thermal wait must be between 0 and 1440 minutes\./);
  assert.match(errorsFor({ waitMode: 'sometime' }), /Thermal wait mode must be minutes or temperature\./);
  assert.doesNotMatch(errorsFor({ waitMode: 'temperature', waitMinutes: Number.NaN }), /minutes\./);
});
```

`tests/what-if-scenario.test.js`:

```js
test('a blank wait between steps is carried to validation instead of becoming zero', () => {
  const rows = [
    { ...createCompareRow('add', 'a'), waitMinutes: Number.NaN },
    createCompareRow('add', 'b')
  ];
  const wait = expandWhatIfRows(rows).find(row => row.type === 'wait');
  assert.equal(Number.isFinite(wait.waitMinutes), false);
});

test('an add row without a wait value still defaults to a zero-minute wait', () => {
  const rows = [createCompareRow('add', 'a'), createCompareRow('add', 'b')];
  assert.equal(expandWhatIfRows(rows).find(row => row.type === 'wait').waitMinutes, 0);
});
```

(Import `createCompareRow` and `expandWhatIfRows` the way the file already does; check its first lines.)

- [ ] **Step 2: Run to verify the first two fail**

Run: `node --test tests/input-validation.test.js tests/what-if-scenario.test.js`
Expected: the validation test and the NaN-wait test FAIL; the default-zero test passes (it pins existing behavior).

- [ ] **Step 3: Fix**

`js/input-validation.js`, immediately after the `coolingMedium` check:

```js
  if (thermal.waitMode !== undefined && !['minutes', 'temperature'].includes(thermal.waitMode)) {
    errors.push('Thermal wait mode must be minutes or temperature.');
  } else if (thermal.waitMode !== 'temperature' && thermal.waitMinutes !== undefined
    && !(Number.isFinite(thermal.waitMinutes) && thermal.waitMinutes >= 0 && thermal.waitMinutes <= 1440)) {
    errors.push('Thermal wait must be between 0 and 1440 minutes.');
  }
```

`js/what-if-scenario.js`:

```js
    wait.waitMinutes = row.waitMinutes === undefined ? 0 : row.waitMinutes;
```

`undefined` stays valid so fixtures that omit the wait keep working. `null` and `NaN` now reach `validateCompareRecipe`, which already emits `Wait duration must be between 0 and 1440 minutes.`

- [ ] **Step 4: Run** `npm test`. If an `optimizer.test.js` or `plan-with-readings.test.js` fixture sets an out-of-range `waitMinutes`, correct the fixture value; do not loosen the check.

- [ ] **Step 5: Run the What-if browser spec** (blank wait now shows an error, as the UI already has a slot for it)

Run: `npm run test:ui -- tests/browser/what-if.spec.js --project=desktop`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add js/input-validation.js js/what-if-scenario.js tests/input-validation.test.js tests/what-if-scenario.test.js
git commit -m "fix: validate fixed wait minutes and wait mode instead of coercing them"
```

### Task 4: Cancel must not undo imports or rewrite storage

`openSettings` snapshots `state.settingsBeforeDraft`. `cancelSettings` restores that snapshot and then calls `saveSettings(state.settings, …)`. A confirmed preset import (`importSelectedPresets`) never refreshes the snapshot, so Cancel after an import removes the imported presets from memory and storage. `docs/superpowers/specs/2026-10-13-preset-management-design.md:102` says an already-confirmed import is not rolled back by Cancel. The same unconditional write also overwrites unreadable saved data with defaults (D6), and `saveSettingsDraft` does not clear `state.settingsLoadFailure` (M6).

Draft edits never write to storage (`persistSettingsDraft` only updates memory), so the Cancel write has no purpose.

**Files:**
- Modify: `js/main.js` (`cancelSettings`, `importSelectedPresets`, `saveSettingsDraft`)
- Test: `tests/browser/persistence.spec.js`

- [ ] **Step 1: Write the failing browser test** (add inside `test.describe('persistence and failure states', …)`, using the helpers already imported there; also import `cancelSettings` from `./helpers/settings.js`)

```js
  test('canceling after a confirmed preset import keeps the imported presets', async ({ appPage }) => {
    const page = await appPage.goto('settings');
    await openSettingsCategory(page, 'preset-management');
    await uploadFixture(page, validGasFixture);
    await page.getByRole('button', { name: 'Import selected', exact: true }).click();
    await expect(settingsImportStatus(page)).toHaveText('Imported 1 preset.');

    await cancelSettings(page);

    await expect(page.evaluate(() => JSON.parse(localStorage.getItem('simplex-gas-remixer-settings')).gasPresets
      .some(preset => preset.name === 'Browser fixture gas'))).resolves.toBe(true);
    await expect(page.locator('#init-gas-preset option', { hasText: 'Browser fixture gas' })).toHaveCount(1);
  });
```

The working-tank gas preset select is `#init-gas-preset` (checked in `index.html`). Import `cancelSettings` from `./helpers/settings.js` in `persistence.spec.js`; it is exported there.

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:ui -- tests/browser/persistence.spec.js --project=desktop -g "canceling after a confirmed preset import"`
Expected: FAIL (storage no longer contains the imported preset).

- [ ] **Step 3: Fix in `js/main.js`**

In `cancelSettings`, delete the storage write:

```js
  if (state.settingsBeforeDraft) {
    state.settings = copySettings(state.settingsBeforeDraft);
    convertDisplayedInputs(previousUnits, state.settings.units);
```

(remove the whole `try { saveSettings(…) } catch { console.warn(…) }` block).

In `importSelectedPresets`, after `state.settingsDraft = copySettings(merged);` add the baseline refresh. An in-session Cancel then restores a baseline that includes the import:

```js
  if (state.settingsBeforeDraft) state.settingsBeforeDraft = copySettings(merged);
```

In `saveSettingsDraft`, after the successful save and where it assigns `state.settings`, add:

```js
  state.settingsLoadFailure = null;
```

Read `saveSettingsDraft` first (it starts at about L913) and place this on the success path only, after `saveSettings` has not thrown.

Known remaining limit, left alone on purpose: `importSelectedPresets` merges into `state.settings`, which can contain unsaved draft edits, and persists them (finding D2). Fixing that changes what "import" saves and is listed under "Needs a decision".

- [ ] **Step 4: Run the new test, then the settings specs**

Run: `npm run test:ui -- tests/browser/persistence.spec.js tests/browser/settings.spec.js tests/browser/multi-session.spec.js --project=desktop`
Expected: all pass, including "keeps draft edits on Save and discards them on Cancel".

- [ ] **Step 5: Run** `npm test`. Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add js/main.js tests/browser/persistence.spec.js
git commit -m "fix: keep confirmed preset imports when settings are canceled"
```

### Task 5: Factory reset and preset-file loading leftovers

D3: after a factory reset, `state.settings.units` returns to metric but the form inputs keep imperial numbers (a 652 psi start is read as 652 bar and fails range validation). M9: reset leaves `state.bankPriceBasis`, `state.bankSuggestions` and `state.interimMeasurements`. D7/M10: `loadPresetFile` never clears `input.value`, so choosing the same file again fires no `change` event.

**Files:**
- Modify: `js/main.js` (`resetFactorySettings` L684-724, `loadPresetFile` about L601-605)
- Test: `tests/browser/persistence.spec.js`

- [ ] **Step 1: Write the failing browser tests**

```js
  test('factory reset from imperial units restores metric input values', async ({ appPage }) => {
    const page = await appPage.goto('tourSeen');
    const general = await openSettingsCategory(page, 'general');
    await general.getByRole('combobox', { name: 'Units' }).selectOption('imperial');
    await saveSettings(page);
    await expect(page.locator('#init-p')).not.toHaveValue(/^45(\.0+)?$/);

    await openSettingsCategory(page, 'preset-management');
    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('button', { name: 'Reset to factory settings', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Analytics consent', exact: true })).toBeVisible();

    await expect(page.locator('#init-p')).toHaveValue(/^45(\.0+)?$/);
  });

  test('canceling Settings after a factory reset does not bring the old presets back', async ({ appPage }) => {
    const page = await appPage.goto('tourSeen');
    const defaultGasOptions = await page.locator('#init-gas-preset option').count();
    const gas = await openSettingsCategory(page, 'gas-presets');
    await gas.getByRole('button', { name: 'Add gas', exact: true }).click();
    await saveSettings(page);
    await expect(page.locator('#init-gas-preset option')).toHaveCount(defaultGasOptions + 1);

    await openSettingsCategory(page, 'preset-management');
    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('button', { name: 'Reset to factory settings', exact: true }).click();
    await dismissFreshConsent(page);
    await openSettingsCategory(page, 'general');
    await cancelSettings(page);

    await expect(page.locator('#init-gas-preset option')).toHaveCount(defaultGasOptions);
  });

  test('the same preset file can be loaded twice', async ({ appPage }) => {
    const page = await appPage.goto('tourSeen');
    await openSettingsCategory(page, 'preset-management');
    await uploadFixture(page, validGasFixture);
    await expect(settingsImportStatus(page)).toContainText('Loaded 3 entries');
    await expect(page.locator('#settings-preset-import-file')).toHaveValue('');
  });
```

The units control is `#settings-units` (role combobox, name `Units`), the start-pressure input is `#init-p`, and the confirm step is `page.once('dialog', dialog => dialog.accept())`, all copied from `index.html` and the existing factory-reset test in `persistence.spec.js`. `dismissFreshConsent` is already defined at the top of that spec.

- [ ] **Step 2: Run to verify both fail**

Run: `npm run test:ui -- tests/browser/persistence.spec.js --project=desktop -g "factory reset from imperial|canceling Settings after a factory reset|same preset file"`
Expected: FAIL.

- [ ] **Step 3: Fix in `js/main.js`**

In `resetFactorySettings`, capture units before the reset, then convert, refresh the Cancel baseline, and clear the transient maps after the existing `if (!didReset) return;`. The initial values below are the literals in the `state` object (`bankSuggestions: {}`, `bankPriceBasis: {}`, `interimMeasurements: []`).

```js
function resetFactorySettings() {
  const previousUnits = state.settings.units;
  let didReset;
  // ...unchanged try/catch around resetApplicationState...
  if (!didReset) return;
  convertDisplayedInputs(previousUnits, state.settings.units);
  state.bankSuggestions = {};
  state.bankPriceBasis = {};
  state.interimMeasurements = [];
  state.settingsBeforeDraft = copySettings(state.settings);
  state.settingsBeforeDraftCylinderName = null;
  // ...rest of the function unchanged...
```

In `loadPresetFile`, after the file is captured:

```js
  const file = input.files?.[0];
  input.value = '';
```

(keep `file` as the variable the function already uses; the `File` object stays valid after the input is cleared).

- [ ] **Step 4: Run** `npm run test:ui -- tests/browser/persistence.spec.js tests/browser/settings.spec.js tests/browser/multi-session.spec.js --project=desktop`. Expected: pass. Then `npm test`.

- [ ] **Step 5: Commit**

```bash
git add js/main.js tests/browser/persistence.spec.js
git commit -m "fix: reset input units and transient state on factory reset; allow reloading a preset file"
```

### Task 6: What-if editor consistency

M3: `applyWhatIfGasPreset` patches the start (which bumps `draftRevision`) and then only re-renders. Every other What-if edit calls `runWhatIf`, and there is no run button, so the result stays "Out of date" until an unrelated edit. C2: `comparePressureStarts` advances only through `add` and `wait` rows, but `validateCompareRecipe` also advances through `drain` rows. After a Drain, the Add row's linked "Pressure added" field is computed from the wrong receiver pressure.

**Files:**
- Modify: `js/main.js` (`applyWhatIfGasPreset`, `comparePressureStarts`)
- Test: `tests/browser/what-if.spec.js`

- [ ] **Step 1: Write the failing browser tests**

Both tests go in `tests/browser/what-if.spec.js`, which already imports `openWhatIf`, `setWhatIfRow`, `runWhatIf` and defines `load(appPage)`.

```js
  test('selecting a What-if gas preset reruns the scenario instead of leaving it out of date', async ({ appPage }) => {
    const page = await load(appPage);
    await openWhatIf(page);
    await runWhatIf(page);
    await page.locator('#what-if-current-gas-preset').selectOption('gas:EAN 32');
    await expect(page.locator('#what-if-result-host')).not.toContainText('Out of date');
  });

  test('an add row after a drain links pressure added to the drained pressure', async ({ appPage }) => {
    const page = await load(appPage);
    await openWhatIf(page);
    await setWhatIfRow(page, 'compare-row-1', { type: 'drain', targetPressureBar: '20' });
    await page.getByRole('button', { name: 'Add step', exact: true }).evaluate(button => button.click());
    const steps = page.locator('#screen-what-if fieldset[data-row-id^="compare-row-"]:visible');
    await steps.nth(1).locator('[data-compare-field="type"]').selectOption('add');
    await steps.nth(1).locator('[data-compare-field="bankId"]').selectOption('compressor-air');
    await steps.nth(1).locator('[data-compare-field="pressureAddedBar"]').fill('5');
    // The scenario starts at 45 bar (default), drains to 20, so 5 bar added targets 25, not 45 + 5 = 50.
    await expect(steps.nth(1).locator('[data-compare-field="targetPressureBar"]')).toHaveValue(/^25(\.0+)?$/);
  });
```

- [ ] **Step 2: Run to verify both fail**

Run: `npm run test:ui -- tests/browser/what-if.spec.js --project=desktop`
Expected: the two new tests FAIL.

- [ ] **Step 3: Fix in `js/main.js`**

```js
function applyWhatIfGasPreset(select) {
  if (!select.value.startsWith('gas:')) return;
  const preset = state.settings.gasPresets.find(candidate => candidate.name === select.value.slice(4));
  if (!preset) return;
  state.whatIfScenario = applyWhatIfStartPatch(state.whatIfScenario, {
    oxygenPercent: preset.oxygenPercent,
    heliumPercent: preset.heliumPercent
  });
  state.whatIfErrors = [];
  runWhatIf();
}
```

Read `runWhatIf` first and confirm it renders both the editor and the result (the audit says it does). If it does not re-render the editor, call `renderWhatIfEditor()` after it.

In `comparePressureStarts`, add the drain branch the validator already implements:

```js
    } else if (row.type === 'drain' && Number.isFinite(row.targetPressureBar)) {
      currentPressure = row.targetPressureBar;
    } else if (row.type === 'wait' && Number.isFinite(waitStates[row.id]?.pressureBar)) {
```

- [ ] **Step 4: Run** `npm run test:ui -- tests/browser/what-if.spec.js tests/browser/blending.spec.js --project=desktop`, then `npm test`.

- [ ] **Step 5: Commit**

```bash
git add js/main.js tests/browser/what-if.spec.js
git commit -m "fix: rerun What-if after a gas preset and track drain pressure for linked add fields"
```

### Task 7: Helium accounting after Add then Drain in Compare/What-if

C1 (reported, hand-computed): in `buildCompareProtocol`, the drain branch scales only `retainedInitialMoles` by `retainedFraction`. `addedHeliumMoles` is never scaled, so `heliumSalvagedLitres` counts helium that was vented. Example: 12 L ideal, 50 bar 21/35, Add to 150 bar from a 50% He bank, Drain to 75 bar. The tank holds 300 L of added helium but the summary reports 600 L salvaged.

**Files:**
- Modify: `js/compare-recipe.js` (`buildCompareProtocol`, drain branch next to the `retainedInitialMoles` update)
- Test: `tests/compare-recipe.test.js`

- [ ] **Step 1: Write the failing test.** Contract this task fixes: `retainedPercent`, `ventedGasLitres`, `heliumVentedLitres` and `heliumRetainedLitres` describe the ORIGINAL cylinder gas only (the same meaning as in Optimize). `heliumSalvagedLitres` is helium from the retained original gas plus helium added from sources under 98% He, and it must count only helium still in the tank. The drain branch already scales the original-gas ledger; it does not scale the added-helium ledger. Append to `tests/compare-recipe.test.js` (it already defines `cylinder` = 12 L, 50 bar, 21/0; `physics` ideal 20 °C; `settings`):

```js
test('helium added from a leftover bank is scaled by a later drain in the summary', () => {
  const halfHeliumBank = {
    id: 'half-he', name: 'Half helium', volumeL: 40, pressureBar: 200,
    oxygenPercent: 0, heliumPercent: 50, enabled: true
  };
  const context = { cylinder, banks: [halfHeliumBank], physics, settings };
  const { normalizedRows } = validateCompareRecipe([
    { id: 'add', type: 'add', bankId: 'half-he', pressureAddedBar: 100, targetPressureBar: 150, pressureInputMode: 'target' },
    { id: 'drain', type: 'drain', targetPressureBar: 75 }
  ], context);
  const { summary } = buildCompareProtocol(normalizedRows, context);

  // Ideal gas in 12 L: free-gas litres = bar x 12. The drain vents half of everything in the tank.
  const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-6, `${actual} !== ${expected}`);
  close(summary.retainedPercent, 50);        // 50 bar of original gas -> 25 bar kept
  close(summary.ventedGasLitres, 300);       // 25 bar x 12 L of the original gas
  close(summary.heliumVentedLitres, 0);      // the original gas holds no helium
  close(summary.heliumRetainedLitres, 0);
  close(summary.heliumSalvagedLitres, 300);  // 100 bar added x 12 L x 50% He x 50% still in the tank
});
```

Before the fix `heliumSalvagedLitres` is 600 (the vented half is still counted). The other four assertions already hold and pin the contract.

- [ ] **Step 2: Run** `node --test tests/compare-recipe.test.js`. Expected: FAIL with `600 !== 300` on `heliumSalvagedLitres` only.

- [ ] **Step 3: Fix.** In the drain branch, after `retainedInitialMoles` is scaled by `retainedFraction`, add `addedHeliumMoles *= retainedFraction;`. Do not change the vented metrics in this task: vented-from-added-gas tracking is a larger summary-semantics change, listed under decisions.

- [ ] **Step 4: Run** `npm test`. Fix only fixtures that encode the old, wrong number.

- [ ] **Step 5: Commit**

```bash
git add js/compare-recipe.js tests/compare-recipe.test.js
git commit -m "fix: scale added helium by the drain retained fraction in Compare summaries"
```

### Task 8: Interim readings survive a display-units change (S5)

`calculatorInputSignature` in `js/interim-measurements.js` blanks only `settings.costs`, so switching metric/imperial changes the signature and `recalculate` in `main.js` clears every stored interim reading. Readings are stored in canonical bar and °C and units only change how values are displayed, so they should survive. `interimPressureTolerancePercent` is deliberately NOT excluded: it decides whether a later reading verifies, so it is not display-only.

**Files:**
- Modify: `js/interim-measurements.js` (`calculatorInputSignature`)
- Test: `tests/interim-measurements.test.js`

- [ ] **Step 1: Write the failing test** (append; the file already defines `input` with `settings: { booster: { otherBoostBpm: 50 } }`)

```js
test('calculator recipe signature ignores the display units setting but not equipment settings', () => {
  const withSettings = overrides => calculatorInputSignature({ ...input, settings: { ...input.settings, ...overrides } });
  assert.equal(withSettings({ units: 'metric' }), withSettings({ units: 'imperial' }));
  assert.notEqual(withSettings({ booster: { otherBoostBpm: 51 } }), withSettings({ booster: { otherBoostBpm: 50 } }));
});
```

- [ ] **Step 2: Run** `node --test tests/interim-measurements.test.js`. Expected: FAIL (metric and imperial signatures differ).

- [ ] **Step 3: Fix** in `js/interim-measurements.js`:

```js
  const settings = input?.settings
    ? { ...input.settings, costs: undefined, units: undefined }
    : input?.settings;
```

Also update the comment above the function to say display units are excluded too.

- [ ] **Step 4: Run** `npm test`, then `npm run test:ui -- tests/browser/results.spec.js --project=desktop`.

- [ ] **Step 5: Commit**

```bash
git add js/interim-measurements.js tests/interim-measurements.test.js
git commit -m "fix: keep interim readings when only the display units change"
```

### Task 9: Stop analytics after a factory reset

D4 (reported; load paths Code-read by the auditor): `loadAnalytics` is only called after consent, which is correct. But `resetFactorySettings` clears consent and reopens the consent wall while `gtag.js` stays loaded and active, and nothing disables it. Re-accepting is a no-op because the script already exists.

**Files:**
- Modify: `js/analytics.js`, `js/main.js` (`resetFactorySettings`)
- Test: `tests/analytics.test.js`

**Interfaces:**
- Produces: `disableAnalytics(window)` sets `window['ga-disable-' + ANALYTICS_MEASUREMENT_ID] = true`. `loadAnalytics(document, window)` keeps its signature and return values, sets that flag to `false` on a (re)load including the already-loaded early return, and the early return still returns `false`.

- [ ] **Step 1: Write the failing test.** In `tests/analytics.test.js` change the import to `import { ANALYTICS_MEASUREMENT_ID, disableAnalytics, loadAnalytics } from '../js/analytics.js';` and append:

```js
test('disableAnalytics sets the Google opt-out flag and a later load clears it', () => {
  const scripts = [];
  const document = {
    head: { append(node) { scripts.push(node); } },
    createElement() { return { async: false, src: '', setAttribute() {} }; },
    querySelector(selector) { return selector === 'script[data-simplex-analytics]' ? scripts[0] ?? null : null; }
  };
  const window = { dataLayer: [] };
  const flag = `ga-disable-${ANALYTICS_MEASUREMENT_ID}`;

  loadAnalytics(document, window);
  assert.equal(window[flag], false);
  disableAnalytics(window);
  assert.equal(window[flag], true);
  assert.equal(loadAnalytics(document, window), false);
  assert.equal(window[flag], false);
});
```

- [ ] **Step 2: Run** `node --test tests/analytics.test.js`. Expected: FAIL (`disableAnalytics` is not exported).

- [ ] **Step 3: Implement.** In `js/analytics.js` add the export and clear the flag at the top of `loadAnalytics` (before the already-loaded early return):

```js
export function disableAnalytics(window) {
  window[`ga-disable-${ANALYTICS_MEASUREMENT_ID}`] = true;
}

export function loadAnalytics(document, window) {
  window[`ga-disable-${ANALYTICS_MEASUREMENT_ID}`] = false;
  if (document.querySelector('script[data-simplex-analytics]')) {
    return false;
  }
```

In `js/main.js` add `disableAnalytics` to the existing `./analytics.js` import, and in `resetFactorySettings` call `disableAnalytics(window);` right after `if (!didReset) return;`.

- [ ] **Step 4: Run** `npm test` and `npm run test:ui -- tests/browser/onboarding.spec.js tests/browser/persistence.spec.js --project=desktop`. Accepting consent after a reset must still enable analytics. Docs: add one sentence to the `js/analytics.js` entry in `docs/architecture.md`.

- [ ] **Step 5: Commit**

```bash
git add js/analytics.js js/main.js tests/analytics.test.js docs/architecture.md
git commit -m "fix: opt out of Google Analytics when consent is revoked by a factory reset"
```

---

## Phase B: numerics and visible output; verify before touching

### Task 10: Max-pressure fallback must retain cylinder gas (priority invariant)

**Proven.** Input (10 L ideal at 20 °C, 50 bar 32/0 in the cylinder, target 21/35 at 200 bar; banks: He 10 L at 60 bar max 200, O₂ 50 L at 200 bar max 200; default settings):

- `optimizeBlend` returns `feasible: false` and a `maximumPressure` recipe at 157.14 bar with `retainedPercent` 0 and `ventedPressureBar` 50.
- The exact request at 157.1 bar (same mix) returns `feasible: true`, `retainedPercent` 100, vented about 0.

So the fallback drains gas that the same-pressure recipe keeps. This is what `docs/development.md` ("Priority invariant") forbids. Cause (reported, consistent with the repro): the max-pressure LP in `js/optimizer.js` (`decisionCosts`, all zero except `n_total = -1`) leaves the cylinder-gas variable unconstrained among equal optima, and the result is adopted directly at the `safeSolverResult = maximumRecipeError ? safeAtPressure(...) : maximumResult` selection.

**Files:**
- Modify: `js/optimizer.js` (the max-pressure branch near `solveMaximumTargetMix` and the `safeSolverResult` selection)
- Test: `tests/optimizer.test.js`

- [ ] **Step 1: Write the failing test** (add after `default example keeps the cylinder gas when the safety ceiling is active`)

```js
test('maximum-pressure fallback keeps the cylinder gas that the same-pressure exact recipe keeps', () => {
  const input = {
    cylinder: {
      volumeL: 10, initialPressureBar: 50, initialOxygenPercent: 32, initialHeliumPercent: 0,
      targetPressureBar: 200, targetOxygenPercent: 21, targetHeliumPercent: 35
    },
    physics: { model: 'ideal', temperatureC: 20 },
    banks: [
      { id: 'he', name: 'He small', volumeL: 10, pressureBar: 60, maxPressureBar: 200, oxygenPercent: 0, heliumPercent: 100, enabled: true },
      { id: 'o2', name: 'O2', volumeL: 50, pressureBar: 200, maxPressureBar: 200, oxygenPercent: 100, heliumPercent: 0, enabled: true }
    ],
    settings: DEFAULT_SETTINGS
  };
  const fallback = optimizeBlend(input);
  assert.equal(fallback.feasible, false);
  const maximumPressureBar = fallback.maximumPressure.blend.finalPressureBar;

  const exact = optimizeBlend({
    ...input,
    cylinder: { ...input.cylinder, targetPressureBar: Math.floor(maximumPressureBar * 10) / 10 }
  });
  assert.equal(exact.feasible, true);
  assert.ok(exact.blend.retainedPercent > 99);

  assert.ok(
    fallback.maximumPressure.blend.retainedPercent >= exact.blend.retainedPercent - 1,
    `fallback retained ${fallback.maximumPressure.blend.retainedPercent}% but the exact recipe retains ${exact.blend.retainedPercent}%`
  );
});
```

`maximumPressure.blend.finalPressureBar` was checked against the repro (it prints 157.14285714285717).

- [ ] **Step 2: Run** `node --test tests/optimizer.test.js`. Expected: only the new test FAILS (`fallback retained 0%…`).

- [ ] **Step 3: Fix.** In `js/optimizer.js` replace the block at `if (inventoryMaximumPressure <= targetPressureBar) {` (the `safeSolverResult = maximumRecipeError ? … : maximumResult;` statement, about L2129-2133) with the version below. When the max-LP vertex is already safe, re-solve the exact mix at that pressure with retention-primary costs and keep the result only if it is feasible, safe, and retains at least as much cylinder gas. Otherwise the previous vertex stays, so this can never do worse than today. No LP cost vector changes.

```js
    if (inventoryMaximumPressure <= targetPressureBar) {
      if (maximumRecipeError) {
        safeSolverResult = safeAtPressure(inventoryMaximumPressure, maximumResult);
      } else {
        const retentionResult = solveAtPressure(inventoryMaximumPressure, { prioritizeTransferSafety: true });
        const keepsAtLeastAsMuch = retentionResult.feasible
          && !isUnsafe(retentionResult, inventoryMaximumPressure)
          && (retentionResult.solution.x_cyl || 0) >= (maximumResult.solution.x_cyl || 0);
        safeSolverResult = keepsAtLeastAsMuch ? retentionResult : maximumResult;
      }
    }
```

Validated in a scratch copy of `js/` at `ccd0df5` (the repository was not modified): with this block the repro reports `retainedPercent` 100 and `ventedPressureBar` about 0 at 157.14 bar, and the whole Node suite stays at 681 of 681 passing, including the priority-invariant test.

- [ ] **Step 4: Run** `npm test`. Gate: `default example keeps the cylinder gas when the safety ceiling is active` MUST pass unchanged. Fixtures that pinned a vertex-specific fallback recipe (search `maximumPressure` in `tests/optimizer.test.js`, about L740-1000 and L1204) may change composition-of-sources only. If one asserts `retainedPercent` is lower than what the new code retains, that assertion encoded the bug; update it and explain in the commit.

- [ ] **Step 5: Run** `npm run test:ui -- tests/browser/results.spec.js tests/browser/blending.spec.js --project=desktop`. If any screenshot diff appears, stop and read `docs/ci-reproduction.md` before touching baselines.

- [ ] **Step 6: Document.** Add one sentence under the optimizer's priority-invariant text in `docs/optimizer.md` stating that the maximum-pressure fallback re-solves with retention-primary costs.

- [ ] **Step 7: Commit**

```bash
git add js/optimizer.js tests/optimizer.test.js docs/optimizer.md
git commit -m "fix: keep cylinder gas in the maximum-pressure fallback recipe"
```

---

## Resolved decisions

The implementation chose the least surprising behavior while preserving existing contracts:

| ID | Decision and implementation |
|---|---|
| M2/D11 | Leaving Settings through primary navigation behaves like Cancel: unsaved drafts are discarded and the saved baseline remains authoritative. |
| D2 | Preset import merges against the saved baseline captured when Settings opened, so importing does not persist unrelated unsaved edits. |
| O1-3 | Equal-start transfers are treated as `Equalize`; stage classification uses source and receiver pressures at both ends, while Compressor Air remains `Top-up`. |
| M4 | What-if continues to use the shared Blending ambient for “same as ambient” inlet temperature; this is shared equipment state, not a scenario-local override. |
| C5 | A target-temperature wait equal to ambient is a valid no-op and is modeled without throwing. |
| S2/S3 | Reading-aware summaries use the modeled post-reading ledger for retained and vented gas; added gas is not double-counted as initial-cylinder gas. |
| C1 (rest) | Compare summary vent metrics remain scoped to initial working-cylinder gas; source-bank gas is not treated as cylinder venting. |
| M5 | Imperial display changes temperature bounds to the selected unit while validation remains in Celsius. |
| P2 | Warning observations retain distinct step indices, so separate same-kind Boost/Wait observations remain visible. |
| P4 | Temperature inputs use one decimal place in What-if and Compare, matching the supported precision without changing stored Celsius values. |

## Deferred or rejected

- **Deferred (real but low value or high risk):** O1-4 (simplex iteration caps and no anti-cycling), O1-5 (thermal-split pieces inherit `oxygenCompressionRatio` and `sourceExhausted`; display only), O1-6 (retention weight not strictly lexicographic; theoretical), O1-7 (tableau snapshots deep-copied per pivot; performance), O1-8 (no compressor cap inside the LP), P5 (cu ft digits), D9 (a name-duplicate entry makes a later same-name entry read as a conflict; arguably correct), D10/M11 (`Date.now()` bank IDs), C6, C7, C9, C10, M8 (add `console.error` to broad catches), M12.
- **Unreproduced candidates (do not plan until a failing test exists):**
  - **P1** thermal chart pressure curve (Reported): `buildThermalStepSamples` is given `pressureAtTransferEndReferenceBar` as `transferEndPressureBar`, so `sample.pressureBar` ends the transfer ramp at the reference-temperature pressure while `sample.projectedPressureBar` is the hot value; `js/ui/thermal-charts.js` plots `pressureBar`. Test to write first: in `tests/thermal-charts.test.js`, build the series for a step with a transfer and a wait and assert the series pressure at transfer-end time equals the key point's `pressureAtTransferEndBar`. If it fails, the chart-side fix is `pressureBar: sample.projectedPressureBar ?? sample.pressureBar` in `buildThermalSeries`; the simulator-side fix breaks about three `tests/thermodynamics.test.js` assertions. Either way thermal-graph screenshot baselines may move, which means `docs/ci-reproduction.md` applies.
  - **P3** target gas mass uses `ambientTemperatureK` while the initial mass uses `startTemperatureK` (`js/thermodynamics.js` about L265-269). Changes simulated temperatures and so hot-overfill splits and many numeric expectations. The project docs do not state which reference temperature is required, so it needs a physics decision plus golden-value updates, not a casual fix.
  - **S1** re-plan with a derived bank pressure under 1 bar fails validation with "Invalid blend input". Do not fix by clamping pressure up to 1 bar: with `minimumSourcePressureBar` 0 that creates phantom gas. A fix must represent the bank as exhausted (for example disabled) and the test must assert zero moles are drawn from it. No reading that triggers it has been constructed yet.
- **Dead code to remove in a separate cleanup PR:** M7 (Compare-mode code in `main.js` unreachable after the What-if split: `runCompare`, `compareInput`, `renderCompareResult`, `state.compareRows`, and related), C8 (unused wait-temperature constants), C11 (`whatIfDraftSignature` used only by tests).
- **Rejected / documented behavior:** P7 (drain cooling uses the configured inlet temperature; documented in `docs/gas-physics.md:42`), the physics latent-only items (`calculateCoolingTime` at or below ambient is guarded upstream), `localStorage.clear()` on factory reset (asserted by `tests/factory-reset.test.js`).

## Coverage

Slices read at `ccd0df5` or its parent and the outcome:

| Slice | Result |
|---|---|
| `physics.js`, `units.js`, `materials.js`, `thermodynamics.js`, `pressure-limits.js` | P6 fixed in task 2; P1 and P3 remain unreproduced candidates; P2 fixed with step-indexed observations; P4 fixed with scoped temperature-input precision; P5 deferred; P7 rejected/documented |
| `simplex.js`, `optimizer.js` L1–1650 | O1-1 fixed in task 1; O1-2 fixed in task 10; remaining findings deferred or rejected |
| `salvage.js`, `leftover-attractiveness.js`, `plan-with-readings.js`, `interim-*.js` | S5 fixed in task 8; S1 remains unreproduced; S2/S3 fixed in the reading-aware ledger |
| `compare-recipe.js`, `what-if-scenario.js`, `input-validation.js`, `gas-input.js` | C1–C4 fixed in tasks 3, 6, and 7; C5 resolved as an accepted ambient-equal no-op wait |
| `settings.js`, `preset-*.js`, `bank-storage.js`, `onboarding.js`, `analytics.js` and related | D-series (tasks 2, 4, 5, 9) |
| `main.js` non-rendering logic | M-series (tasks 4, 5, 6) |
| `cost.js`, `pure-prices.js`, `savings.js`, `bank-pricing.js` | **No defect found.** Read in full: flat-fee operation de-duplication by `costOperationId`, free-gas litre weighting, the 6-virtual-source cap, the sub-10-bar guard, the missing-pure-price precedence in `priceBankByRecipe`, and the `computeSavings` missing-entry bookkeeping all match their doc comments. Two inputs would throw rather than report if settings validation ever let them through: a missing `costs.operationPrices` (`Object.values(undefined)` in `priceBankByRecipe`) and a missing `leftoverDiscountPercent` (NaN price). Settings validation guards both today, so no task is raised. |
| `optimizer.js` L1650–end | Original audit did not cover this slice; Task 10's maximum-pressure fallback change is implemented and covered by current optimizer tests and full-suite verification |

## Not covered by the audit

- Original audit coverage did not include `js/optimizer.js` roughly L1650–end, but Task 10's fallback change was implemented and covered by the current optimizer tests and full Node/browser verification.
- Cost modules (`js/cost.js`, `js/pure-prices.js`, `js/savings.js`, `js/bank-pricing.js`) were read in full at `ccd0df5`; their validation and pricing paths are covered by the current Node and browser suites.
- Audit agents could not execute code; all confirmed findings were subsequently exercised by focused tests or the full suites above.

## Self-review

- **Coverage:** every Proven and Code-read finding maps to a task; every other finding is either a task with a prove-it step or listed under resolved decisions, deferred, unreproduced, or rejected.
- **Placeholders:** none intentional. Every test step contains runnable code against selectors, helpers and fixtures read from the repository at `ccd0df5` (`#init-p`, `#init-gas-preset`, `#settings-units`, `#what-if-current-gas-preset`, `compare-row-1`, `loadAnalytics`, `calculatorInputSignature`, the `cylinder`/`physics`/`settings` constants in `tests/compare-recipe.test.js`).
- **Verification:** `npm test`: 695 passed, 0 failed. `npm run test:ui`: 461 passed, 4 skipped, 0 failed. Focused Blending, Inventory, and What-if specs also pass.
- **Consistency:** `disableAnalytics`, `calculatorInputSignature`, `expandWhatIfRows`, `comparePressureStarts`, `isValidMaterial`, and `solveTwoPhaseSimplex` match the current source names.
