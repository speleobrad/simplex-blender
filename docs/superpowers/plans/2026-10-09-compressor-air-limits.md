# Compressor Air and Booster Pressure Limits Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the finite Air bank with an implicit unlimited compressor source and enforce configurable compressor and booster pressure ceilings.

**Architecture:** Keep persisted equipment settings in `settings.booster`. Keep Air out of bank persistence/UI and inject a private compressor source into optimizer candidates. Reuse the existing solver and fallback search, extending candidate safety evaluation with transfer-operation pressure limits.

**Tech Stack:** Browser-native ES modules, Node built-in test runner, plain DOM rendering, localStorage persistence.

**Spec:** `docs/superpowers/specs/2026-10-09-compressor-air-limits-design.md`

## Global Constraints

- Air is an implicit unlimited 21/0 compressor source and is not a user-editable bank.
- `maxCompressorPressureBar` defaults to 232 bar and caps compressor Air stages.
- `maxBoosterOutputPressureBar` defaults to 200 bar and caps non-Air Boost stages only.
- Non-Air decant/equalize stages remain governed by source pressure.
- Older saved settings gain both new defaults; legacy Air bank records are discarded on load.
- Empty saved bank lists are valid.

---

### Task 1: Settings and bank persistence contracts

**Files:**
- Modify: `js/settings.js`
- Modify: `js/bank-storage.js`
- Modify: `js/input-validation.js`
- Test: `tests/settings.test.js`
- Test: `tests/banks.test.js`

**Interfaces:**
- `DEFAULT_SETTINGS.booster` produces `maxCompressorPressureBar: 232` and `maxBoosterOutputPressureBar: 200`.
- `loadSettings` defaults missing pressure fields and `saveSettings` validates/persists them.
- `loadSupplyBanks` returns only user-managed non-Air banks and permits `[]`.

- [ ] **Step 1: Add failing settings tests**

Add tests asserting defaults, old-setting migration, round-trip persistence, and rejection of values outside 10–350 bar:

```js
test('settings include compressor and booster pressure ceilings', () => {
  assert.equal(DEFAULT_SETTINGS.booster.maxCompressorPressureBar, 232);
  assert.equal(DEFAULT_SETTINGS.booster.maxBoosterOutputPressureBar, 200);
});

test('old settings gain both pressure ceiling defaults', () => {
  const storage = memoryStorage([['simplex-gas-remixer-settings', JSON.stringify({
    gasPresets: [{ name: 'Air', oxygenPercent: 21, heliumPercent: 0 }],
    volumePresets: [12]
  })]]);
  assert.deepEqual(loadSettings(storage).booster, DEFAULT_SETTINGS.booster);
});

test('pressure ceilings survive settings round trip', () => {
  const settings = {
    ...DEFAULT_SETTINGS,
    gasPresets: DEFAULT_SETTINGS.gasPresets.map(preset => ({ ...preset })),
    volumePresets: [...DEFAULT_SETTINGS.volumePresets],
    booster: { ...DEFAULT_SETTINGS.booster, maxCompressorPressureBar: 240, maxBoosterOutputPressureBar: 190 }
  };
  const storage = memoryStorage();
  saveSettings(settings, storage);
  assert.deepEqual(loadSettings(storage).booster, settings.booster);
});

test('invalid pressure ceilings are rejected before storage changes', () => {
  const storage = memoryStorage();
  for (const field of ['maxCompressorPressureBar', 'maxBoosterOutputPressureBar']) {
    assert.throws(() => saveSettings({
      ...DEFAULT_SETTINGS,
      booster: { ...DEFAULT_SETTINGS.booster, [field]: 9 }
    }, storage), /pressure.*10.*350/i);
  }
  assert.equal(storage.getItem('simplex-gas-remixer-settings'), null);
});
```

Add bank tests asserting no default Air, empty list acceptance, and migration of the old Air record:

```js
test('default banks exclude compressor Air', () => {
  assert.equal(DEFAULT_BANKS.some(bank => bank.oxygenPercent === 21 && bank.heliumPercent === 0), false);
});

test('empty saved bank list is valid', () => {
  const storage = memoryStorage([['simplex-gas-remixer-banks', '[]']]);
  assert.deepEqual(loadSupplyBanks(storage), []);
});

test('legacy Air records are removed when banks are loaded', () => {
  const storage = memoryStorage([['simplex-gas-remixer-banks', JSON.stringify([
    { ...DEFAULT_BANKS[0], id: 'bank-heirloom' },
    { id: 'bank-air', name: 'Air Top-off', volumeL: 80, pressureBar: 230, oxygenPercent: 21, heliumPercent: 0, enabled: true }
  ])]]);
  assert.deepEqual(loadSupplyBanks(storage).map(bank => bank.id), ['bank-heirloom']);
});
```

