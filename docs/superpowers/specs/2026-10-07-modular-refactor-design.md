# Modular HTML App Refactor — Design

## Goal

Split the existing scuba gas remixer page into markup, stylesheet, and focused JavaScript modules while preserving its current user-visible calculations and workflows. Add focused project documentation under `docs/` so contributors can locate the architecture, domain rules, UI behavior, and development commands independently.

## Current shape

`scuba_gas_remixer_simplex_optimizer.html` currently contains the complete page, Tailwind CDN theme setup, custom CSS, and a single inline script. That script combines gas equations, supply-bank state and controls, two-phase simplex solving, LP construction, recipe/protocol calculation, tableau navigation, canvas drawing, and startup. There is no existing package configuration, test runner, or project documentation.

## Chosen approach

Use browser-native ES modules without a bundler or runtime dependencies. Keep the existing HTML filename to avoid changing its URL. Serve the project over HTTP during development because browser module imports do not work from `file://`. Keep the existing Tailwind CDN and Google Fonts dependencies; move the Tailwind theme configuration into a separate classic script and move the custom rules into a stylesheet. The HTML file will contain page markup and asset references, not embedded CSS, app logic, or inline event handlers.

A single controller plus a few helpers was considered, but would keep canvas, table, and protocol rendering coupled to orchestration. A bundler would add tooling and an artifact without improving this small app's runtime needs.

## Module boundaries

- `css/app.css`: custom scrollbar and tableau cell rules currently embedded in the document.
- `js/tailwind-config.js`: the existing Tailwind theme configuration, loaded after the Tailwind CDN script.
- `js/physics.js`: pure Van der Waals/ideal-gas mixing, pressure, molar-density, compressibility, and precomputed-density compressibility calculations.
- `js/simplex.js`: the two-phase simplex solver and tableau snapshots; no DOM access.
- `js/optimizer.js`: construct the LP from explicit cylinder/bank/settings input, run the solver, compute bank availability and compressibility data once, and derive the result summary, ordered blending steps, and ternary trajectory. No DOM access.
- `js/ui/supply-banks.js`: render the supply bank table from supplied bank data and optimizer bank metrics, without repeating gas-density calculations.
- `js/ui/results.js`: render solution status, summary metrics, and protocol steps from the optimizer result.
- `js/ui/ternary.js`: draw the ternary diagram, report the composition under the pointer, and own its resize observer lifecycle.
- `js/ui/tableau.js`: render a requested simplex snapshot and its step controls.
- `js/main.js`: initialize the page, own mutable bank/tableau UI state, read form inputs, delegate browser events, call the optimizer, and pass results to UI renderers.

Functions crossing the domain/UI boundary receive explicit values and return calculation results or update only their assigned DOM surface. Remove implicit cross-module globals and inline event handlers. Use event delegation for dynamically rendered bank controls. Dynamic user-entered bank names must be inserted as text, not interpreted as HTML. Form parsing preserves valid numeric zero; empty/non-finite bank edits restore the last valid value instead of reaching the optimizer.

Add `package.json` with only the `type: module` declaration and a built-in Node test command; no third-party dependency or build step is introduced. Tests will exercise physics and optimization contracts through the pure modules.

## Data flow and behavior contract

1. `main.js` reads the cylinder form and current bank list into an explicit input object.
2. `optimizer.js` calculates initial/target gas quantities and each bank's availability/compressibility, constructs the simplex tableau, and derives the solution, result metrics, protocol steps, and trajectory using `physics.js` and `simplex.js`.
3. `main.js` passes that single result to the supply-bank, result, tableau, and ternary UI modules.
4. Form edits, model/temperature changes, presets, bank edits/add/remove/enable, tab selection, tableau navigation, canvas resizing, and pointer-composition readout retain their current effects.
5. Infeasible recalculation clears prior blend metrics and ternary trajectory so no stale feasible result remains visible.

Keep equation constants, objective weights, LP constraints, bank defaults, solver feasibility behavior, protocol ordering, and displayed units unchanged. Preserve valid zero-valued inputs, reject empty/non-finite bank numeric edits without contaminating calculations, and clear derived views on infeasibility. Optimization is limited to eliminating repeated reads/calculations and keeping view rendering scoped to its surface; no equation, objective, solver, or UX redesign is in scope.

## Documentation structure

- `docs/README.md`: documentation index and project orientation.
- `docs/architecture.md`: module responsibilities, dependency direction, and calculation/render flow.
- `docs/gas-physics.md`: gas models, equations, units, and assumptions reflected by `physics.js`.
- `docs/optimizer.md`: decision variables, constraints, objective, simplex phases, and result/protocol derivation.
- `docs/development.md`: local HTTP serving, Node tests, and browser smoke steps.

Each page owns one topic and links to related pages rather than repeating their full content.

## Verification and acceptance

- Pure-domain tests prove representative physics outputs, precomputed-density compressibility, simplex capacity-row basis labels, vented-volume reporting, feasible/infeasible blend outcomes, bank metrics, and the stable default blend/protocol contract.
- Run the test suite with `node --test`.
- Serve the app over HTTP and smoke-test the default case, valid zero inputs, restoration of blank bank numeric edits, presets, bank operations, all tabs and tableau bounds, ternary pointer coordinates and responsive sizing, and clearing of prior results on infeasible inputs. Check the browser console for module/runtime errors.
- Confirm the HTML has no embedded style/app script blocks or inline event handlers, and that the custom stylesheet and module entry resolve through relative asset paths.
- Do not change the Tailwind CDN or font dependencies in this refactor.
