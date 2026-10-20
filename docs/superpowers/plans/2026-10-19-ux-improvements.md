# UI/UX Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the blending workflow easier to scan and operate while preserving the existing calculator behavior.

**Architecture:** Keep calculation and state logic in `js/main.js`, extract result-tab DOM state into the existing navigation-style module pattern, and improve the existing result renderer markup rather than introducing a new component system. Use semantic tab attributes, a compact status summary, progressive disclosure for thermal details, and CSS-only focus/touch improvements.

**Tech Stack:** Native ES modules, DOM APIs, Node's built-in test runner, Tailwind utility classes, existing `css/app.css`.

**Spec:** UX review recommendations from the preceding review conversation.

## Global Constraints

- Preserve all existing user changes and existing calculator calculations.
- No new runtime dependencies or build step.
- Keep technical details available; hide them only behind progressive disclosure.
- Preserve existing onboarding target IDs and behavior.
- Use accessible names, semantic relationships, and visible keyboard focus.

---

### Task 1: Semantic result-tab state

**Files:**
- Create: `js/result-tabs.js`
- Modify: `js/main.js:19,712-729`
- Modify: `index.html:406-425,428-572`
- Test: `tests/result-tabs.test.js`
- Modify: `tests/onboarding-markup.test.js`

**Interfaces:**
- `setResultTab(document, tabId)` accepts a DOM-like document and returns `true` for a known tab, `false` otherwise.
- Known tab IDs remain `recipe`, `ternary`, `thermal`, `summary`, and `water-pressure`.
- Buttons expose `role="tab"`, `aria-selected`, and `aria-controls`; panes expose `role="tabpanel"`, `aria-labelledby`, and `hidden`.

- [ ] Write a failing test for selecting a result tab and rejecting an unknown tab.
- [ ] Run `node --test tests/result-tabs.test.js` and confirm the expected failure.
- [ ] Implement `js/result-tabs.js` using the same DOM adapter style as `js/navigation.js`.
- [ ] Replace the local `setTab` DOM loop in `js/main.js` with the helper while preserving ternary redraw behavior.
- [ ] Add semantic attributes to result tab buttons and panes.
- [ ] Add arrow-key/Home/End keyboard handling for the result tablist without changing click behavior.
- [ ] Run the focused test and onboarding markup tests.

### Task 2: Clearer result status and protocol hierarchy

**Files:**
- Modify: `index.html:428-480`
- Modify: `js/ui/results.js:163-233,263-329`
- Test: `tests/results.test.js`

**Interfaces:**
- The recipe pane contains `#blend-status` with `role="status"` and `aria-live="polite"`.
- `renderResults` updates the status to identify feasible, pressure-limited, or unavailable outcomes.
- Protocol step technical thermal information is available inside a per-step `<details>` disclosure.

- [ ] Add a failing renderer test covering a feasible status and the technical-details disclosure.
- [ ] Run the focused test and confirm failure.
- [ ] Add a compact status element beside the summary metrics.
- [ ] Render status copy based on `result.feasible` and `result.maximumPressure`.
- [ ] Wrap thermal detail lines in an accessible `Technical details` disclosure while keeping measurement capture separate and prominent.
- [ ] Keep existing result values, warnings, and measurement controls intact.
- [ ] Run focused result tests.

### Task 3: Interaction polish

**Files:**
- Modify: `index.html:35-53,406-425`
- Modify: `css/app.css:141-230,344-350`
- Modify: `js/main.js:188-203`

- [ ] Add visible global `:focus-visible` styling and minimum touch dimensions for compact controls.
- [ ] Mark the decorative header logo as hidden from assistive technology.
- [ ] Make result-tab overflow show a mobile scroll cue and keep the selected tab discoverable.
- [ ] Remove the misleading `aria-pressed` state from the theme action and retain its action-oriented accessible name.
- [ ] Run the full test suite.
- [ ] Open the live application at desktop and mobile widths, verify tab keyboard interaction, status updates, dialog behavior, and no console errors.
