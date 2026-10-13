# First-run onboarding wizard

## Goal

Give first-time Simplex blender users a privacy-aware guided tour of the calculator while keeping the existing application visible. Users can accept local-storage/analytics consent, move through the tour, skip it, or reopen it later from a wand button.

## Scope

This feature adds:

- a first-run consent gate explaining local browser storage;
- deferred Google Analytics loading until consent is accepted;
- an eight-step anchored spotlight tour;
- Back, Next, Skip, Escape, and final Done interactions;
- persistent consent and tour-seen state;
- a header wand button that reopens the tour;
- deep navigation to Tank summary, In water pressure, and Diagram;
- accessible responsive and reduced-motion behavior;
- tests and browser smoke documentation.

It does not change gas calculations, saved settings, supply-bank data, calculation tabs, or the factory-reset data contract.

## User flow

1. On a browser with no onboarding state, show a dark consent overlay before the tour.
2. Explain that settings, supply banks, theme, and onboarding state are stored locally in this browser. Do not load Google Analytics before consent.
3. On **Accept and continue**, persist consent, inject the existing Analytics tag, and show Welcome.
4. Walk through these steps in order:
   1. Welcome: explain Simplex blender and the tour.
   2. Working tank: highlight the Working tank card; explain starting gas, target mix, cylinder type, temperature, and wait settings.
   3. Supply banks: highlight Supply banks; explain available gases and disabling banks to preserve them.
   4. Mixing steps: highlight the recipe Mixing steps; explain target pressure, temperature changes, transfer method, and waiting time.
   5. Tank summary: select the existing `summary` tab and highlight both its pane and tab button; the tab button uses a rose control ring.
   6. In-water pressure: select the existing `water-pressure` tab and highlight both its pane and tab button; the tab button uses a rose control ring.
   7. Equipment: first highlight the header Settings button, then open Settings, select Equipment, and highlight both the category tab and configuration pane.
   8. Explore the diagram: select the existing `ternary` tab, highlight the Diagram pane, and invite exploration.
5. Back returns to the previous step and reverses any target-tab navigation. Welcome has Back disabled.
6. Next advances. The final step uses Done.
7. Skip and Escape dismiss the tour and mark it seen. They do not accept consent.
8. The wand button reopens the tour at Welcome without showing consent again.
9. After completion, leave the application on the Diagram tab. On normal dismissal, leave it on the currently guided destination.

## Architecture

### Persistence

Create `js/onboarding.js` as a DOM-free module.

- `ONBOARDING_STORAGE_KEY` is independent from settings, banks, and theme storage.
- `DEFAULT_ONBOARDING_STATE` is `{ consentAccepted: false, wizardSeen: false }`.
- `loadOnboardingState(storage)` returns a copy of the default for missing, malformed, or invalid values. It accepts only boolean fields.
- `saveOnboardingState(state, storage)` validates both boolean fields and serializes the normalized state.
- Storage read/write exceptions are surfaced to the caller; the application can keep the choice session-only and must use the privacy-safe behavior of not loading Analytics when consent cannot be persisted.

### Wizard steps

Export `WIZARD_STEPS` from `js/onboarding.js`. Each entry has:

```js
{
  id: 'working-tank',
  title: 'Your starting point',
  body: '...',
  targetId: 'working-tank-section',
  tab: null,
  settingsCategory: null
}
```

The Welcome entry has no target. Summary and in-water pressure entries carry `spotlights` for both their panes and tab buttons. The Equipment entry carries two `views`: the first targets `settings-launch`, and the second opens `settingsCategory: 'equipment'` with spotlights for `settings-pane-equipment` and `settings-category-equipment`. The diagram entry carries `tab: 'ternary'`. Control spotlights use the rose ring; content spotlights use an unbordered carveout. The step data is the source of truth for ordering, copy, target IDs, tab destinations, Settings destinations, and staged views.

### Controller and DOM

Create `js/ui/onboarding.js` with `createOnboardingController({ document, storage, onNavigate })`.

