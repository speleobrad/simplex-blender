# Task 3 implementation report

## Commit

`96e7fdb feat: edit compare rows from finite supply banks`

## Files changed

- `js/ui/compare-recipe.js`
  - Replaced gas-preset/custom-composition and manual transfer-method controls with enabled Supply-bank selection.
  - Shows inferred selected-bank name, O₂/He composition, volume, and current pressure.
  - Adds synchronized `Pressure added` and `Receiver target pressure` controls marked with `data-pressure-input-mode`.
  - Adds Minutes/Target-state Wait controls and conditionally renders either duration or target pressure/temperature.
- `js/main.js`
  - Passes banks and calculated receiver-start pressures into the editor.
  - Updates bank selection, add-row pressure synchronization, and both Wait modes from delegated row inputs.
  - Validates and plans using finite banks/settings, catches planner/simulation errors while retaining the prior successful comparison result.
- `tests/compare-recipe-ui.test.js`
  - Replaced legacy gas/method UI coverage with bank-backed Add-row and target-state Wait-row contract coverage.

`index.html` was intentionally unchanged: existing Compare editor and result/status hosts already supply the required accessible markup contract.

## UI/controller decisions

- The renderer lists only enabled Supply banks. Source details are inferred display text rather than mutable row data.
- Add rows retain both pressure values; the active edit control tells the controller whether to derive the receiver target or pressure addition from that row's receiver-start estimate.
- The controller renders only the Compare editor and its errors after committed draft edits. It does not recalculate or replace a successful Compare result until planning and simulation complete successfully.
- Planner and target-wait failures are displayed as Compare recipe errors; neither failure overwrites `lastCompareInput` nor `lastCompareResult`.

## Tests run

1. Red phase:
   ```sh
   node --test tests/compare-recipe-ui.test.js tests/compare-mode-markup.test.js
   ```
   Observed 2 expected failures: the old editor lacked `bankId` and `waitMode` controls.

2. Focused suite:
   ```sh
   node --test tests/compare-recipe-ui.test.js tests/compare-mode-markup.test.js tests/compare-recipe.test.js tests/thermodynamics.test.js
   ```
   Observed: 53 passed, 0 failed.

3. Diff whitespace check:
   ```sh
   git diff --check
   ```
   Observed: no output, exit 0.

## Browser-independent self-review

- Verified renderer labels, row IDs, field error association, and delegated `data-action` controls are preserved by focused Fake-DOM tests.
- Verified Add rows contain no gas composition, method, or source-pressure controls and exclude disabled banks.
- Verified target-state Wait rows expose target pressure/temperature rather than minute duration controls.
- Verified existing model tests cover synchronized pressure normalization, finite bank validation/planning, explicit automatic stages, target waits, and unchanged Optimize thermal simulation.
- Confirmed Supply-bank persistence functions and Optimize branch code were not changed.

## Concerns

- No browser smoke was run in this task; the assigned focused automated UI/controller/model/thermal suite passed.

## Review fix follow-up

### Fixes

- Receiver-start estimates now model every preceding Wait row through the same `buildCompareProtocol()` and `simulateCompareProtocol()` path used by Compare runs. A later Add row therefore synchronizes from the wait's modeled post-wait pressure, while retaining its selected `pressureInputMode`.
- Compare-mode recalculation now rerenders the editor and its errors before rendering the retained result, refreshing Supply-bank options, inferred bank details, and receiver-start metadata after calculator or bank changes.
- The editor now omits enabled banks whose names are blank or whitespace-only.

### Regression tests

1. Red phase:
   ```sh
   node --test tests/compare-recipe-ui.test.js
   ```
   Observed expected failure: a whitespace-named enabled bank was present in the Supply-bank select.

2. Focused suite:
   ```sh
   node --test tests/compare-recipe-ui.test.js tests/compare-mode-markup.test.js tests/compare-recipe.test.js tests/thermodynamics.test.js
   ```
   Observed: 53 passed, 0 failed.

### Follow-up self-review

- Fixed-minute and target-state waits now feed their modeled recipe-end pressure into subsequent Add-row editor estimates when their preceding prefix is valid.
- If a draft prefix is invalid, the controller leaves the last usable estimate intact and surfaces the underlying validation/simulation error when Compare is run.
- Optimize-mode recalculation remains on its existing branch.

## Review fix 2 — actual post-Wait planning (`a49ecce`)

- `buildCompareProtocol()` and `validateCompareRecipe()` now accept `waitStates` and apply each modeled Wait pressure before planning later Add rows.
- `main.js` computes those wait states by planning/simulating each valid prefix, then passes them into both validation and full protocol construction. The editor pressure estimates use the same sequential states.
- `tests/compare-recipe.test.js` adds a regression asserting that an Add after a modeled Wait starts at the post-Wait pressure.

Verification:

```sh
node --test tests/compare-recipe-ui.test.js tests/compare-mode-markup.test.js tests/compare-recipe.test.js tests/thermodynamics.test.js
```

Observed: 54 passed, 0 failed.

Self-review: Optimize recalculation, Supply-bank persistence, and the retained-result error path remain on their existing branches. No browser smoke was run.

## Review fix 3 — coherent post-Wait receiver state (`a18f9fb`)

- Wait-state handoff now carries pressure, temperature, total moles, oxygen/helium moles, and mix.
- `buildCompareProtocol()` restores the complete receiver state before planning later Add rows, so source-mole requirements, resulting composition, and automatic transfer stages use a coherent state.
- `tests/compare-recipe.test.js` adds post-Wait Add coverage for resulting mix and finite source accounting.

Verification:

```sh
node --test tests/compare-recipe-ui.test.js tests/compare-mode-markup.test.js tests/compare-recipe.test.js tests/thermodynamics.test.js
```

Observed: 55 passed, 0 failed.

Self-review: Optimize simulation and Supply-bank persistence remain unchanged. No browser smoke was run.

## Review fix 4 — temperature-coherent post-Wait Add planning

- `receiverAfterAddedMoles()` now uses the receiver's carried modeled temperature, with the initial physics temperature as its fallback, and persists that temperature in each resulting receiver state.
- Supply-bank pressure and minimum-inventory calculations continue to use the initial physics temperature, while receiver-side Add and equalization calculations use the post-Wait receiver temperature.
- `tests/compare-recipe.test.js` adds a finite-source regression that verifies a following Add consumes the moles required at the modeled Wait temperature.

### Verification

```sh
node --test tests/compare-recipe-ui.test.js tests/compare-mode-markup.test.js tests/compare-recipe.test.js tests/thermodynamics.test.js
```

Observed: 56 passed, 0 failed.

### Self-review

- The regression failed before the fix because required source consumption was calculated at the original 20°C physics temperature instead of the modeled 15°C receiver temperature.
- The receiver now retains temperature alongside pressure, composition, and molar state after each modeled Add/equalization stage; source-bank state remains intentionally evaluated at the initial physics temperature.
- Optimize code remains unchanged. No browser smoke was run.
