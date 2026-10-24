# Agent guide

Detailed docs live in `docs/`. Start with `docs/development.md` for commands and `docs/architecture.md` for structure.

## Invariants

- Before changing any screenshot baseline under `tests/browser/screenshots.spec.js-snapshots/`, read `docs/ci-reproduction.md`.
- Never claim GitHub Actions passed from a local or Docker run. Local Docker reproduction is evidence, not confirmation; final confirmation requires a pushed Actions run.
- Never raise `maxDiffPixelRatio` to hide a visual diff.
- Do not push to `origin/master` without explicit user instruction.
