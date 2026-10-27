# Development

## Run locally

The page uses browser-native ES modules, which require HTTP rather than direct `file://` opening. From the project root run:

```sh
python3 -m http.server 8000
```

Open `http://127.0.0.1:8000/index.html`. Tailwind CSS and web fonts continue to load from their existing CDNs, so internet access is needed for the existing styling and fonts.

## Tests

Node's built-in test runner covers gas physics, strict numeric parsing, calculator and bank input bounds, thermal transfer/cooling calculations, scale-aware simplex feasibility and recovered-solution constraint checks, tiny-drain pressure and retained-mole precision, blend optimization and stage ratios, preset and bank persistence/validation, slash-delimited gas entry, and ternary geometry/zoom limits. Run:

```sh
npm test
```

Browser checks use Playwright's Chromium runner and require the local browser binary. Install it once with:

```sh
npx playwright install chromium
```

Run all three configured projects (desktop, tablet, and mobile) with:

```sh
npm run test:ui
```

Useful focused runs include:

```sh
npm run test:ui -- tests/browser/screenshots.spec.js --project=desktop
npm run test:ui -- tests/browser/layout-invariants.spec.js --project=mobile
```

For headed or interactive debugging, append `--headed` or `--debug`:

```sh
npm run test:ui -- --headed
npm run test:ui -- --debug
```

On failure, Playwright retains traces, screenshots, and videos in `test-results/` and writes the HTML report to `playwright-report/`. Approved screenshot baselines are checked in under `tests/browser/screenshots.spec.js-snapshots/`; do not update them unless a deliberate visual change has been reviewed.

The Node and browser suites are independent: run `npm test` for the Node suite, and `npm run test:ui` for browser coverage. CI installs Chromium with its system dependencies before running both commands. To reproduce CI results exactly (Ubuntu container, fonts, screenshot baselines), see `docs/ci-reproduction.md`.

## Priority invariant

Cylinder-gas retention, and therefore helium salvaging from the working cylinder, is the optimizer's primary objective. Every safety or fallback re-solve MUST preserve as much working gas as its safe feasible recipe allows before choosing supply-bank sources. The preservation regression uses a 12 L, 80 bar, 21/35 → 210 bar, 18/45 input and MUST begin with preservation rather than a drain when that safe recipe exists. It is covered by `default example keeps the cylinder gas when the safety ceiling is active` in `tests/optimizer.test.js`; changes to LP costs or safety candidate selection must keep this behavior.

## Browser smoke checks

After serving the page, verify that:

Before the existing calculator checks, use a clean browser profile to verify the onboarding boundary:

1. Confirm first load opens the consent dialog with its local-storage notice, keeps keyboard focus inside the consent action, and leaves the background unavailable, and the Network panel has no Google Analytics request before acceptance.
2. Accept consent and advance through the Driver.js tour. Verify the first step ("Main menu") is anchored to the top navigation, the Inventory steps highlight the gases and equipment sections on the Inventory screen, the Settings step opens the Equipment category with its pane and category button highlighted, the working-tank and temperature steps highlight their sections (the temperature step highlights both the ambient and in-water target inputs), the recipe step selects the Recipe tab, and the final step highlights the result tab list. Driver.js keyboard navigation must work.
3. Keep the consent dialog open and confirm it remains open until acceptance; acceptance enables analytics only after storage succeeds. In the tour, verify Back returns to the prior step and destination, Skip and Escape dismiss and persist the seen state, and Done returns to the Recipe tab and persists it. Reload and confirm neither consent nor the tour opens automatically, then use the header wand to re-enter at the first step.
4. Confirm a successful factory reset clears all application data and immediately reopens the consent gate in the same page.
5. Repeat the tour at a narrow viewport and with reduced motion enabled; Driver.js popovers remain usable. After closing it, confirm settings, tab switching, calculator inputs, and result rendering remain unchanged.

