# Recipe and Settings Improvements Design

## Goal

Restore explicit oxygen-rich transfer reporting and improve recipe, diagram, thermal-graph, water-pressure, transfer-temperature, cylinder-settings, and equipment-preset usability without changing the gas solver’s safety rules or storage format.

## Scope

The change covers eight user-visible corrections:

1. Oxygen-rich boosts (>40% source oxygen) report the compression ratio from source-bank end pressure to receiver destination pressure.
2. Supply banks → Transfer conditions uses the same compact typography as Ambient / calculation temperature.
3. The Air/O₂/He triangle boundary is dashed and the complementary N₂/air/He region is gray shaded.
4. Thermal graph band labels alternate between two vertical rows while remaining centered in their bands.
5. Recipe stages that consume a non-Air bank down to the shared booster minimum identify the bank as emptied, show the minimum remaining pressure, and mark that source end pressure with an orange circle-exclamation icon.
6. In water pressure, the warning icon precedes the pressure value.
7. Cylinder preset numeric columns fit mass values such as `14.3` while keeping maximum-pressure controls compact.
8. Equipment settings provide New compressor and New booster actions that add uniquely named clones of the active parameters.

## Existing boundaries to preserve

- `js/optimizer.js` remains the source of recipe and transfer-stage data.
- `js/ui/results.js` owns protocol-card markup.
- `js/ui/ternary.js` owns the canvas drawing order and colors.
- `js/ui/thermal-charts.js` owns SVG chart labels and band metadata.
- `js/ui/water-pressure.js` owns pressure warning markup.
- `js/settings.js` owns settings copying, validation, persistence normalization, and equipment-preset application.
- `js/main.js` owns settings-draft mutation and delegated browser actions.
- Existing localStorage keys and serialized equipment preset shapes remain unchanged.
- The shared booster minimum remains the source-bank lower bound; Air remains the implicit unlimited compressor source.

## Design

### 1. Oxygen-rich transfer and source exhaustion metadata

The optimizer already computes `oxygenCompressionRatio` for a boost whose source bank contains more than 40% oxygen. Preserve that threshold and formula: receiver pressure at the end of the stage divided by source-bank pressure at the end of the stage. Add explicit source-pressure metadata to every generated transfer protocol step:

- `minimumSourcePressureBar`: the configured shared booster minimum for the source bank, or `null` for compressor Air.
- `sourceExhausted`: true only for a non-Air stage whose source-end pressure reaches that minimum within the existing pressure tolerance.

For oxygen-rich boost stages, the protocol description includes a dedicated sentence with the source end pressure, receiver destination pressure, and formatted ratio. For exhausted non-Air stages, use the exact semantic wording `This empties <bank name> and leaves only <minimum> bar of gas.` rather than the generic leftover sentence. The results renderer also displays a `Source end` value for transfer stages, with the orange `fa-solid fa-circle-exclamation` marker immediately before the value when `sourceExhausted` is true. The existing Result value continues to represent receiver pressure.

### 2. Compact transfer-condition typography

Add the same inherited `text-xs` size used by the Working tank thermal-control grid to the Transfer conditions content. Keep the existing sans-serif labels, monospaced numeric values, spacing, and independent inlet-temperature behavior. Make the inlet input’s text size explicit so browser default control typography cannot enlarge it.

### 3. Ternary diagram drawing order

Before grid lines, boundaries, vectors, and markers:

1. Fill the polygon formed by N₂ (`0/0`), Air (`21/0`), and He (`0/100`) with the existing gray full-boundary color at low opacity.
2. Draw the full N₂/O₂/He simplex boundary with its existing dashed style.
3. Draw the Air/O₂/He boundary with the same dashed style.
4. Draw grid, direct mixing vector, trajectory arrows, and points on top so the `21/0 → 35/0` vector remains visible.

The accessible data table and composition math do not change.

### 4. Alternating thermal captions

Extend each thermal band record with a deterministic alternating caption row (`0` or `1`). SVG captions use the band center for `x` and `CHART_MARGIN.top + 14 + row * 12` for `y`. Both temperature and pressure charts consume the same band records, so corresponding captions occupy identical rows. No chart domain, point index, or accessible table behavior changes.

### 5. Water-pressure warning order

Build warning cells by appending the warning icon first and the formatted pressure span second. Use `mr-1` rather than `ml-1`. Keep the warning role, label, title, color, and threshold unchanged.

### 6. Cylinder table sizing

Keep the table structure and sortable/editable rows. Change the mass column to a compact width that leaves room for browser number-input controls and decimal values; reduce the maximum-pressure header/input column from the oversized width to the same compact numeric scale. Reduce numeric input horizontal padding only where needed. The resulting table must display `14.3` without clipping at the default dialog width and must continue to support three-digit pressure values.

### 7. Equipment preset cloning

Add pure settings helpers that construct a preset object from the active settings:

- Compressor clone fields: `name`, `inletFlowLPerMin`, `maxPressureBar`, `temperatureModifierC`.
- Booster clone fields: `name`, all existing booster preset fields, including decant and draining rates.

`main.js` generates `New compressor`, `New compressor 2`, etc., and equivalent booster names by normalized-name uniqueness, pushes the clone into the corresponding draft collection, rerenders the Equipment pane, and keeps the draft unsaved until Save settings. The active values are not changed by adding a clone. Existing selector behavior, validation, save/cancel semantics, and localStorage shape remain unchanged.

## Error handling and edge cases

- A zero or non-finite source end pressure never produces an oxygen ratio; the ratio remains absent/null as today.
- Compressor Air is never marked source-exhausted and never receives an exhaustion icon.
- Floating-point pressure comparison uses a scale-aware tolerance, consistent with protocol operation classification.
- Empty compressor or booster preset collections remain valid under current settings validation; the new action adds the first preset when needed.
- Generated names are unique under the existing locale-independent lower-case normalization.
- Existing invalid-input rendering still clears recipe, chart, and water-pressure output through the current orchestration path.

## Acceptance criteria

- A >40% oxygen non-Air boost visibly reports source pressure, destination pressure, and ratio in its recipe step; a 40% source does not.
- A bank drawn to the booster minimum says it empties the named bank, states the minimum remaining bar, and shows the orange circle-exclamation before the source-end pressure.
- Transfer conditions label/input match Ambient / calculation temperature size.
- The N₂/air/He region is gray filled; both ternary boundary triangles use dashed outlines; vectors remain visible.
- Adjacent narrow thermal bands alternate caption rows in both charts.
- In-water warning icons precede pressure text.
- `14.3` is fully visible in cylinder mass inputs and pressure columns remain compact.
- New compressor and New booster create independent cloned presets with unique names, survive Save/reload, and disappear on Cancel.
- Existing optimizer, settings, ternary, thermal, and water-pressure behavior remains passing.

## Verification

Use test-first regression coverage in the existing Node test runner. Run focused tests after each behavior, then `npm test`. Serve the page with `python3 -m http.server 8000` and exercise the recipe, Diagram, Thermal graphs, In water pressure, Transfer conditions, and Settings surfaces in a browser smoke check. Update `docs/architecture.md` and the relevant `docs/development.md` browser checks to describe the new metadata, drawing order, caption rows, source warning, and equipment clone actions.
