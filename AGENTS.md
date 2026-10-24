# Agent guide

Start here. Detailed documentation lives in `docs/`.

## Where things are

- Architecture and modules: `docs/architecture.md`
- Development commands and test suites: `docs/development.md`
- UI behavior and layout: `docs/UI.md`
- Optimizer and gas physics: `docs/optimizer.md`, `docs/gas-physics.md`
- Presets and sources: `docs/preset-sources.md`

## Testing and CI (read before UI or screenshot work)

- CI-equivalent reproduction (Ubuntu Playwright container), host-vs-CI differences, font notes, and baseline refresh procedure: `docs/ci-reproduction.md`.
- Run the Node suite with `npm test`. Run browser suites with `CI=1` when reproducing CI results (a non-CI run may reuse a stale server on port 4173).
- Screenshot baselines are platform-specific (`*-linux.png`). Do not refresh one without reviewing the diff and confirming the change is intentional. Never raise `maxDiffPixelRatio` to hide a diff.

## Rules

- Use `edit` for file changes; avoid `sed`/`python` rewrites.
- Verify behavior changes by running the relevant test or scenario, not only by reading code.
- Do not push to `origin/master` without the user's explicit instruction; pushing triggers the UI workflow and the Pages deploy gate.
