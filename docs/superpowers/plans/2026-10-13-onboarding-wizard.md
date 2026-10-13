# First-run onboarding wizard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a consent-gated, persistent, anchored first-run tour that explains the calculator, navigates result tabs, and can be reopened from a wand button.

**Architecture:** Keep consent state and ordered tour metadata in a DOM-free `js/onboarding.js` module. Put overlay creation, spotlight positioning, focus management, and responsive callouts in `js/ui/onboarding.js`; `js/main.js` coordinates tab navigation, persistence, and Analytics loading. Keep the existing calculator and tab renderers unchanged apart from stable target IDs.

**Tech Stack:** Browser-native ES modules, vanilla DOM APIs, CSS, Node built-in test runner, existing Tailwind/CDN styling.

**Spec:** `docs/superpowers/specs/2026-10-13-onboarding-wizard-design.md`

## Global Constraints

- Do not load Google Analytics before the user accepts consent.
- Store consent and tour-seen state under a new onboarding key independent of settings, supply banks, theme, and factory-reset data.
- The tour has exactly eight ordered steps: Welcome, Working tank, Supply banks, Mixing steps, Tank summary, In-water pressure, Equipment, Diagram.
- Use the anchored spotlight layout with a responsive bottom-sheet fallback.
- Reuse `setTab()` for all tab navigation; do not duplicate tab state logic.
- Keep the implementation browser-native with no new runtime dependencies.
- New behavior requires tests written and observed failing before production code.
- Do not change calculation behavior, settings schema, bank schema, or factory-reset semantics.

---

### Task 1: Add onboarding state and step metadata

**Files:**
- Create: `js/onboarding.js`
- Create: `tests/onboarding.test.js`

**Interfaces:**
- Produces `ONBOARDING_STORAGE_KEY`, `DEFAULT_ONBOARDING_STATE`, `WIZARD_STEPS`, `loadOnboardingState(storage)`, and `saveOnboardingState(state, storage)` for the controller and `main.js`.
- `WIZARD_STEPS` entries are `{ id, title, body, targetId, tab }`; Welcome has `targetId: null` and `tab: null`; summary, water-pressure, and diagram use tabs `summary`, `water-pressure`, and `ternary`.
- `loadOnboardingState(storage)` returns `{ consentAccepted: boolean, wizardSeen: boolean }` and falls back to a fresh default on missing, malformed, or invalid JSON.
- `saveOnboardingState(state, storage)` validates both fields before calling `storage.setItem`; invalid state must throw without replacing the saved value.

- [ ] **Step 1: Write failing persistence and step-contract tests**

Add tests with a Map-backed storage object:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_ONBOARDING_STATE,
  WIZARD_STEPS,
  loadOnboardingState,
  saveOnboardingState
} from '../js/onboarding.js';

function memoryStorage(initialEntries = []) {
  const values = new Map(initialEntries);
  return {
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, String(value)); },
    value(key) { return values.get(key) ?? null; }
  };
}

test('missing onboarding state starts without consent or a seen tour', () => {
  assert.deepEqual(loadOnboardingState(memoryStorage()), DEFAULT_ONBOARDING_STATE);
});

test('valid onboarding state survives save and load', () => {
  const storage = memoryStorage();
  const state = { consentAccepted: true, wizardSeen: true };
  saveOnboardingState(state, storage);
  assert.deepEqual(loadOnboardingState(storage), state);
});

test('malformed and invalid onboarding values use a fresh default', () => {
  const storage = memoryStorage([
    ['simplex-gas-remixer-onboarding', '{not json']
  ]);
  assert.deepEqual(loadOnboardingState(storage), DEFAULT_ONBOARDING_STATE);
  storage.setItem('simplex-gas-remixer-onboarding', JSON.stringify({ consentAccepted: true }));
  assert.deepEqual(loadOnboardingState(storage), DEFAULT_ONBOARDING_STATE);
});

