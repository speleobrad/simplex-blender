# What-if Scenario Design

## Goal

What-if lets a diver copy the current working tank from Blending, choose or edit an independent starting state and cylinder, define an exact manual sequence of blending operations, and inspect the modeled result through the same result surfaces used by Blending.

The feature is a scenario planner, not a second optimizer. It has no target blend or target pressure. The entered sequence is the scenario's source of truth.

## Scope

What-if adds or changes:

1. An independent scenario-owned starting tank initialized from Blending on first entry.
2. Editable scenario starting values for current pressure, O₂%, He%, ambient temperature, cylinder preset, surrounding medium, and in-water temperature.
3. An explicit `Copy from Blending` action that replaces the scenario starting values without continuously linking the two screens.
4. A manual sequence editor for drain, add-gas, and explicit wait steps.
5. Shared run-time use of current Supply banks, equipment configuration, physics model, pressure-limit policy, units, and theme.
6. An explicit `Run scenario` action with stale-result handling.
7. A full right-side result surface with Summary, Recipe, Thermal Graph, In-water pressure, Tank summary, and Simplex diagram tabs.
8. Manual recipe technical details and thermodynamic calculations without `Record actual` controls.
9. Ambient-settled and in-water terminal projections for the manually defined scenario.
10. Source-bank start/end information and a manual gas-composition trajectory.

What-if does not add target optimization, recipe persistence, automatic source-bank depletion, implicit waits inherited from Blending, actual-reading capture, or mutation of persisted Supply-bank data.

## Existing boundaries

- `js/compare-recipe.js` remains the core manual drain/add/wait schema, validation, finite source accounting, and protocol construction. It is extended only where needed for the scenario contract and source-bank summaries.
- `js/thermodynamics.js` remains the single implementation of transfer heating, cooling, pressure-at-temperature projection, and protocol simulation.
- `js/main.js` owns browser state, scenario lifecycle, delegated events, shared-input signatures, run orchestration, and screen navigation.
- The What-if editor owns scenario starting-state controls and manual row presentation.
- Result rendering is extracted behind a reusable result-panel contract so Blending and What-if do not maintain separate result DOM or rendering behavior.
- `js/ui/results.js`, `js/ui/thermal-charts.js`, `js/ui/water-pressure.js`, and `js/ui/ternary.js` remain responsible for result presentation and calculations specific to their surfaces.
- Settings, Supply-bank storage, presets, and existing persistence formats remain unchanged.
- Optimize behavior and target-blend accounting remain unchanged.

## User flow

### Entering What-if

On the first entry into What-if, the application copies the current Blending working-tank values and selected cylinder into the scenario. The copy includes:

- current pressure;
- current O₂ percentage;
- current He percentage;
- ambient temperature;
- selected cylinder preset;
- surrounding medium;
- in-water temperature.

The scenario is thereafter independent. Navigating between Blending and What-if does not resnapshot values. What-if provides an explicit `Copy from Blending` action for a deliberate replacement.

The What-if screen does not show target pressure, target O₂, target He, or any other target-blend control.

### Editing and running

The left side contains:

1. **Starting tank** — copied status, Copy from Blending, pressure, O₂, He, and cylinder preset/rating.
2. **Scenario conditions** — ambient temperature, surrounding medium, and in-water temperature.
3. **Manual steps** — ordered drain, add-gas, and wait rows, with add/remove/reorder controls.
4. **Run scenario** — validates and executes the complete draft.

What-if uses an explicit run. Draft changes mark the prior result out of date but do not destroy it. A successful run atomically replaces the result. A failed run displays field-level errors and preserves the most recent successful result.

There is no global wait inherited from Blending. A wait occurs only when the user adds a Wait row and defines either a fixed duration or a reachable target temperature.

### Right-side results

The right side uses a result-tab navigation similar to Blending:

1. **Summary**
2. **Recipe**
3. **Thermal Graph**
4. **In-water pressure**
5. **Tank summary**
6. **Simplex diagram**

The Recipe tab displays the manually defined sequence and the calculated stages/details required to execute it. It omits `Record actual` because the sequence is already defined by the scenario.

On narrow screens, the editor is shown before the complete result panel. Result tabs remain keyboard-operable and horizontally scrollable.

## State model

