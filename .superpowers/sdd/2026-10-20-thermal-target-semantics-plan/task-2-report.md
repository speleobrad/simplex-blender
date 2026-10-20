## Fix round 5 completion

Fixed the thermal floor-infeasibility path in `js/optimizer.js`: it now builds the thermalized fallback from the evaluated floor candidate while preserving the original requested in-water pressure/temperature and derived ambient-settled target, then formats the requested in-water error with a labeled ambient diagnostic. The floor regression executes and asserts the returned result instead of throwing on an undefined `fallback`.

Command: `node --test tests/optimizer.test.js tests/thermodynamics.test.js tests/input-validation.test.js tests/results.test.js`
Output: 128 tests, 128 passed, 0 failed.


Commit: `f730105` — `fix: handle thermal floor infeasibility fallback`.
