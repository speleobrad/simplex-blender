# Thermodynamic Recipe Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add sequential gas-transfer rate, heating, cooling, and final ambient-settled pressure estimates to the recipe flow without changing non-thermal optimizer callers.

**Architecture:** Keep the existing simplex recipe solver as a static inner solver. Add pure thermodynamic functions that simulate protocol stages using existing ideal/Van der Waals properties, then wrap the solver with a bounded hot-target search so the final cooled pressure reaches the requested target. Persist only equipment-wide booster settings; keep tank/environment and wait controls in the main working-tank input.

**Tech Stack:** Browser-native ES modules, Node.js built-in test runner, existing ideal/Van der Waals gas model, native HTML controls, Tailwind CDN classes.

**Spec:** `docs/superpowers/specs/2026-10-09-thermodynamic-model-design.md`

## Global Constraints

- Oxygen-rich means source O₂ `>= 40%`.
- Booster displacement is configured in cm³; boost speeds are BPM.
- Direct decant speeds are configured in bar/min.
- Air top-up uses compressor inlet flow in L/min at 1.01325 bar and ambient temperature.
- Existing ideal/Van der Waals calculations remain the only gas-property convention.
- Existing `optimizeBlend` callers without `input.thermal` retain current behavior.
- The final requested pressure is the pressure after complete cooling to ambient temperature; earlier steps use the selected wait mode.
- Do not add third-party dependencies or a build step.
- Every production behavior change gets a failing test before implementation.

---

### Task 1: Persist and validate equipment booster settings

**Files:**
- Modify: `js/settings.js:4-113`
- Modify: `js/ui/settings-dialog.js:5-109`
- Modify: `js/main.js:61-204,489-530`
- Modify: `scuba_gas_remixer_simplex_optimizer.html:87-97`
- Test: `tests/settings.test.js`

**Interfaces:**
- Produces `DEFAULT_SETTINGS.booster` with `minimumSourcePressureBar`, `cylinderVolumeCm3`, `oxygenBoostBpm`, `otherBoostBpm`, `oxygenDecantRateBarPerMin`, `otherDecantRateBarPerMin`, and `compressorInletFlowLPerMin`.
- `validateSettings(settings)` rejects out-of-range equipment values with field-specific messages.
- `renderSettingsDialog(settings)` renders all persisted booster fields.
- `copySettings(settings)` and saved-settings migration preserve every booster field.

- [ ] **Step 1: Write the failing persistence/migration tests**

Add tests to `tests/settings.test.js`:

```js
test('old settings gain all thermodynamic booster defaults', () => {
  const storage = memoryStorage([[
    'simplex-gas-remixer-settings',
    JSON.stringify({
      gasPresets: [{ name: 'Air', oxygenPercent: 21, heliumPercent: 0 }],
      volumePresets: [12],
      booster: { minimumSourcePressureBar: 25 }
    })
  ]]);

  const settings = loadSettings(storage);

  assert.deepEqual(settings.booster, {
    minimumSourcePressureBar: 25,
    cylinderVolumeCm3: 9,
    oxygenBoostBpm: 50,
    otherBoostBpm: 50,
    oxygenDecantRateBarPerMin: 5,
    otherDecantRateBarPerMin: 5,
    compressorInletFlowLPerMin: 100
  });
});

test('invalid thermodynamic booster settings are rejected before storage changes', () => {
  const storage = memoryStorage();
  assert.throws(() => saveSettings({
    ...DEFAULT_SETTINGS,
    booster: {
      ...DEFAULT_SETTINGS.booster,
      cylinderVolumeCm3: 0,
      oxygenDecantRateBarPerMin: -1
    }
  }, storage), /cylinder.*cm|decant/i);
  assert.equal(storage.getItem('simplex-gas-remixer-settings'), null);
});

test('thermodynamic booster settings survive a save/load round trip', () => {
  const settings = {
    ...DEFAULT_SETTINGS,
    gasPresets: DEFAULT_SETTINGS.gasPresets.map(preset => ({ ...preset })),
    volumePresets: [...DEFAULT_SETTINGS.volumePresets],
    booster: {
      minimumSourcePressureBar: 18,
      cylinderVolumeCm3: 12,
      oxygenBoostBpm: 40,
      otherBoostBpm: 55,
      oxygenDecantRateBarPerMin: 3,
      otherDecantRateBarPerMin: 7,
      compressorInletFlowLPerMin: 160
    }
  };
  const storage = memoryStorage();

  saveSettings(settings, storage);

  assert.deepEqual(loadSettings(storage).booster, settings.booster);
});
```

