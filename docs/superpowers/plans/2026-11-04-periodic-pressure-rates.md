# Periodic Pressure-Rate Profiles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sample the bar/min pressure rate during each booster and compressor transfer on the same periodic grid the temperature already uses, and plot it on the thermal chart.

**Architecture:** Temperature already comes from a fixed-step integration (`estimateTransferTemperatureSamples`, 0.5 s steps, samples every 60 s plus endpoint). Add a sibling integration that advances receiver pressure and source inventory on the same grid, evaluates the existing rate functions at each sample, and returns `{elapsedMinutes, pressureBar, rateBarPerMin, sourcePressureBar, ...}`. The thermal timeline and chart consume that profile in place of the linear pressure interpolation they use today.

**As built (deviations from the tasks below):** Profile samples are recorded every 1 s rather than every 60 s, and the integrator steps at 0.5 s and always includes the endpoint. The 60 s grid left sub-minute booster transfers drawn as one straight pressure segment (commit `0b7d0ee`). The booster advances receiver moles and caps each step at source exhaustion, so it never moves more gas than the source holds (commit `7f186a2`). The compressor also advances receiver moles by its molar flow and takes pressure from the equation of state, the same as the booster; the earlier `rate * dt` pressure timeline from Task 1 is removed. On a 20→120 bar, 100 L/min, 12 L fixture at 20 °C with van der Waals gas, the old timeline gave a receiver mole gain 2.0% above the inlet molar flow times the fill duration, and the fill now takes 12.58 min instead of 12.33 min. The formula of `calculateCompressorFillRate` is unchanged; it now also returns `molesPerMin`.

**Rate overlay (as built):** Closed-form transfers (decant, salvage, draining, and equalize, which the thermodynamic solver runs as decant, plus any booster without source inventory) previously drew no rate on the pressure chart, which left dashed gaps across each transfer. Each such step with a configured rate now adds one constant-rate span over its transfer window (`rateSpans` in `js/ui/thermal-charts.js`). Profile transfers (booster or compressor with source inventory) keep their per-sample rates. Steps with no configured rate, such as waits and steps that move no gas, stay gaps by design.

**Tech Stack:** Plain JavaScript ES modules, `node:test` for tests, SVG thermal chart in `js/ui/thermal-charts.js`.

**Spec:** None separate. Source of truth is the investigation in this session; the relevant code is cited below.

## Global Constraints

- Do not change `calculateBoosterFillRate` or `calculateCompressorFillRate` formulas in this plan; reuse them.
- Do not raise `maxDiffPixelRatio` in any screenshot test.
- Screenshot baselines under `tests/browser/screenshots.spec.js-snapshots/` MUST NOT be updated until `docs/ci-reproduction.md` is read.
- Never claim GitHub Actions passed from a local run.
- Clean cutover: remove the linear-pressure path for transfer steps once the profile replaces it; no fallback shim.

## Current state (verified)

- Temperature: `js/thermodynamics.js:215-308` integrates at `THERMAL_INTEGRATION_STEP_SECONDS = 0.5`, pushes samples every 60 s, and always appends the endpoint.
- Pressure during transfers: `js/thermodynamics.js:634-660` sets pressure to a linear interpolation between `currentPressureBar` and `transferEndPressureBar` over `transferProgress = elapsed / durationMinutes`. Pressure is therefore not driven by the rate.
- Duration: `js/thermodynamics.js:1117-1119` sets `durationMinutes = pressureIncreaseBar / rateBarPerMin`. The rate is one number per step.
- Booster rate (`calculateBoosterFillRate`, `js/thermodynamics.js:22-75`) depends on source pressure (mean of step start and end), receiver mean pressure (for volumetric efficiency and Z), temperature (Z only), receiver volume, and BPM × cylinder volume. Source-end pressure comes from the optimizer's mole inventory (`js/optimizer.js:497-527`, `sourcePressureAt`), not from the rate function.
- Compressor rate (`calculateCompressorFillRate`, `js/thermodynamics.js:77-107`) depends only on receiver pressure through Z and on receiver temperature. Inlet flow is constant. It does not depend on source pressure.
- Decant, draining, and salvage-decant rates are fixed settings (`js/thermodynamics.js:459-465`, `497-499`, `556-560`). They need no periodic model.
- Chart: `js/ui/thermal-charts.js:116-140` builds per-step samples from `thermal.samples` and falls back to three points. `interpolateThermalSample` is at line 280.

