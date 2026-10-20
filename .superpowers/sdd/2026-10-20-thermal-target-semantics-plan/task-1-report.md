
## Fix round 3 completion

Added finite equal-target convergence handling: target-medium equal ambient uses `4.6 * tauMinutes` and exact ambient wait endpoint, avoiding Infinity/unbounded sampling. Updated semantic validation/optimizer expectations.

Command: `node --test tests/input-validation.test.js tests/compare-recipe.test.js tests/onboarding-markup.test.js tests/optimizer.test.js tests/thermodynamics.test.js`
Output: 133 tests, 133 passed, 0 failed.

Commit: pending (round 3).

## Fix round 4 completion

Fixed equal target-medium/ambient handling so finite `4.6 * tauMinutes` convergence is used only for `waitMode === 'temperature'`; fixed-minute waits now retain `thermal.waitMinutes` and use `calculateTemperatureAfterWait()`. Updated browser helper/spec terminology from `settledTemperature` to `targetInWaterTemperature` and kept the browser assertion focused on the semantic input/result.

Command: `node --test tests/input-validation.test.js tests/compare-recipe.test.js tests/onboarding-markup.test.js tests/optimizer.test.js tests/thermodynamics.test.js`
Output: 133 tests, 133 passed, 0 failed.

Commit: `55df9b7` — `fix: preserve fixed thermal wait duration`

Concerns: browser spec not run in this environment; no optimizer target conversion or working-pressure scheduling was implemented, per Task 1 scope.