1. On first load, verify the defaults show the current working-tank preset, 45 bar, Air (21/0) to 195 bar, Tx 18/45, air at 21 °C with a 10 °C target, fixed 5 minutes, and incoming gas at 25 °C. Open What-if and verify its start is copied from Blending and its default step is Add gas Oxygen to 60 bar (15 bar added, target mode). With a valid rated target, verify the recipe reports gas pressures and formatted Decant/Equalize/Boost/Top-up stages with target pressure, source leftovers, interim mix, and any relevant compression ratio. For a non-Air Boost from a source above 40% O₂, verify the recipe visibly reports the source-end pressure, receiver destination pressure, and oxygen compression ratio; a 40% source does not report that ratio. When a non-Air source reaches the booster minimum, verify its step says the named bank is emptied, shows the minimum remaining pressure, and places the orange warning icon before its Source end pressure. The summary reports helium salvaged rather than helium saved.
2. Settings uses Model, Gas presets, Cylinder presets, and Equipment categories. Equipment contains Compressor (inlet flow, maximum pressure, temperature modifier), Booster (cylinder volume, minimum mix-source pressure, oxygen/other-gas boost speeds, maximum output pressure, temperature modifier), and Decanting hose (oxygen/other-gas manual decant rates and draining rate). The category rail is vertical on desktop and horizontally scrollable on narrow screens. New compressor and New booster each append a uniquely named clone of the active category's parameters without changing the active values; each clone persists after Save and reload, while Cancel discards an unsaved clone. Settings save/cancel/reload behavior remains unchanged: edits are drafts until Save, Cancel discards them, and saved values survive reload in `localStorage`.
The Booster section's draining rate (bar/min) controls the duration and signed thermal cooling of every drain step; drain and pressure chart values are clamped at 0 bar.
3. The selected cylinder preset updates the calculation; there is no custom working-tank size or independent material override. Gas presets populate both cylinder mixes and non-Air bank compositions without preventing direct editing; the Air preset cannot be assigned to a finite bank. A cylinder mass value such as `14.3` is fully visible, and the **Working pressure** and **Hot overfill** controls remain compact. Verify hot overfill defaults to 2%, accepts 0–5% in 0.5% steps, survives Save/reload, and defaults to 2% for older/imported presets. The working-tank ambient temperature is used for both ambient conditions and the browser calculation/start temperature. Supply banks → Transfer conditions exposes the shared incoming gas temperature for compressor and supply-bank transfers with compact, matching setting typography; inlet temperature remains independent from ambient. Typing `/` in a cylinder O₂ field focuses He, and pasting `21/35` fills the pair. Invalid gas percentages, O₂/He totals above 100%, blank numeric values, pressures above the selected cylinder's working pressure, or pressures/temperatures outside their displayed ranges show an input error and do not run the optimizer.
4. Both physics models update the result; entering the 100 bar EAN 32 (32/0) to 220 bar, 21/30 case reports 838.4 L vented at 1 bar equivalent volume.
5. Bank gas, name, pressure, volume, enabled state, additions, and deletions survive reload for non-Air banks. The default and loaded bank table never contains Air; Air is an implicit unlimited compressor source. The table shows O₂/He inputs without derived N₂, Z, or minimum-pressure columns; blank bank names, out-of-range bank values, and O₂/He totals above 100% are rejected with a bank-specific alert that clears after a valid correction. Invalid saved banks trigger the fallback warning before built-in defaults are used. A failed browser-storage write shows a visible warning until a later save succeeds. Disabling every user bank still permits compressor-Air recipes where composition and pressure limits allow them.
6. Recipe, Diagram, Thermal graphs, Tank summary, and In water pressure tabs work; Air protocol stages are labelled Top-up, never Boost, and a later non-Air stage may follow compressor Air above the compressor ceiling when its own operation limit permits it.
7. The diagram's dashed Air/O₂/He boundary joins Air, pure O₂, and pure He; the dashed outer boundary includes pure N₂, and the complementary N₂/Air/He region is gray shaded. A 15/0 mix plots outside the Air/O₂/He boundary. Mouse-wheel zoom and the diagram's −/Reset/+ controls center on the complete mixing path, keep it visible at the maximum, preserve pointer readout alignment, and remain bounded after resize/recalculation. The Tank summary tab lists reference mixes and enabled banks as O₂/He values; enabled bank rows show source start/end pressures, and trajectory rows show O₂/He values with stage pressure. Invalid input clears these rows and a subsequent valid calculation restores the chart label and pointer prompt.
When the exact requested mix/pressure is unavailable but the recipe tab shows a partial maximum-pressure recipe, verify the Diagram and Tank summary still show the partial trajectory and accessible rows; only a no-positive-solution or invalid result should show the empty state.
8. The browser reports no app module/runtime errors. Tailwind's CDN warning that the runtime CDN is not intended for production is expected and unchanged.
9. The theme toggle switches between light and dark across the header, forms, settings, tables, and ternary chart. Light is the first-run default; the selected theme survives reloads. Settings stays at the far right of the header.
10. When the requested pressure exceeds available gas or the requested recipe violates the 4:1 oxygen-transfer limit, verify the app reports the maximum safe pressure for the exact target mix and renders its recipe; verify a safe recipe can split oxygen across banks when required, and verify no recipe appears when no positive safe pressure is possible.
11. With a deliberately limited Helium bank, verify the fallback alert reports the required source-bank pressure, current pressure, shared booster minimum, and volume, with no mole quantities; verify out-of-range real-gas source estimates are reported as unavailable rather than as a numeric pressure sentinel.
12. With a 0.1 L cylinder and no enabled banks, 10 bar at 21/0 to 10 bar at 23/0 is infeasible. With a 12 L ideal-gas cylinder at 10.4 bar, 21/0 to 10 bar, 21/0, verify the protocol includes the required 0.4 bar drain and ends at the reported final pressure. A 12 L cylinder at 10 bar, 21.00/0 to 10 bar, 21.01/0 with an Oxygen bank must display a nonzero small drain rather than `0.00 bar`.
13. With a 0.1 L ideal-gas cylinder at 50°C, 10.0000002 bar, 21/0 to 10 bar, 21/0, and no banks, verify the protocol emits the representable small drain instead of preserving all gas and reports the retained amount above zero.

