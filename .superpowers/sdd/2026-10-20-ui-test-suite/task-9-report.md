# Task 9 report: persisted display units

## RED

- `npm test -- tests/units.test.js` — failed as expected after regression tests were added: Imperial volume remained `gal` and used the gallon conversion factor.
- Regression coverage added for cubic-foot labels/conversion and no-gallon output.

## GREEN / verification

- `npm test -- tests/units.test.js tests/settings.test.js tests/settings-dialog.test.js tests/results.test.js tests/thermodynamics.test.js tests/water-pressure.test.js` — 90 tests passed.
- `npm test -- tests/units.test.js tests/settings-dialog.test.js tests/results.test.js tests/water-pressure.test.js tests/thermal-charts.test.js` — 40 tests passed.
- `npm test -- tests/thermal-charts.test.js tests/units.test.js` — 22 tests passed after restoring the chart SVG namespace.
- `npm run test:ui -- tests/browser/settings.spec.js tests/browser/multi-session.spec.js --project=desktop --workers=1` — did not complete before the 180-second command deadline. The captured attempts exposed an application runtime error (`SVG_NS is not defined`); this was fixed in the committed chart header, but the browser suite was not rerun to completion afterward.

## Files

- Updated `js/units.js`: Imperial volume is cubic feet (`ft³`) and quantity formatting converts canonical values exactly once.
- Updated `js/main.js`: settings editor and interim reading edits convert selected display units back to canonical metric values; thermal charts receive selected units.
- Updated `js/ui/settings-dialog.js`: cylinder, compressor, booster, and decant editor fields render selected units with converted constraints and accessible unit labels.
- Updated `js/ui/results.js`: pressure/temperature result summaries, protocol thermal details, interim controls, and water-pressure pane use selected units.
- Updated `js/ui/water-pressure.js`: table values, constraints warnings, row labels, and accessible labels use selected pressure/temperature units.
- Updated `js/ui/thermal-charts.js`: chart axes, data tables, hover/accessibility values, reference lines, and status text use selected units.
- Updated `tests/units.test.js` with cubic-foot regression coverage.

## Remaining concerns

- A post-fix affected browser run is still required; no browser acceptance is claimed.
- Full `npm test`, full `npm run test:ui -- --workers=1`, and screenshot review were not run in this worker; main agent should run the requested final verification.