- [ ] **Step 2: Run focused tests and verify RED**

Run: `node --test tests/settings.test.js tests/banks.test.js`

Expected: FAIL because the new fields/defaults, empty-list rule, and Air migration do not exist.

- [ ] **Step 3: Implement settings migration and validation**

In `js/settings.js`, add both fields to `DEFAULT_SETTINGS.booster`, `copySettings`, and the merged default path in `addDefaultBooster`. Add one validation block:

```js
for (const [field, label] of [
  ['maxCompressorPressureBar', 'Maximum compressor pressure'],
  ['maxBoosterOutputPressureBar', 'Maximum booster output pressure']
]) {
  if (!Number.isFinite(booster?.[field]) || booster[field] < 10 || booster[field] > 350) {
    errors.push(`${label} must be between 10 and 350 bar.`);
  }
}
```

In `js/bank-storage.js`, remove the default Air record, change `validateBanks` to accept arrays of length zero, and filter legacy Air records before validation/copying. Identify legacy Air as `oxygenPercent === 21 && heliumPercent === 0`; this is the obsolete finite Air representation and cannot be retained under the new invariant.

In `js/input-validation.js`, update the empty-list-related error text only where it still claims at least one bank is required; individual bank records remain validated exactly as before.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `node --test tests/settings.test.js tests/banks.test.js`

Expected: PASS with no failures.

- [ ] **Step 5: Commit the persistence contract**

```bash
git add js/settings.js js/bank-storage.js js/input-validation.js tests/settings.test.js tests/banks.test.js
git commit -m "feat: add compressor and booster pressure settings"
```

---

### Task 2: Settings dialog and controller copy paths

**Files:**
- Modify: `js/ui/settings-dialog.js`
- Modify: `js/main.js`
- Modify: `scuba_gas_remixer_simplex_optimizer.html`
- Test: `tests/settings.test.js` only if pure settings behavior needs coverage; browser smoke covers DOM wiring.

**Interfaces:**
- Settings drafts retain both numeric pressure fields through render → edit → save.
- The settings dialog exposes accessible inputs for both limits with `data-settings-collection="booster"`.

- [ ] **Step 1: Add the two pressure controls to the settings markup**

Add inputs beside the existing booster controls:

```html
<label for="settings-compressor-max-pressure" class="block text-xs text-slate-400">Max compressor pressure</label>
<input type="number" id="settings-compressor-max-pressure" min="10" max="350" step="1"
  data-settings-collection="booster" data-settings-field="maxCompressorPressureBar"
  aria-label="Maximum compressor pressure">

<label for="settings-booster-max-output-pressure" class="block text-xs text-slate-400">Max booster output pressure</label>
<input type="number" id="settings-booster-max-output-pressure" min="10" max="350" step="1"
  data-settings-collection="booster" data-settings-field="maxBoosterOutputPressureBar"
  aria-label="Maximum booster output pressure">
```

Update the explanatory text to state that compressor Air and non-Air booster output use separate limits.

- [ ] **Step 2: Wire rendering and draft copy**

In `renderSettingsDialog`, add both element IDs to `boosterFields`. The existing delegated `updateSettingsDraft` and `copySettings` paths already handle arbitrary booster fields once `settings.js` copies them, so do not add a second event convention.

- [ ] **Step 3: Run the settings test suite**

Run: `node --test tests/settings.test.js`

Expected: PASS.

- [ ] **Step 4: Commit the settings UI**

```bash
git add js/ui/settings-dialog.js js/main.js scuba_gas_remixer_simplex_optimizer.html
 git commit -m "feat: expose compressor and booster pressure limits"
```

---

### Task 3: Implicit compressor Air and equipment safety in the optimizer

**Files:**
- Modify: `js/optimizer.js`
- Test: `tests/optimizer.test.js`

**Interfaces:**
- `optimizeBlend(input)` accepts settings with both pressure ceilings and no Air bank.
- A valid Air target produces protocol stages whose `operation` is `Top-up` and whose source is not user inventory.
- Candidate fallback rejects compressor stages above the compressor cap and non-Air boost stages above the booster cap, while allowing non-Air decants above it.