The browser state owns an independent scenario draft:

```js
{
  initialized: false,
  start: {
    pressureBar,
    oxygenPercent,
    heliumPercent,
    ambientTemperatureC,
    cylinderPresetName,
    coolingMedium,
    inWaterTemperatureC
  },
  rows: [],
  result: null,
  draftRevision: 0,
  resultRevision: -1,
  sharedInputSignature: null
}
```

The scenario starting values and rows are not persisted. The selected cylinder preset is scenario-owned, but its current definition is resolved from shared Settings when the scenario runs. If the selected preset is removed or otherwise invalid, What-if reports the problem instead of silently falling back to another preset.

Scenario rows store Supply-bank IDs, not copied bank values. At run time, the current enabled Supply-bank records are resolved. This means later changes to bank pressure, composition, enabled state, or existence affect the next run. A selected bank is never silently replaced.

Shared run-time inputs are:

| Input | Ownership and behavior |
|---|---|
| Starting pressure, O₂%, He%, ambient temperature | Independent scenario values |
| Cylinder selection | Independent scenario selection; preset definition resolved from shared Settings |
| Surrounding medium | Independent scenario value |
| In-water temperature | Independent scenario value |
| Manual rows and explicit waits | Independent scenario values |
| Supply-bank records | Shared and read at run time |
| Compressor/booster limits and rates | Shared and read at run time |
| Physics model and pressure-limit policy | Shared and read at run time |
| Units and theme | Shared presentation settings |

A run records a signature of the shared values used. If shared inventory, equipment, settings, or a selected preset changes after a run, the result remains visible as a historical projection but is marked `Out of date — shared inputs changed` until rerun.

## Calculation contract

A successful run performs these stages:

1. Resolve the selected cylinder from current shared Settings.
2. Resolve current enabled Supply banks and shared equipment limits.
3. Validate the independent starting state and cylinder limits.
4. Validate and normalize the ordered manual rows.
5. Build the manual protocol using the existing Compare planner.
6. Simulate transfer, drain, and explicit wait thermal behavior.
7. Calculate the final recipe-end state.
8. Calculate the ambient-settled projection after the final scenario step.
9. Project the ambient-settled final state to the explicit in-water temperature.
10. Produce technical step data, source-bank start/end states, and composition trajectory data.
11. Collect pressure-limit warnings using the current shared policy.
12. Commit the complete result only after every calculation succeeds.

The scenario's final states have this shape:

```js
{
  recipeEnd: {
    pressureBar,
    temperatureC,
    oxygenPercent,
    heliumPercent
  },
  ambientSettled: {
    pressureBar,
    temperatureC,
    oxygenPercent,
    heliumPercent
  },
  inWater: {
    pressureBar,
    temperatureC,
    oxygenPercent,
    heliumPercent
  }
}
```

The in-water projection uses the thermodynamic pressure-at-temperature calculation from the ambient-settled final state. It does not compare against a target pressure or target mix.

A What-if run consumes only an in-memory copy of each selected finite source bank. Persisted Supply-bank records are never changed. Source-bank output includes the source state before and after the modeled transfers so Tank summary can explain the scenario without implying inventory persistence.

The simulator does not insert a configured wait between operations. Transfer and drain rows have no implicit cool-off. Explicit Wait rows model fixed-minute cooling or cooling to a reachable target temperature. A wait target below ambient or above the current transfer temperature is rejected.

## Result contract

The reusable result panel accepts a mode-specific result contract rather than querying Blending-only element IDs.

### Summary

Summary reports:

- scenario start state;
- recipe-end state;
- ambient-settled state;
- in-water projection and temperature;
- total transfer/wait duration;
- maximum modeled temperature;
- pressure-limit and shared-input warnings.

Optimizer-only values such as retained gas, vented gas, helium salvaged, target match, and target-pressure feasibility are not shown.

### Recipe

Recipe renders every user-defined row and every calculated execution stage, including:

- operation and source gas;
- receiver start/end pressure;
- resulting mix;
- transfer method;
- rate and duration where applicable;
- hot transfer pressure and temperature;
- pressure and temperature after the explicit wait;
- source-bank leftover pressure where applicable;
- technical warnings.

`Record actual` controls are not rendered for What-if.

### Thermal Graph

