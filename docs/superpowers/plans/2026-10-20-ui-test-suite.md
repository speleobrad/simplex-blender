# Comprehensive UI Test Suite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a deterministic Playwright/Chromium browser suite that exercises the entire Simplex blender UI and detects layout, overlap, clipping, overflow, focus, and runtime artifacts.

**Architecture:** Keep the existing Node unit/DOM suite unchanged and add an isolated Playwright project under `tests/browser/`. Use fresh browser contexts with explicit storage fixtures, user-level helpers, reusable geometry/runtime assertions, and targeted screenshot baselines. Run the app through a local HTTP server so native ES modules behave as they do in production.

**Tech Stack:** Playwright Test, Chromium, Node.js ES modules, the existing static HTML/CSS/JavaScript app, Node’s built-in test runner for existing tests.

**Spec:** `docs/superpowers/specs/2026-10-20-ui-test-suite-design.md`

## Global Constraints

- Target Chromium initially; define desktop, tablet-ish, and narrow mobile viewport projects.
- Use fresh browser contexts and deterministic factory/custom-data fixtures; never depend on test order or real user data.
- Interact through accessible user-level locators and existing storage/file contracts; do not mirror private implementation functions.
- Geometry assertions are the primary artifact detector; screenshots are targeted supporting regressions, not the only oracle.
- Preserve `npm test` as the existing fast unit/DOM test command.
- Serve the app over HTTP with native ES modules and local preset-file access.
- Fail on uncaught app exceptions, same-origin module/request failures, and actionable layout invariant violations while classifying expected CDN/storage/import failures explicitly.
- Do not alter product behavior merely to make a test pass.

---

### Task 1: Add Playwright dependency and project command

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `playwright.config.js`
- Modify: `.gitignore`

**Interfaces:**
- Produces `npm run test:ui` as the browser-suite entry point.
- Produces a Playwright config with a `chromium` project and named viewport projects consumed by later browser tests.

- [ ] **Step 1: Add the dependency and command**

Run:

```sh
npm install --save-dev @playwright/test
npx playwright install chromium
```

Update `package.json` so scripts contain:

```json
{
  "test": "node --test",
  "test:ui": "playwright test"
}
```

Keep the existing `test` script unchanged.

- [ ] **Step 2: Write the configuration test scaffold**

Create one minimal browser test at `tests/browser/smoke.spec.js`:

```js
import { test, expect } from '@playwright/test';

test('application loads over HTTP', async ({ page }) => {
  await page.goto('/index.html');
  await expect(page).toHaveTitle('Simplex blender');
  await expect(page.getByRole('tab', { name: 'Blending' })).toBeVisible();
});
```

- [ ] **Step 3: Configure the local server and viewport projects**

Create `playwright.config.js` with:

```js
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/browser',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['html', { open: 'never' }], ['line']] : 'list',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    reducedMotion: 'reduce',
    serviceWorkers: 'block'
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1000 } } },
    { name: 'tablet', use: { ...devices['Desktop Chrome'], viewport: { width: 900, height: 1000 } } },
    { name: 'mobile', use: { ...devices['Pixel 5'], viewport: { width: 393, height: 851 } } }
  ],
  webServer: {
    command: 'python3 -m http.server 4173',
    url: 'http://127.0.0.1:4173/index.html',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000
  }
});
```

Use the repository’s actual ignore-file convention for `test-results/`, `playwright-report/`, and screenshot output.

- [ ] **Step 4: Run the smoke test**

Run: `npm run test:ui -- tests/browser/smoke.spec.js`

Expected: all three viewport projects pass and the generated report/artifacts are ignored.

- [ ] **Step 5: Commit**

```sh
git add package.json package-lock.json playwright.config.js tests/browser/smoke.spec.js .gitignore
git commit -m "test: add Playwright Chromium project"
```

---

### Task 2: Build deterministic browser fixtures and runtime capture

**Files:**
- Create: `tests/browser/fixtures/app-fixtures.js`
- Create: `tests/browser/fixtures/storage-fixtures.js`
- Create: `tests/browser/fixtures/import-fixtures/valid-gases.json`
- Create: `tests/browser/fixtures/import-fixtures/invalid.json`
- Modify: `tests/browser/smoke.spec.js`

