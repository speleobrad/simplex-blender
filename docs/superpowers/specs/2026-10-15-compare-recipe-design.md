# Compare Recipe Mode Design

## Goal

Compare mode lets a diver model an ordered sequence of finite Supply-bank operations with the existing gas and thermodynamic model. It reports the entered recipe endpoint and a separate projection after the final gas reaches ambient temperature.

## Scope

Compare mode adds:

1. A switch between the existing Optimize workflow and Compare recipe.
2. An in-memory ordered editor with Keep, Add gas, and Wait rows.
3. Add-gas rows that select an enabled, named Supply bank and infer its composition and inventory data.
4. Linked pressure-added and receiver-target controls for each Add row.
5. Finite, local source-bank accounting and automatic Decant, Equalize, and Boost stage selection.
6. Wait rows that model either a fixed duration or a target pressure and temperature.
7. Manual-protocol result cards, thermal charts, a composition trajectory, and tank summary.

Compare mode does not persist recipes or its local bank consumption, import or export recipes, automatically reorder rows, or alter the Optimize workflow or persisted Supply-bank settings.

## Existing boundaries

- `js/optimizer.js` remains the source of optimized recipes and its behavior is unchanged.
- `js/compare-recipe.js` owns the Compare draft schema, validation, finite bank planning, and conversion to thermodynamic protocol steps.
- `js/thermodynamics.js` remains the single implementation of transfer heating, cooling, pressure-at-temperature projection, and protocol simulation.
- `js/main.js` owns browser state, delegated events, mode switching, and calculation orchestration.
- `js/ui/compare-recipe.js` renders the Compare editor and its inline validation feedback.
- `js/ui/results.js`, `js/ui/thermal-charts.js`, and `js/ui/ternary.js` render the selected mode's result surfaces.
- `js/settings.js`, bank storage, presets, and equipment settings retain their existing persistence format and behavior.

## User flow

The main calculator exposes two modes:

- **Optimize blend**: the existing target-mix workflow, Supply banks, and optimizer-generated protocol.
- **Compare recipe**: the current working-cylinder state, physics model, thermal inputs, and equipment settings remain active while the user edits an ordered manual protocol.

Compare starts with one Keep row. Rows can be added, removed, and moved. Editing a draft does not replace the last valid comparison result.

Rows show fields appropriate to their type:

- **Keep**: retains the current modeled receiver state.
- **Add gas**: selects an enabled Supply bank with a nonblank name. The editor displays the selected bank's inferred O₂/He composition, volume, and current pressure. Entering either **Pressure added** or **Receiver target pressure** updates the other from the receiver pressure at that row.
- **Wait**: uses either a fixed duration in minutes or a target pressure and target temperature.

An Add row consumes only an in-memory copy of its selected Supply bank. The planner rejects transfers that cannot retain the configured source minimum pressure. It automatically uses:

- **Decant** when the source remains at or above the requested receiver target;
- **Equalize**, then **Boost**, when useful source pressure is available before a required boosted finish; or
- **Boost** when equalization is not available.

The selected bank's persisted value is never mutated by Compare. The existing Optimize mode continues to use persisted Supply-bank settings and retains its existing behavior.

## Data model

`js/compare-recipe.js` owns the pure draft schema:

```js
{ id: string, type: 'keep' }

{
  id: string,
  type: 'add',
  bankId: string | null,
  pressureAddedBar: number,
  targetPressureBar: number,
  pressureInputMode: 'added' | 'target'
}

{
  id: string,
  type: 'wait',
  waitMode: 'minutes' | 'target',
  waitMinutes: number,
  targetPressureBar: number | null,
  targetTemperatureC: number | null
}
```

Validation returns stable field errors instead of throwing for editable input. It accepts only enabled, named Supply banks with valid finite inventory and normalizes the linked Add pressure fields against the row's modeled receiver-start pressure. A valid Add target cannot exceed the working-cylinder pressure or be below the current modeled receiver pressure.

Planning copies the selected banks, converts their and the receiver's state to moles, and updates the copied source state after every transfer. A Wait's modeled pressure, temperature, total moles, and composition feed later rows so later Add rows use coherent post-Wait receiver state. Source-bank pressure and minimum inventory use the calculation temperature; receiver addition calculations use the carried receiver temperature after a Wait.

## Thermodynamic behavior

Compare simulation uses the selected gas model, cylinder geometry/material/mass, ambient and inlet-gas temperatures, cooling medium, and equipment rates already used by Optimize.

Each automatic transfer stage carries its source start/end pressure, receiver start/end pressure, resulting mix, rate source, rate, and estimated duration. Compare does not insert an implicit configured wait between stages. A fixed-minute Wait runs cooling for that duration. A target-state Wait solves cooling to the requested pressure and temperature; an unreachable or inconsistent target pair is rejected and leaves the preceding successful result visible.

The simulator returns protocol steps and:

```js
{
  final: {
    recipeEnd: { pressureBar, temperatureC, oxygenPercent, heliumPercent },
    ambientSettled: { pressureBar, temperatureC, oxygenPercent, heliumPercent }
  }
}
```

`recipeEnd` is the state immediately after the final entered row. `ambientSettled` applies the full cool-off projection without adding a visible user-entered row. Optimize's existing simulation contract remains unchanged.

## Result presentation

Compare cards show the planned Decant, Equalize, and/or Boost stages, selected bank name, modeled receiver pressure and mix, transfer rate and duration, and thermal values. Wait cards show the modeled wait state.

Compare results show:

- starting state;
- recipe endpoint; and
- ambient-settled projection.

Optimizer-only accounting is hidden in Compare mode. Thermal graphs, Diagram, and Tank summary render the manual trajectory; Compare intentionally provides no source-bank metadata to the Diagram/Tank summary because the local inventory copy is not persisted.

An invalid draft displays inline errors. A first invalid run has no result; a later invalid run keeps the most recent successful result.

## Error handling and edge cases

- Add and Wait pressures must be finite and in the supported range; an Add target must not exceed cylinder working pressure.
- Wait minutes must be finite and between 0 and 1440. Target wait temperature must be between -100 °C and 100 °C, above ambient, and form a reachable pressure/temperature pair.
- Add rows require a valid enabled, named bank with positive finite volume and valid composition.
- A source must retain the configured minimum pressure after each planned transfer.
- The configured booster maximum limits stages that require Boost.
- Compare recipe state and local source consumption are not persisted; bank settings and Optimize validation remain unchanged.

## Acceptance criteria

1. Users can switch modes without losing the current workflow inputs.
2. Compare drafts support Keep, bank-backed Add gas, and fixed-minute or target-state Wait rows, including editing, reordering, adding, and removing rows.
3. Add gas lists enabled named Supply banks, shows inferred source data, and synchronizes pressure-added and receiver-target values.
4. Finite local source accounting automatically plans Decant, Equalize, and Boost stages while preserving the configured source minimum.
5. Wait results feed subsequent planning, and invalid target-state waits retain the prior successful result.
6. Results distinguish recipe-end and ambient-settled states; Thermal graphs, Diagram, and Tank summary render the Compare trajectory.
7. Compare does not persist a recipe or mutate persisted Supply banks; Optimize remains unchanged.

## Verification

Run `npm test` and `git diff --check`. Serve the application, then verify Compare is usable without an onboarding overlay, enabled Supply-bank selection and inferred details, linked Add pressures, automatic stage cards and unchanged persisted bank data, both Wait modes including retained results after an invalid target pair, all result tabs, and switching back to Optimize.