- [ ] **Step 2: Run the focused settings tests and verify the expected failure**

Run: `node --test tests/settings.test.js`

Expected: FAIL because the old settings shape does not add or validate the new booster fields.

- [ ] **Step 3: Implement defaults, normalization, copying, and validation**

Extend `DEFAULT_SETTINGS.booster`, `copySettings`, and `addDefaultBooster`. Validate:

```js
cylinderVolumeCm3: 0.1 <= value <= 1000
boost BPM: 1 <= value <= 1000
manual decant rates: 0.01 <= value <= 1000
compressor inlet flow: 0.1 <= value <= 10000
```

Keep the existing minimum-source-pressure rule and report each invalid category in `validateSettings`.

- [ ] **Step 4: Implement the Settings dialog fields and draft wiring**

Add labeled numeric inputs with `data-settings-collection="booster"` and the exact fields above. Extend `renderSettingsDialog` to populate them. Existing delegated `updateSettingsDraft` already writes numeric settings by collection/field; retain that convention. Do not add thermal tank fields to the dialog.

- [ ] **Step 5: Run focused tests and verify they pass**

Run: `node --test tests/settings.test.js`

Expected: PASS with no warnings.

- [ ] **Step 6: Commit the settings slice**

Run: `git add js/settings.js js/ui/settings-dialog.js js/main.js scuba_gas_remixer_simplex_optimizer.html tests/settings.test.js && git commit -m "feat: add thermodynamic booster settings"`

---

### Task 2: Build pure thermodynamic rate and cooling functions

**Files:**
- Create: `js/thermodynamics.js`
- Test: `tests/thermodynamics.test.js`
- Modify: `docs/gas-physics.md`

**Interfaces:**
- `calculateBoosterFillRate({ cylinderVolumeCm3, bpm, sourcePressureBar, receiverPressureBar, sourceOxygenPercent, sourceHeliumPercent, receiverOxygenPercent, receiverHeliumPercent, receiverVolumeL, temperatureC, useVdw })` returns `{ fillRateBarPerMin, volumetricEfficiency, zSource, zReceiver, molesPerMin }`.
- `calculateCompressorFillRate({ inletFlowLPerMin, receiverOxygenPercent, receiverHeliumPercent, receiverVolumeL, ambientTemperatureC, receiverTemperatureC, useVdw })` returns a positive bar/min rate.
- `calculateCoolingTime({ transferEndTemperatureC, ambientTemperatureC, targetTemperatureC, tauMinutes })` returns minutes or zero.
- `calculateTemperatureAfterWait({ transferEndTemperatureC, ambientTemperatureC, waitMinutes, tauMinutes })` returns °C.
- `calculatePressureAtTemperature({ pressureBar, oxygenPercent, heliumPercent, fromTemperatureC, toTemperatureC, volumeL, useVdw })` preserves hot-state density and evaluates pressure at the new temperature.
- `estimateCompressionTemperature({ startTemperatureC, addedPressureBar, fillTimeMinutes, volumeL, heliumFraction, tankMaterial, coolingMedium })` returns transfer-end °C.

- [ ] **Step 1: Write the failing pure-model tests**

