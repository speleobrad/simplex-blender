# Pressure-Limit Warning Mode Design

## Status

Approved in conversation; implementation has not started.

## Goal

Add a global setting in **Settings → General** that selects whether cylinder working-pressure and transient hot-overfill limits are enforced or reported as warnings. Hard stop is the default. Warning mode requires the phrase `I KNOW WHAT I'M DOING` once to permanently unlock the option; matching ignores case and accepts a single quote, backtick, or double quote for the apostrophe.

## Approved decisions

- One policy applies to calculator/Optimize and Compare; there are no per-flow modes.
- Warning mode bypasses only cylinder working-pressure and hot-overfill enforcement.
- Existing per-field pressure bounds (maximum 350 bar; calculator target minimum 10 bar) and independent compressor/booster equipment limits remain enforced.
- Hard stop preserves the current behavior, including automatic Optimize waits/splits when possible.
- Unlocking is permanent in saved settings. The phrase itself is never stored.
- Warning mode stays visibly identified in Settings and results; actual exceedances identify the applicable limit and affected input or step.

## Current behavior and boundaries

- `js/settings.js` owns settings defaults, migration, validation, copies, and browser-storage persistence. Legacy settings may omit newer fields; load-time normalizers supply safe defaults.
- `js/input-validation.js` rejects initial and target pressure above cylinder working pressure. An interim measurement above working pressure is currently accepted only when it is transient-hot and within the cylinder's configured hot-overfill ceiling.
- `js/optimizer.js` checks modeled thermal pressures against the working-pressure or transient hot-overfill ceiling and equipment limits. It may extend waits or split transfers to stay within those limits; a plan fails if it cannot be made safe within its wait bound.
- `js/compare-recipe.js` rejects initial and Add target pressures above cylinder working pressure in both recipe validation and protocol construction. Compressor Air has a separate equipment pressure ceiling.
- `js/ui/results.js` renders calculator and Compare results, including Optimize's automatic-wait warnings.

These existing behaviors form the Hard stop mode. The thermodynamic model, gas/supply constraints, equipment ceilings, and 350-bar supported range are not relaxed by this feature.

## Settings and persistence

Add these fields to `DEFAULT_SETTINGS`:

```js
{
  pressureLimitMode: 'hard-stop',
  pressureWarningUnlocked: false
}
```

`pressureLimitMode` accepts only `'hard-stop'` or `'warning'`. `pressureWarningUnlocked` is boolean. A warning mode is valid only when unlocked. Settings normalization, copying, validation, loading, and saving preserve these fields. Legacy saved settings without them normalize to Hard stop and locked. Invalid mode/unlock combinations follow the existing invalid-settings fallback behavior.

Settings → General presents Hard stop and Warning. Warning cannot be selected until the phrase is entered with the correct words and spacing; matching ignores letter case and accepts a single quote, backtick, or double quote for the apostrophe in “I'm”. The phrase unlocks Warning in the current draft; Save persists the unlocked flag and selected mode, while Cancel discards draft changes. Once saved, the unlock survives reloads and switching back to Hard stop does not relock the option. Factory reset restores Hard stop and locked. Only the boolean unlock state is persisted; the phrase is not. This is an explicit user-intent confirmation in a local browser setting, not an authorization or tamper-resistance mechanism.

When Warning is selected, General displays an amber notice that cylinder limits will not be enforced.

## Pressure policy

Use a small pure pressure-limit helper in `js/pressure-limits.js` to compute the applicable cylinder ceiling and consistently classify exceedances. The helper must preserve the current rule:

- At ambient or settled/target-temperature states, the ceiling is working pressure.
- Only above-ambient transient states may use `workingPressureBar × (1 + hotOverfillPercent / 100)`.

Thread the saved mode through calculator validation, Optimize thermal scheduling, and both Compare validation and protocol construction.

### Hard stop

Hard stop remains the default and preserves existing behavior:

- Calculator initial/target pressure checks and interim measurement limits remain enforced.
- Optimize continues to add waits/split transfers to avoid cylinder-limit crossings where possible, and fails when it cannot find a safe sequence within its existing wait bound.
- Compare continues to reject a starting or Add target pressure above working pressure.

### Warning

Warning mode removes only the cylinder ceiling from blocking/scheduling decisions:

- Calculator initial, target, and interim pressures may exceed the cylinder ceiling only within their existing per-field ranges (initial/interim 0–350 bar; calculator target 10–350 bar) and other validation rules.
- Optimize does not add a wait or split solely to satisfy a cylinder pressure limit. It continues to enforce compressor/booster and other existing operational constraints; those constraints may still cause a wait, split, or failure.
- Compare may use initial/Add target pressures above working pressure within its existing 0–350 bar pressure range. Compressor Air and other equipment constraints remain enforced.
- The working-pressure/hot-overfill rule remains active for classification and notices even though it no longer blocks the calculation.

An above-ambient transient pressure between working pressure and its hot-overfill ceiling is permitted and is not an exceedance. Exceeding the applicable ceiling is reported. Pressures beyond 350 bar or outside an input's existing field-specific range remain invalid even in Warning mode.

## Warning presentation

When Warning mode is active, the results surface displays a persistent amber notice that working-pressure and hot-overfill enforcement is disabled, including when a result is otherwise feasible and no limit was crossed. When an input or modeled result crosses its applicable cylinder ceiling, report the observed pressure, applicable ceiling, and affected input or protocol step; distinguish working-pressure exceedances from transient hot-overfill exceedances. Render values in the selected units and use accessible status/alert semantics. Do not convert a warning into a calculation error.

Optimize's existing automatic-wait notices remain unchanged in Hard stop mode. Warning-mode results do not claim the cylinder is within its rated limits.

## Component responsibilities

- `js/settings.js`: setting defaults, migration, copies, and enum/unlock validation.
- `index.html`, `js/ui/settings-dialog.js`, and `js/main.js`: General controls, exact-phrase unlock, draft/save/cancel behavior, and propagation of the selected policy.
- `js/pressure-limits.js`: shared applicable-ceiling and exceedance classification logic.
- `js/input-validation.js`: apply Hard stop versus Warning to initial, target, and interim cylinder-pressure checks while retaining other validation.
- `js/optimizer.js`: preserve the existing Hard stop scheduler and, in Warning mode, ignore cylinder limits without suppressing equipment constraints; provide actual exceedance data for notices.
- `js/compare-recipe.js`: apply the policy to both editable-recipe validation and protocol construction while preserving equipment checks.
- `js/ui/results.js`: show the active policy notice and actual exceedances in calculator and Compare results.
- `docs/UI.md`, `docs/optimizer.md`, and `docs/architecture.md`: document the mode, scope, thresholds, and safety implications.

## Error handling and edge cases

- A wrong phrase or altered wording/spacing does not unlock Warning. Matching is case-insensitive and accepts a single quote, backtick, or double quote for the apostrophe.
- Cancel discards an unlock that has not been saved.
- Malformed saved mode or an invalid warning-without-unlock combination falls back through existing settings-load behavior; legacy records missing the fields remain valid and default locked.
- Invalid cylinder preset hot-overfill values remain invalid regardless of mode.
- Invalid gas, inventory, thermal input, supported pressure range, and equipment pressure limits remain errors/constraints in both modes.
- In Warning mode, show the policy notice even if there is no crossing; show exceedance detail only for inputs/states that actually exceed the applicable cylinder ceiling.

## Acceptance criteria

1. A first-run or legacy settings record loads Hard stop with Warning locked.
2. The case-insensitive confirmation phrase, with single-quote/backtick/double-quote apostrophe variants, unlocks Warning once; the unlock and selected mode persist on Save, the phrase is not persisted, Cancel discards unsaved unlocks, and factory reset relocks.
3. Hard stop retains existing calculator validation, Compare limits, and Optimize wait/split behavior.
4. Warning mode lets calculator and Compare flows proceed above cylinder limits within their existing field-specific pressure ranges (maximum 350 bar) and does not schedule waits/splits solely to satisfy cylinder limits.
5. Warning mode still enforces supported input ranges, compressor/booster pressure limits, and other existing validation/safety constraints.
6. Warning classification uses working pressure except for above-ambient transient states, which use the configured hot-overfill ceiling. A transient value above working pressure but within the hot ceiling is not reported as an exceedance.
7. Warning-mode results visibly identify the active policy and report actual exceedances with the applicable threshold and affected input/step in selected units.
8. Documentation describes the setting, the limits it bypasses, and the constraints that remain enforced.

## Verification

- Run focused Node tests for settings migration/validation, calculator input validation, Optimize scheduling, and Compare recipe bounds.
- Run browser tests for exact-phrase unlock, Save/Cancel/reload/reset behavior, and visible warning-mode notices on actual calculator and Compare results.
- Run `npm test` and `npm run test:ui`.
- Smoke the running application through Settings → General, a cylinder-limit exceedance in Optimize, and a cylinder-limit exceedance in Compare; confirm retained equipment caps and the accessible warning surface.
