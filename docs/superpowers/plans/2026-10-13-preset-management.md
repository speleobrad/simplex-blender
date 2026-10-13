# Preset Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Settings → Preset management workflow for local/online gas, cylinder, and combined equipment JSON imports with duplicate preview and immediate localStorage persistence.

**Architecture:** Keep settings schemas and storage in `js/settings.js`. Add a pure `js/preset-import.js` module that normalizes source JSON, validates candidates, classifies duplicates by normalized name or complete content, and merges only selected new candidates. Extend the existing Settings dialog renderer and `main.js` delegated browser flow; add repository JSON files under `presets/`.

**Tech Stack:** Browser-native ES modules, vanilla DOM, Fetch/File APIs, Tailwind CDN utility classes, Node built-in test runner.

**Spec:** `docs/superpowers/specs/2026-10-13-preset-management-design.md`

## Global Constraints

- Existing `simplex-gas-remixer-settings` storage key and all existing preset object shapes MUST remain unchanged.
- Existing manual Settings edits MUST remain draft-based; confirmed imports MUST persist immediately.
- Duplicate detection MUST use case-insensitive trimmed names or complete persisted content, and MUST classify source-file duplicates.
- Invalid candidates MUST never be selectable or imported; import/storage failures MUST leave live settings and storage unchanged.
- Equipment imports MUST use one file containing `compressorPresets` and/or `boosterPresets` arrays.
- Run focused tests after each implementation task and `npm test` before completion.

---

### Task 1: Add pure preset import analysis and merge logic

**Files:**
- Create: `js/preset-import.js`
- Create: `tests/preset-import.test.js`
- Modify: `js/preset-validation.js` only if a shared validator export is needed (avoid otherwise)

**Interfaces:**
- Consumes: `normalizePresetName` from `js/settings.js`, validators from `js/preset-validation.js`, and current settings collections.
- Produces:
  - `PRESET_IMPORT_DEFAULT_URLS` object with `gas`, `cylinders`, and `equipment` raw GitHub URLs.
  - `analyzePresetSource(category, source)` returning `{ candidates, errors }`, where each candidate is `{ id, category, collection, preset, status, reason, selectable }` and status is `new`, `duplicate`, or `invalid`.
  - `mergeSelectedPresets(settings, analyzedCandidates, selectedIds)` returning a fresh settings object containing only selected `new` candidates, or throwing `RangeError` when selection is invalid or merged settings fail validation.

- [ ] **Step 1: Write failing pure-analysis tests**

Use plain existing preset objects and assert:

```js
const result = analyzePresetSource('gas', [
  { name: 'AIR', oxygenPercent: 21, heliumPercent: 0 },
  { name: 'New mix', oxygenPercent: 18, heliumPercent: 45 },
  { name: 'Same content, new name', oxygenPercent: 18, heliumPercent: 45 },
  { name: 'Broken', oxygenPercent: 101, heliumPercent: 0 }
]);
assert.equal(result.candidates[0].status, 'duplicate');
assert.equal(result.candidates[1].status, 'new');
assert.equal(result.candidates[2].status, 'duplicate');
assert.equal(result.candidates[3].status, 'invalid');
```

Cover normalized-name duplicates, content duplicates with different names, duplicate source entries, cylinder validation, combined equipment collections, malformed top-level shapes, and fresh merge results without mutating the input settings.

- [ ] **Step 2: Run the focused tests and verify failure**

Run: `node --test tests/preset-import.test.js`

Expected: FAIL because `js/preset-import.js` does not exist.

- [ ] **Step 3: Implement source normalization and classification**

Define category metadata with collection name, validator, and content fields. Normalize gas/cylinder arrays directly. Normalize equipment objects into ordered compressor and booster candidates; reject non-array provided collections and reject an equipment object with neither collection. Validate each candidate with the existing validator. Build duplicate indexes from current settings and previously accepted candidates; compare normalized names first and stable field-value content second. Return candidate status and human-readable reason without throwing for individual invalid entries.

- [ ] **Step 4: Implement immutable selected merge**

Copy settings with `copySettings`, verify every selected ID refers to a `new` candidate, append fresh preset objects to the correct collection, then call `validateSettings` and throw a `RangeError` on any merged error. Never mutate the caller’s settings or candidate objects.

- [ ] **Step 5: Run the focused tests**

Run: `node --test tests/preset-import.test.js`

Expected: PASS for all analysis, duplicate, validation, and merge cases.

---

### Task 2: Add repository preset files and persistence coverage

**Files:**
- Create: `presets/gas.json`
- Create: `presets/cylinders.json`
- Create: `presets/equipment.json`
- Modify: `tests/settings.test.js`
- Modify: `tests/preset-import.test.js`

**Interfaces:**
- Consumes: the import JSON shapes from Task 1.
- Produces: valid repository defaults and tests proving merged settings survive the existing `saveSettings`/`loadSettings` round trip.

- [ ] **Step 1: Add fixture assertions**

Read the repository fixture files from the test using `readFileSync` and `JSON.parse`, analyze each with the matching category, and assert every fixture entry is either `new` or `duplicate` and none is `invalid`.

- [ ] **Step 2: Add settings round-trip coverage**

Create a copy of `DEFAULT_SETTINGS`, analyze a new gas, cylinder, compressor, and booster candidate, merge selected IDs, save with the existing memory storage helper, reload with `loadSettings`, and assert each imported object is present with exact fields.

- [ ] **Step 3: Run focused tests**

Run: `node --test tests/preset-import.test.js tests/settings.test.js`

Expected: PASS.

---

### Task 3: Add Preset management Settings markup and renderer