**Interfaces:**
- `test` fixture extends Playwright test with `appPage`, `seedStorage`, `captureRuntime`, and `resetApp`.
- `seedStorage(page, scenarioName)` writes only the existing application storage records required for a named scenario before navigation.
- `captureRuntime(page)` returns `{ errors, consoleMessages, failedRequests }` and fails same-origin app errors while allowing explicitly classified CDN warnings.
- `appPage.goto()` opens `/index.html` after fixture setup.

- [ ] **Step 1: Define storage state names and records**

Use the exact existing storage contracts:

```js
export const storageScenarios = {
  factory: {},
  tourSeen: {
    'simplex-gas-remixer-onboarding': JSON.stringify({
      consentAccepted: true,
      wizardSeen: true
    })
  },
  populatedInventory: {
    'simplex-gas-remixer-banks': JSON.stringify([
      { id: 'test-helium', name: 'Helium reserve with a deliberately long label', volumeL: 40, pressureBar: 150, oxygenPercent: 0, heliumPercent: 100, enabled: true },
      { id: 'test-oxygen', name: 'Oxygen', volumeL: 50, pressureBar: 200, oxygenPercent: 100, heliumPercent: 0, enabled: false },
      { id: 'test-mix', name: 'Tx 18/45', volumeL: 12, pressureBar: 45, oxygenPercent: 18, heliumPercent: 45, enabled: true, gasPresetName: null }
    ])
  },
  invalidSavedData: {
    'simplex-gas-remixer-banks': '{not-json',
    'simplex-gas-remixer-onboarding': JSON.stringify({
      consentAccepted: 'yes',
      wizardSeen: false
    })
  }
};
```

Add `simplex-gas-remixer-settings` only in settings scenarios, using a serialized `DEFAULT_SETTINGS`-compatible object imported from `js/settings.js`. Add `simplex-gas-remixer-theme` only in theme scenarios, with the literal value `light` or `dark`. The fixture must not invent alternate storage keys or a second serialization format.

- [ ] **Step 2: Implement isolated context setup**

Implement `seedStorage(page, scenarioName)` with `page.addInitScript` so storage is populated before application modules execute. Add a `resetApp` helper that clears storage, reloads, and waits for the app’s initial navigation/render state.

- [ ] **Step 3: Add runtime request/error capture**

Register listeners before navigation. Record console errors, page errors, failed requests, and same-origin response failures. Ignore known CDN warning/request classes only by URL and message; do not suppress local module failures.

- [ ] **Step 4: Expose the fixture test object**

Use `test.extend` and export `{ test, expect }` from `app-fixtures.js`. Make every test receive a fresh page/context by relying on Playwright’s default isolation.

- [ ] **Step 5: Run fixture smoke coverage**

Add tests that load factory and `tourSeen` states and assert the expected consent/tour boundary. Run:

```sh
npm run test:ui -- tests/browser/smoke.spec.js
```

Expected: both states pass without leaking storage between tests.

- [ ] **Step 6: Commit**

```sh
git add tests/browser/fixtures tests/browser/smoke.spec.js
git commit -m "test: add deterministic browser fixtures"
```

---

### Task 3: Implement shared geometry, containment, focus, and overlap assertions

**Files:**
- Create: `tests/browser/assertions/layout.js`
- Create: `tests/browser/assertions/runtime.js`
- Create: `tests/browser/assertions/accessibility.js`
- Create: `tests/browser/layout-invariants.spec.js`

**Interfaces:**
- `assertNoUnexpectedOverflow(page)` checks document scroll width against viewport width.
- `assertInsideViewport(page, locator, options)` reports the locator’s rectangle and viewport when it escapes.
- `assertContained(page, child, container)` checks all child edges against the container rectangle.
- `assertNoUnexpectedOverlap(page, locator, options)` compares selected visible boxes and accepts an explicit `allowOverlap` predicate/allowlist.
- `assertNoClippedText(page, locator)` detects rendered text/control clipping for selected controls.
- `assertVisibleFocus(page, locator)` focuses a locator and checks the focus ring intersects the viewport and the element is not covered.
- `assertOnlyActivePanelsInteractive(page, selectors)` checks hidden screens/panels have no tabbable visible controls.
- `assertRuntimeClean(runtime)` fails on uncaught app errors and unexpected same-origin failures.

- [ ] **Step 1: Write failing geometry tests**

In `tests/browser/layout-invariants.spec.js`, load factory state and create assertions for header, active screen, visible tabs, and main cards. Include a test that deliberately evaluates a known off-viewport synthetic fixture element through `page.evaluate` and expects `assertInsideViewport` to fail with selector and rectangle details.

