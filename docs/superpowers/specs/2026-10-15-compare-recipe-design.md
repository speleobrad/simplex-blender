# Compare Recipe Mode Design

## Goal

Add a Compare recipe mode that lets a user transcribe an ordered recipe from another application and run that recipe through Simplex blender's existing gas and thermodynamic model. The mode must show the modeled state at the end of the entered recipe and a separate projection after the final gas reaches ambient temperature.

## Scope

Compare mode adds:

1. A mode switch between the existing optimizer workflow and Compare recipe.
2. An in-memory ordered recipe editor with Keep, Drain, Add gas, and Wait rows.
3. Existing gas-preset selection plus per-row custom gas composition.
4. A transfer-method selector for every Add gas row: Decant, Boost, or Compressor.
5. A required source-pressure input for Boost rows.
6. Explicit wait rows whose durations are taken literally.
7. Thermodynamic simulation of the manually entered protocol using the existing physics, thermal, and equipment settings.
8. Recipe-end and ambient-settled result summaries, protocol cards, thermal charts, and composition trajectory output.

Compare mode does not add recipe persistence, JSON import/export, finite source-bank accounting, optimizer reordering, or a side-by-side optimizer comparison.

## Existing boundaries

- `js/optimizer.js` remains the source of automatically optimized recipes and its behavior is unchanged.
- `js/thermodynamics.js` remains the single implementation of transfer heating, cooling, pressure-at-temperature projection, and protocol simulation. It gains explicit compare-protocol support without a second thermal engine.
- `js/main.js` remains responsible for browser state, delegated events, mode switching, and calculation orchestration.
- `js/ui/results.js` remains responsible for protocol-card and summary markup.
- `js/ui/thermal-charts.js` remains responsible for synchronized thermal charts and accessible data tables.
- `js/ui/ternary.js` remains responsible for the composition diagram and trajectory rendering.
- `js/settings.js`, gas presets, cylinder presets, and equipment settings retain their existing storage format and persistence behavior.

## User flow

The main calculator exposes two modes:

- **Optimize blend**: the current workflow, including target pressure, target mix, supply banks, and optimizer-generated protocol.
- **Compare recipe**: the current working-cylinder state, selected physics model, thermal inputs, and equipment settings remain active, while the user edits an ordered manual protocol.

Compare mode provides a recipe editor with:

- Add row
- Remove row
- Move row up
- Move row down
- Run comparison

The editor starts with one Keep row. The first row may be changed to Drain or removed and replaced with another valid row. Compare mode never inserts an optimizer-generated drain or transfer.

Rows are rendered in order and show only fields relevant to their type:

- **Keep**: retain the current tank pressure and composition.
- **Drain**: enter the receiver pressure after venting. Gas composition remains unchanged.
- **Add gas**: select a saved gas preset or choose Custom, enter or edit the gas name and O₂/He percentages, enter the receiver pressure after the addition, and select Decant, Boost, or Compressor.
- **Wait**: enter a duration in minutes.

A custom gas must have finite O₂ and He percentages in the existing supported ranges, with O₂ + He <= 100%. Nitrogen is the complement. A saved preset populates the same values but remains directly editable; editing a preset-backed row changes only that row.

An Add gas row using Compressor is valid only for Air (21% O₂, 0% He). Decant and Boost accept any valid gas composition. A Boost row requires a finite source pressure greater than zero and within the existing supported pressure range. Compare mode treats that source pressure as constant during the transfer; it does not model source-cylinder depletion because no finite source volume is part of the compare input.

Rows are draft state. Editing, adding, removing, or reordering rows does not replace the last valid comparison result. Run comparison validates the complete draft; invalid rows receive inline messages and the previous valid comparison output remains visible. A successful run replaces the comparison output and switches the result view to Recipe.

Switching back to Optimize blend restores the existing optimizer inputs and orchestration. Switching modes does not alter saved settings, supply banks, or optimizer form values.

## Data model

`js/compare-recipe.js` owns the pure draft schema and conversion helpers. Draft rows use a discriminated shape:

```js
{
  id: string,
  type: 'keep'
}

{
  id: string,
  type: 'drain',
  targetPressureBar: number
}

{
  id: string,
  type: 'add',
  gas: {
    presetName: string | null,
    name: string,
    oxygenPercent: number,
    heliumPercent: number
  },
  targetPressureBar: number,
  method: 'decant' | 'boost' | 'compressor',
  sourcePressureBar: number | null
}

{
  id: string,
  type: 'wait',
  waitMinutes: number
}
```

The module validates rows independently and as an ordered recipe. It returns stable field errors rather than throwing for user-editable invalid values. It also normalizes preset-backed rows into explicit gas values before simulation.

The converter receives the current cylinder state and turns the draft into protocol data consumed by the thermodynamic simulator. It calculates receiver composition after each Add gas row using the selected physics model and cylinder volume:

1. Convert the current receiver pressure/composition to moles.
2. Convert the requested receiver pressure/composition to moles.
3. Add the required gas moles for an Add row.
4. Update cumulative O₂, He, and total moles.
5. Convert cumulative composition to the protocol's resulting mix.

Drain removes moles proportionally, leaving the composition unchanged. Keep and Wait leave moles and composition unchanged. Pressure values are gauge pressures everywhere in the UI and protocol, matching the existing calculator contract.

