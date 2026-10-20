# Compare Inventory Operations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans (recommended). Steps use checkbox (`- [ ]`) syntax.

**Goal:** Replace manual Compare transfer-method/custom-gas inputs with finite Supply-bank selection, synchronized pressure inputs, automatic decant/equalise/boost planning, and fixed-minute or target-state waits.

**Architecture:** Keep Optimize mode and its protocol untouched. Extend the pure Compare adapter to resolve enabled Supply banks, plan finite source-mole transfers, and emit explicit transfer stages; extend the existing Compare thermal simulator to consume those stages and solve target-state waits. Keep browser state/delegation in `js/main.js` and the Compare editor in `js/ui/compare-recipe.js`.

**Tech Stack:** Browser-native ES modules, vanilla DOM/SVG, Node built-in test runner, existing gas physics and thermal helpers.

**Spec:** Approved Compare redesign in conversation; baseline design: `docs/superpowers/specs/2026-10-15-compare-recipe-design.md`.

## Global Constraints

- Existing optimizer behavior and optimizer protocol simulation MUST remain unchanged.
- Compare Add gas rows MUST select only an enabled named Supply bank; custom gas and implicit compressor sources are not valid Compare inputs.
- Supply-bank consumption MUST be finite and comparison-local; the persisted Supply bank records MUST NOT be mutated by a comparison.
- Add gas pressure-added and receiver-target fields MUST represent the same operation and update each other when either is edited.
- Transfer method selection MUST be derived from source/receiver pressures and equipment limits; the editor MUST NOT expose a manual Decant/Boost/Compressor selector.
- Wait rows MUST support fixed minutes or a modeled pressure/temperature target pair; physically inconsistent target pairs MUST be rejected.
- Invalid drafts MUST retain the most recent successful Compare result.
- Existing gas, equipment, bank, and settings storage formats MUST remain unchanged.

---

### Task 1: Replace Compare row schema and build finite-bank protocol plans

**Files:**
- Modify: `js/compare-recipe.js`
- Test: `tests/compare-recipe.test.js`

**Interfaces:**
- Consume: current cylinder `{ volumeL, initialPressureBar, initialOxygenPercent, initialHeliumPercent }`, selected physics, enabled `banks`, and equipment settings.
- Produce: `createCompareRow(type, id)`, `validateCompareRecipe(rows, { cylinder, banks, physics, settings })`, and `buildCompareProtocol(rows, { cylinder, physics, banks, settings })`.
- Add row shape: `{ id, type: 'add', bankId, pressureAddedBar, targetPressureBar, pressureInputMode }`, where `pressureInputMode` is `'added'` or `'target'` and both pressure fields are finite synchronized values.
- Wait row shape: `{ id, type: 'wait', waitMode: 'minutes' | 'target', waitMinutes, targetPressureBar, targetTemperatureC }`.
- Protocol stages: explicit `type: 'decant' | 'boost' | 'equalize' | 'wait' | 'keep'` rows carrying `compareRowId`, `sourceBankId`, source start/end pressure, receiver start/end pressure, source composition, resulting mix, and the finite source state after the stage.

- [ ] **Step 1: Write failing model tests**

Add tests for:

```js
test('creates a bank-backed add row and target-state wait row', () => {
  assert.deepEqual(createCompareRow('add', 'row-1'), {
    id: 'row-1', type: 'add', bankId: null,
    pressureAddedBar: 0, targetPressureBar: 0,
    pressureInputMode: 'added'
  });
  assert.deepEqual(createCompareRow('wait', 'row-2'), {
    id: 'row-2', type: 'wait', waitMode: 'minutes',
    waitMinutes: 0, targetPressureBar: null, targetTemperatureC: null
  });
});

test('rejects an add row that does not select an enabled supply bank', () => {
  const result = validateCompareRecipe([{
    id: 'add', type: 'add', bankId: 'missing',
    pressureAddedBar: 50, targetPressureBar: 100, pressureInputMode: 'added'
  }], { cylinder, banks, physics, settings });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some(error => error.field === 'bankId'));
});

test('synchronizes pressure-added and receiver-target values from the row start', () => {
  const result = normalizeComparePressureFields({
    pressureAddedBar: 100, targetPressureBar: 150, pressureInputMode: 'target'
  }, 50);
  assert.deepEqual(result, {
    pressureAddedBar: 100, targetPressureBar: 150, pressureInputMode: 'target'
  });
});

test('plans decant/equalize/boost stages and depletes only the local source copy', () => {
  const result = buildCompareProtocol([{
    id: 'add', type: 'add', bankId: 'he-bank',
    pressureAddedBar: 150, targetPressureBar: 200, pressureInputMode: 'target'
  }], { cylinder, physics, banks, settings });
  assert.deepEqual(result.protocolSteps.map(step => step.type), ['equalize', 'boost']);
  assert.ok(result.protocolSteps.at(-1).sourceEndPressureBar < result.protocolSteps[0].sourceStartPressureBar);
  assert.equal(banks[0].pressureBar, 200);
});

test('rejects a finite bank that cannot supply the requested addition', () => {
  const smallBank = {
    id: 'small-he', name: 'Small helium', volumeL: 2, pressureBar: 20,
    oxygenPercent: 0, heliumPercent: 100, enabled: true
  };
  assert.throws(() => buildCompareProtocol([{
    id: 'add', type: 'add', bankId: 'small-he',
    pressureAddedBar: 200, targetPressureBar: 250, pressureInputMode: 'target'
  }], {
    cylinder,
    physics,
    banks: [smallBank],
    settings
  }), /supply bank/i);
});

test('requires both pressure and temperature for a target-state wait', () => {
  const result = validateCompareRecipe([{
    id: 'wait', type: 'wait', waitMode: 'target',
    targetPressureBar: null, targetTemperatureC: 20
  }], { cylinder, banks, physics, settings });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some(error => error.field === 'targetPressureBar'));
});

```