Create `tests/thermodynamics.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateBoosterFillRate,
  calculateCompressorFillRate,
  calculateCoolingTime,
  calculatePressureAtTemperature,
  calculateTemperatureAfterWait,
  estimateCompressionTemperature
} from '../js/thermodynamics.js';

test('booster rate uses displacement, BPM, and receiver/source compressibility', () => {
  const rate = calculateBoosterFillRate({
    cylinderVolumeCm3: 9,
    bpm: 50,
    sourcePressureBar: 200,
    receiverPressureBar: 100,
    sourceOxygenPercent: 21,
    sourceHeliumPercent: 0,
    receiverOxygenPercent: 21,
    receiverHeliumPercent: 0,
    receiverVolumeL: 12,
    temperatureC: 20,
    useVdw: false
  });

  assert.ok(rate.fillRateBarPerMin > 7 && rate.fillRateBarPerMin < 8);
  assert.equal(rate.volumetricEfficiency, 1);
});

test('booster clearance efficiency falls when receiver pressure exceeds source pressure', () => {
  const rate = calculateBoosterFillRate({
    cylinderVolumeCm3: 9,
    bpm: 50,
    sourcePressureBar: 100,
    receiverPressureBar: 200,
    sourceOxygenPercent: 100,
    sourceHeliumPercent: 0,
    receiverOxygenPercent: 41,
    receiverHeliumPercent: 0,
    receiverVolumeL: 12,
    temperatureC: 20,
    useVdw: false
  });

  assert.ok(rate.volumetricEfficiency < 98);
  assert.ok(rate.fillRateBarPerMin > 0);
});

test('compressor inlet flow converts free-air flow to receiver pressure rate', () => {
  const rate = calculateCompressorFillRate({
    inletFlowLPerMin: 100,
    receiverOxygenPercent: 21,
    receiverHeliumPercent: 0,
    receiverVolumeL: 12,
    ambientTemperatureC: 20,
    receiverTemperatureC: 20,
    useVdw: false
  });

  assert.ok(Math.abs(rate - 8.447) < 0.01);
});

test('cooling reaches an absolute target using Newton cooling', () => {
  const minutes = calculateCoolingTime({
    transferEndTemperatureC: 60,
    ambientTemperatureC: 20,
    targetTemperatureC: 30,
    tauMinutes: 18
  });
  assert.ok(Math.abs(minutes - 24.9533) < 1e-3);
  assert.ok(Math.abs(calculateTemperatureAfterWait({
    transferEndTemperatureC: 60,
    ambientTemperatureC: 20,
    waitMinutes: minutes,
    tauMinutes: 18
  }) - 30) < 1e-9);
});

test('pressure falls when a hot ideal-gas tank cools at fixed density', () => {
  const pressure = calculatePressureAtTemperature({
    pressureBar: 200,
    oxygenPercent: 21,
    heliumPercent: 0,
    fromTemperatureC: 60,
    toTemperatureC: 20,
    volumeL: 12,
    useVdw: false
  });
  assert.ok(Math.abs(pressure - 175.989) < 0.01);
});

test('compression temperature increases with pressure and is cooled faster in water', () => {
  const airSteel = estimateCompressionTemperature({
    startTemperatureC: 20,
    addedPressureBar: 70,
    fillTimeMinutes: 10,
    volumeL: 12,
    heliumFraction: 0,
    tankMaterial: 'steel',
    coolingMedium: 'air'
  });
  const heliumAluminumWater = estimateCompressionTemperature({
    startTemperatureC: 20,
    addedPressureBar: 70,
    fillTimeMinutes: 10,
    volumeL: 12,
    heliumFraction: 0.35,
    tankMaterial: 'aluminum',
    coolingMedium: 'water'
  });

  assert.ok(airSteel > 20);
  assert.ok(heliumAluminumWater > 20);
  assert.ok(heliumAluminumWater < airSteel);
});
```

- [ ] **Step 2: Run the new test file and verify it fails for the missing module**

Run: `node --test tests/thermodynamics.test.js`

Expected: FAIL with module-not-found or missing-export errors.

- [ ] **Step 3: Implement the minimal pure functions**

Use `calcZ`, `calcMolarDensity`, and `calcPressure` from `js/physics.js`. Use `GAS_CONSTANT` in bar·L/(mol·K). Keep all functions deterministic and avoid DOM access.

Implement these constants exactly:

```js
const ATMOSPHERIC_PRESSURE_BAR = 1.01325;
const CLEARANCE_RATIO = 0.05;
const GAMMA = 1.4;
const OXYGEN_RICH_THRESHOLD = 40;
```

Use the specified material factors, water multiplier, size factors, and time constants from the design spec. Clamp booster volumetric efficiency to 0.10–0.98.

- [ ] **Step 4: Run the focused tests and verify they pass**

