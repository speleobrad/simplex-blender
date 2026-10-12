# Remote and Local Preset Import

## Goal

Allow users to load gas, cylinder, compressor, and booster presets from a remote URL or local JSON file, choose which new presets to import, and persist the selected presets in the local app settings.

## Scope

The feature extends the existing Settings dialog and settings persistence flow. It does not add a server, upload functionality, background synchronization, or automatic loading from remote sources.

Supported source files are JSON objects containing one or more category arrays:

- `gasPresets`
- `cylinderPresets`
- `compressorPresets`
- `boosterPresets`

A file MAY contain only one category, which supports separate files for each preset type. A file MAY contain multiple categories, which are displayed together in the import selection list.

## JSON schemas

Gas preset:

```json
{
  "gasPresets": [
    { "name": "EAN32", "oxygenPercent": 32, "heliumPercent": 0 }
  ]
}
```

Cylinder preset:

```json
{
  "cylinderPresets": [
    {
      "name": "12 L Steel 232 bar",
      "volumeL": 12,
      "material": "steel",
      "massKg": 14,
      "workingPressureBar": 232
    }
  ]
}
```

Compressor preset:

```json
{
  "compressorPresets": [
    {
      "name": "Standard compressor",
      "inletFlowLPerMin": 100,
      "maxPressureBar": 232,
      "temperatureModifierC": 0
    }
  ]
}
```

Booster preset:

```json
{
  "boosterPresets": [
    {
      "name": "Standard booster",
      "cylinderVolumeCm3": 9,
      "minimumSourcePressureBar": 20,
      "oxygenBoostBpm": 50,
      "otherBoostBpm": 50,
      "maxOutputPressureBar": 200,
      "temperatureModifierC": 0,
      "oxygenDecantRateBarPerMin": 5,
      "otherDecantRateBarPerMin": 5,
      "drainingRateBarPerMin": 5
    }
  ]
}
```

The importer MUST reject malformed category values and entries that violate the existing settings constraints. The importer MUST allow omitted category arrays. A source with no recognized category arrays MUST produce an error and MUST NOT alter the draft.

## Settings model

The existing flat `settings.booster` object remains the active equipment configuration used by calculations. Settings gain two persisted collections:

- `compressorPresets`
- `boosterPresets`

Each collection contains validated named preset records. Built-in defaults include the current compressor and booster values represented as named presets. Existing saved settings without these collections migrate by creating collections from their current active values. Existing gas and cylinder settings remain unchanged.

Selecting a compressor or booster preset copies its fields into the active flat settings values. Saving settings persists both the active values and preset collections. Imported equipment presets are therefore usable, not merely stored.

The active compressor fields remain in `settings.booster`:

- `compressorInletFlowLPerMin`
- `maxCompressorPressureBar`
- `compressorTemperatureModifierC`

The active booster fields remain in `settings.booster`:

- `minimumSourcePressureBar`
- `cylinderVolumeCm3`
- `oxygenBoostBpm`
- `otherBoostBpm`
- `maxBoosterOutputPressureBar`
- `boosterTemperatureModifierC`
- `oxygenDecantRateBarPerMin`
- `otherDecantRateBarPerMin`
- `drainingRateBarPerMin`

The imported compressor and booster schemas use the shorter category-specific field names shown above and are normalized into the active settings field names when selected.

## Import flow

The Settings dialog gains an Import presets action. The import surface provides:

1. A URL input and **Load from URL** button.
2. A local JSON file input and **Load from local drive** button.
3. A grouped selection list for valid gas, cylinder, compressor, and booster entries.
4. An **Import selected** action.
5. An error/status region with accessible live updates.

The URL loader uses `fetch`, requires a successful response, parses JSON, and reports network, HTTP, CORS, JSON, and schema errors. It does not retry. The local loader uses the browser file picker and reads the selected file as text. The implementation exposes an empty configurable default-URL map for later URL values; no default remote URL is loaded automatically in this change.

After a source is parsed, valid records are rendered with checkboxes. Records already present in the corresponding local collection are disabled and visibly grayed out when either condition is true:

- The trimmed name, compared case-insensitively, matches an existing local preset name.
- The canonical preset content matches an existing local preset content.

The same duplicate rules apply to duplicate records in the loaded source. A same-name/different-content record is disabled because local settings require unique names. Invalid records are not selectable and are reported in the import status/error region.

No local settings are changed while loading or selecting. **Import selected** appends enabled checked records to `settingsDraft`, validates the resulting draft, clears the import selection, and refreshes the relevant settings panes. The user must click the existing **Save settings** action to persist the draft through `saveSettings`. If saving fails, the existing settings error path remains active and no in-memory committed settings change occurs.

Cancelling Settings discards imported selections and all other draft changes, matching current behavior.

## Duplicate canonicalization

Duplicate content comparison uses category-specific fields in a stable order and normalized scalar values. Names are excluded from content equality so two differently named presets with identical functional values are recognized as content duplicates. Name equality trims surrounding whitespace and uses locale-independent case folding consistent with existing settings validation.

## UI behavior

Gas and cylinder panes retain their current editable lists. Compressor and booster panes gain preset selectors plus the existing active equipment fields. Selecting a preset updates the active draft fields; editing an active field does not silently rewrite the selected preset.

The import list displays category, name, and category-relevant summary values. Disabled duplicates remain visible so users can understand why they were not imported. The dialog remains keyboard accessible: native buttons, inputs, checkboxes, labels, and disabled states are used; status messages use the existing alert/live-region conventions.

## Persistence and migration

All selected records use the existing settings storage key and `saveSettings`/`loadSettings` path. Storage writes remain atomic from the application perspective: validation occurs before `setItem`. Invalid or unreadable saved settings continue to fall back to defaults and use the existing warning path.

Migration MUST preserve all existing active settings and existing gas/cylinder presets. It MUST not duplicate a current active compressor or booster preset when the corresponding collection already exists.

## Testing

Add unit tests for:

- Parsing each supported category and mixed-category documents.
- Rejecting malformed JSON, unknown-only documents, malformed entries, and invalid values.
- Normalizing compressor and booster records into active settings fields.
- Name and canonical-content duplicate detection.
- Disabling duplicates while retaining new entries.
- Settings migration and round-trip persistence for equipment collections.
- Selecting equipment presets into active settings.
- Importing selected records into a draft without modifying committed settings before Save.

Retain existing settings, dialog, and browser smoke coverage. Add a browser smoke check covering remote URL load, local file load, disabled duplicates, selecting new entries, Save settings, reload, and use of an imported cylinder/gas preset.

## Non-goals

- No server-side preset repository.
- No automatic remote synchronization.
- No default URLs until supplied.
- No import of arbitrary calculator settings or supply banks.
- No overwrite/delete operation for existing presets during import.