Use concrete fixture banks and settings from the existing test style. Assert consumer-visible stage types, finite source boundaries, bank selection, pressure synchronization, and required target-pair fields; the thermal simulator owns physical consistency checks after the prior transfer state is known.

- [ ] **Step 2: Run focused tests and verify failure**

Run:

```sh
node --test tests/compare-recipe.test.js
```

Expected: FAIL because Add rows still hold custom gas/method fields and protocol construction does not consume finite Supply banks.

- [ ] **Step 3: Implement the pure row schema and validators**

Remove manual gas/method validation. Resolve `bankId` only against enabled `banks`; copy the selected bank’s name, composition, volume, and current pressure into normalized protocol data. Validate pressure-added/target bounds and the active input mode. Validate wait mode, minutes bounds, target temperature bounds, and target pressure bounds. Keep row order and preserve caller-owned objects.

Implement a pure pressure synchronization helper:

```js
export function normalizeComparePressureFields(row, receiverStartPressureBar) {
  if (row.pressureInputMode === 'target') {
    return {
      ...row,
      pressureAddedBar: row.targetPressureBar - receiverStartPressureBar
    };
  }
  return {
    ...row,
    targetPressureBar: receiverStartPressureBar + row.pressureAddedBar
  };
}
```

Reject negative additions, target pressure below the receiver start, pressure above 350 bar, missing banks, disabled banks, and duplicate/unknown bank IDs.

- [ ] **Step 4: Implement finite transfer planning**

Use `calcMolarDensity`/`calcPressure` with the selected physics model to track receiver and source moles. Solve the requested receiver target for added source moles by monotonic bisection over the source gas amount, then calculate the source-bank pressure after transfer.

For each Add row:

1. Resolve target pressure from `pressureInputMode` and the actual modeled receiver start pressure.
2. Compute the required source moles and reject if the bank cannot retain its configured minimum source pressure or the booster/cylinder ceiling prevents completion.
3. If the source can reach the target while ending above the receiver pressure, emit a `decant` stage.
4. If the source and receiver meet at the same pressure before the target, emit an `equalize` stage followed by a `boost` stage for the remainder.
5. Update only an internal bank-state map with source moles/pressure; never mutate `banks` or persisted storage.
6. Carry the selected bank ID, source composition, source start/end pressure, and resulting receiver state on every generated stage.

Use existing equipment values for decant rates, booster minimum source pressure, booster maximum output pressure, and booster flow. Keep `Keep` and `Wait` rows in order between transfer stages.

- [ ] **Step 5: Implement wait row normalization**

For `waitMode: 'minutes'`, preserve `waitMinutes`. For `waitMode: 'target'`, preserve both requested endpoint values and defer exact time/pressure projection to the thermal simulator while validating that the pair is physically reachable from the modeled prior state. Return stable field errors instead of silently changing the requested pair.

- [ ] **Step 6: Run focused model tests and commit**

Run:

```sh
node --test tests/compare-recipe.test.js
```

Expected: PASS. Commit:

```sh
git add js/compare-recipe.js tests/compare-recipe.test.js
git commit -m "feat: plan compare transfers from finite supply banks"
```

---

### Task 2: Simulate automatic stages and target-state waits