## Decision point (resolve before Task 3)

Two designs for duration:

- **A. Integrated duration (recommended).** Duration becomes the time at which the integrated `pressureBar` reaches `transferEndPressureBar`. The displayed rate and the duration come from the same trajectory. This changes results for boost steps, and the optimizer's stage solve will see different durations, so it needs a regression pass.
- **B. Display-only.** Keep `durationMinutes = ΔP / rate`. The integrated profile is shown but will not end exactly at the step's end pressure, so the plot and the step summary disagree.

Plan below assumes **A**. If the user chooses B, skip Task 3's duration change and add a consistency assertion instead.

## File Structure

- Modify `js/thermodynamics.js`: add `integrateTransferRateProfile` next to `estimateTransferTemperatureSamples`; route boost and top-up transfers through it; use its pressure in the timeline loop at lines 609-672; change duration at lines 1117-1119.
- Modify `js/ui/thermal-charts.js`: carry `rateBarPerMin` through the sample mapping (lines 116-140) and add a rate series to the chart.
- Modify `js/optimizer.js` only if the source volume is not already available to the transfer step (verify in Task 2).
- Test `tests/thermodynamics.test.js`: add profile behavior tests.
- Test `tests/*` for chart mapping only if a pure mapping function is extracted.

## Tasks

### Task 1: Profile integrator (booster and compressor)

**Files:**
- Modify: `js/thermodynamics.js` (new exported `integrateTransferRateProfile`, placed after `estimateTransferTemperatureSamples`)
- Test: `tests/thermodynamics.test.js`

**Interfaces:**
- Consumes: `calculateBoosterFillRate`, `calculateCompressorFillRate`, `estimateTransferTemperatureSamples` (existing), the same `physics`, `cylinder`, `booster`, `thermal` fields used by `rateForProtocolStep`.
- Produces: `integrateTransferRateProfile({ rateSource, startPressureBar, endPressureBar, sourceStartPressureBar, sourceVolumeL, startTemperatureC, ...rateInputs })` returns `{ durationMinutes, samples: Array<{ elapsedMinutes, pressureBar, rateBarPerMin, sourcePressureBar, temperatureC }> }`. Samples are every 60 s plus endpoint, matching the temperature grid.

- [ ] **Step 1: Write failing behavior tests**

```js
test('booster profile ends at the requested receiver pressure', () => {
  const profile = integrateTransferRateProfile(boosterCase({ sourceVolumeL: 50, startPressureBar: 100, endPressureBar: 200 }));
  assert.ok(Math.abs(profile.samples.at(-1).pressureBar - 200) < 0.5);
});

test('booster rate falls as the source drains', () => {
  const { samples } = integrateTransferRateProfile(boosterCase({ sourceVolumeL: 5, sourceStartPressureBar: 80, startPressureBar: 20, endPressureBar: 120 }));
  const rates = samples.map(s => s.rateBarPerMin);
  assert.ok(rates.at(-1) < rates[0]);
});

test('compressor rate depends on receiver temperature at identical pressure and mix', () => {
  const common = {
    inletFlowLPerMin: 100,
    receiverPressureBar: 150,
    receiverOxygenPercent: 21,
    receiverHeliumPercent: 0,
    receiverVolumeL: 12,
    ambientTemperatureC: 20,
    useVdw: false
  };
  const cool = calculateCompressorFillRate({ ...common, receiverTemperatureC: 20 });
  const hot = calculateCompressorFillRate({ ...common, receiverTemperatureC: 60 });
  assert.ok(Math.abs(hot - cool) / cool > 1e-3);
});
```