The normalized protocol preserves row identity and carries:

- `type` and `operation`;
- receiver start/end pressure;
- resulting O₂/He mix;
- source O₂/He mix for transfers;
- source pressure for Boost;
- explicit wait duration for Wait rows.

## Thermodynamic behavior

Compare simulation uses the selected gas model, cylinder geometry/material/mass, ambient temperature, inlet-gas temperature, cooling medium, and equipment rate settings already used by the optimizer.

Unlike optimizer protocols, Compare mode does not insert configured waits between transfer rows. A Wait row is the only finite inter-step wait. This makes the entered order and timing authoritative.

Transfer rows use the selected method:

- Decant uses the configured manual decant rate selected by source oxygen concentration.
- Boost uses the existing booster-rate model and the required constant source pressure.
- Compressor uses the existing compressor rate model and is restricted to Air.

A Wait row performs cooling at fixed receiver pressure for its requested duration and records the pressure decrease caused by cooling. Drain rows use the configured draining rate and signed thermal transfer behavior. Keep rows perform no transfer and no wait.

The simulator returns:

```js
{
  protocolSteps: [...],
  final: {
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
    }
  }
}
```

`recipeEnd` is the state immediately after the last entered row. If the last row is a Wait, it is the state after that explicit wait. If the last row is a transfer, it is the hot transfer-end state. `ambientSettled` applies the existing full cool-off projection to the recipe-end state without inventing another user-entered protocol row.

The existing optimizer simulation contract remains compatible: its configured final cool-off and thermal summary continue to behave as they do today.

## Result presentation

Compare protocol cards use the existing step-card surface and show:

- Entered operation and gas name.
- Modeled receiver pressure and resulting O₂/He mix.
- Transfer rate source, rate, and duration for transfer rows.
- Transfer-end pressure and temperature.
- Explicit wait duration and after-wait pressure and temperature for Wait rows or rows with modeled cooling data.

The Compare summary replaces optimizer accounting with:

- Starting state.
- Recipe endpoint state.
- Ambient-settled projection.

Optimizer-only values—retained pressure, vented gas litres, helium salvaged, source-bank leftovers, and feasibility diagnostics—are hidden in Compare mode rather than filled with synthetic values.

Thermal graphs include drain, transfer, and Wait rows. The recipe endpoint and ambient-settled projection are represented as semantic key points and remain available in the accessible data table. The composition diagram and Tank summary use the manually simulated trajectory and omit bank-source metadata when no finite bank exists.

Invalid compare drafts clear no existing valid output. An invalid first run shows the editor errors and an empty compare result area; a later invalid edit retains the most recent successful result.

## Error handling and edge cases

- O₂/He values must be finite and non-negative; their sum must not exceed 100%.
- Pressures must be finite and within the existing calculator supported range. Drain targets must not exceed the current modeled receiver pressure; Add targets must not be below it; Keep has no target pressure.
- Wait duration must be finite and between 0 and 1440 minutes.
- Boost source pressure is required, finite, positive, and within the supported pressure range.
- Compressor rows reject non-Air compositions with an inline error.
- A recipe with no rows after editing is invalid and cannot run.
- Zero-pressure changes produce zero transfer duration and no transfer-rate claim.
- Cooling pressure projection is clamped to non-negative gauge pressure, matching existing behavior.
- Existing optimizer validation, safety limits, source-bank rules, and localStorage formats remain unchanged.

## Acceptance criteria

1. Users can switch between Optimize blend and Compare recipe without losing either workflow's current form values.
2. A Compare draft can contain Keep, Drain, Add gas, and Wait rows, and rows can be edited, reordered, added, and removed.
3. Add gas rows support saved gas presets and custom named O₂/He compositions.
4. Decant, Boost, and Compressor methods select the existing configured rate models; Boost requires source pressure and Compressor accepts only Air.
5. The simulator preserves the entered order and explicit waits, calculates cumulative receiver composition, and exposes per-step thermal results.
6. Results show the state at the entered recipe endpoint and the separate fully ambient-settled projection.
7. Thermal graphs and the composition trajectory include manual rows and both endpoint states.
8. Invalid drafts show actionable inline errors without replacing the last successful comparison result.
9. Existing optimizer tests and behavior remain passing and unchanged.
10. No in-progress compare recipe is persisted; existing settings and preset persistence remain unchanged.

## Verification

Use test-first coverage in the existing Node test runner:

- `tests/compare-recipe.test.js` covers row validation, preset/custom normalization, ordering, pressure/composition conversion, and method constraints.
- `tests/thermodynamics.test.js` covers explicit Wait rows, recipe-end versus ambient-settled output, and compare transfer methods while retaining optimizer regressions.
- `tests/results.test.js` covers compare summary and cards without optimizer-only accounting.
- `tests/thermal-charts.test.js` covers compare endpoint/settled key points and manual wait rows.
- Existing optimizer, physics, ternary, settings, and input-validation tests remain passing.

Run `npm test`, then serve the app with `python3 -m http.server 8000` and smoke-test mode switching, a Keep → Drain → Add gas → Wait → Add gas recipe, invalid Boost/Compressor rows, Recipe results, Thermal graphs, Diagram, Tank summary, and switching back to the optimizer workflow. Update `docs/architecture.md`, `docs/development.md`, and `README.md` only with behavior that is implemented and verified.