test('invalid onboarding state is rejected before replacing saved data', () => {
  const storage = memoryStorage();
  saveOnboardingState({ consentAccepted: true, wizardSeen: false }, storage);
  assert.throws(() => saveOnboardingState({ consentAccepted: 'yes', wizardSeen: false }, storage), RangeError);
  assert.deepEqual(loadOnboardingState(storage), { consentAccepted: true, wizardSeen: false });
});

test('wizard steps cover the ordered tour destinations', () => {
  assert.deepEqual(WIZARD_STEPS.map(step => step.id), [
    'welcome', 'working-tank', 'supply-banks', 'mixing-steps',
    'tank-summary', 'water-pressure', 'equipment', 'diagram'
  ]);
  assert.equal(WIZARD_STEPS[0].targetId, null);
  assert.equal(WIZARD_STEPS.find(step => step.id === 'tank-summary').tab, 'summary');
  assert.equal(WIZARD_STEPS.find(step => step.id === 'water-pressure').tab, 'water-pressure');
  assert.equal(WIZARD_STEPS.find(step => step.id === 'diagram').tab, 'ternary');
});
```

- [ ] **Step 2: Run the focused test and verify the expected missing-module failure**

Run: `node --test tests/onboarding.test.js`

Expected: FAIL because `js/onboarding.js` does not exist yet. If the test errors for a test typo instead, fix the test and rerun until it fails for the missing behavior.

- [ ] **Step 3: Implement the minimal DOM-free module**

In `js/onboarding.js`:

- Define `ONBOARDING_STORAGE_KEY = 'simplex-gas-remixer-onboarding'`.
- Freeze the default state and step metadata so callers cannot mutate the source of truth.
- Define useful, concise user-facing copy for each step, including cylinder type, temperature, wait time, bank enable/disable behavior, target pressure, transfer method, and the three requested result destinations.
- Parse saved JSON inside `try/catch`; require exactly boolean `consentAccepted` and `wizardSeen` fields and return a fresh `{ ...DEFAULT_ONBOARDING_STATE }` on invalid data.
- Validate both booleans before serializing in `saveOnboardingState`; throw `RangeError` before storage writes when invalid.

- [ ] **Step 4: Run the focused test and verify it passes**

Run: `node --test tests/onboarding.test.js`

Expected: PASS for all onboarding state and step metadata tests.

- [ ] **Step 5: Commit the state contract**

```bash
git add js/onboarding.js tests/onboarding.test.js
git commit -m "feat: add onboarding state contract"
```

---

### Task 2: Defer Analytics until consent

**Files:**
- Create: `js/analytics.js`
- Create: `tests/analytics.test.js`
- Modify: `index.html:7-14`

**Interfaces:**
- Produces `loadAnalytics(document)` that injects the existing Google tag script and initializes `window.dataLayer`, `window.gtag`, and the same measurement ID once per document.
- `loadAnalytics` returns `false` when the document has already loaded the tag and `true` when it inserts it for the first time.
- No Analytics code executes before `main.js` calls `loadAnalytics` after consent.

- [ ] **Step 1: Write the failing loader test**

Use a minimal fake document with `createElement`, `head.append`, and `querySelector`, plus a fake `window` object. Assert that the first call creates one async script with the existing URL and one `gtag('config', 'G-KDQH39FXV3')` call, while a second call returns `false` and creates no duplicate script.

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadAnalytics } from '../js/analytics.js';

test('loads Analytics only when explicitly called and only once', () => {
  const scripts = [];
  const calls = [];
  const document = {
    head: { append(node) { scripts.push(node); } },
    createElement() { return { async: false, src: '', setAttribute() {} }; },
    querySelector(selector) { return selector === 'script[data-simplex-analytics]' ? scripts[0] ?? null : null; }
  };
  const window = { dataLayer: [], gtag(...args) { calls.push(args); } };

  assert.equal(loadAnalytics(document, window), true);
  assert.equal(scripts.length, 1);
  assert.equal(scripts[0].async, true);
  assert.match(scripts[0].src, /googletagmanager\.com\/gtag\/js\?id=G-KDQH39FXV3/);
  assert.deepEqual(calls.at(-1), ['config', 'G-KDQH39FXV3']);
  assert.equal(loadAnalytics(document, window), false);
  assert.equal(scripts.length, 1);
});
```

