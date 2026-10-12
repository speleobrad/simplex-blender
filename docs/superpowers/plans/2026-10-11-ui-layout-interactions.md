# UI Layout, Thermal Interaction, and Equipment Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reorganize the calculator's working-tank, supply-bank, thermal-chart, and settings surfaces while adding bidirectional thermal chart/table highlighting, without changing calculation or persistence semantics.

**Architecture:** Keep the existing static HTML and delegated-controller architecture. Add responsive settings category panes in the dialog, keep all existing `data-settings-*` fields and setting keys, and add one event-delegated thermal interaction layer that maps a shared point index across both SVG charts and the table.

**Tech Stack:** Native HTML dialog, Tailwind CDN utility classes, CSS custom properties, browser-native ES modules, Node built-in test runner, Chrome browser smoke testing.

**Spec:** `docs/superpowers/specs/2026-10-11-ui-layout-interactions-design.md`

## Global Constraints

- Preserve optimizer, thermodynamic equations, input contracts, storage keys, defaults, validation bounds, and draft/save/cancel semantics.
- Preserve every existing `data-settings-collection`, `data-settings-field`, numeric bound, unit, and persisted property name.
- Use no new runtime dependency or bundler.
- Preserve all pre-existing worktree changes; modify only the files needed for this feature.
- Thermal point ordering and values remain exactly those returned by `buildThermalSeries`.
- Browser UI changes require a smoke run against the served page in addition to Node tests.

---

### Task 1: Reorganize working-tank and supply-bank layout

**Files:**
- Modify: `scuba_gas_remixer_simplex_optimizer.html:204-241` — working-tank thermal-control grid.
- Modify: `scuba_gas_remixer_simplex_optimizer.html:318-328` — supply-bank transfer conditions.

**Interfaces:**
- Consumes: Existing element IDs `cooling-medium`, `ambient-temperature`, `wait-mode`, `wait-minutes`, `wait-target-temperature`, and `inlet-gas-temperature`.
- Produces: The same DOM IDs and `data-recalculate` attributes in the requested responsive visual grouping.

- [x] **Step 1: Place surrounding medium and ambient temperature in one responsive row**

Keep the existing controls and IDs, but change the inner container to a two-column grid at `sm` and above. The medium field occupies the first column and ambient temperature the second:

```html
<div class="col-span-2 grid grid-cols-1 gap-3 rounded-xl border border-ocean-800/80 bg-ocean-950/60 p-3 sm:grid-cols-2">
  <div>
    <label for="cooling-medium" class="mb-1 block text-slate-400 font-medium">Surrounding medium</label>
    <select id="cooling-medium" data-recalculate="change" class="w-full rounded-lg border border-ocean-700 bg-ocean-900 px-2.5 py-1.5 text-slate-100 focus:border-cyan-400 focus:outline-none">
      <option value="air">Air</option>
      <option value="water">Water</option>
    </select>
  </div>
  <div>
    <label for="ambient-temperature" class="mb-1 block text-slate-400 font-medium">Ambient / calculation temperature</label>
    <div class="flex items-center gap-2">
      <input type="number" id="ambient-temperature" value="20" min="0" max="50" step="0.1" data-recalculate="input" class="min-w-0 flex-1 rounded-lg border border-ocean-700 bg-ocean-900 px-2.5 py-1.5 font-mono text-slate-100 focus:border-cyan-400 focus:outline-none">
      <span class="font-mono text-slate-400">°C</span>
    </div>
    <p class="mt-1 text-[10px] text-slate-500">Used for the surrounding conditions and the starting gas calculation state.</p>
  </div>
```

- [x] **Step 2: Place wait mode and active wait value in one responsive row**

Continue the same grid and make `wait-mode` the first column. Keep both conditional fields in the second column, preserving their IDs, `hidden` behavior, and input triggers:

