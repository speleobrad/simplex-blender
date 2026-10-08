# Architecture

## Runtime assets

`scuba_gas_remixer_simplex_optimizer.html` owns the page markup and relative asset references. `css/app.css` contains theme color variables for both appearances and custom table/scrollbar rules. The page loads Tailwind from its existing CDN, then `js/tailwind-config.js` maps utility colors to those variables, followed by the native-module entry `js/main.js`.

## JavaScript boundaries

- `js/main.js` owns browser event delegation, editable bank state, settings drafts, active theme, selected tab, tableau index, form parsing, supported-range validation, and calculation orchestration.
- `js/theme.js` loads and saves the explicit light/dark choice in browser `localStorage`; dark is the default.
- `js/bank-storage.js` validates, loads, and saves the editable supply-bank list in browser `localStorage`.
- `js/settings.js` defines and validates the default gas/volume presets and shared booster minimum source pressure, persists user-configured settings in browser `localStorage`, and reports when unreadable saved data falls back to defaults.
- `js/gas-input.js` parses slash-delimited O₂/He paste input and provides strict numeric parsing and gas-composition validation without DOM dependencies.
- `js/input-validation.js` enforces supported calculator ranges and supply-bank record constraints, shared by the UI, optimizer, and persistence layer.
- `js/physics.js` contains pure gas-property functions, including compressibility-factor calculation from an already-known density; it has no DOM dependency.
- `js/simplex.js` contains the two-phase solver, scaled Phase-I feasibility checks, removal of zero-valued artificial basis variables before phase 2, and tableau snapshots; it has no DOM dependency.
- `js/optimizer.js` validates the gas model, calculator ranges, bank records, and physical gas compositions before constructing the requested-mix and maximum-pressure linear programs; it applies the shared booster minimum source pressure, rechecks recovered solver variables against the original constraints, applies the oxygen-transfer safety limit, and returns gas data, solver steps, protocol entries, and ternary trajectory points carrying each used source bank's starting and residual pressure.
- `js/ui/settings-dialog.js` renders the editable preset lists, shared booster setting, and refreshes cylinder gas/volume choices.
- `js/ui/storage-warning.js` renders persistence and rejected-bank-edit warnings from controller state.
- `js/ui/supply-banks.js` renders editable bank properties and gas-preset selectors; derived N₂, Z, and minimum-pressure columns are not shown.
- `js/ui/results.js` renders gas metrics and the pumping protocol, including formatted Boost/Decant/Equalize/Top-up instructions, end-of-stage pressures/mixes, and oxygen compression ratios, with explicit infeasible feedback.
- `js/ui/tableau.js` renders one solver snapshot.
- `js/ui/ternary.js` draws the feasible Air/O₂/He triangle and dotted full simplex, reports composition under the pointer, populates the Tank summary tab's keyboard-operable O₂/He tables for reference mixes and trajectory data with source-bank start/end pressures, observes its container size, and bounds path-centered wheel zoom using the active theme's chart colors.

Calculation modules pass plain values to UI modules. UI renderers own only their assigned DOM surface. Bank controls are generated dynamically and handled through delegated events in `main.js`; bank names are treated as text. Preset edits remain drafts until the user saves them; selecting a cylinder preset updates its O₂/He values, while a bank preset also updates that bank's displayed name.

## Data flow

1. The settings dialog edits gas and volume preset drafts; saving validates and persists them in `localStorage`. `bank-storage.js` loads saved bank records on startup and writes mutations for the next session.
2. `main.js` applies the saved theme to the root element; CSS variables update app colors, and the ternary canvas redraws after theme changes.
3. A form, bank, gas preset, volume, or physics-setting change causes `main.js` to collect one input object.
4. `optimizeBlend` calculates gas quantities and bank availability, solves for the requested exact mix, then finds a maximum safe pressure recipe for that same mix if the requested pressure is unavailable.
5. `main.js` sends bank state to the bank renderer and the optimizer result to the results, tableau, and ternary renderers.
6. Selecting the Diagram tab or resizing its container redraws the latest chart; its accessible data tables update with the same reference mixes and trajectory points. Mouse-wheel zoom stays centered on the complete path and clamps to keep it in view; pointer movement reports composition and leaving the canvas restores the prompt.

The app uses browser-native ES modules and has no bundling step. Serve the directory over HTTP; see [Development](development.md).
