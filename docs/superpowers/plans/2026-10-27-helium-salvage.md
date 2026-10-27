# Helium Salvage on Drain Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When the Optimize recipe drains the working tank, move the surplus into a suitable non-pure bank instead of venting when that raises net gas value without hurting any bank's leftover attractiveness.

**Architecture:** Pure modules (`js/leftover-attractiveness.js`, `js/salvage.js`) score and select variants through an injected evaluator. `js/optimizer.js` wraps the static solver: solve baseline, generate vent+cascade variants, re-solve each with mutated banks via the non-thermal solver only (never `optimizeBlend`), pick the winner, then run the existing thermal search on the winner. A new `salvage` protocol step is simulated like a drain.

**Tech Stack:** Browser-native ES modules, `node --test` (`npm test`), Playwright for browser tests (`npm run test:ui:data`). No bundler.

**Spec:** `docs/superpowers/specs/2026-10-27-helium-salvage-design.md` (binding authority; read it fully first).

## Global Constraints

- Selected gas model (`physics.model`, `calcPressure`/`calcMolarDensity` in `js/physics.js`) is authoritative; all salvage maths in moles, never bar·L.
- Prices: `SALVAGE_HE_PRICE_PER_LITRE = 0.075`, `SALVAGE_O2_PRICE_PER_LITRE = 0.007`; `SALVAGE_MIN_VALUE = 1.0`; attractiveness gate `-2.0`; weights 0.4/0.4/0.2; score = `100·(0.4·s_line + 0.4·s_versatility + 0.2·s_energy)`; `SCORE_REFERENCE_HELIUM_LITRES = 1000`; line slope 3.077, decay 15; standard targets 21/35, 18/45, 15/55, 12/65, 10/70.
- `maxPressureBar`: 1–350, ≥ `pressureBar`; missing migrates to `Math.max(200, pressureBar)`; Sample scrap default 200.
- Receivers: enabled, not 100% O₂, not 100% He, not compressor Air.
- Cylinder retention stays primary: do not change the LP retention coefficient; the preservation regression in `docs/development.md` must still pass.
- Salvage never reads Settings or #3 cost data. Optimize only; Compare/What-if and summary tiles unchanged; do not touch screenshot baselines (`docs/ci-reproduction.md`).
- Calculation is side-effect free: never mutate persisted Inventory.
- Do not push; commit on branch `feat/helium-salvage`. Baseline: 450 passing tests.

---

### Task 1: Bank `maxPressureBar` field

**Files:**
- Modify: `js/bank-storage.js`, `js/input-validation.js` (`validateSupplyBankInput`), `js/ui/supply-banks.js`, `index.html` (bank table header, if columns are static), `js/main.js` only where bank edits are parsed/validated
- Test: existing bank-storage/input-validation/inventory suites (find via `grep -l bank tests`), `tests/browser/inventory.spec.js`

**Interfaces:**
- Produces: every bank record has numeric `maxPressureBar`; `validateSupplyBankInput` rejects `maxPressureBar` outside 1–350 or below `pressureBar` with message `Supply bank maximum pressure must be 1–350 bar and at least the current pressure.`

- [ ] **Step 1: Failing tests.** Migration: stored bank without field at 120 bar → 200; at 250 bar → 250; stored with valid field is kept; DEFAULT_BANKS all carry it (Helium 200? use 200 for every default). Validation: reject max 0, 351, non-finite, max < pressure; accept equal. Edit path: lowering max below pressure or raising pressure above max is rejected via the existing rejected-bank-edit warning path.
- [ ] **Step 2:** Run `npm test`; confirm the new tests fail.
- [ ] **Step 3: Implement.** Add field to `DEFAULT_BANKS`, `BANK_FIELDS`-style copy/migrate logic, validation, an editable column (`max pressure in <unit>`, min 1, max 350, step 5, display-converted like `pressureBar`), and keep `isLegacyDefaultBanks` working.
- [ ] **Step 4:** `npm test` all green; `npm run test:ui:data` green (update inventory browser assertions for the new column only; do NOT modify screenshot baselines).
- [ ] **Step 5: Commit** `feat: add per-bank maximum pressure (refs #5)`.

### Task 2: `leftoverAttractiveness`

**Files:**
- Create: `js/leftover-attractiveness.js`, `tests/leftover-attractiveness.test.js`

