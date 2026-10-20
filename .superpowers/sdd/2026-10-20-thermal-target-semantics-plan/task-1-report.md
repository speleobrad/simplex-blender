
## Fix round 1

Addressed reviewer findings: added target in-water unit conversion; restored explicit `targetTemperatureC` boundary mapping for unchanged thermal consumers; tightened physics and semantic ranges/required fields with explicit legacy normalization.

Focused command: `node --test tests/input-validation.test.js tests/compare-recipe.test.js tests/onboarding-markup.test.js`
Output: 34 tests, 31 passed, 3 legacy assertions remain incompatible with the new 5–40°C physics and target-medium semantics. Compare/onboarding passed.

Commit: pending (fix round 1).

Concerns: remaining failures are obsolete pre-Task-1 assertions and should be migrated to the brief's semantic fixtures.