Run: `node --test tests/thermodynamics.test.js`

Expected: PASS.

- [ ] **Step 5: Document the new equations and units**

Extend `docs/gas-physics.md` with the booster, compressor, heating, and cooling assumptions. State that the thermodynamic model is an estimate and that the existing ideal/VDW model supplies compressibility.

- [ ] **Step 6: Commit the pure model slice**

Run: `git add js/thermodynamics.js tests/thermodynamics.test.js docs/gas-physics.md && git commit -m "feat: add thermodynamic rate and cooling model"`

---

### Task 3: Add sequential stage simulation and final ambient-target convergence

**Files:**
- Modify: `js/thermodynamics.js`
- Modify: `js/optimizer.js:537-561,781-1370`
- Test: `tests/thermodynamics.test.js`
- Test: `tests/optimizer.test.js`

**Interfaces:**
- `simulateThermalProtocol({ protocolSteps, cylinder, physics, thermal, settings })` returns `{ protocolSteps, final }`, preserving existing step objects and adding `step.thermal`.
- `optimizeBlend(input)` dispatches to the existing static solver when `input.thermal` is absent and to a thermal-target wrapper when present.
- The thermal result adds `result.thermal` with final transfer-end and ambient-settled metrics; existing `blend.finalPressureBar` remains the static hot recipe pressure for compatibility.

- [ ] **Step 1: Write failing sequential-simulation tests**

Append tests to `tests/thermodynamics.test.js` using a small hand-built protocol:

```js
test('sequential simulation carries post-wait pressure and temperature into the next stage', () => {
  const simulation = simulateThermalProtocol({
    protocolSteps: [
      {
        type: 'boost',
        operation: 'Boost',
        resultingPressureBar: 150,
        resultingMix: { oxygenPercent: 21, heliumPercent: 0 },
        sourceStartPressureBar: 200,
        sourceEndPressureBar: 150,
        receiverStartPressureBar: 100,
        receiverEndPressureBar: 150
      },
      {
        type: 'decant',
        operation: 'Decant',
        resultingPressureBar: 180,
        resultingMix: { oxygenPercent: 21, heliumPercent: 0 },
        sourceStartPressureBar: 220,
        sourceEndPressureBar: 190,
        receiverStartPressureBar: 150,
        receiverEndPressureBar: 180
      }
    ],
    cylinder: { volumeL: 12 },
    physics: { model: 'ideal', temperatureC: 20 },
    thermal: {
      tankMaterial: 'steel',
      coolingMedium: 'air',
      ambientTemperatureC: 20,
      waitMode: 'minutes',
      waitMinutes: 10,
      targetTemperatureC: 25
    },
    settings: {
      booster: {
        cylinderVolumeCm3: 9,
        oxygenBoostBpm: 50,
        otherBoostBpm: 50,
        oxygenDecantRateBarPerMin: 5,
        otherDecantRateBarPerMin: 5,
        compressorInletFlowLPerMin: 100
      }
    }
  });

  assert.equal(simulation.protocolSteps.length, 2);
  assert.equal(simulation.protocolSteps[0].thermal.rateSource, 'booster');
  assert.equal(simulation.protocolSteps[1].thermal.rateSource, 'decant-rate');
  assert.ok(simulation.protocolSteps[0].thermal.pressureAfterWaitBar < 150);
  assert.equal(
    simulation.protocolSteps[1].thermal.temperatureStartC,
    simulation.protocolSteps[0].thermal.temperatureAfterWaitC
  );
});

test('top-up uses compressor flow and 40 percent oxygen selects oxygen rates', () => {
  const simulation = simulateThermalProtocol({
    protocolSteps: [{
      type: 'boost',
      operation: 'Top-up',
      resultingPressureBar: 200,
      resultingMix: { oxygenPercent: 21, heliumPercent: 0 },
      sourceStartPressureBar: 190,
      sourceEndPressureBar: 100,
      receiverStartPressureBar: 150,
      receiverEndPressureBar: 200
    }],
    cylinder: { volumeL: 12 },
    physics: { model: 'ideal', temperatureC: 20 },
    thermal: {
      tankMaterial: 'steel',
      coolingMedium: 'air',
      ambientTemperatureC: 20,
      waitMode: 'minutes',
      waitMinutes: 0,
      targetTemperatureC: 25
    },
    settings: {
      booster: {
        cylinderVolumeCm3: 9,
        oxygenBoostBpm: 50,
        otherBoostBpm: 50,
        oxygenDecantRateBarPerMin: 5,
        otherDecantRateBarPerMin: 5,
        compressorInletFlowLPerMin: 100
      }
    }
  });

  assert.equal(simulation.protocolSteps[0].thermal.rateSource, 'compressor');
  assert.ok(simulation.protocolSteps[0].thermal.rateBarPerMin > 0);
});
```

