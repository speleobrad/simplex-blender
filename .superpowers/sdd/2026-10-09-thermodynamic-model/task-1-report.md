# Task 1 implementation report

## Changed files

- `js/settings.js` — added the seven persisted booster defaults, migration defaults, copying, and field-specific equipment range validation.
- `js/ui/settings-dialog.js` — populates every persisted booster input when rendering Settings.
- `scuba_gas_remixer_simplex_optimizer.html` — added the seven delegated booster setting inputs.
- `tests/settings.test.js` — added migration, rejection-before-storage, and round-trip coverage; updated legacy round-trip fixtures to include the complete persisted booster shape.

`js/main.js` already used a spread copy for `booster` and delegated numeric `data-settings-collection="booster"` field updates, so it required no change.

## TDD evidence

### Red

Ran `node --test tests/settings.test.js` after adding the requested tests and before implementation.

- 12 passed, 3 failed.
- Expected failures: legacy saved settings did not gain thermodynamic defaults; invalid cylinder/decant values were accepted; thermodynamic fields were lost during a save/load round trip.

### Green

Ran `node --test tests/settings.test.js` after implementation.

- 15 passed, 0 failed, 0 warnings.

## Tests run

`node --test tests/settings.test.js` — pass: 15, fail: 0, cancelled: 0, skipped: 0, todo: 0.

## Commit

`3ba01e8 feat: add thermodynamic booster settings`

## Concerns

None.