14. Set thermal tank inputs and run a recipe with at least one transfer. Each thermal step reports its rate source/rate/duration, transfer-end pressure and temperature, wait, and post-wait pressure and temperature. The final step labels its full ambient cool-off. Confirm the final hot transfer-end pressure is above the requested target and the final ambient-settled pressure returns to the requested target. Treat these values as estimates: actual transfer rate, compression heat, and cooling vary with equipment, gas flow, fill technique, and environment.
15. Open Thermal graphs for a recipe with a drain and at least one transfer. Confirm both charts use elapsed minutes on the X-axis, show alternating bands spanning each protocol step's transfer and wait interval, alternate adjacent band captions between two rows while keeping each caption centered in its band, include the drain as Step 1, and end at the final ambient-settled pressure and temperature. Confirm the paths follow the minute-resolution transfer and cooling samples rather than direct key-point joins, while the start, transfer-end, and settled key points remain highlighted and present in the data table. Hover across either plot and verify the shared readout reports the interpolated time, temperature, and pressure while guide markers move on both charts. Moving out of the plot restores the hover instruction. Invalid input clears both charts and their data table.
The drain transfer-end temperature must be below its step-start temperature when the cylinder starts above ambient; its duration must equal drained pressure divided by the configured draining rate. Fractional transfer or wait durations still include their exact endpoint in both curves.
For a recipe with multiple mixing steps, expand the compact “Record actual readings” control between steps, enter measured pressure and temperature, and apply it. Verify downstream recipe values recalculate from those readings. Thermal graphs and the data table show the measured-start point; its time is shown as an estimate when the cooling model can derive one, otherwise as `? min`.
Solid thermal curves show the current/observed path; dotted curves show the superseded modeled section after a manual reading. The chart cue and accessible label identify both styles. The ambient temperature reference remains a separate dashed line.

For interim readings, verify that the first form on a fresh load rejects 30 bar at 15 °C with the inline alert about the pressure-lowering drain, and that 45 bar at 21 °C (the planned start) is accepted and shown as the measured start for step 1. After a later reading is recorded, verify that earlier rows show the locked note and only the latest row has Clear. Verify that Settings → General rejects an interim tolerance outside 0.5–10%.
After an accepted reading that changes a later pressure (for example 146 bar at 29.6 °C on the fourth form of the default recipe), verify that the notice "This recipe is a mix of planned steps and your interim manual readings." appears under the status line with no other details, and that the fourth step shows the measured start. On a fresh load with no accepted reading, a reading far outside tolerance leaves the notice hidden; a rejected reading does not clear a notice from an earlier accepted reading, because rejected readings return before the recalculation.
Then clear it and record 54 bar at 22 °C on the Step 2 form of the default recipe: the recipe must become Step 1 Decant Oxygen, Step 2 Decant Oxygen with the struck-through planned start 55.6 bar and 21.7 °C beside the measured 54.0 bar and 22.0 °C, Step 3 Boost Sample scrap, and Steps 4 to 6, ending at the same target mix and pressure, with the same notice and no failure on the Sample scrap bank. Clear that reading and confirm the original five-step recipe returns.