- [ ] **Step 2: Run the sequential tests and verify they fail**

Run: `node --test tests/thermodynamics.test.js`

Expected: FAIL because `simulateThermalProtocol` is not exported.

- [ ] **Step 3: Implement sequential simulation**

Use `operation === 'Top-up'` for compressor rate selection before checking stage type. Use source bank gas composition from the protocol/trajectory data; preserve current output shape if a direct protocol fixture lacks `sourceOxygenPercent` by deriving it from `resultingMix` only for receiver calculations. Apply the configured wait after every stage. For the final stage, replace the normal configured wait with full ambient cooling and report approximately `4.6 × tau` minutes.

For each step add:

```js
step.thermal = {
  rateSource,
  rateBarPerMin,
  durationMinutes,
  temperatureStartC,
  temperatureAtTransferEndC,
  waitMinutes,
  temperatureAfterWaitC,
  pressureAtTransferEndBar,
  pressureAfterWaitBar
};
```

Start the simulation at `cylinder.initialPressureBar` and the existing `physics.temperatureC`. Carry `currentPressureBar` and `currentTemperatureC` after every wait.

- [ ] **Step 4: Add the final ambient-target convergence regression test**

Append to `tests/optimizer.test.js`:

```js
test('thermal recipe overshoots the last hot target so ambient pressure reaches the request', () => {
  const result = optimizeBlend({
    cylinder: {
      volumeL: 12,
      initialPressureBar: 80,
      initialOxygenPercent: 21,
      initialHeliumPercent: 0,
      targetPressureBar: 210,
      targetOxygenPercent: 21,
      targetHeliumPercent: 0
    },
    physics: { model: 'ideal', temperatureC: 20 },
    thermal: {
      tankMaterial: 'steel',
      coolingMedium: 'air',
      ambientTemperatureC: 20,
      waitMode: 'minutes',
      waitMinutes: 10,
      targetTemperatureC: 25
    },
    settings: {
      booster: {
        minimumSourcePressureBar: 0,
        cylinderVolumeCm3: 9,
        oxygenBoostBpm: 50,
        otherBoostBpm: 50,
        oxygenDecantRateBarPerMin: 5,
        otherDecantRateBarPerMin: 5,
        compressorInletFlowLPerMin: 100
      }
    },
    banks: [{
      id: 'air', name: 'Air', volumeL: 80, pressureBar: 300,
      oxygenPercent: 21, heliumPercent: 0, enabled: true
    }]
  });

  assert.equal(result.feasible, true);
  assert.ok(result.thermal.finalTransferEndPressureBar > 210);
  assert.ok(Math.abs(result.thermal.finalAmbientPressureBar - 210) < 1e-5);
});
```

- [ ] **Step 5: Run the new regression test and verify it fails before wrapper integration**

Run: `node --test tests/optimizer.test.js --test-name-pattern="thermal recipe overshoots"`

Expected: FAIL because the current optimizer has no thermal result or final-target adjustment.

- [ ] **Step 6: Refactor the current optimizer into a static inner function**

Rename the current exported implementation body to an internal `optimizeBlendWithoutThermal(input)`. Add a new exported dispatcher:

```js
export function optimizeBlend(input) {
  if (!input?.thermal) return optimizeBlendWithoutThermal(input);
  return optimizeThermalBlend(input, optimizeBlendWithoutThermal);
}
```

Do not change the static function’s calculations or existing return fields.

- [ ] **Step 7: Implement bounded thermal-target search**