- [ ] **Step 2: Implement rectangle helpers**

Use `locator.boundingBox()` and `page.evaluate(({ selector }) => ...)` only for computed style/scroll metrics. Treat zero-size hidden elements as excluded when the assertion targets visible elements. Return structured diagnostics, not only boolean messages.

- [ ] **Step 3: Implement intentional-overlap handling**

Select only user-facing interactive/content nodes by role or explicit stable selectors. Whitelist icon-in-button, badge-in-card, chart overlay, and decorative layers. Do not compare every DOM node; that would classify normal containment as a product defect.

- [ ] **Step 4: Implement clipping and focus checks**

Compare `scrollWidth`/`clientWidth`, rendered text dimensions, computed overflow, `document.activeElement`, and element intersection with the viewport. Include accessible name and stable identifier in errors.

- [ ] **Step 5: Implement runtime assertions**

Connect `captureRuntime` output to `assertRuntimeClean`. Expected CDN warnings and deliberate storage/import failure scenarios must be passed as explicit options, not globally ignored.

- [ ] **Step 6: Run invariant tests**

Run:

```sh
npm run test:ui -- tests/browser/layout-invariants.spec.js
```

Expected: factory desktop/tablet/mobile states pass and the deliberate synthetic failure proves diagnostics are actionable.

- [ ] **Step 7: Commit**

```sh
git add tests/browser/assertions tests/browser/layout-invariants.spec.js
git commit -m "test: add browser layout invariants"
```

---

### Task 4: Add global shell, onboarding, navigation, and theme flows

**Files:**
- Create: `tests/browser/helpers/navigation.js`
- Create: `tests/browser/helpers/onboarding.js`
- Create: `tests/browser/global-shell.spec.js`
- Create: `tests/browser/onboarding.spec.js`

**Interfaces:**
- `selectPrimaryScreen(page, name)` selects Blending, Inventory, or Settings and verifies the selected tab/panel.
- `selectResultTab(page, name)` selects a result tab and verifies panel exclusivity.
- `acceptConsent(page)` accepts the consent gate and waits for the tour boundary.
- `completeOrExitTour(page, action)` drives Done, Skip, or Escape and verifies persisted state.
- `toggleTheme(page)` toggles via the user-visible control and returns the root `data-theme` value.

- [ ] **Step 1: Write tests for consent and navigation boundaries**

Cover fresh consent visibility, focus/background blocking, acceptance, tour launch/exit, reload persistence, primary screen navigation, and header geometry at all viewports.

- [ ] **Step 2: Implement semantic navigation helpers**

Use `getByRole('tab')`, `getByRole('button')`, labels, and stable IDs only where no accessible locator exists. Wait for panel visibility/state rather than arbitrary sleeps.

- [ ] **Step 3: Add theme and storage-warning checks**

Verify action label/icon changes, root theme state, reload persistence, warning visibility for invalid saved data, and clean runtime output.

- [ ] **Step 4: Run focused coverage**

```sh
npm run test:ui -- tests/browser/global-shell.spec.js tests/browser/onboarding.spec.js
```

Expected: consent, tour, navigation, theme, and warning tests pass in the relevant viewport projects.

- [ ] **Step 5: Commit**

```sh
git add tests/browser/helpers/navigation.js tests/browser/helpers/onboarding.js tests/browser/global-shell.spec.js tests/browser/onboarding.spec.js
git commit -m "test: cover onboarding and global shell"
```

---

### Task 5: Cover blending inputs and all result tabs

**Files:**
- Create: `tests/browser/helpers/blending.js`
- Create: `tests/browser/blending.spec.js`
- Create: `tests/browser/results.spec.js`
- Create: `tests/browser/screenshots.spec.js`

**Interfaces:**
- `fillWorkingTank(page, values)` edits the existing labeled inputs and waits for a result update.
- `openRecipeScenario(page, scenario)` applies deterministic state and waits for Recipe content or documented empty/error state.
- `assertResultPanelExclusive(page, tabName)` verifies tab/panel ARIA and visibility state.

- [ ] **Step 1: Write input-flow tests**

Cover preset selection, custom O₂/He editing, cylinder/medium selection, ambient temperature, fixed wait/target temperature switching, invalid input, recovery, and desktop/mobile containment.

- [ ] **Step 2: Write result-tab tests**

