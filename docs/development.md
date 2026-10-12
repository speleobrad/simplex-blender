# Development

## Run locally

The page uses browser-native ES modules, which require HTTP rather than direct `file://` opening. From the project root run:

```sh
python3 -m http.server 8000
```

Open `http://127.0.0.1:8000/scuba_gas_remixer_simplex_optimizer.html`. Tailwind CSS and web fonts continue to load from their existing CDNs, so internet access is needed for the existing styling and fonts.

## Tests

Node's built-in test runner covers gas physics, strict numeric parsing, calculator and bank input bounds, thermal transfer/cooling calculations, scale-aware simplex feasibility and recovered-solution constraint checks, tiny-drain pressure and retained-mole precision, blend optimization and stage ratios, preset and bank persistence/validation, slash-delimited gas entry, and ternary geometry/zoom limits. Run:

```sh
npm test
```

No third-party test or build dependencies are required.

## Browser smoke checks

After serving the page, verify that:

1. The initial 12 L, 80 bar, 21/35 to 210 bar, 18/45 case reports the gas pressures and six protocol entries: preserve/drain preparation, then formatted Decant/Equalize/Boost stages with target pressure, source leftovers, interim mix, and any relevant compression ratio. The summary reports helium salvaged rather than helium saved.
2. Settings can add, edit, and remove gas and cylinder presets; each cylinder preset defines internal volume, material, empty assembly mass, and working pressure. The Calculation section persists the Real gas/Ideal gas choice, and the Booster section exposes shared minimum source pressure, max compressor pressure (default 232 bar), and max booster output pressure (default 200 bar). Compressor Air and non-Air Boost stages use separate limits; decant/equalization remains source-pressure limited. Save survives reload in `localStorage`, Cancel discards edits, invalid entries remain unsaved, and unreadable saved presets trigger a warning while built-in defaults are used.
3. The selected cylinder preset updates the calculation; there is no custom working-tank size or independent material override. Gas presets populate both cylinder mixes and non-Air bank compositions without preventing direct editing; the Air preset cannot be assigned to a finite bank. The working-tank ambient temperature is used for both ambient conditions and the browser calculation/start temperature. Supply banks → Transfer conditions exposes the shared incoming gas temperature for compressor and supply-bank transfers; inlet temperature remains independent from ambient. Typing `/` in a cylinder O₂ field focuses He, and pasting `21/35` fills the pair. Invalid gas percentages, O₂/He totals above 100%, blank numeric values, pressures above the selected cylinder working pressure, or pressures/temperatures outside their displayed ranges show an input error and do not run the optimizer.
4. Both physics models update the result; entering the 100 bar EAN32 (32/0) to 220 bar, 21/30 case reports 838.4 L vented at 1 bar equivalent volume.
5. Bank gas, name, pressure, volume, enabled state, additions, and deletions survive reload for non-Air banks. The default and loaded bank table never contains Air; Air is an implicit unlimited compressor source. The table shows O₂/He inputs without derived N₂, Z, or minimum-pressure columns; blank bank names, out-of-range bank values, and O₂/He totals above 100% are rejected with a bank-specific alert that clears after a valid correction. Invalid saved banks trigger the fallback warning before built-in defaults are used. A failed browser-storage write shows a visible warning until a later save succeeds. Disabling every user bank still permits compressor-Air recipes where composition and pressure limits allow them.
6. Recipe, Diagram, Tank summary, and Solver tabs work; Air protocol stages are labelled Top-up, never Boost, and a later non-Air stage may follow compressor Air above the compressor ceiling when its own operation limit permits it.
7. The diagram's solid boundary joins Air, pure O₂, and pure He; the dotted outer boundary includes pure N₂; a 15/0 mix plots outside the solid boundary. Mouse-wheel zoom centers on the complete mixing path, keeps it visible at the maximum, preserves pointer readout alignment, and remains bounded after resize/recalculation. The Tank summary tab lists reference mixes and enabled banks as O₂/He values; enabled bank rows show source start/end pressures, and trajectory rows show O₂/He values with stage pressure. Invalid input clears these rows and a subsequent valid calculation restores the chart label and pointer prompt.
8. The browser reports no app module/runtime errors. Tailwind's CDN warning that the runtime CDN is not intended for production is expected and unchanged.
9. The theme toggle switches between light and dark across the header, forms, settings, tables, and ternary chart. Dark is the first-run default; the selected theme survives reloads. Settings stays at the far right of the header.
10. When the requested pressure exceeds available gas or the requested recipe violates the 4:1 oxygen-transfer limit, verify the app reports the maximum safe pressure for the exact target mix and renders its recipe; verify a safe recipe can split oxygen across banks when required, and verify no recipe appears when no positive safe pressure is possible.
11. With a deliberately limited Pure He bank, verify the fallback alert reports the required source-bank pressure, current pressure, shared booster minimum, and volume, with no mole quantities; verify out-of-range real-gas source estimates are reported as unavailable rather than as a numeric pressure sentinel.
12. With a 0.1 L cylinder and no enabled banks, 10 bar at 21/0 to 10 bar at 23/0 is infeasible. With a 12 L ideal-gas cylinder at 10.4 bar, 21/0 to 10 bar, 21/0, verify the protocol includes the required 0.4 bar drain and ends at the reported final pressure. A 12 L cylinder at 10 bar, 21.00/0 to 10 bar, 21.01/0 with a Pure Oxygen bank must display a nonzero small drain rather than `0.00 bar`.
13. With a 0.1 L ideal-gas cylinder at 50°C, 10.0000002 bar, 21/0 to 10 bar, 21/0, and no banks, verify the protocol emits the representable small drain instead of preserving all gas and reports the retained amount above zero.

14. Set thermal tank inputs and run a recipe with at least one transfer. Each thermal step reports its rate source/rate/duration, transfer-end pressure and temperature, wait, and post-wait pressure and temperature. Transfer temperature includes numerical heat loss to the configured air/water medium during filling; the post-transfer wait applies additional exponential cooling. The final step labels its full ambient cool-off. Confirm the final hot transfer-end pressure is above the requested target and the final ambient-settled pressure returns to the requested target. Treat these values as estimates: actual transfer rate, compression heat, and cooling vary with equipment, gas flow, fill technique, and environment.

15. In Settings → Import presets, load a valid four-category JSON source from a local file, then load one from a URL. Confirm each source renders grouped choices without changing saved settings. Confirm same-name and same-content entries remain visible but are disabled. Select new entries, import them, then Save settings and reload to confirm they persist. Import compressor and booster presets, select each active preset, and confirm its active equipment values—including booster draining rate—survive Save and reload.

See [Architecture](architecture.md) for runtime module responsibilities.