- [ ] **Step 1: Add failing optimizer tests**

Add these behavior tests:

```js
test('uses implicit unlimited Air without an Air bank', () => {
  const result = optimizeBlend({
    cylinder: { volumeL: 12, initialPressureBar: 0, initialOxygenPercent: 0, initialHeliumPercent: 0,
      targetPressureBar: 180, targetOxygenPercent: 21, targetHeliumPercent: 0 },
    physics: { model: 'ideal', temperatureC: 20 },
    banks: [],
    settings: { booster: { maxCompressorPressureBar: 232, maxBoosterOutputPressureBar: 200 } }
  });
  assert.equal(result.feasible, true);
  assert.equal(result.protocolSteps.at(-1).operation, 'Top-up');
});

test('compressor Air cannot top up above its configured ceiling', () => {
  const result = optimizeBlend({
    cylinder: { volumeL: 12, initialPressureBar: 0, initialOxygenPercent: 0, initialHeliumPercent: 0,
      targetPressureBar: 250, targetOxygenPercent: 21, targetHeliumPercent: 0 },
    physics: { model: 'ideal', temperatureC: 20 },
    banks: [],
    settings: { booster: { maxCompressorPressureBar: 232, maxBoosterOutputPressureBar: 200 } }
  });
  assert.equal(result.feasible, false);
  assert.ok(result.maximumPressure.pressureBar <= 232 + 1e-9);
});

test('non-Air boost cannot end above the booster output ceiling', () => {
  const result = optimizeBlend({
    cylinder: { volumeL: 12, initialPressureBar: 0, initialOxygenPercent: 0, initialHeliumPercent: 0,
      targetPressureBar: 250, targetOxygenPercent: 0, targetHeliumPercent: 100 },
    physics: { model: 'ideal', temperatureC: 20 },
    banks: [{ id: 'he', name: 'Helium', volumeL: 50, pressureBar: 150, oxygenPercent: 0, heliumPercent: 100, enabled: true }],
    settings: { booster: { maxCompressorPressureBar: 232, maxBoosterOutputPressureBar: 200 } }
  });
  assert.equal(result.feasible, false);
  assert.ok(result.maximumPressure.pressureBar <= 200 + 1e-9);
});

test('non-Air decant can exceed the booster output ceiling', () => {
  const result = optimizeBlend({
    cylinder: { volumeL: 12, initialPressureBar: 0, initialOxygenPercent: 0, initialHeliumPercent: 0,
      targetPressureBar: 250, targetOxygenPercent: 0, targetHeliumPercent: 100 },
    physics: { model: 'ideal', temperatureC: 20 },
    banks: [{ id: 'he', name: 'Helium', volumeL: 50, pressureBar: 300, oxygenPercent: 0, heliumPercent: 100, enabled: true }],
    settings: { booster: { maxCompressorPressureBar: 232, maxBoosterOutputPressureBar: 200 } }
  });
  assert.equal(result.feasible, true);
  assert.ok(result.protocolSteps.some(step => step.operation === 'Decant' && step.resultingPressureBar > 200));
});
```

Update existing Air-bank tests to pass `banks: []` and use the implicit source; tests that specifically exercise a finite bank must use a non-Air composition.

- [ ] **Step 2: Run optimizer tests and verify RED**

Run: `node --test tests/optimizer.test.js`

Expected: FAIL because no implicit Air source exists and no equipment safety cap is enforced.

- [ ] **Step 3: Add the private compressor source**

Define a module-local source factory:

```js
const COMPRESSOR_AIR_ID = 'compressor-air';
function compressorAirBank(maxPressureBar) {
  return {
    id: COMPRESSOR_AIR_ID,
    name: 'Compressor Air',
    volumeL: 1,
    pressureBar: maxPressureBar,
    oxygenPercent: 21,
    heliumPercent: 0,
    enabled: true,
    isCompressor: true
  };
}
```

In `optimizeBlendWithoutThermal`, read both settings with defaults, append the private source to the solver-only `activeBanks`, and assign it an LP capacity of `targetMoles`. Keep it out of `banks` validation, persistence, UI data, and diagnostics for user banks.

Update bank-density/source-pressure helpers so `isCompressor` sources retain the configured compressor pressure and do not calculate reservoir depletion. Update `isAirBank` to recognize only `isCompressor`, preventing a custom non-Air inventory row from being silently reclassified by composition.

- [ ] **Step 4: Make compressor Air a Top-up in every mode**

