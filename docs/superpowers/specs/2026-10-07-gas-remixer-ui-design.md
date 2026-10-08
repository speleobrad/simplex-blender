# Gas Remixer UI Redesign — Design

## Goal

Simplify the gas remixer interface, add user-managed gas and cylinder-volume presets, make cylinder mix entry faster, and make the ternary diagram clearly distinguish feasible mixes while keeping the complete mixing path visible during zoom.

## Current shape

The page is a browser-native ES-module application. `js/main.js` owns event delegation, form parsing, current bank state, and calculation orchestration. `js/ui/supply-banks.js` renders the editable bank table, `js/ui/results.js` renders the recipe/status, and `js/ui/ternary.js` draws the canvas diagram. There is no settings UI or persistence. The current ternary boundary is the full O₂/N₂/He simplex, although mixes without an available source gas can lie outside the region reachable from air, pure O₂, and pure He.

## Chosen approach

Keep the existing static-page and native-module architecture. Add an accessible native `<dialog>` for configurable presets, save those settings in `localStorage`, and use native form controls for preset choice and custom entry. Do not add a framework, server, or dependency. Preserve current blend calculations, solver behavior, and bank-editing workflows.

## Settings and preset behavior

The dialog has two editable preset lists:

- Gas presets: name, oxygen percentage, and helium percentage. Nitrogen remains the remainder, as in the existing bank data model.
- Cylinder volumes: positive values in litres.

Seed the gas list with Air (21/0), EAN32 (32/0), Tx 18/45, Tx 21/35, pure O₂ (100/0), and pure He (0/100). Seed the volume list with 3, 5, 7, 10, 12, 15, 18, and 24 L. Users can add, edit, and remove entries. Persist both lists in `localStorage`; if no saved settings exist, use the defaults. Removing a preset must not change any currently entered mix or cylinder volume.

Gas presets are selectable for the cylinder's current mix, target mix, and each supply bank. Choosing a preset fills its O₂ and He values; those values remain directly editable afterward. Bank names remain editable. Preset selection must not lock numeric gas fields or alter pressure, volume, enabled state, or bank availability.

The cylinder capacity control offers configured volumes while accepting a typed custom numeric value. Its calculation value remains the current numeric cylinder volume; preset membership is not required.

The current and target cylinder compositions remain separate O₂ and He fields. Typing `/` in an O₂ field keeps the O₂ value and moves focus to its paired He field. Pasting a value such as `21/35` into O₂ stores 21 in O₂ and 35 in He. The two fields remain independently editable. Do not change the supply-bank input format.

If saved data cannot be read, the UI uses the built-in defaults. Saving editable settings must preserve the user's entries across reloads.

## Supply-bank state

Persist the full editable bank list in `localStorage` under a separate key, including identity, name, enabled state, gas fractions, volume, pressure, minimum pressure, and the selected/custom gas-preset state. Load it before the initial calculation and save after bank add/remove, enable, preset selection, and direct edits. When no saved list exists, use the existing four defaults. Invalid or unreadable saved data falls back to those defaults with a visible warning; a later mutation saves the repaired list.


## Interface simplification

Remove the two top quick-blend buttons and the `applyPreset()` action; gas presets remain selectable for cylinder mixes and supply banks. Remove the `Simplex LP` and physics badges, explanatory subtitle, `Rigid Volume` label, successful `Optimal Solution` badge, and entire helium-minimization weighting explainer. Keep the physics-model and temperature controls; shorten the model choices to `Real gas` and `Ideal gas`. The supply-bank table keeps editable O₂ and He but omits derived N₂% and Z columns; keep Z in the cylinder gas summary and keep N₂ available for ternary composition. Shorten remaining section/tab/solver headings while keeping all labels needed to edit values and identify infeasible states.

## Ternary diagram

Draw the full O₂/N₂/He simplex as a dotted outer triangle. Draw the feasible solid triangle through Air (21/0/79), 100% O₂, and 100% He. Keep gas points, grid, and the mixing trajectory legible within that coordinate system; a mix such as 15/0 must plot outside the solid triangle, inside the dotted simplex.

Mouse-wheel input over the chart changes zoom. Zoom is centered on the bounding-box center of the complete trajectory, not the cursor. The maximum zoom is calculated from the trajectory bounds and available plot area so every trajectory point remains visible. Zoom is bounded at the unzoomed view and that computed maximum; no pan interaction is added. Recompute the zoom limit when the trajectory or canvas dimensions change.

## Data flow and boundaries

`main.js` remains the owner of editable runtime state and delegates settings, bank, result, and chart rendering to UI modules. A focused settings module owns default preset data and `localStorage` access. The supply-bank renderer receives the gas presets needed to render per-bank selectors. The ternary renderer retains responsibility for drawing, resize redraws, and pointer readout; zoom state belongs to the canvas interaction and is reset/clamped when its data or geometry changes. Preset selection only updates the corresponding mix fields before the existing optimizer input is collected.
`js/bank-storage.js` owns default bank records, validation, and `localStorage` reads/writes. `main.js` loads that list before the first calculation and persists each bank mutation. `js/optimizer.js` computes bank availability internally for its decision-variable limits; it no longer returns display-only per-bank Z metrics.

## Verification and acceptance

- Existing Node tests continue to prove calculation and optimization behavior; new unit tests cover preset persistence/default behavior, slash-delimited gas parsing, and maximum-zoom trajectory bounds/diagram boundary coordinates where those behaviors are implemented as pure functions.
- Browser smoke confirms bank name, gas, pressure, volume, minimum pressure, enabled state, additions, and deletions persist across reload; a corrupt stored list warns and uses defaults until the user changes a bank.
- Visual smoke confirms simplified labels, the solid Air/O₂/He and dotted full-simplex boundaries, a 15/0 point outside the solid region, wheel zoom centered on the full path, and the complete path remains in view at maximum zoom and after resize/recalculation.
- Verify the default blend, bank edits and reload, both physics modes, the remaining cylinder/bank gas preset selectors, recipe/diagram/solver tabs, and infeasible-state handling.
- Update the focused development documentation for settings and chart interactions after implementation.