**Files:**
- Modify: `index.html:66-101` to add the category button and pane.
- Modify: `js/ui/settings-dialog.js` to render category controls, default URLs, candidate rows, and import status.
- Modify: `tests/settings-dialog.test.js`

**Interfaces:**
- Consumes: `settings` and a renderer import-preview model supplied by `main.js`.
- Produces:
  - Category button `data-settings-category="preset-management"` and pane `settings-pane-preset-management`.
  - Controls with `data-action="load-preset-file"`, `data-action="load-preset-url"`, `data-action="import-selected-presets"`, category selector, URL input, file input, candidate checkboxes, and a polite status region.
  - `renderPresetImport(settings, importState)` that renders the current category and candidate state without HTML interpolation.

- [ ] **Step 1: Extend fake-DOM coverage**

Add fake elements required by `renderSettingsDialog`, assert the Settings markup contains the new category/pane and all three default raw URLs, and assert a supplied preview renders a checked `new` candidate plus disabled unchecked `duplicate` and `invalid` candidates. Assert the import button is disabled when no new candidate is selected.

- [ ] **Step 2: Run focused UI tests and verify failure**

Run: `node --test tests/settings-dialog.test.js`

Expected: FAIL because the markup and renderer controls do not exist.

- [ ] **Step 3: Add the management pane markup**

Follow the existing category rail and pane classes. Include a category select, file input accepting `.json,application/json`, URL input, separate load buttons, candidate container, status live region, and import button. Keep existing Save/Cancel controls unchanged.

- [ ] **Step 4: Implement renderer functions**

Render category-specific labels and default URL. Render each candidate as a row with a checkbox only when `status === 'new'`; set `disabled`, muted classes, and status text for duplicates/invalid entries. Use DOM properties/textContent for all source values. Compute the import button disabled state from selectable checked candidates.

- [ ] **Step 5: Run focused UI tests**

Run: `node --test tests/settings-dialog.test.js`

Expected: PASS.

---

### Task 4: Integrate local/online loading and immediate import persistence

**Files:**
- Modify: `js/main.js:4-18,39-53,154-187,562-666`
- Modify: `js/ui/settings-dialog.js` only if integration needs renderer state updates.
- Modify: `tests/settings-dialog.test.js` only for pure renderer behavior not covered in Task 3.

**Interfaces:**
- Consumes: `PRESET_IMPORT_DEFAULT_URLS`, `analyzePresetSource`, and `mergeSelectedPresets` from `js/preset-import.js`; existing `copySettings`, `saveSettings`, `renderSettingsDialog`, and `renderPresetOptions`.
- Produces: browser actions for file selection, online fetch, candidate checkbox selection, and immediate persistence of selected imports.

- [ ] **Step 1: Add state and action wiring**

Add `settingsImport` state containing category, URL, candidates, checked IDs, status, and loading flag. Extend Settings categories with `preset-management`. Render the import state whenever the dialog draft renders and preserve the selected category after rerender.

- [ ] **Step 2: Implement local file loading**

On file change/action, read the selected `File` with `file.text()`, parse JSON, analyze the selected category, store the preview model, and report file/JSON errors in the Settings status region. Do not change settings on analysis failure.

- [ ] **Step 3: Implement online loading**

Fetch the URL with `fetch`, require `response.ok`, parse JSON, analyze it, and store the preview model. Catch network, HTTP, and parse failures and show an actionable error without changing settings. Keep URL input editable.

- [ ] **Step 4: Implement immediate selected import**

Collect checked candidate IDs, call `mergeSelectedPresets(state.settings, candidates, selectedIds)`, save with `saveSettings`, then assign a fresh copy to both `state.settings` and `state.settingsDraft`, clear the preview, clear settings-load failure, refresh all preset options, rerender the dialog, and recalculate. On any failure, keep previous state and display the error.

- [ ] **Step 5: Add checkbox/category change handling**

Changing category resets the preview to that category and fills its default URL only when the URL has not been user-edited. Checkbox changes update selected IDs and rerender only the import surface. The existing manual settings handlers and Save/Cancel actions continue to work.

- [ ] **Step 6: Run focused integration checks**

Run: `node --test tests/settings-dialog.test.js tests/settings.test.js tests/preset-import.test.js`

Expected: PASS.

---

### Task 5: Update architecture and development documentation

**Files:**
- Modify: `docs/architecture.md`
- Modify: `docs/development.md`
- Modify: `README.md` only if the project documentation index needs a preset-management link.

- [ ] **Step 1: Document module boundaries and data flow**

Add `js/preset-import.js`, the `presets/` fixture files, immediate import persistence, duplicate classification, and the Settings management pane to the architecture responsibilities/data flow.

- [ ] **Step 2: Add browser smoke checks**

Document checks for default URLs, local file load, online load, duplicate disabling, selective import, immediate reload persistence, invalid/network/storage errors, and unchanged manual Save/Cancel behavior.

- [ ] **Step 3: Run documentation consistency checks**

Run: `grep -R "preset-management\|preset-import\|presets/" docs README.md`

Expected: the new architecture and smoke-check references are present.

---

### Task 6: Full verification and browser smoke test

**Files:**
- No production files expected; fix only regressions discovered in the changed flow.

- [ ] **Step 1: Run the complete automated suite**

Run: `npm test`

Expected: all tests pass with no failures, cancellations, or unhandled errors.

- [ ] **Step 2: Serve and exercise the actual page**

Run: `python3 -m http.server 8000`.

Open the page and verify Settings → Preset management, each category’s default URL, local JSON selection, online loading, duplicate disabled rows, checked new rows, selective immediate import, refreshed main-screen selectors, and visible error handling for invalid input. Check the browser console for app module/runtime errors.

- [ ] **Step 3: Run the complete suite again after smoke-driven fixes**

Run: `npm test`

Expected: PASS.