Use the existing `boosterCase`/`compressorCase` fixtures pattern from `tests/thermodynamics.test.js`; add them if absent.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/thermodynamics.test.js`
Expected: FAIL with `integrateTransferRateProfile is not a function` (or import error).

- [ ] **Step 3: Implement the integrator**

Structure: step on the 0.5 s grid. At each step, recompute each device's rate from that sample's receiver pressure, temperature, and mix: booster via `calculateBoosterFillRate`, compressor via `calculateCompressorFillRate` (receiver pressure, temperature, and mix only). Do not derive the rate by finite-differencing the piecewise-linear pressure samples; that reproduces one constant step rate. Advance receiver pressure by `rate * dt`. For booster, the source is tracked as moles, not pressure. Remove `dn = P_s_abs * Vdot / (Z_s R T)` moles per step, with the same Vdot as the rate function. Source pressure is then computed from the remaining moles by a shared inventory-pressure helper that is extracted from the optimizer's private `sourcePressureAt` closure (`js/optimizer.js`), so the optimizer and the integrator use one calculation. That helper takes the bank's `volumeL`, moles, and gas mix, and evaluates at the optimizer's fixed `ambientTemperatureC` basis. Source pressure must not follow the receiver-temperature samples. `calculatePressureAtTemperature` only changes temperature at fixed inventory, so it is not used to map depleted moles to pressure. Stop when receiver pressure reaches `endPressureBar`; emit a sample at each 60 s boundary and at the endpoint.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/thermodynamics.test.js`
Expected: PASS for the three new tests; existing tests unchanged.

- [ ] **Step 5: Commit**

```bash
git add js/thermodynamics.js tests/thermodynamics.test.js
git commit -m "feat: integrate periodic transfer rate profile"
```

### Task 2: Source volume availability

**Files:**
- Verify: `js/optimizer.js:404` (`sourceVolumeL` on `transferStep`)
- Modify only if missing: `js/thermodynamics.js` step builder that reads `step.sourceVolumeL`

**Interfaces:**
- Consumes: `transferStep.sourceVolumeL` (optimizer).
- Produces: `sourceVolumeL` on every boost step passed into `rateForProtocolStep`.

- [ ] **Step 1: Check the field reaches `rateForProtocolStep`**

Run: `node -e "import('./js/optimizer.js').then(()=>console.log('ok'))"` and then trace `sourceVolumeL` from `optimizer.js:404` into `thermodynamics.js` step data with `lsp` references. If it is absent at the rate call (line 537 path), add it at the step builder.

- [ ] **Step 2: Commit only if a change was needed**

### Task 3: Use the profile for duration and timeline (decision A)

**Files:**
- Modify: `js/thermodynamics.js:1117-1119` (duration), `js/thermodynamics.js:609-672` (timeline loop), `js/thermodynamics.js:1128-1145` (sample source for boost/top-up)
- Test: `tests/thermodynamics.test.js`

**Interfaces:**
- Consumes: `integrateTransferRateProfile` from Task 1.
- Produces: for boost and top-up steps, `durationMinutes` equal to the profile's `durationMinutes`; `transferTemperatureSamples` gain a `rateBarPerMin` and `pressureBar` field; timeline `append` uses `sample.pressureBar` instead of the linear interpolation.

- [ ] **Step 1: Write failing regression tests**