16. At desktop width, the Working tank places Surrounding medium beside Ambient / calculation temperature, and Wait between fills beside the active Wait time or Target temperature field. At narrow width both rows stack. Supply banks → Transfer conditions uses the same compact sans-serif setting typography as the Working tank while retaining monospaced numeric values and independent inlet-temperature behavior.
17. Thermal graphs expose focusable points with shared indices across the temperature chart, pressure chart, and data table. Hovering or keyboard-focusing any point or row highlights the corresponding row and both chart points; moving away clears the highlight. Invalid input clears both charts and the data table, and valid input restores them.
18. The In water pressure tab shows a water-temperature table from 4 to 28 °C in 2 °C increments and a Car temperatures table from 25 to 60 °C in 5 °C increments. Readings above the selected cylinder's working pressure are colored red with a warning icon immediately before the pressure value.
19. Settings → Preset management exposes Gas, Cylinders, and Equipment imports. Each category starts with its raw GitHub URL under `presets/`, accepts a local JSON file or an edited online URL, previews valid entries, grays out and disables entries duplicated by content for gas presets or normalized name for cylinder and equipment presets, marks same-name/different-content gas conflicts invalid and unavailable, and checks new entries by default. Load the repository fixture files locally to verify the preview counts; confirm a selection and verify the new gas/cylinder/compressor/booster entries appear in the existing selectors and survive reload. Try malformed JSON and an unavailable URL and verify the visible status reports the failure without changing saved settings. Confirm that ordinary Settings edits still require Save and Cancel still discards unconfirmed edits.
20. Settings → Preset management exposes Reset to factory settings. Confirm the action and verify all local storage data is removed, the light theme and built-in presets/banks return immediately, and the success status remains visible without reloading.
21. At a narrow viewport, verify Settings category navigation scrolls the active category into view, Equipment preset actions stack without clipping, Cylinder presets use readable cards with full-width remove actions, and Preset management URL controls stack without horizontal overflow. At desktop width, verify the cylinder table and sidebar layout remain intact.
22. Select Surrounding medium = Water: a "Tank submerged" select (20/40/60/80%, default 60%) appears beside it; with Air it is hidden. Lowering the percentage raises the Hot mix temperature and lengthens the settle time on the Thermal graphs. In What-if, the same control appears for Water, is included by Copy from Blending, and changes the scenario result.
23. Use the `salvageInput` fixture in `tests/plan-with-readings.test.js`: a 12 L cylinder at 150 bar, 32/0, to 100 bar, 21/35, with enabled banks Pure Helium (50 L, 200 bar, max 350 bar), Pure Oxygen (40 L, 180 bar, max 350 bar), and Leftover N (50 L, 20 bar, max 200 bar, 32% O₂). Verify the first mixing step is an unnumbered salvage card titled `Salvage: decant into Leftover N to … bar` with Receiver, Helium moved, Receiver before, and Receiver after rows, and that the salvage card itself has no reading control. Step 1 is the first step with a reading control, and the helium salvaged metric is unchanged. A drain card shows a reading control only while a reading is stored at its index: a drain holding a reading keeps its control after partial salvage, and a drain without one has none. Confirm the 100 bar, 32/0 to 220 bar, 21/30 nitrox case stays vent-only (no salvage card) with the test's bank set (Pure Helium 200 bar, Tx 18/45 Bank 200 bar, Pure Oxygen 180 bar) at 20 °C physics: 838.4 L vented. With the default bank set at the same temperature it vents 77.6 L instead.

### Compare recipe scenario

With valid working-tank, thermal, equipment, and Supply-bank values, switch from the default Optimize mode to Compare and confirm those values remain while the row editor appears without an onboarding overlay blocking its controls. Add gas must list **Compressor Air** plus enabled named Supply banks, but not disabled or unnamed banks; selecting Compressor Air displays 21/0 and **Infinite supply**, while selecting a finite bank displays its inferred O₂/He composition, volume, and current pressure. Edit **Pressure added** and confirm **Receiver target pressure** changes, then edit the target and confirm the added value changes. Run a Compressor Air operation below its configured pressure ceiling and a finite-bank operation that produces automatic Decant, Equalize, and/or Boost cards; confirm the persisted Supply-bank value remains unchanged.

Run both a fixed-minute Wait and a target-temperature Wait; each must produce modeled output, with target-temperature pressure calculated after cooling. Enter a target below ambient or above the current transfer temperature and confirm an inline error while the previous successful result remains visible. Confirm the summary separates recipe-end and ambient-settled pressure, mix, and temperature. Thermal graphs, Diagram, and Tank summary must show the Compare trajectory. Switch back to Optimize and confirm its existing result, Supply-bank controls, target fields, and tabs still work. Confirm the browser console has no app module or runtime errors; the existing Tailwind CDN warning remains expected.

See [Architecture](architecture.md) for runtime module responsibilities.

### What-if browser acceptance

Run `npx playwright test tests/browser/what-if.spec.js`. Verify snapshot edits leave Blending unchanged until Copy from Blending, drain/add/wait rows execute, all six result tabs are exclusive, Recipe has technical details without Record actual, and narrow keyboard navigation stays contained. Change or disable a shared bank after a run and verify the exact `Out of date — shared inputs changed` status; invalid reruns retain the prior valid summary. These checks cover current runtime inputs only and make no persistence or inventory-depletion claim.
