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