The graph renders transfer and explicit wait periods, then the ambient-settled and in-water projection points. Its data table identifies the scenario step and phase for each point.

### In-water pressure

The pane reports the final projected pressure at the explicit scenario in-water temperature. It must not label that value as a target or imply that the manual scenario achieved an optimizer target.

### Tank summary

Tank summary reports working-tank states at the start and each modeled stage, together with source-bank start/end values for banks used by the scenario. It does not invent target reference mixes.

### Simplex diagram

The diagram uses the starting mix and each resulting stage mix. It is rendered only when every plotted composition is valid simplex data. Otherwise the pane remains available and explains why no diagram can be shown.

## Errors and stale results

- Starting pressure must be finite, non-negative, and within the supported pressure range and active cylinder policy.
- O₂ and He must be valid finite percentages whose sum does not exceed 100%.
- Ambient and in-water temperatures must be within their supported input ranges.
- Every selected finite bank must be enabled, named, valid, and present at run time.
- Add targets must not exceed the active cylinder/equipment ceilings or move below the modeled receiver pressure.
- A finite source must retain the configured minimum pressure after each transfer.
- Wait minutes and target temperatures must be finite and supported; target cooling must be physically reachable.
- Pressure-limit warnings identify the scenario step and current shared policy.
- A first invalid run has no result. A later invalid run preserves the last successful result and marks it stale.
- A shared-input change after a successful run marks that result stale without silently recalculating it.
- Missing or disabled banks identify the affected row and never fall back to another source.

## Implementation boundaries

The implementation should introduce a scenario controller/model boundary rather than adding more What-if-specific conditions to the optimizer path. The manual protocol core remains reusable.

The result surface should be extracted into a reusable component/renderer with a scoped root or equivalent result contract. Blending and What-if must not maintain divergent copies of the result markup or hard-coded renderer behavior.

The existing Compare result path should be adapted to provide a complete scenario result contract. The main calculation change is the explicit in-water terminal projection and source-bank summary metadata; a second drain/add/wait simulator is prohibited.

## Verification

Unit tests should cover:

- first-entry snapshot independence from later Blending edits;
- explicit Copy from Blending replacement;
- absence of target-blend dependencies;
- explicit wait-only cooling behavior;
- current shared-bank resolution at run time;
- missing/disabled bank errors;
- explicit-temperature in-water projection;
- source-bank summaries and simplex trajectory;
- stale-result detection for draft and shared-input changes;
- preservation of the last successful result after a failed rerun.

Browser tests should cover:

1. Populate Blending, enter What-if, and verify the copied starting state.
2. Edit What-if values and verify Blending remains unchanged.
3. Select a different cylinder and surrounding medium.
4. Define drain, add, and explicit wait rows.
5. Run and inspect Summary, Recipe, Thermal Graph, In-water pressure, Tank summary, and Simplex tabs.
6. Confirm technical details are present and Record actual controls are absent.
7. Change a shared bank after a run and verify the result is stale.
8. Remove or disable a selected bank and verify the affected row is reported.
9. Verify keyboard navigation, tab exclusivity, responsive layout, and clean runtime output.

Documentation should update the UI and architecture documentation to describe What-if as an independent scenario with shared run-time inventory/equipment inputs, not as another optimizer mode.

## Acceptance criteria

1. What-if initializes from Blending once, then remains independent until the user explicitly copies from Blending again.
2. What-if exposes only the scenario-relevant starting and condition inputs: pressure, O₂%, He%, ambient temperature, cylinder, surrounding medium, and in-water temperature.
3. What-if supports ordered drain, add-gas, and explicit wait rows without inheriting a global wait.
4. Runs use current shared Supply banks and equipment without mutating persisted inventory or settings.
5. Results distinguish recipe-end, ambient-settled, and explicit-temperature in-water states.
6. The right side exposes Summary, Recipe, Thermal Graph, In-water pressure, Tank summary, and conditionally usable Simplex views.
7. Manual Recipe results include technical calculations and omit Record actual controls.
8. Invalid drafts and changed shared inputs are visible without silently discarding the last valid result.
9. Blending's existing optimizer behavior and result presentation remain intact.
10. Unit and browser verification covers the specified state, calculation, result, stale-input, and accessibility behavior.