- [ ] **Step 2: Run the focused test and verify the expected missing-module failure**

Run: `node --test tests/analytics.test.js`

Expected: FAIL because `js/analytics.js` does not exist yet.

- [ ] **Step 3: Implement the loader and remove eager Analytics markup**

In `js/analytics.js`:

- Export the fixed measurement ID and loader.
- Set `script.async = true`, `script.dataset.simplexAnalytics = ''`, and the exact existing script URL.
- Initialize `window.dataLayer` and `window.gtag` only inside the function; queue `js` with the current date and then `config` with the measurement ID.
- Guard with `document.querySelector('script[data-simplex-analytics]')` so repeated consent handling cannot duplicate the tag.

In `index.html`, remove lines 7–14 containing the Google tag script and inline initialization. Do not remove Tailwind, font, or Font Awesome CDN resources.

- [ ] **Step 4: Run Analytics tests and the full existing suite**

Run: `node --test tests/analytics.test.js && npm test`

Expected: PASS with no Analytics markup-related test failures.

- [ ] **Step 5: Commit deferred Analytics**

```bash
git add js/analytics.js tests/analytics.test.js index.html
git commit -m "feat: defer analytics until consent"
```

---

### Task 3: Build the anchored onboarding controller

**Files:**
- Create: `js/ui/onboarding.js`
- Create: `tests/onboarding-ui.test.js`
- Modify: `css/app.css` (append onboarding overlay rules)

**Interfaces:**
- Produces `createOnboardingController({ document, storage, initialState, onNavigate, onConsentAccepted, launchButton })`; `initialState` defaults to `loadOnboardingState(storage)` so the controller has one consistent state snapshot.
- Returned methods: `open({ requireConsent = false } = {})`, `close({ markSeen = true } = {})`, `next()`, `back()`, `render()`, and `destroy()`.
- `onNavigate(tab)` receives the step tab or `null`; it is the only tab-navigation dependency.
- `onConsentAccepted()` runs only after a successful consent-state write.

- [ ] **Step 1: Write failing controller behavior tests**

Use a fake DOM that supports element creation, IDs, class-list operations, attributes, event listeners, focus, append/remove, and `getBoundingClientRect`. Test observable behavior rather than class names:

- `open({ requireConsent: true })` creates an accessible consent dialog and does not create a wizard target highlight.
- Clicking the consent action stores `consentAccepted: true`, calls `onConsentAccepted` once, and renders Welcome.
- `next()` moves through the ordered steps, calls `onNavigate('summary')`, then `onNavigate('water-pressure')`, then `onNavigate('ternary')` at the specified steps.
- `back()` decrements the step and calls the prior tab callback; at Welcome it does not go negative.
- `close({ markSeen: true })` stores `wizardSeen: true`; a later `open()` starts at Welcome.
- `destroy()` removes the overlay and registered window listeners.

The fake DOM test should dispatch the controller’s actual button events instead of calling private helpers. Keep geometry checks out of this test; verify positioning in the browser smoke pass.

- [ ] **Step 2: Run the focused test and verify the expected missing-module failure**

Run: `node --test tests/onboarding-ui.test.js`

Expected: FAIL because `js/ui/onboarding.js` does not exist yet.

- [ ] **Step 3: Implement controller DOM and state transitions**

In `js/ui/onboarding.js`:

- Create one fixed root with `role="dialog"`, `aria-modal="true"`, `aria-labelledby`, a scrim, highlight element, callout heading/body/progress, and controls.
- Create a separate consent state inside the same root with an explicit local-storage notice and an `Accept and continue` button. Consent must not have a Skip action.
- Maintain `mode` (`consent`, `wizard`, or closed), `stepIndex`, `previousFocus`, and a `Set` of bound event handlers.
- Render `WIZARD_STEPS[stepIndex]`; set heading/body/progress text, disable Back for Welcome, use `Done` on the final step, and keep Skip available during the tour.
- On consent, write `{ ...state, consentAccepted: true }`; if storage throws, keep Analytics unloaded, show a visible inline error, and leave consent mode active.
- On Skip, Done, or Escape, write `wizardSeen: true` and remove the overlay. Restore focus to `launchButton` when available.
- On each step change, call `onNavigate(step.tab)` when a tab is specified and call `onNavigate(null)` for calculator-root steps so moving backward returns to Recipe.
- Keep focus inside the dialog; focus the heading after rendering a step and implement Tab/Shift+Tab cycling over visible wizard controls. Keep target elements non-interactive while the overlay is active.

- [ ] **Step 4: Implement geometry and responsive spotlight behavior**

Add private controller functions that:

- find `step.targetId`, call `scrollIntoView({ block: 'center', inline: 'nearest' })`, then measure its `getBoundingClientRect()`;
- set highlight `top`, `left`, `width`, and `height` with a small 8px padding and a large box-shadow scrim;
- place the callout to the right or left when its measured width fits in the viewport, otherwise place it below/above the target;
- switch to a viewport-width bottom sheet when the callout cannot fit beside the target or the viewport is narrow;
- update geometry on `resize` and `scroll` while open;
- use CSS custom properties for coordinates so style rules remain readable.

Add CSS rules for the fixed root, scrim, highlight, callout, buttons, bottom-sheet fallback, focus-visible states, and `@media (prefers-reduced-motion: reduce)`.

- [ ] **Step 5: Run the focused UI tests and verify they pass**

Run: `node --test tests/onboarding-ui.test.js`

Expected: PASS for consent, navigation, persistence, dismissal, focus, and cleanup behavior.

- [ ] **Step 6: Commit the controller**

```bash
git add js/ui/onboarding.js tests/onboarding-ui.test.js css/app.css
git commit -m "feat: add anchored onboarding overlay"
```

---

### Task 4: Integrate the tour with the application surface

**Files:**
- Modify: `index.html:41-50, 273-449, 478-602`
- Modify: `js/main.js:1-76, 917-933` and the delegated click handler

**Interfaces:**
- `main.js` owns the shared `settingsStorage`, onboarding state load, controller construction, and `setTab` callback.
- The new header action is `data-action="open-wizard"` and contains `<i class="fa-solid fa-wand-magic-sparkles"></i>`.
- Target IDs are `working-tank-section`, `supply-banks-section`, `mixing-steps-section`, `equipment-section`, `tab-pane-summary`, `tab-pane-water-pressure`, and `tab-pane-ternary`.

- [ ] **Step 1: Write failing markup/integration tests**

Add tests to `tests/onboarding-ui.test.js` or a focused `tests/onboarding-markup.test.js` that read `index.html` and assert the wand button has `data-action="open-wizard"`, the Font Awesome class, and every required target ID. These tests should fail against the current markup because the IDs and button still do not exist. The eager Analytics markup is already covered by Task 2.

- [ ] **Step 2: Run the markup test and verify the expected failures**

Run: `node --test tests/onboarding-markup.test.js`

Expected: FAIL on the missing wizard action/target IDs and eager Analytics markup.

- [ ] **Step 3: Add target IDs and the wand action**

In `index.html`:

- Add `id="working-tank-section"` to the Working tank section.
- Add `id="supply-banks-section"` to the Supply banks section.
- Wrap the existing Mixing steps heading/container in or assign `id="mixing-steps-section"` to its existing section-level element without changing the recipe content.
- Add `id="equipment-section"` to the Equipment summary section.
- Add `id="tab-pane-summary"`, `id="tab-pane-water-pressure"`, and `id="tab-pane-ternary"` to the existing panes if not already present; preserve existing IDs where they already match.
- Add a compact header button beside Settings with `data-action="open-wizard"`, `aria-label="Show the guided tour"`, `title="Show the guided tour"`, and `<i class="fa-solid fa-wand-magic-sparkles" aria-hidden="true"></i>`.

