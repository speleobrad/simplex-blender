# Remote and Local Preset Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add URL/file JSON import for gas, cylinder, compressor, and booster presets with duplicate-aware checkbox selection and local settings persistence.

**Architecture:** Keep parsing and import decisions in DOM-free modules. Extend `settings.js` with validated compressor/booster preset collections, migration, active-preset normalization, and duplicate helpers. Add a small import view/controller surface to the existing Settings dialog; loading only populates transient import state, while importing updates `settingsDraft` and the existing Save action remains the persistence boundary.

**Tech Stack:** Browser-native ES modules, native `<dialog>`, Tailwind utility classes already used by the page, Node built-in test runner, DOM-free unit tests with the repository's existing fake DOM patterns.

**Spec:** `docs/superpowers/specs/2026-10-12-remote-preset-import-design.md`

## Global Constraints

- Use the existing `settings.js` localStorage key and `saveSettings`/`loadSettings` path.
- Preserve the current flat `settings.booster` active equipment fields used by calculations.
- Add `compressorPresets` and `boosterPresets` collections without breaking legacy saved settings.
- A source JSON object MAY omit any supported category, but an object with no recognized category arrays is invalid.
- Existing local settings MUST NOT change during source loading or checkbox selection.
- Existing local presets are duplicates by case-insensitive trimmed name OR canonical functional content.
- Invalid imported records MUST be reported and MUST NOT be selectable.
- Remote loading uses one `fetch` attempt and reports HTTP, network, CORS, JSON, and schema failures.
- No default remote URLs are loaded until actual URLs are supplied; expose an empty configurable URL map.
- Run `npm test` after all implementation tasks; perform a browser smoke check against the actual page.

---

### Task 1: Add pure preset import parsing and duplicate selection logic

**Files:**
- Create: `js/preset-import.js`
- Create: `tests/preset-import.test.js`

**Interfaces:**
- Produces `PRESET_CATEGORIES`, `DEFAULT_PRESET_URLS`, `parsePresetDocument(document)`, `getImportEntries(parsed, settings)`, `canonicalPresetContent(category, preset)`, and `mergeSelectedPresets(settingsDraft, entries)`.
- Consumes existing validation rules from `js/settings.js` through a dependency-safe validation interface. Avoid a circular import: move shared equipment validation helpers to a DOM-free module or expose category validators from a module that does not import `preset-import.js`.
- `parsePresetDocument(document)` returns `{ entries, errors }`, where each entry is `{ category, preset }` and errors are strings. It throws only for non-object root input if that is the established module convention; normal malformed entries are represented in `errors`.
- `getImportEntries(parsed, settings)` returns entries with `{ category, preset, duplicate, duplicateReason }`, where duplicate is true for a local name/content collision or an earlier entry in the same imported document.
- `mergeSelectedPresets(settingsDraft, entries)` returns a copied validated settings object and appends only selected non-duplicate entries.

- [ ] **Step 1: Write failing parser tests**

Add tests that exercise real pure functions:

```js
test('parses a gas-only document', () => {
  const result = parsePresetDocument({
    gasPresets: [{ name: 'EAN32', oxygenPercent: 32, heliumPercent: 0 }]
  });

  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.entries, [{
    category: 'gasPresets',
    preset: { name: 'EAN32', oxygenPercent: 32, heliumPercent: 0 }
  }]);
});

test('parses mixed category documents and rejects invalid records', () => {
  const result = parsePresetDocument({
    gasPresets: [
      { name: 'EAN32', oxygenPercent: 32, heliumPercent: 0 },
      { name: 'Bad gas', oxygenPercent: 80, heliumPercent: 30 }
    ],
    cylinderPresets: [{
      name: '12 L', volumeL: 12, material: 'steel', massKg: 14, workingPressureBar: 232
    }]
  });

  assert.equal(result.entries.length, 2);
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0], /Bad gas/);
});

test('rejects a document without a recognized category', () => {
  assert.throws(() => parsePresetDocument({ banks: [] }), /recognized preset/i);
});
```

