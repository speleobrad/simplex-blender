
## Worker follow-up

### RED
- `npm test -- tests/units.test.js` — failed as expected after adding `displayStep` regression assertions because the export was initially absent.

### GREEN
- `npm test -- tests/units.test.js tests/settings-dialog.test.js tests/results.test.js tests/water-pressure.test.js tests/thermal-charts.test.js tests/equipment-summary.test.js` — 45 tests passed.

### Changes
- Added unit-aware primary working-tank pressure/temperature parsing and display constraints, suffixes, and ARIA labels; canonical values remain metric.
- Added scale-only display-step conversion for temperature and applied it to Settings constraints.
- Added Units browser helper category support and changed Imperial selector text to cubic feet.

### Remaining concerns
- Full browser and repository verification requested by the parent agent remains outstanding.

### Current assignment RED
- `npm test -- tests/settings.test.js tests/settings-dialog.test.js` — passed (51 tests); no focused Node regression was red before production changes.
- `npm run test:ui -- tests/browser/settings.spec.js tests/browser/multi-session.spec.js --workers=1` — failed in the units session test: Imperial cylinder volume/pressure were still asserted as metric `3`/`232`, while the editor displayed `0.10594400009999999` ft³.