- [ ] **Step 4: Wire controller startup and actions in `main.js`**

- Import `loadOnboardingState` and `createOnboardingController`, plus `loadAnalytics`.
- Add `onboarding` and `onboardingController` to controller state without changing settings/bank loading.
- Load `state.onboarding = loadOnboardingState(settingsStorage)` once and pass it as `initialState` when creating the controller, with `onNavigate: tab => setTab(tab ?? 'recipe')`, `onConsentAccepted: () => loadAnalytics(document, window)`, and `launchButton: byId('wizard-launch')`.
- Add the `open-wizard` case to `handleClick` and open the controller at Welcome without consent.
- After the initial calculation/render, automatically open consent when `state.onboarding.consentAccepted` is false; otherwise automatically open the tour when `state.onboarding.wizardSeen` is false.
- Keep the existing tab event handling and setting dialog behavior unchanged.

- [ ] **Step 5: Run integration and full tests**

Run: `node --test tests/onboarding-markup.test.js tests/onboarding-ui.test.js && npm test`

Expected: PASS with all existing calculator tests green.

- [ ] **Step 6: Commit application integration**

```bash
git add index.html js/main.js tests/onboarding-markup.test.js tests/onboarding-ui.test.js
# Include `tests/onboarding-ui.test.js` only when it was updated in this task.
git commit -m "feat: integrate first-run guided tour"
```

---

### Task 5: Document behavior and run the real browser smoke pass

**Files:**
- Modify: `docs/architecture.md` (runtime modules, data flow, consent boundary)
- Modify: `docs/development.md` (browser smoke checks)
- Modify: `README.md` only if a concise user-facing onboarding note is useful after the smoke pass

**Interfaces:**
- Documentation describes the final implemented behavior and exact storage/Analytics boundaries; it does not introduce a second source of truth for step copy.

- [ ] **Step 1: Update architecture documentation**

Add `js/onboarding.js`, `js/ui/onboarding.js`, and `js/analytics.js` to the module responsibility list. State that onboarding state is separate from calculation settings and that the Analytics tag is injected only after consent. Update the data-flow list to include the first-load consent/tour decision and wand re-entry.

- [ ] **Step 2: Update browser smoke documentation**

Add checks for clean-profile consent, no pre-consent Analytics, all eight spotlight targets, tab navigation, persistence, Skip/Done/Escape, wand re-entry, narrow viewport fallback, reduced motion, and unchanged calculator/settings behavior.

- [ ] **Step 3: Run the full automated suite**

Run: `npm test`

Expected: PASS with no failures or runtime warnings introduced by onboarding modules.

- [ ] **Step 4: Serve and exercise the changed surface**

Run: `python3 -m http.server 8000`

In a fresh browser profile at `http://127.0.0.1:8000/`:

1. Confirm the app opens with the dark consent screen and the local-storage notice.
2. Inspect the Network panel and confirm no Google Analytics request appears before acceptance.
3. Accept and verify Welcome; advance through all eight steps, confirming the target is the only lit area and the correct tab opens for summary, in-water pressure, and diagram.
4. Verify Back returns to the prior step/tab, Skip and Escape dismiss, and Done persists completion.
5. Reload and verify no automatic consent/tour appears; activate the wand button and verify the tour starts at Welcome.
6. Repeat at a narrow viewport and with reduced motion enabled; confirm the callout remains usable.
7. Close the tour and verify settings, tab switching, calculator inputs, and result rendering still work.

- [ ] **Step 5: Review the final diff and commit documentation**

```bash
git add docs/architecture.md docs/development.md README.md
git commit -m "docs: document onboarding consent and tour"
```

