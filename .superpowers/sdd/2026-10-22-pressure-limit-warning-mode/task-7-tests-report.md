# Task 7 RED tests report

Added failing coverage for:

- Warning-mode result notices with a hot-overfill exceedance (measured pressure, applicable limit, and `Transfer 2` step), plus the no-crossing policy notice.
- Optimize flow with 100-bar cylinders, 0% hot overfill, exact `I KNOW WHAT I'M DOING` Warning unlock phrase, 99-bar target, and 40°C transfer gas; verifies feasibility, Warning/hot-overfill notices, and no cylinder-pressure automatic wait.
- What-if flow with a 100-bar cylinder, Warning mode, 110-bar start, and drain-to-20 recipe; verifies success and working-pressure exceedance notice.

Existing Hard stop coverage was preserved. No tests, build, lint, or formatting commands were run (controller owns RED verification).

## Controller RED

- `node --test tests/results.test.js`: 11 passed, 2 failed. Both new cases lacked the Warning-mode status/policy notice.
- `env -u NO_COLOR npm run test:ui -- --config .superpowers/sdd/2026-10-22-pressure-limit-warning-mode/playwright-alt-port.config.mjs --reporter=dot --workers=4 tests/browser/blending.spec.js`: 30 passed, 6 failed across desktop/tablet/mobile. The new Optimize flow lacked Warning/hot-overfill status text, and the What-if flow lacked the working-pressure notice; expected before Task 7 implementation.

## Fix-round regression coverage

- Extended the Optimize Warning-mode flow to reject generic `Recorded input` notices that lack a step identifier.
- Added a Warning-mode What-if Compressor Air transfer at 96 bar with 100-bar working pressure, 5% hot overfill, and 40°C incoming gas; the approximately 100.94-bar transfer endpoint remains inside the 105-bar hot ceiling, so the result must show only the policy notice and no exceedance.
- Added a Warning-mode What-if Compressor Air transfer to 97 bar followed by a 30°C target-temperature wait; the approximately 102.02-bar transfer endpoint and approximately 100.31-bar settled target must produce exactly one working-pressure notice for the settled wait state, with no duplicate Add/Final notices and no hot-overfill notice.

## Fix-round locator correction

- Updated the shared Warning-mode browser helper to target `#settings-pressure-limit-confirmation` directly and assert it is visible before filling the exact unlock phrase. This avoids the cross-browser role-locator mismatch while preserving the unlock behavior assertions.

## Fixture corrections

- The 96-bar What-if now explicitly sets the shared starting pressure to 0 bar before switching to What-if and asserts the modeled final pressure is above 100 bar but below 105 bar.
- The target-temperature flow now uses the visible `Add row` button by role, verifies the row count increases, and targets the newly added last row instead of assuming a fixed row ID.

## Fix-round 2 fixture findings

- The focused run showed the 96-bar case's start-at-zero result was 99 bar, so the Compressor Air target was raised to 98 bar; the stale exact 100.9-bar assertion was removed while retaining the 100–105 bar threshold checks.
- The target-temperature case still had only its initial row after the prior Add row call. It now starts from 0 bar as well, invokes Add row through `evaluate(button => button.click())`, and verifies the second fieldset exists before editing it.

## Fix-round 3 fixture finding

- The target-temperature flow now sets the shared ambient temperature to 20°C before opening What-if; the fixture default of 25°C produced a 99-bar result instead of the expected approximately 100.3-bar settled target.

## Fix-round 4 fixture finding

- The target-temperature wait at 30°C was unreachable from the modeled transfer temperature. The flow now uses a 99-bar Compressor Air target and a reachable 24°C wait target with 20°C ambient, asserting the settled final pressure remains between 100 and 105 bar while retaining the single working-pressure/no-hot-overfill checks.

## Fix-round controller RED

- The focused browser command was run against the corrected fixtures:
  `env -u NO_COLOR npm run test:ui -- --config .superpowers/sdd/2026-10-22-pressure-limit-warning-mode/playwright-alt-port.config.mjs --reporter=dot --workers=4 --grep "keeps a Compressor Air What-if transfer|reports only the settled working-pressure" tests/browser/blending.spec.js`
- Result: 6 failed across desktop/tablet/mobile, as expected against the current mapper. A transient Compressor Air transfer at 101.5 bar (<105-bar hot ceiling) received false working-pressure notices; the target-temperature wait case produced four working-pressure notices rather than one.
- `node --test tests/results.test.js` remains 13 passed, 0 failed; the rendering unit tests do not exercise main.js observation classification.

## Controller RED after production fix round 1

- `node --test tests/results.test.js`: 13 passed, 0 failed.
- The focused browser suite after the first production fix passed the within-hot-ceiling case on all projects but still failed the target-temperature case on desktop/tablet/mobile (3 passed, 3 failed overall).
- Error-context evidence: the result showed `Working pressure limit exceeded: 102.8 bar > 100.0 bar (Wait)` plus the expected settled target warning at `100.7 bar`. The 102.8-bar value comes from the no-transfer Wait step's `pressureAtTransferEndAmbientBar`, which is not an ambient projection in that Compare state.

## RED after production fix round 1 (remaining no-transfer ambient classification)

- `node --test tests/results.test.js`: 13 passed, 0 failed.
- Focused browser suite: 3 passed, 3 failed. The target-temperature What-if flow displayed two Wait warnings: a false `102.8 bar > 100 bar` ambient-threshold event from the no-transfer Wait row and the correct `100.7 bar > 100 bar` settled target event.

## Controller GREEN after production fix round 2

- Focused browser suite: 6 passed, 0 failed across desktop/tablet/mobile.
- `node --test tests/results.test.js tests/optimizer.test.js tests/compare-recipe.test.js tests/pressure-limits.test.js`: 127 passed, 0 failed.
- `env -u NO_COLOR npm run test:ui -- --config .superpowers/sdd/2026-10-22-pressure-limit-warning-mode/playwright-alt-port.config.mjs --reporter=dot --workers=4 tests/browser/settings.spec.js tests/browser/blending.spec.js`: 72 passed, 0 failed across desktop/tablet/mobile.

## Fix-round 3 rendering regression

- Added a results regression combining Warning-mode policy/exceedance notices with automatic-wait metadata. The fake DOM now clears child nodes when `textContent` is assigned, matching browser semantics; the test verifies amber `role=status` notices and automatic-wait text survive thermal-summary rendering.
