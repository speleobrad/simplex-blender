# Comprehensive UI Test Suite Design

## Goal

Add a deterministic browser-based UI test suite for Simplex blender that exercises every user-facing screen, menu, tab, settings category, option, and high-risk dynamic state. The suite must detect layout inconsistencies, element overlap, clipping, overflow, broken stacking, inaccessible focus, and other unwanted rendered artifacts while also verifying the existing UI flows.

## Scope

The suite adds:

1. A Playwright test project targeting Chromium.
2. Desktop and narrow responsive viewport coverage, with a tablet-sized viewport where it exposes a distinct layout transition.
3. Deterministic browser-context fixtures for factory defaults and representative custom/persisted data.
4. User-level tests for onboarding, global navigation, blending, inventory, settings, result tabs, persistence, reset, imports, and failure states.
5. Shared geometry and rendered-artifact assertions.
6. Targeted screenshot baselines for representative high-risk states.
7. Failure artifacts containing traces, screenshots, console/page errors, network failures, and geometry diagnostics.

The suite does not replace the existing Node unit/DOM tests, physics tests, or documented manual investigation of domain-specific behavior that is not observable through stable UI contracts. It does not assert Tailwind class names, private module functions, arbitrary DOM structure, or incidental wording.

## Existing boundaries

- `index.html` remains the static application shell and source of stable semantic IDs and ARIA relationships.
- `js/main.js` and the existing UI modules remain responsible for application behavior; browser tests interact through the rendered UI.
- Existing localStorage records and preset fixture files remain the persistence contract. Browser fixtures seed those records rather than adding a parallel application state API.
- `npm test` remains the fast Node test command.
- The browser suite is a separate command so browser installation and runtime do not slow every unit-test invocation.
- The existing browser smoke checklist in `docs/development.md` is the behavior inventory for converting manual checks into executable checks; it remains useful for exploratory checks not yet automated.

## Test architecture

Add the following structure:

- `playwright.config.js`: Chromium project definitions, viewport projects, local HTTP server, test directory, retries, trace/screenshot/video policy, and deterministic timeout settings.
- `tests/browser/`: tests grouped by user-facing surface.
- `tests/browser/fixtures/`: browser-context setup, storage seeding, factory/custom-state scenarios, local import fixtures, and onboarding helpers.
- `tests/browser/assertions/`: reusable layout, visibility, focus, overflow, clipping, overlap, and console/network assertions.
- `tests/browser/helpers/`: user-level actions for primary navigation, settings categories, result tabs, inventory rows, onboarding/tour flows, and preset management. Helpers expose product actions rather than copying implementation functions.
- `tests/browser/screens/` (optional only where needed): focused page objects for repeated surfaces; avoid a mandatory page-object layer for one-off flows.

Use a fresh browser context per test. Fixtures may seed only the records required for a scenario. Tests must not depend on execution order or a shared browser profile.

The suite runs against the repository over HTTP using the existing static-server model. The server must support native ES modules and local preset-file access. External CDN assets are controlled in test setup where practical; expected CDN behavior is explicitly accounted for so a third-party request failure cannot be reported as an application failure. Same-origin module errors and unexpected app requests fail the relevant test.

## Browser projects and viewports

The initial matrix targets Chromium only:

- desktop viewport representing the large breakpoint and two-column workspace;
- tablet-ish viewport covering the intermediate wrapping behavior;
- narrow mobile viewport covering stacked forms, horizontal tab/category scrollers, and tour popovers.

Tests use fixed viewport dimensions, reduced motion, deterministic seeded data, and stable screenshot settings. The configuration remains extensible for later Firefox/WebKit projects without requiring test rewrites.

## Coverage matrix

### Onboarding

Automate consent-gate visibility, focus containment, background blocking, acceptance persistence, analytics enablement after successful storage, guided-tour launch, welcome and anchored steps, navigation across primary screens/result tabs/settings categories, Back, Skip, Escape, Done, reload behavior, narrow viewport behavior, reduced motion, and factory-reset reopening the consent gate.

### Global shell

Verify header geometry, primary navigation, active screen state, theme toggle labels/icons and persistence, storage-warning rendering, keyboard focus visibility, and absence of uncaught app errors. Confirm only the active primary screen is visible and interactive.

### Blending inputs

Cover current and target gas presets, custom oxygen/helium values, cylinder selection, surrounding medium, ambient temperature, fixed wait and target-temperature modes, valid recalculation, invalid input reporting and recovery, and narrow/desktop layout transitions.

### Result tabs

Exercise Recipe, Diagram, Thermal graphs, Tank summary, and In water pressure. Verify tab visibility, `aria-selected`, roving keyboard focus, panel exclusivity, populated and empty/error states, and tab-list containment at narrow widths.

For Diagram, cover zoom out/reset/zoom in, pointer readout, canvas containment, and accessible description. For Thermal graphs, cover synchronized hover/focus, semantic points, accessible table, empty state, and chart containment. For Tank summary and In water pressure, verify accessible tables and narrow-width scrolling.

### Inventory

Cover add/edit/delete bank, enabled state, bank name, gas selector/custom gas, volume, pressure, oxygen/helium values, validation failures and recovery, transfer temperature, dynamic row growth, and no accidental Air bank row.

### Settings