**Files:**
- Modify: `js/thermodynamics.js`
- Test: `tests/thermodynamics.test.js`

**Interfaces:**
- Consume: explicit Compare stages from Task 1, including `decant`, `equalize`, `boost`, `wait`, source pressure ranges, and target wait fields.
- Produce: existing Compare result shape with thermal details, finite source metadata, fixed-wait behavior, and target-state wait duration/endpoint values.

- [ ] **Step 1: Write failing thermodynamic tests**

Add tests for:

```js
test('compare simulation maps explicit decant, equalize, and boost stages', () => {
  const result = simulateCompareProtocol({
    protocolSteps: [
      {
        type: 'equalize', operation: 'Equalize',
        receiverStartPressureBar: 50, receiverEndPressureBar: 120,
        sourceStartPressureBar: 200, sourceEndPressureBar: 120,
        sourceOxygenPercent: 0, sourceHeliumPercent: 100,
        resultingMix: { oxygenPercent: 10, heliumPercent: 50 }
      },
      {
        type: 'boost', operation: 'Boost',
        receiverStartPressureBar: 120, receiverEndPressureBar: 200,
        sourceStartPressureBar: 120, sourceEndPressureBar: 80,
        sourceOxygenPercent: 0, sourceHeliumPercent: 100,
        resultingMix: { oxygenPercent: 8, heliumPercent: 60 }
      }
    ],
    cylinder, physics, thermal, settings
  });
  assert.deepEqual(result.protocolSteps.map(step => step.type), ['equalize', 'boost']);
  assert.ok(result.protocolSteps.every(step => step.thermal.durationMinutes >= 0));
});

test('compare target wait reaches the requested pressure and temperature', () => {
  const result = simulateCompareProtocol({
    protocolSteps: [{
      type: 'wait', waitMode: 'target',
      targetPressureBar: 98.4, targetTemperatureC: 25,
      receiverStartPressureBar: 100, resultingPressureBar: 100,
      resultingMix: { oxygenPercent: 21, heliumPercent: 0 }
    }],
    cylinder, physics, thermal, settings
  });
  const wait = result.protocolSteps[0];
  assert.ok(Math.abs(wait.thermal.temperatureAfterWaitC - 25) < 0.05);
  assert.ok(Math.abs(wait.thermal.pressureAfterWaitBar - 98.4) < 0.2);
});

test('compare rejects an unreachable target-state wait', () => {
  assert.throws(() => simulateCompareProtocol({
    protocolSteps: [{
      type: 'wait', waitMode: 'target',
      targetPressureBar: 120, targetTemperatureC: 25,
      receiverStartPressureBar: 100, resultingPressureBar: 100,
      resultingMix: { oxygenPercent: 21, heliumPercent: 0 }
    }],
    cylinder, physics, thermal, settings
  }), /target pressure/i);
});
```

- [ ] **Step 2: Run focused tests and verify failure**

Run:

```sh
node --test tests/thermodynamics.test.js
```

Expected: FAIL because the simulator only understands the old Add/method shape and fixed-minute waits.

- [ ] **Step 3: Extend the Compare-only simulation branch**

Leave `simulateThermalProtocol()` unchanged. Update `simulateCompareProtocol()` to treat explicit stage types as follows:

- `decant` and `equalize`: use the existing manual decant-rate path; retain the operation label from the planner.
- `boost`: use the existing booster-rate path with the stage’s source start/end pressure range and selected source mix.
- `wait`: use zero transfer and either the literal minutes or `calculateCoolingTime()` for the target temperature.
- `keep`: use zero transfer and zero wait.

For target waits, calculate the pressure projection at the requested target temperature. Compare it to the requested target pressure with a documented tolerance; throw a structured Compare simulation error when inconsistent. Return the actual modeled duration and endpoint state. Preserve final ambient-settled projection behavior after the last entered row.

- [ ] **Step 4: Run thermodynamic tests and the existing optimizer thermal tests**

Run:

```sh
node --test tests/thermodynamics.test.js
```

Expected: PASS, including all existing optimizer thermal tests. Commit:

```sh
git add js/thermodynamics.js tests/thermodynamics.test.js
git commit -m "feat: simulate automatic compare stages and target waits"
```

---

### Task 3: Update Compare editor and controller contracts

**Files:**
- Modify: `js/ui/compare-recipe.js`
- Modify: `js/main.js`
- Modify: `index.html` only if labels/help text need alignment
- Test: `tests/compare-recipe-ui.test.js`, `tests/compare-mode-markup.test.js`

