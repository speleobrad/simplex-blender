# Task 9 report: persisted display units

## RED

- `npm test -- tests/units.test.js tests/settings.test.js tests/settings-dialog.test.js` initially failed because `js/units.js` did not exist (`ERR_MODULE_NOT_FOUND`).

## GREEN / verification

- `npm test -- tests/units.test.js tests/settings.test.js tests/settings-dialog.test.js` — 52 tests passed.
- `npm run test:ui -- tests/browser/settings.spec.js --project=desktop --workers=1` — 6 tests passed.
- `npm test` — 253 tests passed.
- `npm run test:ui` — attempted full 213-test suite; the run was interrupted by the existing shared local-server instability (`ERR_CONNECTION_REFUSED` after the server stopped under parallel load). The focused browser settings suite passed after fixing the source import issue.

## Files

- Added `js/units.js` with metric/Imperial normalization, conversion, labels, and formatting.
- Added `tests/units.test.js` conversion/formatting coverage.
- Added persisted `settings.units` default/validation/copy/load/save behavior and tests.
- Added accessible Units settings category/selector and delegated draft handling.
- Threaded display units through supply-bank, equipment-summary, and results rendering while converting bank edits back to canonical metric values.
- Added visible Units markup test.
- Added continued-session Imperial → Metric persistence/canonical-value browser flow.

## Concerns

- Cylinder/equipment settings editor fields remain canonical metric controls; visible supply-bank and result/equipment displays use selected units. Full browser suite needs a stable single local HTTP server for parallel workers; the attempted run reported connection refusals unrelated to application assertions.
