# Architecture

## Runtime assets

`scuba_gas_remixer_simplex_optimizer.html` owns the page markup and relative asset references. `css/app.css` contains theme color variables for both appearances and custom table/scrollbar rules. The page loads Tailwind from its existing CDN, then `js/tailwind-config.js` maps utility colors to those variables, followed by the native-module entry `js/main.js`.

## JavaScript boundaries

- `js/main.js` owns browser event delegation, editable bank state, settings drafts, active theme, selected tab, tableau index, form parsing, supported-range validation, and calculation orchestration.
- `js/theme.js` loads and saves the explicit light/dark choice in browser `localStorage`; dark is the default.
- `js/bank-storage.js` validates, loads, and saves the editable non-Air supply-bank list in browser `localStorage`; legacy finite Air records are discarded during load and an empty list is valid.
- `js/settings.js` defines and validates the default gas/cylinder presets, persisted gas model, shared booster minimum source pressure, compressor Air ceiling, and non-Air booster output ceiling, persists user-configured settings in browser `localStorage`, migrates legacy volume-only settings, and reports when unreadable saved data falls back to defaults.
- `js/gas-input.js` parses slash-delimited O₂/He paste input and provides strict numeric parsing and gas-composition validation without DOM dependencies.
- `js/input-validation.js` enforces supported calculator ranges and supply-bank record constraints, shared by the UI, optimizer, and persistence layer.
- `js/physics.js` contains pure gas-property functions, including compressibility-factor calculation from an already-known density; it has no DOM dependency.
- `js/thermodynamics.js` simulates transfer rates, numerical simultaneous fill heating/ambient heat loss, and post-transfer cooling waits for a completed protocol; it has no DOM dependency and returns thermal values alongside each step plus final transfer-end and ambient-settled estimates.
- `js/optimizer.js` validates the gas model, calculator ranges, user bank records, physical gas compositions, and thermal equipment input before constructing the requested-mix and maximum-pressure linear programs; it injects unlimited compressor Air, enforces the shared booster minimum source pressure, caps compressor and non-Air boost stages independently, rechecks recovered solver variables against the original constraints, applies the oxygen-transfer safety limit, and returns gas data, solver steps, protocol entries, thermal estimates, and ternary trajectory points carrying each used source bank's starting and residual pressure.
- `js/ui/settings-dialog.js` renders the persisted gas-model choice, editable gas and cylinder preset lists, shared booster settings, compressor pressure ceiling, booster output ceiling, and refreshes cylinder and gas choices.
- `js/ui/storage-warning.js` renders persistence and rejected-bank-edit warnings from controller state.
- `js/ui/supply-banks.js` renders editable non-Air bank properties and gas-preset selectors; compressor Air is implicit and is not shown as a bank row, while derived N₂, Z, and minimum-pressure columns are not shown.
- `js/ui/results.js` renders gas metrics and the pumping protocol, including formatted Boost/Decant/Equalize/Top-up instructions, end-of-stage pressures/mixes, oxygen compression ratios, thermal rate/transfer-end/wait estimates, final hot and ambient-settled pressure summaries, and explicit infeasible feedback.
- `js/ui/tableau.js` renders one solver snapshot.
- `js/ui/ternary.js` draws the feasible Air/O₂/He triangle and dotted full simplex, reports composition under the pointer, populates the Tank summary tab's keyboard-operable O₂/He tables for reference mixes and trajectory data with source-bank start/end pressures, observes its container size, and bounds path-centered wheel zoom using the active theme's chart colors.

Calculation modules pass plain values to UI modules. UI renderers own only their assigned DOM surface. Bank controls are generated dynamically and handled through delegated events in `main.js`; bank names are treated as text. Preset edits remain drafts until the user saves them; selecting a cylinder preset supplies the working tank's volume, material, mass, and pressure rating, while a gas-bank preset also updates that bank's displayed name.

## Data flow

1. The settings dialog edits the gas model, gas and cylinder presets, and equipment-setting drafts; saving validates and persists them in `localStorage`. Legacy volume-only settings are normalized into cylinder presets when loaded. `bank-storage.js` loads saved non-Air bank records, removes legacy Air records, and writes user-bank mutations for the next session.
2. `main.js` applies the saved theme to the root element; CSS variables update app colors, and the ternary canvas redraws after theme changes.
3. A form, bank, gas preset, cylinder preset, physics-setting, or main-screen tank thermal-input change causes `main.js` to collect one input object. The browser uses the selected cylinder preset for working-tank volume, material, mass, and working-pressure validation; it uses the saved gas model and maps ambient temperature to both `physics.temperatureC` and `thermal.ambientTemperatureC`; inlet gas temperature remains independent.
4. `optimizeBlend` injects unlimited 21/0 compressor Air, enforces the 232-bar default compressor ceiling and 200-bar default non-Air booster ceiling from settings, calculates gas quantities and bank availability, solves for the requested exact mix, then finds a maximum safe pressure recipe for that same mix if the requested pressure is unavailable. Compressor Air may precede later non-Air stages above the compressor ceiling; a non-Air Boost stage never exceeds the booster ceiling.
5. `main.js` sends bank state to the bank renderer and the optimizer result to the results, tableau, and ternary renderers. The results renderer displays thermal step estimates and distinguishes the final transfer-end pressure from the settled ambient estimate.
6. Selecting the Diagram tab or resizing its container redraws the latest chart; its accessible data tables update with the same reference mixes and trajectory points. Mouse-wheel zoom stays centered on the complete path and clamps to keep it in view; pointer movement reports composition and leaving the canvas restores the prompt.

The app uses browser-native ES modules and has no bundling step. Serve the directory over HTTP; see [Development](development.md).