```html
  <div>
    <label for="wait-mode" class="mb-1 block text-slate-400 font-medium">Wait between fills</label>
    <select id="wait-mode" data-recalculate="change" class="w-full rounded-lg border border-ocean-700 bg-ocean-900 px-2.5 py-1.5 text-slate-100 focus:border-cyan-400 focus:outline-none">
      <option value="minutes">Fixed minutes</option>
      <option value="temperature">Target temperature</option>
    </select>
  </div>
  <div id="wait-minutes-field">
    <label for="wait-minutes" class="mb-1 block text-slate-400 font-medium">Wait time</label>
    <div class="flex items-center gap-2">
      <input type="number" id="wait-minutes" value="10" min="0" max="1440" step="1" data-recalculate="input" class="min-w-0 flex-1 rounded-lg border border-ocean-700 bg-ocean-900 px-2.5 py-1.5 font-mono text-slate-100 focus:border-cyan-400 focus:outline-none">
      <span class="font-mono text-slate-400">min</span>
    </div>
  </div>
  <div id="wait-target-temperature-field" hidden>
    <label for="wait-target-temperature" class="mb-1 block text-slate-400 font-medium">Target temperature</label>
    <div class="flex items-center gap-2">
      <input type="number" id="wait-target-temperature" value="25" min="0" max="100" step="0.1" data-recalculate="input" class="min-w-0 flex-1 rounded-lg border border-ocean-700 bg-ocean-900 px-2.5 py-1.5 font-mono text-slate-100 focus:border-cyan-400 focus:outline-none">
      <span class="font-mono text-slate-400">°C</span>
    </div>
  </div>
</div>
```

- [x] **Step 3: Match transfer-condition typography without changing data flow**

Use the same sans-serif label/control classes as the working-tank settings on the transfer-condition subsection. Retain `font-mono` only for the numeric input and unit, and keep the explanatory text unchanged.

- [x] **Step 4: Run a syntax and markup smoke check**

Run:

```sh
node --check js/main.js
node --check js/ui/settings-dialog.js
node --check js/ui/thermal-charts.js
```

Expected: all commands exit 0.

---

### Task 2: Add responsive settings category navigation and equipment grouping

**Files:**
- Modify: `scuba_gas_remixer_simplex_optimizer.html:50-178` — settings dialog markup.
- Modify: `js/main.js:151-173,544-582` — category selection state and delegated action.
- Modify: `js/ui/settings-dialog.js:172-194` — preserve selected category after preset re-render.
- Modify: `css/app.css:141-145` — responsive category and equipment UI rules.

**Interfaces:**
- Consumes: Existing `state.settingsDraft`, `renderSettingsDialog`, `data-settings-*` controls, and settings actions.
- Produces: `data-action="select-settings-category"` controls, visible pane switching, and equipment sub-sections with unchanged field contracts.

- [x] **Step 1: Add category rail and four content panes**

Wrap the current settings grid in a responsive two-column layout. Add four buttons with `data-settings-category` values `model`, `gas-presets`, `cylinder-presets`, and `equipment`. Make the rail a vertical list on `sm` and a horizontally scrollable row below it. Put the current gas-model section in `settings-pane-model`, gas rows in `settings-pane-gas-presets`, cylinder rows in `settings-pane-cylinder-presets`, and all equipment inputs in `settings-pane-equipment`.

The category button shape must include the action and category metadata used by the controller:

```html
<button type="button" data-action="select-settings-category" data-settings-category="equipment" aria-controls="settings-pane-equipment" aria-selected="false" class="settings-category-button ...">Equipment</button>
```

The Model pane remains selected when the dialog opens. Do not move the existing `settings-physics-model` ID or its `data-settings-*` attributes.

- [x] **Step 2: Group equipment fields under Compressor, Booster, and Decanting hose**

Move the existing fields into three labeled sub-sections without changing their IDs or `data-settings-field` values. Use these exact field groupings:

```text
Compressor:
  settings-compressor-inlet-flow
  settings-compressor-max-pressure
  settings-compressor-temperature-modifier

Booster:
  settings-booster-cylinder-volume
  settings-booster-min-source-pressure
  settings-booster-oxygen-bpm
  settings-booster-other-bpm
  settings-booster-max-output-pressure
  settings-booster-temperature-modifier

Decanting hose:
  settings-booster-oxygen-decant-rate
  settings-booster-other-decant-rate
  settings-booster-draining-rate
```

Use the visible label `Mix source gas pressure` for `settings-booster-min-source-pressure`, with helper text or a parenthetical `minimum` qualifier so the existing minimum-pressure semantics remain clear. Keep the existing maximum booster output pressure field in Booster because `settings.booster.maxBoosterOutputPressureBar` remains an optimizer constraint.

- [x] **Step 3: Add category state handling in `main.js`**

Add a transient `settingsCategory` value to `state`, initialized to `model`. Implement a controller function with this exact behavior:

```js
function setSettingsCategory(category) {
  const categories = ['model', 'gas-presets', 'cylinder-presets', 'equipment'];
  if (!categories.includes(category)) return;
  state.settingsCategory = category;
  for (const candidate of categories) {
    const button = document.querySelector(`[data-settings-category="${candidate}"]`);
    const pane = byId(`settings-pane-${candidate}`);
    if (!button || !pane) continue;
    const selected = candidate === category;
    button.setAttribute('aria-selected', String(selected));
    button.classList.toggle('settings-category-selected', selected);
    pane.classList.toggle('hidden', !selected);
  }
}
```

