# SDD ledger — plan: docs/superpowers/plans/2026-10-20-thermal-target-semantics-plan.md

## Setup

- Workspace: `.worktrees/thermal-target-semantics`
- Baseline: `5d96a2f` (`docs: plan thermal target implementation`)
- Baseline tests: `npm test` — 304 passed, 0 failed.
- Spec authority: `docs/superpowers/specs/2026-10-20-thermal-target-semantics-design.md`

## Preflight plan scan

### Shared-file/interface pairs

| Tasks | Shared surface | Finding | Ruling |
|---|---|---|---|
| 1 ↔ 2 | `js/main.js` input contract → `js/optimizer.js` thermal input | Task 1 defines semantic temperature fields; Task 2 consumes them for target normalization. | Proceed in order; Task 2 must consume the exact Task 1 contract. |
| 1 ↔ 2 | `js/thermodynamics.js` target-medium waits | Task 1 validates equal target-medium/ambient; Task 2 handles equal convergence without NaN. | Required dependency; Task 2 owns runtime behavior. |
| 1 ↔ 3 | `js/optimizer.js` thermal input and protocol | Task 1 establishes validated fields; Task 3 schedules waits against the same protocol. | Proceed in order; safety scheduler receives normalized thermal input. |
| 1 ↔ 4 | DOM labels/IDs and result inputs | Task 1 changes target labels; Task 4 renders related result labels. | Use semantic labels consistently; retain stable IDs where callers depend on them. |
| 1 ↔ 5 | Browser selectors and documentation | Task 5 verifies Task 1 labels/ranges. | Add browser assertions only after Task 1’s final DOM contract exists. |
| 2 ↔ 3 | Thermal optimizer target search and safe protocol | Task 2 searches to a derived ambient target; Task 3 must safety-check each candidate before returning it. | Safety scheduling wraps candidate simulation and cannot change target conversion semantics. |
| 2 ↔ 4 | Thermal result object | Task 2 produces hot/ambient/in-water fields; Task 4 renders them. | Task 4 consumes exact fields from Task 2; no UI-side recomputation. |
| 2 ↔ 5 | Result fields and browser assertions | Task 5 verifies the result contract. | Browser tests use visible labels/results, not internal fields. |
| 3 ↔ 4 | Automatic wait metadata | Task 3 produces structured metadata; Task 4 renders it. | UI must consume metadata, never infer warnings from text. |
| 3 ↔ 5 | Safe protocol and warning visibility | Task 5 exercises the safety scheduler. | Browser case must trigger a deterministic extension and assert `!`. |
| 4 ↔ 5 | Result/chart labels | Task 5 verifies rendered states. | Complete renderer tests before browser assertions. |

### Per-task consistency

| Task | Internal consistency check | Finding | Ruling |
|---|---|---|---|
| 1 | Tests ↔ validation/UI files | New ranges and field meanings match the spec; Compare retains row pressure semantics. | Proceed. |
| 2 | Tests ↔ conversion/result interfaces | Tests require the exact in-water/ambient fields produced by the task. | Proceed. |
| 3 | Tests ↔ scheduler contract | Tests require safe endpoints, extension metadata, and split stages described by implementation steps. | Proceed; use the existing 1440-minute ceiling. |
| 4 | Tests ↔ renderer contract | Tests require all three state labels and structured warning metadata. | Proceed. |
| 5 | Browser/docs ↔ completed tasks | Browser flow depends on Tasks 1–4 and documentation records the final behavior. | Proceed last. |

### Plan conflicts and defects

- No contradiction with the spec found.
- No tautological test requirement found; assertions target observable values, constraints, labels, and transitions.
- Ruling: preserve existing stable DOM IDs where browser/tests depend on them; update labels and semantic field mapping without creating duplicate editable temperature controls.

## Task status


- Ruling: the first implementer accidentally committed from the root checkout; the commit and pre-existing uncommitted changes were transferred into the isolated worktree, and the root checkout was restored to `5d96a2f`. Cost if wrong: any missing root-only change would need manual recovery; the transfer was verified by the feature worktree diff and focused tests.
- Task 1: complete (commits `185e8a2`..`edb7d1f`, review clean after rounds 1–5; focused unit suite 138 passed)
- Task 2: complete (commits `4fc6b85`..`f83de5a`, review clean after rounds 1–5; focused unit suites 128 passed)

### Task 3 verification

- Implementation/final measurement-continuity correction: `ea4aad4 fix: preserve measured thermal transfer starts`.
- Current complete suite: `npm test` — **336 tests, 334 passed, 2 failed**. The two failures are the existing thermal ceiling cases `reports an infeasible result when the requested settled target exceeds the hot ceiling` (`tests/optimizer.test.js:2008`) and `omits an unsafe thermal maximum fallback instead of returning it as feasible` (`tests/optimizer.test.js:2462`); both currently return `true` where the test expects `false`.
- Baseline complete suite: clean worktree at `f83de5a`, `npm test` — **320 tests, 320 passed, 0 failed**.
- Focused thermal suite after `ea4aad4`: **123 tests, 121 passed, 2 failed**, the same two thermal ceiling cases. Assignment-specific hot-endpoint, automatic-wait, split-continuity, drain-composition, finite-source conversion, and measurement-identity coverage passed.