Add equivalent cases for compressor and booster schema field names, omitted categories, malformed category arrays, and invalid values.

- [ ] **Step 2: Run parser tests to verify the expected failure**

Run: `node --test tests/preset-import.test.js`

Expected: FAIL because `js/preset-import.js` does not exist.

- [ ] **Step 3: Implement category schemas and parser**

Define category metadata in one place. Gas and cylinder records retain their existing field names. Compressor records normalize:

```js
{
  name,
  inletFlowLPerMin,
  maxPressureBar,
  temperatureModifierC
}
```

Booster records normalize:

```js
{
  name,
  cylinderVolumeCm3,
  minimumSourcePressureBar,
  oxygenBoostBpm,
  otherBoostBpm,
  maxOutputPressureBar,
  temperatureModifierC,
  oxygenDecantRateBarPerMin,
  otherDecantRateBarPerMin,
  drainingRateBarPerMin
}
```

Validate each record against the same numeric limits and name/composition rules used by settings. Copy accepted records so later UI edits cannot mutate parsed source data.

- [ ] **Step 4: Add failing duplicate and merge tests**

```js
test('marks local name and content duplicates while retaining new entries', () => {
  const parsed = parsePresetDocument({
    gasPresets: [
      { name: ' air ', oxygenPercent: 21, heliumPercent: 0 },
      { name: 'My mix', oxygenPercent: 32, heliumPercent: 0 },
      { name: 'Same content', oxygenPercent: 32, heliumPercent: 0 }
    ]
  });
  const entries = getImportEntries(parsed, {
    ...DEFAULT_SETTINGS,
    gasPresets: [{ name: 'Air', oxygenPercent: 21, heliumPercent: 0 }]
  });

  assert.equal(entries[0].duplicate, true);
  assert.equal(entries[1].duplicate, false);
  assert.equal(entries[2].duplicate, true);
});

test('merges only selected non-duplicates into a copied draft', () => {
  const draft = {
    ...DEFAULT_SETTINGS,
    gasPresets: DEFAULT_SETTINGS.gasPresets.map(preset => ({ ...preset }))
  };
  const merged = mergeSelectedPresets(draft, [{
    category: 'gasPresets',
    preset: { name: 'My mix', oxygenPercent: 32, heliumPercent: 0 },
    selected: true,
    duplicate: false
  }]);

  assert.equal(merged.gasPresets.at(-1).name, 'My mix');
  assert.equal(draft.gasPresets.some(preset => preset.name === 'My mix'), false);
});
```

Test that names are excluded from canonical content equality, fields are ordered stably, and duplicate entries in one imported source are disabled after the first occurrence.

- [ ] **Step 5: Implement canonicalization and merge**

Use category-specific functional fields in a fixed order. Normalize numeric values to finite numbers and normalize names only for name comparison. Do not include `name` in content canonicalization. Have `mergeSelectedPresets` deep-copy the draft, append records to the correct collection, and validate the final result before returning it.

- [ ] **Step 6: Run the focused tests**

Run: `node --test tests/preset-import.test.js tests/settings.test.js`

Expected: PASS.

- [ ] **Step 7: Commit the pure import module**

```sh
git add js/preset-import.js tests/preset-import.test.js
git commit -m "feat: add preset import parsing and deduplication"
```

---

### Task 2: Extend settings persistence with equipment preset collections

**Files:**
- Modify: `js/settings.js`
- Modify: `tests/settings.test.js`

**Interfaces:**
- Produces default `compressorPresets` and `boosterPresets` arrays, migration of legacy settings, validation for both collections, copying/round-trip persistence, and `applyCompressorPresetToSettings`/`applyBoosterPresetToSettings` helpers.
- Consumes existing `DEFAULT_SETTINGS.booster` values and keeps all current active field names unchanged.

- [ ] **Step 1: Write failing settings tests**

Add tests for:

```js
test('default settings expose named compressor and booster presets', () => {
  assert.equal(DEFAULT_SETTINGS.compressorPresets.length, 1);
  assert.equal(DEFAULT_SETTINGS.boosterPresets.length, 1);
  assert.equal(DEFAULT_SETTINGS.compressorPresets[0].inletFlowLPerMin, 100);
  assert.equal(DEFAULT_SETTINGS.boosterPresets[0].maxOutputPressureBar, 200);
});

test('legacy settings migrate active equipment values into preset collections', () => {
  const loaded = loadSettings(memoryStorage([[
    'simplex-gas-remixer-settings',
    JSON.stringify({
      gasPresets: [{ name: 'Air', oxygenPercent: 21, heliumPercent: 0 }],
      volumePresets: [12],
      booster: { ...DEFAULT_SETTINGS.booster, compressorInletFlowLPerMin: 160 }
    })
  ]]));

  assert.equal(loaded.compressorPresets[0].inletFlowLPerMin, 160);
  assert.equal(loaded.boosterPresets[0].cylinderVolumeCm3, 9);
});

test('equipment preset collections survive a settings round trip', () => {
  const settings = {
    ...DEFAULT_SETTINGS,
    gasPresets: DEFAULT_SETTINGS.gasPresets.map(preset => ({ ...preset })),
    cylinderPresets: DEFAULT_SETTINGS.cylinderPresets.map(preset => ({ ...preset })),
    booster: { ...DEFAULT_SETTINGS.booster },
    compressorPresets: DEFAULT_SETTINGS.compressorPresets.map(preset => ({ ...preset })),
    boosterPresets: DEFAULT_SETTINGS.boosterPresets.map(preset => ({ ...preset }))
  };
  settings.compressorPresets.push({
    name: 'High flow', inletFlowLPerMin: 160, maxPressureBar: 250, temperatureModifierC: 4
  });
  const storage = memoryStorage();
  saveSettings(settings, storage);
  assert.deepEqual(loadSettings(storage).compressorPresets, settings.compressorPresets);
});
```

Add invalid-range and duplicate-name tests for both collections, plus tests that applying a preset updates only its active `settings.booster` fields.

- [ ] **Step 2: Run settings tests to verify the expected failure**

Run: `node --test tests/settings.test.js`

Expected: FAIL because the new collections and helpers are absent.

- [ ] **Step 3: Add defaults, copy support, normalization, and validation**

Create named built-in presets from the existing active defaults. Add the two arrays to `copySettings`, `validateSettings`, load normalization, and save normalization. A missing collection is created from the current active fields; an existing collection is preserved. Reject empty names, duplicate case-insensitive names, invalid numbers, and collections that are not arrays.

- [ ] **Step 4: Implement active equipment preset application**

Map compressor preset fields to `settings.booster.compressorInletFlowLPerMin`, `maxCompressorPressureBar`, and `compressorTemperatureModifierC`. Map booster preset fields to the remaining active booster fields. Return a copied settings object so the UI can update a draft without mutating committed state.

- [ ] **Step 5: Run focused settings tests**

Run: `node --test tests/settings.test.js tests/preset-import.test.js`

Expected: PASS.

- [ ] **Step 6: Commit settings persistence changes**

```sh
git add js/settings.js tests/settings.test.js
git commit -m "feat: persist equipment preset collections"
```

---

### Task 3: Add import and equipment controls to the Settings dialog

**Files:**
- Modify: `scuba_gas_remixer_simplex_optimizer.html`
- Modify: `js/ui/settings-dialog.js`
- Modify: `tests/settings-dialog.test.js`

**Interfaces:**
- Produces markup for the import controls and equipment preset selectors.
- `renderSettingsDialog(settings)` renders gas/cylinder rows, equipment selectors, active equipment fields, and resets stale import results through a controller-owned surface.
- Add `renderPresetImport(entries, status)` and `clearPresetImport()` to render the grouped checkbox list without owning fetch/file state.