Call `setSettingsCategory(state.settingsCategory)` after `renderSettingsDialog` in `openSettings`, after `renderSettingsDialog` in `addGasPreset`, after `renderSettingsDialog` in `addCylinderPreset`, and after `renderSettingsDialog` in `removeSettingsPreset`. Add a `select-settings-category` case to `handleClick` that calls `setSettingsCategory(actionElement.dataset.settingsCategory)`.

- [x] **Step 4: Add CSS for selected categories and narrow screens**

Add CSS classes in `css/app.css` so the selected category uses the existing cyan accent, unselected categories remain readable in both themes, and the rail becomes horizontal without wrapping below `sm`:

```css
.settings-category-list {
  scrollbar-width: thin;
}

.settings-category-selected {
  color: rgb(var(--cyan-300));
  background: rgb(var(--ocean-800) / 0.7);
  border-color: rgb(var(--cyan-500) / 0.45);
}

@media (max-width: 639px) {
  .settings-category-list {
    display: flex;
    overflow-x: auto;
    white-space: nowrap;
  }
}
```

Use existing theme variables only; do not add a hard-coded page background.

- [x] **Step 5: Verify settings draft behavior manually in the browser**

Open Settings, switch each category, edit a numeric equipment field, switch categories, then Cancel. Reopen Settings and confirm the edit was discarded. Edit the same field again, Save, reload, and confirm the value persists. This is a browser smoke step, not a source-text assertion.

---

### Task 3: Synchronize thermal chart points and table rows

**Files:**
- Modify: `js/ui/thermal-charts.js:108-288` — point metadata, focusability, table row metadata, interaction binding.
- Modify: `css/app.css:141-145` — thermal active styles.
- Test: `tests/thermal-charts.test.js:1-82` — retain the existing pure series invariants; browser smoke coverage verifies DOM highlight behavior without adding a DOM test dependency.

**Interfaces:**
- Consumes: `buildThermalSeries` point array and existing chart/table containers.
- Produces: Shared `data-thermal-point-index` metadata, accessible point controls, and one delegated interaction layer across `thermal-temperature-chart`, `thermal-pressure-chart`, and `thermal-chart-data`.

- [x] **Step 1: Add shared point metadata to both SVG charts**

In `renderChart`, add `data-thermal-point-index` with the `points` array index to every circle. Add `tabindex="0"`, `role="button"`, and an `aria-label` such as:

```js
const description = `Step ${pointValue.step}, ${phaseLabel(pointValue.phase)}, ${pointValue.elapsedMinutes.toFixed(1)} minutes, ${pointValue.temperatureC.toFixed(1)} degrees Celsius, ${pointValue.pressureBar.toFixed(1)} bar`;
```

Set `circle.dataset.thermalPointIndex = String(index)`, `circle.tabIndex = 0`, `circle.setAttribute('role', 'button')`, and `circle.setAttribute('aria-label', description)`.

- [x] **Step 2: Add shared metadata and focusability to table rows**

In `renderDataTable`, iterate with `points.entries()`, set `row.dataset.thermalPointIndex = String(index)`, `row.tabIndex = 0`, and `row.setAttribute('aria-label', description)`. Preserve the table semantics and all existing cell text.

- [x] **Step 3: Implement one event-delegated highlight controller**

Add a module-level binding guard and helpers with this behavior:

```js
let thermalInteractionsBound = false;

function setActiveThermalPoint(index) {
  for (const element of document.querySelectorAll('[data-thermal-point-index]')) {
    element.classList.toggle('thermal-point-active', element.dataset.thermalPointIndex === String(index));
  }
}

function clearActiveThermalPoint() {
  for (const element of document.querySelectorAll('.thermal-point-active')) {
    element.classList.remove('thermal-point-active');
  }
}
```

Bind `mouseover`/`mouseout` and `focusin`/`focusout` once to the three thermal containers. Resolve the nearest `[data-thermal-point-index]`, ignore transitions between descendants of the same point, and call the active/clear helpers. Call the binding helper from `renderThermalCharts` before rendering so invalid/empty recalculations do not create duplicate listeners.

- [x] **Step 4: Add active CSS for SVG and table elements**

Add theme-safe styles:

