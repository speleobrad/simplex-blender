# UI Layout, Thermal Interaction, and Equipment Settings

## Status

Approved design; pending written-spec review.

## Goal

Improve the calculator's visual grouping and make thermal chart data directly navigable between SVG points and the table, without changing calculation behavior or persisted setting semantics.

## Scope

The change covers:

- Working-tank responsive field grouping.
- Supply-bank transfer-condition typography.
- Bidirectional thermal chart/table highlighting.
- Settings category navigation and equipment sub-sections.
- Documentation and browser smoke coverage for the visible behavior.

The optimizer, thermal equations, input contracts, storage keys, defaults, validation bounds, and save/cancel draft workflow remain unchanged.

## Approved behavior

### Working tank

The working-tank thermal controls use two logical rows:

1. `Surrounding medium` and `Ambient / calculation temperature`.
2. `Wait between fills` and the active wait value (`Wait time` or `Target temperature`).

The rows use two columns from the small breakpoint upward and stack on narrow screens. Existing labels, units, conditional wait-mode behavior, and recalculation triggers remain unchanged.

### Supply banks

The `Transfer conditions` subsection retains the shared incoming-gas temperature field and explanatory text. Its labels and select/control typography match the working-tank settings: sans-serif labels and controls, with monospaced numeric values where appropriate. The value remains independent from ambient temperature and continues to feed `thermal.inletTemperatureC`.

### Thermal chart and table synchronization

`buildThermalSeries` remains the source of point order and values. Each rendered point in the temperature chart, pressure chart, and data-table row receives the same point index.

- Hovering a chart point highlights the corresponding table row and matching point in both charts.
- Hovering a table row highlights the corresponding points in both charts.
- Keyboard focus on a chart point or table row produces the same highlight.
- Leaving the active point/row clears the highlight.
- SVG points are focusable and expose an accessible label containing step, phase, elapsed time, temperature, and pressure.
- The interaction is event-delegated and does not register duplicate listeners across recalculations.
- Point order, series values, chart domains, and rendered table values do not change.

### Settings categories

The settings dialog uses a responsive vertical category rail on wide screens and a horizontally scrollable category row on narrow screens. The categories are:

1. **Model** — persisted gas-model selector.
2. **Gas presets** — current editable gas-preset list and add/remove actions.
3. **Cylinder presets** — current editable cylinder-preset list and add/remove actions.
4. **Equipment** — grouped equipment settings.

The selected category controls which content pane is visible. Category selection is transient UI state and does not alter the settings draft or persistence format. Re-rendering preset rows preserves the selected category.

Equipment contains three visible sub-sections:

- **Compressor**
  - Compressor inlet flow.
  - Maximum compressor pressure.
  - Compressor temperature modifier.
- **Booster**
  - Booster cylinder volume.
  - Mix source gas minimum pressure (existing `minimumSourcePressureBar` setting).
  - Oxygen boost speed.
  - Other-gas boost speed.
  - Booster temperature modifier.
  - Existing maximum booster output pressure, retained because the optimizer enforces it.
- **Decanting hose**
  - Oxygen manual decant rate.
  - Other-gas manual decant rate.
  - Draining rate.

All controls keep their existing `data-settings-collection`, `data-settings-field`, numeric bounds, units, and persisted property names. Only visible grouping and labels change.

## Implementation boundaries

- `scuba_gas_remixer_simplex_optimizer.html` owns static layout and settings category/pane markup.
- `js/main.js` owns delegated category selection and keeps settings draft updates unchanged.
- `js/ui/settings-dialog.js` owns dynamic preset rows and equipment field value refreshes.
- `js/ui/thermal-charts.js` owns point metadata, accessible point controls, and synchronized highlight event delegation.
- `css/app.css` owns reusable thermal active-state and responsive category styling.
- `docs/architecture.md` and `docs/development.md` document the new UI responsibilities and browser checks.

No new runtime dependency or bundler is introduced.

## Verification

1. Run `npm test` and confirm all existing Node tests pass.
2. Serve the project with `python3 -m http.server 8000`.
3. Open the calculator and verify:
   - Working-tank fields form the requested pairs at desktop width and stack at narrow width.
   - Supply-bank transfer-condition typography matches working-tank settings.
   - Settings categories navigate correctly, equipment fields appear under the requested sub-sections, and save/cancel behavior remains intact.
   - Hovering/focusing any thermal chart point highlights the matching table row and both-chart points; hovering/focusing the row highlights both chart points.
   - Invalid input still clears thermal output.
4. Confirm the browser console has no application module/runtime errors.