- [ ] **Step 1: Write failing renderer tests**

Extend the fake DOM as needed (`disabled`, `checked`, `append`, `querySelectorAll`, and `classList.toggle`). Test observable behavior:

```js
test('renders equipment selectors and active values', () => {
  renderSettingsDialog(settingsWithEquipmentPresets());
  const compressor = elements.get('settings-compressor-preset');
  const booster = elements.get('settings-booster-preset');

  assert.deepEqual(compressor.children.map(option => option.textContent), ['Standard compressor', 'High flow']);
  assert.equal(compressor.value, 'Standard compressor');
  assert.equal(booster.value, 'Standard booster');
});

test('renders duplicate import entries as disabled checkboxes', () => {
  renderPresetImport([{
    category: 'gasPresets',
    preset: { name: 'Air', oxygenPercent: 21, heliumPercent: 0 },
    duplicate: true,
    duplicateReason: 'same name'
  }], 'Loaded 1 preset');

  const checkbox = elements.get('preset-import-list').children[0].querySelector('input');
  assert.equal(checkbox.disabled, true);
});
```

- [ ] **Step 2: Run dialog tests to verify the expected failure**

Run: `node --test tests/settings-dialog.test.js`

Expected: FAIL because the controls and render helpers do not exist.

- [ ] **Step 3: Add equipment preset selectors to the HTML**

Add selectors at the top of the Compressor and Booster equipment sections. Use `data-action="select-compressor-preset"` and `data-action="select-booster-preset"`. Keep current active input IDs and data fields unchanged so existing controller logic remains valid.

Add an Import presets section in the settings dialog with:

- `settings-preset-url`
- `settings-load-preset-url`
- `settings-preset-file`
- `settings-preset-import-status`
- `settings-preset-import-list`
- `settings-import-selected`

Use native labels, buttons, file input, checkboxes, and an `aria-live="polite"` status region.

- [ ] **Step 4: Implement renderer helpers**

Render selectors from `settings.compressorPresets` and `settings.boosterPresets`, selecting the active preset by matching all active fields; otherwise use the first preset without changing values. Render import entries grouped by category, with disabled checkboxes and a visible duplicate reason. Store entry identity in `data-preset-import-index` rather than serializing JSON into DOM attributes.

- [ ] **Step 5: Run dialog tests**

Run: `node --test tests/settings-dialog.test.js`

Expected: PASS.

- [ ] **Step 6: Commit dialog surface changes**

```sh
git add scuba_gas_remixer_simplex_optimizer.html js/ui/settings-dialog.js tests/settings-dialog.test.js
git commit -m "feat: add preset import settings controls"
```

---

### Task 4: Wire URL/file loading, selection, equipment selection, and draft merging

**Files:**
- Modify: `js/main.js`
- Modify: `js/ui/settings-dialog.js` if renderer event metadata needs adjustment
- Modify: `docs/architecture.md`
- Modify: `docs/development.md`

**Interfaces:**
- Consumes parser and merge APIs from `js/preset-import.js` and equipment application helpers from `js/settings.js`.
- Produces the end-to-end Settings dialog behavior: load source, render choices, merge checked entries into `settingsDraft`, and save through the existing Save settings path.

- [ ] **Step 1: Add controller-focused failing tests where the existing harness permits**

If `main.js` cannot be imported under Node because it initializes the browser immediately, extract pure controller helpers into `js/preset-import.js` and test those instead. The tests MUST cover:

- Loading a parsed source does not mutate committed settings.
- Selecting one new entry and importing it adds exactly one record to the draft.
- Disabled duplicate entries cannot be merged.
- Selecting a compressor or booster preset updates only the draft's active fields.

Use real settings objects and pure functions; do not assert only that a mock callback was called.

- [ ] **Step 2: Run the focused controller/pure tests and verify expected failures**

Run: `node --test tests/preset-import.test.js tests/settings.test.js`

Expected: FAIL for the newly specified selection and equipment-application behavior.

