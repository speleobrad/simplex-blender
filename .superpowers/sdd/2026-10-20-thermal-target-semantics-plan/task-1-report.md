
## Fix round 3 completion

Added finite equal-target convergence handling: target-medium equal ambient uses `4.6 * tauMinutes` and exact ambient wait endpoint, avoiding Infinity/unbounded sampling. Updated semantic validation/optimizer expectations.

Command: `node --test tests/input-validation.test.js tests/compare-recipe.test.js tests/onboarding-markup.test.js tests/optimizer.test.js tests/thermodynamics.test.js`
Output: 133 tests, 133 passed, 0 failed.

Commit: pending (round 3).

Concerns: browser spec not run in this environment; no browser-specific changes were needed for this final round.