```css
.thermal-point-active {
  outline: 2px solid rgb(var(--cyan-400));
  outline-offset: 2px;
  filter: brightness(1.2);
}

circle.thermal-point-active {
  r: 7;
}

tr.thermal-point-active {
  background: rgb(var(--ocean-800) / 0.7);
  color: rgb(var(--slate-100));
}
```

If SVG `r` cannot be reliably styled in the target browser, set the active circle radius through the same shared state helper while retaining the CSS class. Keep the unselected chart rendering unchanged.

- [x] **Step 5: Keep pure series regression coverage unchanged**

Do not add a DOM test dependency solely to assert class toggles. The existing `tests/thermal-charts.test.js` coverage already verifies point order, phase, pressure, temperature, elapsed time, bands, final point, empty protocols, and chart-domain bounds. The browser smoke run in Task 5 verifies the DOM point-index mapping and bidirectional highlight behavior.

- [x] **Step 6: Run the focused thermal tests**

Run:

```sh
node --test tests/thermal-charts.test.js
```

Expected: all thermal tests pass with zero failures.

---

### Task 4: Update architecture and browser smoke documentation

**Files:**
- Modify: `docs/architecture.md:18-24,34-36` — UI responsibilities and data flow.
- Modify: `docs/development.md:23-46` — browser smoke checklist.

**Interfaces:**
- Consumes: Implemented DOM structure, settings category state, and thermal interaction behavior.
- Produces: Documentation matching the actual code and verification path.

- [x] **Step 1: Document settings category ownership**

Update the settings-dialog responsibility to state that it renders category panes and equipment sub-sections while preserving the flat persisted settings object. Update the data-flow description to state that category selection is transient and that equipment field keys remain unchanged.

- [x] **Step 2: Document thermal point synchronization**

Update the thermal-charts responsibility to state that temperature points, pressure points, and table rows share a point index and are synchronized on pointer hover and keyboard focus.

- [x] **Step 3: Add explicit browser checks**

Add smoke checklist entries for the two working-tank field rows, transfer typography, all four Settings categories plus the three Equipment sub-sections, save/cancel/reload behavior, and chart/table highlight in both directions. Keep all existing thermodynamic and optimizer smoke criteria intact.

- [x] **Step 4: Scan documentation for stale UI claims**

Run:

```sh
grep -R "Booster section\|thermal chart\|Transfer conditions" docs/architecture.md docs/development.md
```

Expected: every matching statement describes the category-pane and synchronized-point behavior implemented by Tasks 2 and 3.

---

### Task 5: Full verification and browser smoke run

**Files:**
- Verify: `scuba_gas_remixer_simplex_optimizer.html`
- Verify: `js/main.js`, `js/ui/settings-dialog.js`, `js/ui/thermal-charts.js`
- Verify: `tests/thermal-charts.test.js`, existing test suite.

**Interfaces:**
- Consumes: All changes from Tasks 1–4.
- Produces: Evidence that the visible requested behavior and existing calculation behavior both remain intact.

- [x] **Step 1: Run the complete Node test suite**

Run:

```sh
npm test
```

Expected: exit code 0 and zero failing tests.

- [x] **Step 2: Run syntax checks**

Run:

```sh
node --check js/main.js
node --check js/settings.js
node --check js/ui/settings-dialog.js
node --check js/ui/thermal-charts.js
```

Expected: all commands exit 0.

- [x] **Step 3: Serve the actual application**

Run:

```sh
python3 -m http.server 8000
```

Open `http://127.0.0.1:8000/scuba_gas_remixer_simplex_optimizer.html` in a browser.

- [x] **Step 4: Exercise the requested desktop layout**

At desktop width, verify the working-tank fields pair as specified, transfer conditions use the same typography as working-tank settings, and Settings shows the vertical category rail. Open Equipment and verify Compressor, Booster, and Decanting hose contain the exact requested controls.

- [x] **Step 5: Exercise chart/table synchronization**

Open Thermal graphs for the default feasible recipe. Hover a temperature point, pressure point, and table row in turn. For each, observe the corresponding row and both chart points highlight. Repeat with keyboard focus using Tab. Move away and confirm the highlight clears.

- [x] **Step 6: Exercise narrow layout and settings persistence**

Resize to a narrow viewport. Verify the settings categories become a horizontally scrollable row and the two working-tank rows stack. Edit an equipment value, Cancel, reopen and confirm it reverted; then edit, Save, reload, and confirm it persisted.

- [x] **Step 7: Verify runtime errors and invalid-input clearing**

Use the browser console to confirm there are no application module/runtime errors. Enter invalid calculator input and confirm both thermal charts and the table clear, then restore valid input and confirm the synchronized chart/table surfaces return.