**Interfaces:**
- Consume: `rows`, enabled `banks`, structured Compare errors, and the Task 1 row schema.
- Produce: accessible bank-backed Add controls, synchronized pressure inputs, wait-mode controls, inferred bank data, and delegated controller updates.

- [ ] **Step 1: Write failing UI/controller contract tests**

Assert that the rendered Add row contains:

- a Supply bank select, not a gas preset or custom gas composition editor;
- inferred bank name/composition/pressure/volume text;
- `Pressure added` and `Receiver target pressure` controls;
- no manual method/source-pressure controls.

Assert that Wait rows contain a Minutes/Target state selector and target pressure/temperature controls for target mode. Assert that changing either pressure field updates the other through the controller contract.

- [ ] **Step 2: Run focused UI tests and verify failure**

Run:

```sh
node --test tests/compare-recipe-ui.test.js tests/compare-mode-markup.test.js
```

Expected: FAIL against the old gas-preset/method editor.

- [ ] **Step 3: Implement renderer changes**

Change `renderCompareRecipe(container, { rows, banks, errors, pressureStarts })` to render only enabled banks in Add rows. Display inferred bank data as text, including bank name, O₂/He, volume, and current pressure. Render both pressure fields and mark the last-edited field through `data-pressure-input-mode`/`data-compare-field` so `main.js` can synchronize them. Render wait mode and conditionally show minutes or target pressure/temperature.

Keep native labels, row IDs, inline errors, and delegated `data-action` attributes. Remove imports and rendering for `COMPARE_METHODS` and gas presets.

- [ ] **Step 4: Implement controller updates**

Update `compareInput()` to pass `banks` and equipment settings. Update `updateCompareRow()` to:

- replace an Add row from `createCompareRow()` when its type changes;
- set `bankId` and clear invalid bank state on bank selection;
- parse pressure fields and set `pressureInputMode`, then synchronize the opposite field from the row’s current receiver start estimate;
- parse wait mode/minutes/target fields;
- rerender only the editor for draft edits.

Update `runCompare()` to validate with banks/settings, catch finite-source and target-wait errors, retain the last successful result on failure, and render the planned/simulated result on success. Keep Optimize branch code and Supply bank persistence unchanged.

- [ ] **Step 5: Run focused UI/controller tests and commit**

Run:

```sh
node --test tests/compare-recipe-ui.test.js tests/compare-mode-markup.test.js tests/compare-recipe.test.js tests/thermodynamics.test.js
```

Expected: PASS. Commit:

```sh
git add js/ui/compare-recipe.js js/main.js index.html tests/compare-recipe-ui.test.js tests/compare-mode-markup.test.js
git commit -m "feat: edit compare rows from finite supply banks"
```

---

### Task 4: Update documentation and verify the complete flow

**Files:**
- Modify: `docs/superpowers/specs/2026-10-15-compare-recipe-design.md`
- Modify: `README.md`
- Modify: `docs/architecture.md`
- Modify: `docs/development.md`
- Test: all existing tests plus browser smoke

- [ ] **Step 1: Update the Compare design contract**

Replace the old custom-gas/manual-method description with the approved bank-backed row schema, finite local source consumption, automatic stage selection, synchronized pressure fields, and target-state waits. Preserve the Optimize/non-persistence constraints.

- [ ] **Step 2: Update user and maintainer documentation**

Document only verified behavior: Add gas selects Supply banks and shows inferred source data; pressure-added and receiver-target fields synchronize; the model chooses Decant/Equalize/Boost; banks are finite for the comparison but persisted bank settings are unchanged; Wait supports minutes or target pressure/temperature.

- [ ] **Step 3: Run the complete automated suite**

Run:

```sh
npm test
git diff --check
```

Expected: all tests pass, zero whitespace errors.

- [ ] **Step 4: Browser smoke the changed path**

Serve the worktree and verify:

1. Compare opens without the onboarding overlay blocking controls.
2. Add gas lists only enabled Supply banks and displays inferred bank data.
3. Editing `Pressure added` updates `Receiver target pressure`; editing the target updates the added value.
4. A bank-backed operation produces Decant/Equalize/Boost cards automatically and leaves the persisted Supply bank unchanged after the run.
5. Fixed-minute Wait and target pressure/temperature Wait both produce modeled outputs; an inconsistent target pair shows an error and retains the previous successful result.
6. Thermal graphs, Diagram, Tank summary, and Optimize mode still render and switch correctly.

- [ ] **Step 5: Commit documentation and verification evidence**

```sh
git add docs/superpowers/specs/2026-10-15-compare-recipe-design.md README.md docs/architecture.md docs/development.md
git commit -m "docs: describe inventory-backed compare operations"
```