- [ ] **Step 3: Add transient import state to `main.js`**

Track loaded entries only while Settings is open. On `openSettings`, clear previous source entries and status. On dialog close, discard them. Do not put them in `state.settings` or localStorage.

- [ ] **Step 4: Wire local-file loading**

Handle `change` on `settings-preset-file`, read the selected file with `File.text()`, parse JSON, call `parsePresetDocument`, annotate duplicates against `state.settingsDraft`, and render the result. Report errors through `settings-preset-import-status`. Clear the file input after processing so the same file can be selected again.

- [ ] **Step 5: Wire URL loading**

Handle `settings-load-preset-url`, trim and require a non-empty URL, call `fetch(url)`, reject non-OK responses with status text, parse JSON, annotate duplicates, and render the result. Disable the load button while the request is pending and restore it in `finally`. Use the empty `DEFAULT_PRESET_URLS` map as the future configuration point; do not add automatic requests.

- [ ] **Step 6: Wire checkbox selection and Import selected**

On **Import selected**, collect checked, non-disabled entries by index, call `mergeSelectedPresets`, replace `state.settingsDraft` with the returned copy, re-render settings, restore the current category, clear import entries, and show a success status. If no entries are selected, show an actionable status and leave the draft unchanged.

- [ ] **Step 7: Wire equipment preset selectors**

On compressor selection, apply the selected compressor preset to a copied draft, then render the dialog while preserving the selected category. On booster selection, do the analogous operation. Editing active equipment fields continues to update the draft through the existing delegated input handler and does not rewrite preset collections.

- [ ] **Step 8: Update architecture and smoke-check documentation**

Document the new `js/preset-import.js` boundary, settings collections, transient import state, and four-category JSON sources in `docs/architecture.md`. Add browser smoke steps to `docs/development.md` for URL/file loading, disabled duplicates, selection, Save, reload, and active equipment preset selection.

- [ ] **Step 9: Run focused tests**

Run: `node --test tests/preset-import.test.js tests/settings.test.js tests/settings-dialog.test.js`

Expected: PASS.

- [ ] **Step 10: Commit controller and documentation changes**

```sh
git add js/main.js js/ui/settings-dialog.js docs/architecture.md docs/development.md tests/preset-import.test.js
 git commit -m "feat: wire remote and local preset import"
```

---

### Task 5: Full verification and browser smoke test

**Files:**
- Modify only files required by failing verification.

- [ ] **Step 1: Run the complete Node test suite**

Run: `npm test`

Expected: PASS with no test failures or unexpected runtime errors.

- [ ] **Step 2: Serve the application**

Run: `python3 -m http.server 8000`

Open `http://127.0.0.1:8000/scuba_gas_remixer_simplex_optimizer.html` in a browser.

- [ ] **Step 3: Exercise the actual import flow**

Verify:

1. Open Settings → Import presets.
2. Load a valid gas/cylinder JSON file from the local drive.
3. Confirm entries appear grouped with checkboxes.
4. Confirm an existing same-name or same-content entry is visible but disabled/grayed out.
5. Select a new gas and cylinder entry, import them, and verify they appear in the settings lists.
6. Save settings, reload the page, and verify both entries survive.
7. Select the imported cylinder on the main form and verify its dimensions/rating are used.
8. Load a valid JSON document from a URL and verify the same selection behavior, subject to server CORS policy.
9. Load invalid JSON and a non-OK URL response; verify the error is visible and existing settings remain unchanged.
10. Import compressor and booster files, select the imported equipment presets, save, reload, and verify active equipment values survive.

- [ ] **Step 4: Check browser console and existing smoke invariants**

Confirm no app module/runtime errors. Recheck the existing default calculation and Settings cancel/save behavior from `docs/development.md`.

- [ ] **Step 5: Commit only verification fixes**

If verification finds a defect, add a regression test first, fix the smallest affected implementation, rerun the relevant focused test, then rerun `npm test` and the browser scenario. Do not commit generated files or throwaway fixtures.