```js
test('boost duration matches integrated profile within 5% for a small transfer', () => {
  const step = boostFixture({ receiverVolumeL: 12, sourceVolumeL: 50 });
  const averageRate = calculateBoosterFillRate(averageInputs(step)).fillRateBarPerMin;
  const avgDuration = (step.pressureIncreaseBar) / averageRate;
  const profile = integrateTransferRateProfile(profileInputs(step));
  assert.ok(Math.abs(profile.durationMinutes - avgDuration) / avgDuration < 0.05);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/thermodynamics.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement**

At lines 1117-1119, for `rateSource` in `booster`, `salvage-booster`, `compressor`, call `integrateTransferRateProfile` and take its `durationMinutes`. Keep decant/draining/salvage-decant on the closed form. At lines 634-660, use `sample.pressureBar` for profile steps. Remove the linear-interpolation branch for those steps.

- [ ] **Step 4: Run tests**

Run: `node --test tests/thermodynamics.test.js`
Expected: PASS.

- [ ] **Step 5: Run the full unit suite**

Run: `npm test` (or the repo's unit command from `docs/development.md`)
Expected: failures limited to results that encode the old duration; list them and review each before updating. Do not update tests that pin incidental wording or numbers without checking the physics.

- [ ] **Step 6: Commit**

```bash
git add js/thermodynamics.js tests/thermodynamics.test.js
git commit -m "feat: derive transfer duration from integrated rate profile"
```

### Task 4: Chart the rate

**Files:**
- Modify: `js/ui/thermal-charts.js:116-140` (carry `rateBarPerMin` on mapped samples), and the chart rendering that uses `interpolateThermalSample` (line 280) to add a rate series.
- Test: a pure mapping helper in `js/ui/thermal-charts.js` if extracted; otherwise rely on Task 5 smoke run.

**Interfaces:**
- Consumes: `thermal.samples[i].rateBarPerMin` from Task 3.
- Produces: a rate series in the chart; `interpolateThermalSample` returns `rateBarPerMin`.

- [ ] **Step 1: Add the field to the mapped sample** (`rateBarPerMin: sample.rateBarPerMin ?? null`).

- [ ] **Step 2: Add a rate series**

Plot on a secondary axis labeled with the unit from `js/units.js` (`pressureBarPerMin`). Do not plot rate for steps with null rate (wait, keep, decant). Keep colors from the existing `TECHNICAL_COLORS` palette.

- [ ] **Step 3: Verify in browser**

Open the app per `docs/development.md`, load a recipe with a booster step, check the rate line falls for a drained source and matches the step summary's rate at transfer end within rounding.

- [ ] **Step 4: Commit**

```bash
git add js/ui/thermal-charts.js
git commit -m "feat: plot periodic transfer pressure rate"
```

### Task 5: Compare path and screenshots

**Files:**
- Review: `js/compare-recipe.js:414-446` (uses average-pressure rate and `estimatedDurationMinutes`).
- Review: `tests/browser/screenshots.spec.js` and its snapshots.

- [ ] **Step 1: Decide the compare path.** Either keep the average-rate estimate and label it as such, or route it through `integrateTransferRateProfile`. Record the choice in the PR description.

- [ ] **Step 2: Screenshots.** Chart changes will alter baselines. Read `docs/ci-reproduction.md` before touching any snapshot. Do not change `maxDiffPixelRatio`. Report local Docker reproduction as evidence only; confirmation requires a pushed Actions run.

### Task 6: Docs and cleanup

**Files:**
- Modify: `docs/architecture.md` (transfer pipeline section) to describe the profile integrator and the duration change.
- Modify: changelog if the repo keeps one.

- [ ] **Step 1: Update docs** describing: the 0.5 s integration, the 60 s sample grid, the rate-driven pressure timeline, and that decant/draining rates remain constant.

- [ ] **Step 2: Remove obsolete code.** The linear-interpolation branch for boost/top-up pressure must be gone (Task 3). Confirm with a search before committing.

## Compressor-specific note

Compressor top-up rate depends on receiver Z and receiver temperature. Inlet molar flow is fixed and there is no source-pressure term. Receiver temperature evolves during a fill (`estimateTransferTemperatureSamples`), so the compressor rate is not constant over a fill. Its size of variation has not been measured yet. Task 1 must quantify it over representative ranges (for example, 20→200 bar at the ambient and heated temperature profiles) before any claim about its magnitude. The plan does not treat the compressor rate as flat; each sample recomputes the rate from that sample's pressure, temperature, and mix.

## Self-review

- Spec coverage: periodic rate for booster (Tasks 1, 3), compressor (Tasks 1, 3, compressor note), plotting (Task 4), investigation of compressor need (compressor note), and the duration decision (decision point).
- Placeholder scan: test fixtures `boosterCase`, `compressorCase`, `boostFixture`, `profileInputs`, `averageInputs` are referenced but must be written in Task 1/3 from existing fixtures in `tests/thermodynamics.test.js`; do not leave them undefined.
- Type consistency: `integrateTransferRateProfile` returns `{ durationMinutes, samples }` with `samples[].{elapsedMinutes, pressureBar, rateBarPerMin, sourcePressureBar, temperatureC}`; Task 3 and Task 4 use the same names.
