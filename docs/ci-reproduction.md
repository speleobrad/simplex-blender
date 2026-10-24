# CI reproduction and visual baselines

This guide explains how to reproduce the GitHub Actions "UI tests" workflow locally, and how to refresh screenshot baselines safely. Read it before touching anything under `tests/browser/screenshots.spec.js-snapshots/`, or before debugging a CI-only UI failure.

## Why local runs can disagree with CI

The workflow (`.github/workflows/ui-tests.yml`) runs on `ubuntu-24.04` with Node 24 and Playwright `v1.64.1`. A developer workstation may differ in OS, fonts, and Node version. Observed differences on the 2026-10 investigation:

| Factor | Fedora workstation (host) | CI / reproduction container |
|---|---|---|
| OS | Fedora 44 | Ubuntu 24.04.5 (`mcr.microsoft.com/playwright:v1.64.1-noble`) |
| Node | v22.23.1 | v24.22.1 (matches workflow) |
| `fc-match sans-serif` | Noto Sans | WenQuanYi Zen Hei |
| Installed font files (`fc-list`) | 587 | 50 |
| JetBrains Mono / Plus Jakarta Sans installed locally | no | no |

Neither environment installs the two app fonts. `index.html` loads them from Google Fonts (`<link>` to `fonts.googleapis.com`). Both environments could reach that host during the investigation (HTTP 200).

**Consequence:** the Fedora host is not CI-equivalent. Use the container for any screenshot decision.

## Known facts vs. unverified hypotheses

Facts (observed):
- The committed diagram baseline `results-diagram-light-desktop-linux.png` showed the old legend "Direct Target" and old step labels.
- At HEAD the UI legend reads "Initial-to-final reference" (`index.html`, changed in commit `ecccb20`, Oct 22). That commit also added a "Scenario summary" tab, which shifts the tab bar and the diagram layout.
- In the Ubuntu container the diagram screenshot differed by 15,230 pixels (about 2.0%), above the 1% `maxDiffPixelRatio`. It was the only failure observed, but that run used `--max-failures=1` and stopped there.
- The same tree passed on the Fedora host before the baseline refresh (local non-CI run; a fresh `CI=1` run also passed).
- Commit `fd1019b` ("Refresh visual baselines for GitHub Chromium", Oct 23) did modify this PNG. It is not an ancestor of `ecccb20` (and vice versa), so the refresh did not include that HTML change. Which tree generated it is unresolved.

Hypotheses (NOT verified):
- The ternary diagram is drawn on a `<canvas>` using `"Plus Jakarta Sans"` and `"JetBrains Mono"` (`js/ui/ternary.js`). No code or test waits for `document.fonts` before drawing. If the canvas draws before the web fonts load, it falls back to a system font, which would differ between hosts. This may explain the host-vs-container difference, but it has not been tested.
- Confirm or reject this before relying on it: wait for `document.fonts.ready` in a throwaway probe and compare the canvas output.

## Reproduce the CI container locally

Prerequisites: `podman`. The first pull of the Playwright image takes time.

1. Export a clean tree. `git archive` only includes committed files, so commit or copy any baseline changes first.

   ```bash
   rm -rf /tmp/ci-fresh && mkdir /tmp/ci-fresh
   git archive HEAD | tar -x -C /tmp/ci-fresh
   # If you have uncommitted snapshot changes you want to test, copy them explicitly:
   # cp tests/browser/screenshots.spec.js-snapshots/<file>.png /tmp/ci-fresh/tests/browser/screenshots.spec.js-snapshots/
   ```

2. Install dependencies and run the workflow steps inside the container. `CI=1` enables the same retry and reporter behavior as CI.

   ```bash
   cd /tmp/ci-fresh
   podman run --rm --network=host -v /tmp/ci-fresh:/work:Z -w /work -e CI=1 \
     mcr.microsoft.com/playwright:v1.64.1-noble bash -lc '
       npm ci > /tmp/npmci.log 2>&1 || { tail -n 30 /tmp/npmci.log; exit 1; }
       npm test
       for s in screenshots core blending settings results data layout; do
         npm run test:ui:$s -- --max-failures=1 || exit 1
       done'
   ```

   The container image already provides Chromium and system dependencies. The workflow runs `npx playwright install-deps chromium` and `npx playwright install chromium` on GitHub; the image makes those steps unnecessary here.

3. `--network=host` was used during the investigation. Whether it is strictly required is unverified.

4. Read the output. A failing test prints the snapshot name and pixel count. Artifacts go to `test-results/<test-name>/` inside the copy (`*-actual.png`, `*-diff.png`, `test-failed-1.png`).

To run one segment, replace the loop with, for example, `npm run test:ui:screenshots -- --max-failures=1`.

## Run the local (non-CI) suite correctly

`playwright.config.js` sets `reuseExistingServer: !process.env.CI`. Without `CI=1`, Playwright reuses any server already on port 4173, which may be serving stale code. Always use `CI=1` when reproducing CI results:

```bash
CI=1 npx playwright test tests/browser/screenshots.spec.js --max-failures=1
```

## Refreshing a screenshot baseline

Only refresh when the visual change is intentional and reviewed. Never raise `maxDiffPixelRatio` to hide a diff.

1. Reproduce the failure in the container (steps above) and inspect `*-actual.png` vs. the baseline and `*-diff.png`. Confirm the change matches an intended commit (text, layout, or data).
2. Regenerate only the changed snapshot, in the container copy:

   ```bash
   podman run --rm --network=host -v /tmp/ci-fresh:/work:Z -w /work -e CI=1 \
     mcr.microsoft.com/playwright:v1.64.1-noble bash -lc \
     'npx playwright test tests/browser/screenshots.spec.js -g "<test name>" --project=<project> --update-snapshots=changed'
   ```

   `--update-snapshots=changed` rewrites only mismatched images. It logged the single regenerated file during the diagram fix.
3. Confirm the changed file list is what you expect (`git status`/`git diff --stat` in the repo after copying back).
4. Copy only the regenerated PNGs back into the repo, commit with the rationale, then rerun the full workflow in a fresh container.

Do not run a broad `--update-snapshots` on the whole suite; it rewrites every baseline and hides regressions.

## Chronology of the diagram baseline fix

- `fd1019b` refreshed the diagram PNG. That image matches the pre-change UI.
- `ecccb20` changed the legend and added a tab (What-if work). The two commits are on divergent ancestry.
- The CI failure was the stale PNG against the current UI.
- The baseline was regenerated in the Ubuntu container with `--update-snapshots=changed`. Tolerance was unchanged.
- The exact tree that produced `fd1019b` is unresolved; do not assume it was a missed update.

## Checklist for the next agent

- [ ] Reproduce in the Ubuntu container with `CI=1`, not on the host.
- [ ] Use `--max-failures=1` to match CI, and run every UI segment, not only the failing one.
- [ ] Inspect the diff image before any baseline change.
- [ ] Label font-rendering theories as hypotheses until a probe confirms them.
- [ ] Never widen tolerance to pass a visual regression.