Pass `airTopUp: isAirBank(bank)` to `pressureTransferStages`, not only when thermal input exists. Ensure `protocolOperation` returns `Top-up` for the private source. Order the private Air stage before later non-Air sources when the candidate target pressure exceeds the compressor ceiling; otherwise retain the existing non-Air ordering and put Air at the final top-up position. The source pressure fields for compressor stages remain at the configured ceiling.

- [ ] **Step 5: Add equipment safety to candidate evaluation**

Add a helper that evaluates the generated transfer stages for a solver result:

```js
function equipmentSafetyFor({ solverResult, activeBanks, ...context }) {
  // Walk activeBoostsFor in protocol order, call pressureTransferStages for each source,
  // reject compressor receiverEndPressureBar > maxCompressorPressureBar,
  // reject non-Air boost receiverEndPressureBar > maxBoosterOutputPressureBar,
  // and return { error, margin } in the same shape used by transferSafety.
}
```

Combine it with `transferSafety` in `isUnsafe`. Use the same combined check in all fallback branches through the existing `safeAtPressure` path. Error messages must identify the relevant configured limit, for example `Compressor Air cannot top up above 232.0 bar.` and `Booster output cannot exceed 200.0 bar.`.

- [ ] **Step 6: Run optimizer tests and verify GREEN**

Run: `node --test tests/optimizer.test.js`

Expected: PASS, including existing protocol, fallback, and safety tests after their Air fixtures are migrated.

- [ ] **Step 7: Commit optimizer behavior**

```bash
git add js/optimizer.js tests/optimizer.test.js
git commit -m "feat: model implicit compressor Air and pressure caps"
```

---

### Task 4: Thermal behavior and documentation

**Files:**
- Modify: `js/thermodynamics.js` only if default settings need explicit pressure-field handling; rate calculation should otherwise remain unchanged.
- Modify: `docs/architecture.md`
- Modify: `docs/optimizer.md`
- Modify: `docs/development.md`
- Test: `tests/thermodynamics.test.js` if a new Air operation regression is needed.

**Interfaces:**
- Thermal simulation recognizes optimizer-generated Air stages by `operation: 'Top-up'` and uses compressor flow.
- Documentation describes implicit Air and the two independent limits.

- [ ] **Step 1: Add or update the thermal regression test**

Use a protocol step with `operation: 'Top-up'` and assert `rateSource === 'compressor'`; retain the existing direct thermal test and add only a regression proving optimizer-generated Air no longer depends on a bank row.

- [ ] **Step 2: Update module and data-flow documentation**

Describe `bank-storage.js` as persisting only user-managed non-Air banks, `settings.js` as carrying both pressure ceilings, and `optimizer.js` as injecting unlimited compressor Air and enforcing operation-specific pressure limits.

- [ ] **Step 3: Update optimizer and browser smoke documentation**

Replace statements that Air is a finite bank or always the final bank transfer. Document the 232-bar compressor default, 200-bar booster default, Air migration, empty bank lists, and the sequential compressor-then-booster rule.

- [ ] **Step 4: Run focused thermal tests**

Run: `node --test tests/thermodynamics.test.js`

Expected: PASS.

- [ ] **Step 5: Commit thermal/docs updates**

```bash
git add js/thermodynamics.js docs/architecture.md docs/optimizer.md docs/development.md tests/thermodynamics.test.js
git commit -m "docs: describe compressor air and booster limits"
```

---

### Task 5: Full verification and browser smoke

**Files:**
- No new files.

- [ ] **Step 1: Run the complete automated suite**

Run: `npm test`

Expected: exit code 0 with all tests passing.

- [ ] **Step 2: Serve and exercise the actual application**

Run: `python3 -m http.server 8000`

Open `http://127.0.0.1:8000/scuba_gas_remixer_simplex_optimizer.html` and verify:

1. The default supply-bank table contains no Air row.
2. Settings shows both pressure fields with 232 and 200 defaults.
3. With no user banks, an Air target below 232 bar produces a Top-up recipe.
4. Air-only target pressure above 232 bar is rejected/falls back at or below 232 bar.
5. A non-Air source above the receiver can decant above 200 bar.
6. A non-Air source below the receiver cannot Boost beyond 200 bar.
7. Reload preserves edited settings and non-Air banks.
8. The browser console has no application module/runtime errors.

- [ ] **Step 3: Remove the temporary server and report observed evidence**

Stop the HTTP server after the smoke run and report exact automated test counts plus observed browser behavior; do not claim unobserved UI behavior.