**Interfaces:**
- Produces: `export const STANDARD_TARGETS` (array of `{oxygenPercent, heliumPercent}`), `export const SCORE_REFERENCE_HELIUM_LITRES = 1000`, `export function leftoverAttractiveness({ oxygenPercent, heliumPercent, pressureBar, volumeL, maxPressureBar, temperatureC = 20 }) → number in [0,100]`. Free-gas litres = `moles × GAS_CONSTANT × (temperatureC + 273.15)` with moles from `calcMolarDensity × volumeL` under `physics`; accept an optional `physics` arg `{ model, temperatureC }` defaulting to ideal at 20 °C.

- [ ] **Step 1: Failing tests (pinned values from spec).** (a) invalid fractions (negative; O₂+He>100) → 0. (b) pressure-dependent reachability with a 350 bar max: pure O₂ reaches 5/5 targets at ≤35 bar and 0/5 above 73.5 bar; pure He reaches 5/5 at ≤122.5 bar and 2/5 at 200 bar. (c) 18/45 at low pressure with large max: all 5 targets reachable → versatility term 1; score ≥ 80. (d) A bank is reachable for target t iff `P · max_x(f_x/t_x) ≤ maxPressureBar` with `t_x = 0 ⇒ f_x = 0`; test boundary equality both sides. (e) energy term clamps to 1 (helium litres ≥ 1000) and is 0 for helium-free gas. (f) monotonic: moving a mix off the line lowers score. (g) a bank at 100 bar, 12 L, max 200 receiving 10 bar of 12/65 (final state computed at the mixed composition and 110 bar) scores about 6 lower; the same bank at 45 bar receiving 50 bar of 12/65 scores about 7 higher.
- [ ] **Step 2:** `node --test tests/leftover-attractiveness.test.js` fails.
- [ ] **Step 3: Implement** exactly per spec §Attractiveness score.
- [ ] **Step 4:** pass; `npm test` green.
- [ ] **Step 5: Commit** `feat: add leftover attractiveness score (refs #5)`.

### Task 3: Pure salvage core (`js/salvage.js`)

**Files:**
- Create: `js/salvage.js`, `tests/salvage.test.js`

**Interfaces:**
- Consumes: `leftoverAttractiveness` (Task 2).
- Produces:
  - constants `SALVAGE_HE_PRICE_PER_LITRE`, `SALVAGE_O2_PRICE_PER_LITRE`, `SALVAGE_MIN_VALUE`, `SALVAGE_ATTRACTIVENESS_GATE = -2`.
  - `isSalvageReceiver(bank) → boolean` (enabled, finite `maxPressureBar`, not pure O₂, not pure He, not compressor).
  - `salvageTransferMoles({ bank, tank, surplusMoles, physics, minimumSourcePressureBar, maxBoosterOutputPressureBar, retainedMoles }) → { movedMoles, stage: 'decant'|'boost'|'decant+boost', receiverEndPressureBar }`: min of surplus, room up to `min(bank.maxPressureBar, maxBoosterOutputPressureBar if boost needed)`, and what the tank can deliver down to `max(minimumSourcePressureBar, retained pressure)`. Decant limited to equalization; boost beyond it.
  - `applyTransferToBank(bank, tankMix, movedMoles, physics) → bank'` (new moles, composition, pressure via the gas model, `volumeL` unchanged).
  - `netStockValue(banks, physics) → number` priced He+O₂ free litres summed over enabled banks.
  - `selectSalvageVariant({ baseline, variants, bankScoresOf }) → winner|null` where each variant is `{ id, salvagedMoles, resolvedSurplusMoles, finalBanks, lpCost, transfers }` and `baseline` is `{ finalBanks }`; applies spec gates in order (feasible `resolvedSurplusMoles ≥ salvagedMoles`; per-bank attractiveness delta ≥ −2 for every bank present in both; net value delta ≥ `SALVAGE_MIN_VALUE`) then rank by net value, then Σ attractiveness delta, then lowest `lpCost`. Pure; never calls the optimizer.
  - `rankReceivers(candidates) → sorted by delta attractiveness of the receiving bank right after transfer`.

- [ ] **Step 1: Failing tests** with hand-computed ideal-gas fixtures: transfer caps (surplus-limited, bank-max-limited, equalization-only decant when booster not needed, booster minimum source pressure leaves remainder vented); receiver eligibility truth table; net value counts moves through displaced draws only (a receiver that is also fully drawn yields ≈0 net, not gross); selection: infeasible variant dropped, attractiveness-violating variant dropped, below-min-value dropped, tie-breaking order, `null` when none qualifies.
- [ ] **Step 2:** fail. **Step 3:** implement. **Step 4:** pass, `npm test` green.
- [ ] **Step 5: Commit** `feat: add pure salvage selection core (refs #5)`.

### Task 4: Optimizer integration and thermal step