Exercise Recipe, Diagram, Thermal graphs, Tank summary, and In water pressure in populated and empty/error states. Include keyboard tab movement, Diagram zoom/reset, chart/table focus correspondence, and narrow tab-list scrolling.

- [ ] **Step 3: Implement blending/result helpers**

Use documented labels/roles and wait for stable status text or panel visibility. Do not assert exact physics output unless the existing development checklist identifies it as a stable user contract.

- [ ] **Step 4: Add targeted screenshots**

Capture approved representative states using fixed screenshot names and `expect(page).toHaveScreenshot(...)`: desktop/mobile blending, populated Recipe, Diagram, Thermal graphs, and both themes where applicable.

- [ ] **Step 5: Run tests and baseline screenshots**

```sh
npm run test:ui -- tests/browser/blending.spec.js tests/browser/results.spec.js tests/browser/screenshots.spec.js
npx playwright test tests/browser/screenshots.spec.js --project=desktop --update-snapshots
```

Review generated images; do not accept diffs without checking geometry and content.

- [ ] **Step 6: Commit**

```sh
git add tests/browser/helpers/blending.js tests/browser/blending.spec.js tests/browser/results.spec.js tests/browser/screenshots.spec.js tests/browser/**-snapshots
 git commit -m "test: cover blending and result surfaces"
```

---

### Task 6: Cover inventory and all settings categories

**Files:**
- Create: `tests/browser/helpers/inventory.js`
- Create: `tests/browser/helpers/settings.js`
- Create: `tests/browser/inventory.spec.js`
- Create: `tests/browser/settings.spec.js`

**Interfaces:**
- `openSettingsCategory(page, category)` selects a category and verifies its pane.
- `editBank(page, rowIndex, values)` edits one inventory row through its labels/row context.
- `addBank(page)` returns the new row locator after the UI renders it.
- `saveSettings(page)` and `cancelSettings(page)` verify the corresponding draft transition.

- [ ] **Step 1: Write inventory tests**

Cover add/edit/delete, enabled state, name/gas/volume/pressure/O₂/He fields, validation and recovery, transfer temperature, persistence after reload, dynamic-row overlap, and absence of Air as a finite bank row.

- [ ] **Step 2: Write settings tests**

Cover Units, Gas presets, Cylinder presets, Equipment, and Preset management category navigation; draft edits; Save/Cancel; dynamic add/remove; disabled removal; long labels/max values; category scrolling; stacked narrow actions; and desktop layout.

- [ ] **Step 3: Implement focused helpers**

Scope row actions to the row locator and category actions to the active settings pane. Use accessible labels and `data-action` only where no user-facing locator is stable.

- [ ] **Step 4: Run focused tests**

```sh
npm run test:ui -- tests/browser/inventory.spec.js tests/browser/settings.spec.js
```

Expected: all dynamic-row and settings-category checks pass at desktop/tablet/mobile where relevant.

- [ ] **Step 5: Commit**

```sh
git add tests/browser/helpers/inventory.js tests/browser/helpers/settings.js tests/browser/inventory.spec.js tests/browser/settings.spec.js
git commit -m "test: cover inventory and settings surfaces"
```

---

### Task 7: Cover imports, multi-session persistence, failures, reset, and responsive artifact states

**Files:**
- Create: `tests/browser/persistence.spec.js`
- Create: `tests/browser/multi-session.spec.js`
- Create: `tests/browser/responsive-artifacts.spec.js`
- Modify: `tests/browser/fixtures/storage-fixtures.js`
- Modify: `tests/browser/fixtures/app-fixtures.js`
- Modify: `tests/browser/assertions/layout.js`

**Interfaces:**
- `createContinuedSession(page, scenario)` persists storage state, closes the current context, and returns a fresh context/page initialized from that state.
- `injectStorageFailure(page, operation)` simulates only the requested existing storage operation and exposes the resulting warning/status.
- `assertResponsiveSurface(page, surface, selectors)` runs overflow/containment/focus checks for a named surface.

- [ ] **Step 1: Write multi-session tests**

Cover consent/tour reuse, inventory add/edit/remove reuse, Imperial settings and tank/equipment edits across sessions followed by a metric conversion session, theme persistence versus an unsaved draft, and preset persistence followed by factory reset and a final factory-state session.

- [ ] **Step 2: Write failure-state tests**

