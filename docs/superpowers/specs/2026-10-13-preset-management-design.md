# Preset Management Design

## Goal

Add a Settings → Preset management workflow that loads gas, cylinder, and equipment preset files from the local drive or the project’s GitHub raw files, previews valid import candidates, disables duplicates, and persists confirmed new presets for use by the application.

## Scope

The change adds one Settings category and three importable preset collections:

- Gas presets.
- Cylinder presets.
- Equipment presets, represented by one file containing compressor and booster preset arrays.

The feature does not change the existing settings localStorage key, preset object shapes, calculation behavior, or manual preset editing workflow.

## Existing boundaries

- `js/settings.js` remains the owner of settings copying, validation, persistence, and the existing preset schemas.
- `js/preset-validation.js` remains the source of preset validation rules.
- `js/main.js` owns browser event delegation, settings drafts, file/URL loading, and import persistence orchestration.
- `js/ui/settings-dialog.js` owns Settings dialog rendering.
- A new pure module owns import-file normalization, validation classification, duplicate comparison, and merge preparation without DOM or browser APIs.
- Repository defaults live under `presets/` and use the same shapes accepted by the importer.

## File formats and defaults

The importer accepts JSON only.

`presets/gas.json` is an array of:

```json
[
  { "name": "EAN 32", "oxygenPercent": 32, "heliumPercent": 0 }
]
```

`presets/cylinders.json` is an array of:

```json
[
  {
    "name": "Catalina S80",
    "volumeL": 11.1,
    "material": "aluminum",
    "massKg": 14.3,
    "workingPressureBar": 207
  }
]
```

`presets/equipment.json` is an object containing both existing equipment collections:

```json
{
  "compressorPresets": [
    {
      "name": "Bauer Junior 2 200bar",
      "inletFlowLPerMin": 100,
      "maxPressureBar": 232,
      "temperatureModifierC": 5
    }
  ],
  "boosterPresets": [
    {
      "name": "MPS C1 Sport light",
      "minimumSourcePressureBar": 5,
      "cylinderVolumeCm3": 9,
      "oxygenBoostBpm": 35,
      "otherBoostBpm": 50,
      "oxygenDecantRateBarPerMin": 5,
      "otherDecantRateBarPerMin": 10,
      "maxOutputPressureBar": 230,
      "temperatureModifierC": 10,
      "drainingRateBarPerMin": 15
    }
  ]
}
```

Default online URLs:

- `https://raw.githubusercontent.com/speleobrad/simplex-blender/master/presets/gas.json`
- `https://raw.githubusercontent.com/speleobrad/simplex-blender/master/presets/cylinders.json`
- `https://raw.githubusercontent.com/speleobrad/simplex-blender/master/presets/equipment.json`

The defaults are ordinary editable URL values, so users can load compatible files from another server.

## User flow

1. Open Settings and select **Preset management**.
2. Select Gas, Cylinders, or Equipment.
3. Choose a local JSON file, or edit the prefilled URL and choose **Load online**.
4. The app parses and analyzes the file.
5. The preview lists every candidate with its name and relevant values.
6. Invalid candidates are visibly rejected and cannot be selected.
7. Existing candidates are visibly grayed out, unchecked, and disabled.
8. New valid candidates are checked by default and can be individually selected or deselected.
9. **Import selected** validates the merged settings, writes them through `saveSettings`, updates the live settings and current draft, and refreshes the application preset selectors.
10. A successful import clears the preview and reports the imported count. A failed import leaves storage and live state unchanged and displays the error.

Import confirmation is intentionally immediate because the requirement is that confirmed entries reach local storage. Manual edits made elsewhere in the dialog continue to follow the existing Save/Cancel behavior; an already-confirmed import is not rolled back by Cancel.

## Candidate normalization and duplicate policy

The pure importer maps one category to one settings collection:

- Gas → `gasPresets`.
- Cylinders → `cylinderPresets`.
- Equipment → `compressorPresets` and `boosterPresets`.

For equipment, candidates are labeled by subtype and compared only against the matching collection.

Each candidate is classified as exactly one of:

- `new`: valid and not duplicated under the category's duplicate policy.
- `duplicate`: valid but duplicated under the category's duplicate policy.
- `invalid`: does not satisfy the existing validator or conflicts with the existing unique-name invariant.

Gas candidates compare complete persisted composition content only. Cylinder, compressor, and booster candidates compare normalized names only; casing and surrounding whitespace do not distinguish names. A candidate duplicated earlier in the same file is classified as a duplicate under the same category policy. Duplicate candidates are never imported, even if a user attempts to select them programmatically.

The importer must reject malformed top-level JSON shapes with a category-specific error. Equipment files must contain arrays for any provided `compressorPresets` and `boosterPresets`; if either provided collection is malformed, the entire source is rejected without selectable candidates. An empty valid collection is allowed, but a file with neither collection is invalid.

## Persistence and failure handling

The merged settings are validated with the existing `validateSettings` and written with the existing `saveSettings`. The merge uses fresh objects and does not mutate the saved settings until the storage write succeeds. On storage failure, the previous live settings, draft, and preview remain available, and the UI reports that the import was not saved.

Local file reads use the browser File API. Online reads use `fetch` and require a successful HTTP response before parsing. Network, file-read, JSON-parse, schema, and storage errors are shown in the Settings error/status area; no error is silently ignored.

## UI and accessibility

The new category follows the existing responsive Settings rail and pane pattern. The management pane exposes labels for category, local file, URL, loading actions, candidate status, and selection controls. Disabled duplicate/invalid entries remain readable and have status text; the import action is disabled when no new candidate is selected. Status messages use an existing or new polite live region.

The importer must not rely on file names for duplicate detection or persistence. Online URL text is escaped through DOM properties, not HTML interpolation.

## Testing

Add pure-module tests for:

- gas, cylinder, and combined equipment shape normalization;
- validator failures;
- case-insensitive name duplicates;
- content duplicates with different names;
- duplicates within one source file;
- disabled/no-import classifications;
- merge immutability and correct collection placement.

Add Settings UI tests for the new category markup, default URLs, disabled duplicate rows, checked new rows, and disabled empty import action. Extend settings persistence tests to verify a successful merge round trip and rejection of an invalid merged collection.

Run focused tests, then `npm test`. Serve the actual page and smoke-test local-file selection, online loading with the default URLs, duplicate preview state, selective import, immediate reload persistence, and updated gas/cylinder/equipment selectors.

## Acceptance criteria

- Settings contains a Preset management category.
- Gas, cylinder, and combined equipment files can be loaded from local JSON or an editable online URL.
- Default online URLs point to raw files in this repository’s `presets/` directory.
- The preview validates entries before import.
- Entries duplicated by normalized name or complete content are grayed out and unavailable.
- New valid entries appear with selectable checkboxes.
- Confirmed selections are immediately persisted and become available in the existing app controls.
- Invalid files, entries, network errors, and storage failures are visible and do not partially modify settings.
- Existing settings editing, saving, canceling, and calculation behavior remain intact.