**Files:**
- Modify: `js/optimizer.js` (static path `optimizeBlendWithoutThermal` and the thermal wrapper), `js/thermodynamics.js` (`rateForProtocolStep` and step handling for `type: 'salvage'`)
- Test: `tests/optimizer.test.js`, `tests/thermodynamics.test.js`

**Interfaces:**
- Consumes: Task 1 field, Task 3 exports.
- Produces: `optimizeBlendWithoutThermal(input)` accepts internal option `input._salvage !== false` (default on). When a drain exists and a variant wins, result `protocolSteps` contain, first in the protocol, in cascade order, BEFORE the vent `drain` step (each salvage step lowers the tank by its moved moles; the vent `drain` step then drops the tank from its post-salvage pressure to the retained pressure, and is omitted if nothing remains to vent), one step per receiver: `{ type: 'salvage', stage: 'decant'|'boost', receiverBankId, receiverBankName, movedMoles, movedHeliumLitres, receiverStartPressureBar, receiverEndPressureBar, receiverStartMix, receiverEndMix, title, recipeLabel, description, resultingPressureBar, resultingMix }`. `resultingPressureBar` is the tank pressure after that transfer; `resultingMix` is the working tank's unchanged mix. Result also carries `salvageTransfers` (same objects, minus presentation) and `salvageBanks` (banks after salvage, projected, not persisted). Salvage steps add no trajectory point. `heliumVentedLitres` is reduced by helium moved. Helium-salvaged tile semantics unchanged.

- [ ] **Step 1: Failing tests.** (a) the preservation regression (12 L, 80 bar, 21/35 → 210 bar, 18/45) still starts with retention, no salvage step; (b) a drain case with a receivable non-pure bank with room and attractive result yields a `salvage` step and smaller vented helium; (c) a receiver whose transfer loses a reachable target (100 bar, 12 L, max 200 bank receiving 12/65 gas) vents instead; (d) bank at its `maxPressureBar` receives nothing; (e) no enabled eligible banks → byte-identical result to baseline; (f) receiver also a recipe source: result is internally consistent (bank end pressure matches); (g) salvage disabled via `_salvage:false` → baseline; (h) thermal: salvage step cools the tank (pressure falls, temperature does not rise), duration uses decant rate (`decant` stage) or booster fill-rate model with tank-side pressure derived by moles conservation (`boost`), and the thermal wrapper's winner is chosen once; if the thermal search rejects the winner as infeasible while baseline is feasible, fall back to baseline (test this).
- [ ] **Step 2:** fail. **Step 3: Implement.** Variants re-solve through the non-thermal solver only (no recursion into `optimizeBlend`); N+1 solves max. **Step 4:** `npm test` green; record before/after wall time of one default Optimize run in the report.
- [ ] **Step 5: Commit** `feat: salvage drained gas into leftover banks (refs #5)`.

### Task 5: Results cards, interim re-plans, docs

**Files:**
- Modify: `js/ui/results.js`, `js/plan-with-readings.js`, `js/interim-measurements.js` if it enumerates step types, `docs/optimizer.md`, `docs/architecture.md`, `docs/UI.md`, `docs/development.md` (add a browser smoke step)
- Test: `tests/results.test.js`, `tests/plan-with-readings.test.js`, `tests/interim-check.test.js`

**Interfaces:**
- Consumes: Task 4 `salvage` step fields, `salvageBanks`, `salvageTransfers`.
- Produces: salvage cards show receiver name, moved helium (litres in the user's units), receiver before/after pressure and mix; no interim-reading slot for salvage steps; `planWithReadings` applies the base plan's `salvageBanks` to its working banks and calls the optimizer with `_salvage: false` for every re-plan.

- [ ] **Step 1: Failing tests** (card rendering via existing results test harness; reading slots absent for salvage; re-plan after a reading keeps the salvage steps and does not salvage a second time; source-bank accounting unchanged).
- [ ] **Step 2–4:** implement; `npm test` green.
- [ ] **Step 5:** Update the three docs per spec; run `npm run test:ui:blending` and `npm run test:ui:results` locally (do not edit baselines; report any screenshot diffs instead).
- [ ] **Step 6: Commit** `feat: show salvage steps and keep them in re-plans (refs #5)`.

---

## Self-Review

Spec coverage: bank field → T1; score → T2; gates/prices/transfer → T3; variant search, thermal, fallback, retention invariant → T4; protocol cards, re-plans, docs → T5. Spec risk "booster rate on reversed flow" is verified in T4 test (h). Names are consistent across tasks (`salvage`, `salvageBanks`, `salvageTransfers`, `_salvage`).
