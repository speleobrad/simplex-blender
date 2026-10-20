# Task 3 implementation report

## Status

**Complete.** Shared browser assertions and factory-state invariant coverage are implemented for desktop, tablet, and mobile Chromium projects. Geometry, containment, clipping, focus visibility, panel interactivity, overlap, and runtime-cleanliness checks return structured diagnostics and fail with actionable details. The suite includes deliberate synthetic failures for off-viewport geometry and missing focus indicators.

## Commits

- `e494199 test: add browser layout invariants` — initial Task 3 assertion helpers and invariant suite.
- `5934224 test: strengthen layout invariant diagnostics` — final review fixes, scroll-aware diagnostics, focus-ring intersection checks, synthetic focus failure coverage, and scroll-position coverage.
- Earlier Task 1–2 commits preserved: `4ad8350 test: make fixture resets repeatable` and its predecessor `4a9045e test: harden browser fixture scenarios`.

## Files

- `tests/browser/assertions/layout.js`
  - Added `assertNoUnexpectedOverflow(page)` using document scroll metrics and the configured Playwright viewport.
  - Added `assertInsideViewport(page, locator, options)` with visible-box filtering, zero-size exclusion, viewport diagnostics, and offscreen rectangle fallback for mobile emulation.
  - Added `assertContained(page, child, container)` with edge-by-edge checks.
  - Added `assertNoUnexpectedOverlap(page, locator, options)` for selected visible nodes, containment handling, and explicit predicate/allowlist support. Predicate diagnostics include rectangles and stable identifiers.
- `tests/browser/assertions/runtime.js`
  - Added `assertNoClippedText(page, locator)` using rendered text ranges, control scroll dimensions, and computed overflow.
  - Added `assertRuntimeClean(runtime, options)` for uncaught errors, console failures, and failed requests. Expected failures require explicit options.
- `tests/browser/assertions/accessibility.js`
  - Added `assertVisibleFocus(page, locator)` with active-element, focus-ring style/geometry, viewport intersection, and element coverage checks.
  - Added `assertOnlyActivePanelsInteractive(page, selectors)` for hidden panel tabbable-control diagnostics.
- `tests/browser/layout-invariants.spec.js`
  - Added factory-state invariant coverage for primary shell regions, active result panels, visible tab controls, cards, clipping, focus, runtime cleanliness, scroll-relative geometry, and overlap.
  - Added deliberate `#synthetic-off-viewport` fixture coverage through `page.evaluate`; the test verifies selector, rectangle, and viewport details in the failure.
  - Added deliberate `#synthetic-focus-without-ring` coverage to verify missing rendered focus indicators fail diagnostically.

## Commands and results

1. Focused viewport/failure diagnostics during implementation:

   ```sh
   npm run test:ui -- tests/browser/layout-invariants.spec.js --grep "primary regions|off-viewport"
   ```

   Result: **6 passed** across desktop, tablet, and mobile projects.

2. Focused focus-ring coverage:

   ```sh
   npm run test:ui -- tests/browser/layout-invariants.spec.js --grep "readable labels"
   ```

   Result: **3 passed** across desktop, tablet, and mobile projects.

3. Final complete invariant suite after review fixes:

   ```sh
   npm run test:ui -- tests/browser/layout-invariants.spec.js
   ```

   Result: **24 passed (11.9s)** across desktop, tablet, and mobile projects.

4. Whitespace check before final review-fix commit:

   ```sh
   git diff --check
   ```

   Result: passed with no output.

5. Commits:

   ```sh
   git add tests/browser/assertions tests/browser/layout-invariants.spec.js
   git commit -m "test: add browser layout invariants"
   git add tests/browser/assertions/accessibility.js tests/browser/assertions/layout.js tests/browser/layout-invariants.spec.js
   git commit -m "test: strengthen layout invariant diagnostics"
   ```

   Result: commits `e494199` and `5934224` created successfully.

## Self-review

- Preserved the Task 1–2 fixture/runtime interfaces; tests continue using `appPage.goto()` and seeded scenarios, while runtime assertions consume the existing `captureRuntime` result through `appPage.runtime`.
- Assertions throw structured errors with `error.diagnostics`; successful calls return structured diagnostics rather than bare booleans.
- Geometry checks use `boundingBox()` and exclude zero-size/non-visible elements. Mobile emulation exposed a distinction between `window.innerWidth` and the configured Playwright viewport; viewport comparisons consistently use `page.viewportSize()` while retaining browser scroll metrics in diagnostics.
- Scroll-dependent diagnostics now capture `scrollX`/`scrollY` once and report them consistently for overflow and focus checks.
- Focus checks verify the rendered focus ring intersects the viewport by geometry, rather than accepting an offscreen outline merely because computed style is non-default.
- Overlap checks operate only on explicitly selected card/content nodes and do not compare the entire DOM. Normal containment is ignored by default and can be made strict with `allowContainment: false`; intentional overlaps require an explicit predicate or allowlist.
- Runtime allowances are opt-in through assertion options; no additional global suppression was added beyond existing fixture capture behavior.
- Synthetic failure tests run in all three viewport projects and confirm actionable failure text.
- `git diff --check` passed before the final review-fix commit.

## Concerns

- The application header Settings button currently suppresses its own visible outline. The focus invariant therefore targets the onboarding Skip control, which has the application's explicit focus-visible ring; the helper still rejects controls with no computed outline/box-shadow indicator or no visible ring intersection.
- The mobile browser project can report a layout viewport different from its configured Playwright viewport under this app's mobile emulation. The assertion deliberately uses `page.viewportSize()` for viewport bounds and keeps `window.innerWidth` in overflow diagnostics so this discrepancy remains observable.
- Playwright emits existing `NO_COLOR`/`FORCE_COLOR` warnings during the suite; they do not fail tests and are unrelated to the new assertions.