Add `optimizeThermalBlend(input, optimizeStatic)` that:

1. starts at the requested target pressure;
2. optimizes and simulates the candidate;
3. returns immediately if final ambient pressure is within `1e-5` bar;
4. searches up to the existing 350 bar target limit;
5. bisects feasible candidates for at most 40 iterations;
6. selects the highest feasible candidate when the requested settled pressure cannot be reached;
7. returns the existing infeasible/maximum-pressure shape with thermal metrics when no positive safe recipe exists.

Use the candidate’s static protocol as the input to `simulateThermalProtocol`. Preserve static no-thermal callers and all existing safety diagnostics.

- [ ] **Step 8: Run optimizer and model tests**

Run: `node --test tests/thermodynamics.test.js tests/optimizer.test.js`

Expected: PASS, including all pre-existing optimizer tests.

- [ ] **Step 9: Commit the simulation and optimizer slice**

Run: `git add js/thermodynamics.js js/optimizer.js tests/thermodynamics.test.js tests/optimizer.test.js && git commit -m "feat: simulate thermal recipe stages"`

---

### Task 4: Add working-tank thermal controls and input validation

**Files:**
- Modify: `scuba_gas_remixer_simplex_optimizer.html:121-130`
- Modify: `js/main.js:261-278,320-334,448-487`
- Modify: `js/input-validation.js:3-20`
- Test: `tests/input-validation.test.js`

**Interfaces:**
- `readInput()` returns `thermal` with material, medium, ambient, wait mode, and both wait values.
- `validateCalculatorInputs(cylinder, physics, thermal)` validates thermal values while remaining compatible with calls that omit thermal.
- Main-screen changes trigger `recalculate()` through the existing `data-recalculate` convention.

- [ ] **Step 1: Write failing thermal-input validation tests**

Add:

```js
test('rejects a temperature wait target at or below ambient', () => {
  const errors = validateCalculatorInputs(
    { volumeL: 12, initialPressureBar: 80, targetPressureBar: 210 },
    { temperatureC: 20 },
    {
      tankMaterial: 'steel',
      coolingMedium: 'air',
      ambientTemperatureC: 25,
      waitMode: 'temperature',
      waitMinutes: 10,
      targetTemperatureC: 25
    }
  );
  assert.match(errors.join(' '), /target.*ambient/i);
});

test('rejects unsupported thermal selectors and negative fixed waits', () => {
  const errors = validateCalculatorInputs(
    { volumeL: 12, initialPressureBar: 80, targetPressureBar: 210 },
    { temperatureC: 20 },
    {
      tankMaterial: 'carbon',
      coolingMedium: 'oil',
      ambientTemperatureC: 20,
      waitMode: 'temperature',
      waitMinutes: -1,
      targetTemperatureC: 25
    }
  );
  assert.ok(errors.length >= 3);
});
```

- [ ] **Step 2: Run focused validation tests and verify failure**

Run: `node --test tests/input-validation.test.js`

Expected: FAIL because the validation function ignores the third argument.

- [ ] **Step 3: Implement validation and main-screen controls**

Add fields to the working-tank card beside volume. Use selects for material, medium, and wait mode; show a numeric minutes input for `minutes` mode and a numeric °C input for `temperature` mode. Keep both values in the DOM so mode changes do not discard the other draft value.

Extend `readInput()` with:

```js
thermal: {
  tankMaterial: byId('tank-material').value,
  coolingMedium: byId('cooling-medium').value,
  ambientTemperatureC: numberValue('ambient-temperature'),
  waitMode: byId('wait-mode').value,
  waitMinutes: numberValue('wait-minutes'),
  targetTemperatureC: numberValue('wait-target-temperature')
}
```

Toggle the mode-specific field on change and recalculate on every thermal input change. Pass thermal data to `validateCalculatorInputs` and `optimizeBlend`.

- [ ] **Step 4: Run focused tests and verify pass**

Run: `node --test tests/input-validation.test.js tests/settings.test.js`

Expected: PASS.

- [ ] **Step 5: Commit the main input slice**

Run: `git add scuba_gas_remixer_simplex_optimizer.html js/main.js js/input-validation.js tests/input-validation.test.js && git commit -m "feat: add working-tank thermal controls"`

