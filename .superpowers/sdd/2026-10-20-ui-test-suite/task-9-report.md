
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