Cover invalid saved data, storage write failure and recovery, feasible/infeasible result states, malformed import, unavailable import, duplicate/conflict candidates, no mutation after failed import, and factory reset restoring defaults and consent state.

- [ ] **Step 3: Write responsive artifact tests**

At mobile and tablet sizes, expand equipment actions, cylinder cards, preset-management controls, inventory rows, result tabs, charts, dialogs, and tour popovers. Run geometry, overlap, clipping, overflow, and visible-focus assertions for each.

- [ ] **Step 4: Implement continued-session state handoff**

Use Playwright storage-state serialization or an equivalent explicit state copy. Close session A’s browser context before opening session B. Keep state handoff local to the test; never use a shared file or global fixture state. Restore the original storage API after any failure injection on reload/context teardown.

- [ ] **Step 5: Implement controlled failure injection**

Use `page.addInitScript` or narrowly scoped browser API overrides matching the existing storage implementation. Never mutate application source solely for test injection.

- [ ] **Step 6: Run focused tests**

```sh
npm run test:ui -- tests/browser/multi-session.spec.js tests/browser/persistence.spec.js tests/browser/responsive-artifacts.spec.js
```

Expected: state survives only the explicitly continued sessions; failure messages are visible; layout checks produce selector/rectangle diagnostics when a deliberate fixture mutation is applied.

- [ ] **Step 7: Commit**

```sh
git add tests/browser/multi-session.spec.js tests/browser/persistence.spec.js tests/browser/responsive-artifacts.spec.js tests/browser/fixtures tests/browser/assertions/layout.js
git commit -m "test: cover persistence failures and responsive UI states"
```

---


### Task 8: Integrate documentation, CI, full verification, and cleanup

**Files:**
- Modify: `README.md`
- Modify: `docs/development.md`
- Create: `.github/workflows/ui-tests.yml`
- Modify: `.gitignore`
- Remove: `tests/browser/smoke.spec.js` only if its coverage is fully absorbed by the final suite; otherwise retain it as the fast smoke test

**Interfaces:**
- Documentation exposes `npm run test:ui`, Chromium installation, headed/debug invocation, and artifact locations.
- CI runs `npm test` followed by `npm run test:ui` with browser installation/cache support.


- [ ] **Step 1: Run the complete existing suite**

Run: `npm test`

Expected: all existing Node tests pass without browser-specific changes.

- [ ] **Step 2: Run the complete browser suite**

Run: `npm run test:ui`

Expected: desktop, tablet, and mobile projects pass with no unexpected runtime errors.

- [ ] **Step 3: Prove artifact diagnostics**

Introduce a temporary local-only CSS/layout mutation in a test fixture or browser evaluation that creates overflow/overlap, run the targeted invariant test, verify the failure includes selector, accessible label, rectangles, viewport, and fixture, then remove the mutation.

- [ ] **Step 4: Repeat screenshot run**

Run the screenshot subset twice without updating snapshots:

```sh
npx playwright test tests/browser/screenshots.spec.js --project=desktop
npx playwright test tests/browser/screenshots.spec.js --project=desktop
```

Expected: both runs pass with no unexplained diff.

- [ ] **Step 5: Document and configure CI**

Document local installation and commands in `README.md` and `docs/development.md`. Add `.github/workflows/ui-tests.yml` with:

```yaml
name: UI tests
on:
  pull_request:
  workflow_dispatch:
jobs:
  test:
    runs-on: ubuntu-24.04
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v5
        with:
          node-version: 24
          cache: npm
      - run: npm ci
      - run: npx playwright install --with-deps chromium
      - run: npm test
      - run: npm run test:ui
      - if: failure()
        uses: actions/upload-artifact@v6
        with:
          name: playwright-results
          path: |
            playwright-report/
            test-results/
```

Preserve the existing Pages deployment workflow. Update `.gitignore` for `playwright-report/`, `test-results/`, and generated screenshot output. Preserve the existing manual checklist for exploratory behavior not covered by stable automation.

- [ ] **Step 6: Run final checks and inspect status**

Run:

```sh
npm test && npm run test:ui
git diff --check
git status --short
```

Expected: both suites pass, no whitespace errors, generated artifacts are ignored, and only intended files are changed.

- [ ] **Step 7: Commit**

```sh
git add README.md docs/development.md .gitignore .github tests/browser package.json package-lock.json playwright.config.js
git commit -m "test: integrate comprehensive UI browser suite"
```