---

### Task 5: Render thermal recipe details and update documentation

**Files:**
- Modify: `js/ui/results.js:57-149`
- Modify: `scuba_gas_remixer_simplex_optimizer.html:258-287`
- Modify: `docs/architecture.md:8-34`
- Modify: `docs/development.md:23-40`
- Modify: `docs/optimizer.md`
- Test: `tests/results.test.js` (create only if a DOM-free renderer helper can be tested without mocks)

**Interfaces:**
- `renderResults(result)` renders existing summaries plus thermal estimates when `result.thermal` exists.
- Existing infeasible and no-thermal result paths continue rendering without accessing missing thermal fields.

- [ ] **Step 1: Add DOM markup for final thermal summary fields**

Add two summary values under the existing final-pressure card: final transfer-end gauge and final ambient-settled gauge/temperature. Keep the existing IDs intact so existing result updates continue to work.

- [ ] **Step 2: Extend recipe-card rendering with thermal details**

In `renderProtocol`, append a separate text block only when `step.thermal` exists. Use text nodes, not `innerHTML`. Display:

```text
Rate: <source> · <rate> bar/min · <duration> min
Transfer end: <pressure> bar at <temperature> °C
Wait: <minutes> min
After wait: <pressure> bar at <temperature> °C
```

For the final step identify the wait as full ambient cool-off and show the estimated `4.6 × tau` duration.

- [ ] **Step 3: Add safe rendering for maximum-pressure and invalid results**

Use `result.thermal ?? result.maximumPressure?.thermal` where appropriate. If no thermal result exists, preserve the current card and summary output exactly. If thermal convergence is infeasible, render the existing alert plus the predicted ambient-settled pressure when available.

- [ ] **Step 4: Update architecture and development documentation**

Document the new module boundary, data flow, equipment settings, main-screen tank inputs, browser smoke checks, and estimate limitations. Add a smoke check that verifies a final hot pressure above the requested target settles to the requested ambient pressure.

- [ ] **Step 5: Run the full Node test suite**

Run: `npm test`

Expected: PASS with zero failures.

- [ ] **Step 6: Commit the result and documentation slice**

Run: `git add js/ui/results.js scuba_gas_remixer_simplex_optimizer.html docs/architecture.md docs/development.md docs/optimizer.md && git commit -m "feat: display thermal recipe estimates"`

---

### Task 6: Browser smoke verification and final cleanup

**Files:**
- Modify: any affected files from prior tasks only

- [ ] **Step 1: Start the documented local server**

Run: `python3 -m http.server 8000`

Expected: server starts without errors.

- [ ] **Step 2: Open the actual application and exercise the thermal path**

Open `http://127.0.0.1:8000/scuba_gas_remixer_simplex_optimizer.html` in a browser. Verify:

1. Working tank shows material, medium, ambient, and wait controls beside volume.
2. Settings shows all six new equipment fields and saves/reloads them.
3. A feasible recipe renders per-step rate, duration, hot temperature, wait, and post-wait pressure/temperature.
4. Changing air to water changes cooling estimates.
5. Changing fixed minutes to target temperature changes wait values.
6. The final transfer-end pressure is above the requested settled target when heating is nonzero.
7. The final ambient-settled pressure is the requested target within displayed rounding.
8. Invalid thermal input clears the recipe and displays an input error.
9. Existing Diagram, Tank summary, Solver, theme, bank editing, and no-bank infeasible states still work.
10. Browser console has no application module/runtime errors.

- [ ] **Step 3: Run the complete verification command after smoke testing**

Run: `npm test`

Expected: PASS with zero failures after browser changes.

- [ ] **Step 4: Remove only temporary verification artifacts**

Stop the temporary HTTP server. Do not add screenshots, logs, or throwaway scripts to the repository.

- [ ] **Step 5: Review the final branch diff and commit any required cleanup**

Run: `git diff master...thermodynamic-model --stat`

Confirm only the specification, thermodynamic implementation, settings/UI integration, tests, and relevant documentation changed. If cleanup is needed, use a focused commit:

```sh
git add <affected-files>
git commit -m "chore: clean up thermodynamic integration"
```