Cover General, Gas presets, Cylinder presets, Equipment, and Preset management category navigation. Exercise draft edits, Save, Cancel, dynamic add/remove actions, disabled removal states, field validation, equipment sections, narrow category scrolling, stacked actions, and desktop layout.

### Preset management

Use local repository fixture files and controlled local import sources. Cover gas, cylinder, and equipment selection, preview, duplicate/conflict/invalid candidates, selection defaults, successful import and persistence, malformed JSON, unavailable source, visible status, and no mutation after failed import.

### Persistence and failure states

Cover storage read fallback warning, storage write failure and later recovery, invalid saved data, feasible and infeasible recipes, factory reset, theme persistence, inventory persistence, settings save/cancel behavior, and onboarding persistence.

## Deterministic state fixtures

Provide named scenarios for:

- factory defaults;
- populated inventory with multiple enabled and disabled banks;
- long labels and maximum supported numeric display values;
- invalid saved data and storage failure injection;
- feasible, infeasible, and thermally populated recipes;
- expanded equipment/settings state;
- preset-management review with valid, duplicate, conflict, and invalid candidates;
- consent-required and tour-seen onboarding states.

Fixtures use the existing storage format and local preset files. They must be explicit and reproducible. Generated/random data is out of scope for the initial suite; deterministic long values provide the layout stress cases needed for actionable failures.

## Layout and artifact assertions

Reusable assertions inspect visible semantic controls and documented containers.

### Geometry invariants

For each tested state, assert that:

- required visible elements have positive dimensions;
- visible controls are inside the viewport or their documented scroll container;
- there is no unexpected document-level horizontal overflow;
- content does not escape its card, dialog, table, chart, tab panel, or popover container;
- interactive controls do not overlap unrelated controls, labels, values, or errors;
- text-bearing controls are not unintentionally clipped or ellipsized;
- sticky/fixed elements do not cover focused controls or primary content;
- only the active screen, settings pane, result panel, modal, or tour layer is visible and interactive;
- tables, charts, tab lists, and horizontal scrollers remain contained at narrow widths;
- dialogs and Driver.js popovers remain within the viewport and expose usable actions.

The overlap checker compares selected interactive/content bounding boxes and permits an explicit whitelist for intentional containment, such as icons inside buttons, badges, chart overlays, and decorative layers. Failure output includes element identifiers, roles, accessible names/text, rectangles, and the containing route/screen.

### Accessibility-adjacent rendered checks

Verify keyboard reachability for interactive controls, visible focus, dialog/tour focus containment, non-tabbability of hidden panels, accessible names, unique IDs, and absence of orphaned ARIA references where the browser exposes them. These are rendered-flow checks, not a replacement for a dedicated accessibility scanner.

### Runtime checks

Fail tests on uncaught page exceptions, same-origin module failures, unexpected same-origin request failures, and missing required app-rendered content. Expected CDN warnings and intentionally simulated storage/import failures are explicitly classified so they do not hide real errors.

## Targeted screenshots

Maintain reviewed screenshots for representative high-risk states:

- clean desktop blending;
- narrow blending with stacked controls;
- populated inventory;
- expanded settings equipment;
- preset-management review;
- consent dialog and guided tour;
- populated Recipe, Diagram, and Thermal graphs;
- light and dark themes.

Screenshots use fixed viewports, reduced motion, seeded storage, and controlled font/network behavior. Pixel diffs are supporting evidence and a regression signal; broad geometry assertions remain the primary detector for overlap, overflow, clipping, and containment.

## Failure artifacts and CI

On failure, retain a trace on first retry/failure, a screenshot, console/page errors, failed-request summary, and a geometry report. Video is enabled only where the configured failure policy makes it useful. Reports include viewport, fixture, route/screen, and relevant control labels.

Commands:

- `npm test`: existing unit and DOM tests.
- `npm run test:ui`: headless Chromium browser suite.
- standard Playwright options remain available for headed/debug runs and focused test selection.

CI runs unit tests first and browser tests second. Browser tests use isolated contexts and may run in parallel. Pull requests run the deterministic full suite; screenshot baseline changes require review. A smaller smoke selection may run on every change only if full-suite runtime proves materially high; the full suite remains the acceptance gate.

## Acceptance criteria

1. The browser command starts the app over HTTP and completes a clean default flow.
2. Every documented primary screen, result tab, settings category, menu/action, and user-visible option has at least one executable interaction.
3. Desktop, tablet-ish, and narrow mobile layouts are exercised.
4. Deterministic fixtures cover factory defaults, expanded dynamic content, persisted custom data, invalid data, imports, onboarding, and failure states.
5. Shared assertions detect unexpected overflow, overlap, clipping, containment failure, hidden interactive content, and broken focus containment.
6. Targeted screenshots cover the approved representative states in both themes where applicable.
7. Deliberately introduced fixture/layout mutations prove each major invariant can fail with actionable diagnostics.
8. Browser failures retain useful traces, screenshots, console/network information, and geometry diagnostics.
9. Existing `npm test` remains green and unchanged in purpose.
10. The suite does not rely on test order, real user data, or unstable external services.

## Verification

During implementation, run `npm test`, then `npm run test:ui` against the local server. Exercise at least one clean flow, one populated dynamic state, one onboarding flow, one settings/import flow, one responsive flow, and one deliberately invalid/failure fixture. Review generated artifacts for a forced geometry failure and confirm screenshot baselines are stable across repeated runs.