The controller owns a fixed overlay containing:

- a scrim;
- a fixed highlight rectangle around the target;
- an anchored callout with heading, body, progress, Back, Next/Done, and Skip controls;
- a separate consent callout before the wizard starts.

It exposes `open()`, `close({ markSeen })`, `next()`, `back()`, `render()`, and `destroy()`. It calls `onNavigate({ tab, settingsCategory })` for each step view and does not import `main.js` or know calculator behavior. A view may define multiple spotlight targets; the controller renders one highlight per target and keeps the progress count at the parent step count. When a target is inside an open native dialog, the controller moves its overlay into that dialog's top layer so the target highlight remains visible.

`main.js` creates the controller and handles both tab selection and Settings navigation. Equipment first highlights the header Settings button, then opens the existing Settings dialog and selects the Equipment category. It closes that dialog when the wizard moves back to the first Equipment view or to a non-Settings destination. It opens the consent gate on first load when needed, opens the wizard after consent, handles the wand action, and starts the deferred Analytics loader after successful consent.

Use `getBoundingClientRect()` to measure every target after any tab, Settings, or view navigation. On narrow screens, scroll a compact control target into view instead of centering oversized modal content. Build explicit dim regions around all target rectangles so every highlighted target remains an unshaded carveout; content targets remain unbordered and control targets use a rose ring. Nearby vertical carveouts are joined to avoid divider lines. The introductory Settings view omits the repeated parent-step progress label; the Equipment view retains `Step 7 of 8`. Position the callout beside the primary target where there is room; otherwise use a bottom-anchored sheet on narrow screens. Recalculate on window resize and scroll. The wizard controls remain the only interactive overlay content while the tour is open.

### Analytics consent

Remove the current Google tag script and inline initialization from `index.html`. Add a deferred loader that injects the same external script and configures the same measurement ID only after `consentAccepted` becomes true. The existing CDN resources for Tailwind, fonts, and Font Awesome remain unchanged because the application currently depends on them for rendering.

### Accessibility

- Use `role="dialog"`, `aria-modal="true"`, and an accessible heading.
- Keep focus within the active consent/wizard controls.
- Focus the callout heading on step changes and restore focus to the launch button on close when possible.
- Label the progress text and announce step changes with `aria-live="polite"`.
- Provide an accessible label and tooltip for the wand icon.
- Support Escape to skip the tour.
- Respect `prefers-reduced-motion`.

## Markup changes

In `index.html`:

- add stable IDs to the Working tank, Supply banks, Mixing steps, and Equipment sections;
- add stable IDs already represented by the existing result panes as wizard targets;
- add a header button containing `<i class="fa-solid fa-wand-magic-sparkles"></i>` with action `open-wizard`;
- remove the pre-consent Analytics script and inline initialization.

## Verification

### Automated tests

Add `tests/onboarding.test.js` covering:

- missing state defaults;
- valid round-trip persistence;
- malformed and invalid state fallback;
- step ordering, target coverage, and tab destinations;
- invalid state rejection before storage replacement.

Keep tests DOM-free and behavior-focused. Existing tests must continue to pass.

### Browser smoke checks

Serve the actual app and verify:

1. A clean browser shows consent before the wizard, and the page has no Analytics request before acceptance.
2. Accepting consent starts Welcome and allows the Analytics request.
3. All eight steps show the correct copy and target; only the target remains lit through the dark scrim.
4. Summary, In water pressure, and Diagram steps select their existing tabs.
5. Back, Next, Skip, Done, Escape, and the wand button behave as specified.
6. Reload does not show consent or the automatic tour after acceptance/seen state is saved; the wand reopens it.
7. Narrow viewport positioning remains usable and reduced motion disables transitions.
8. Existing calculator results, settings, and tabs remain functional after closing the tour.

## Documentation

Update `docs/architecture.md` with the onboarding module, consent state, and deferred Analytics boundary. Add onboarding and consent cases to `docs/development.md` browser smoke checks.
