# Compressor Air and Booster Pressure Limits

## Goal

Treat Air as an unlimited compressor supply instead of an editable finite bank, cap compressor Air top-ups at a configurable pressure, and cap non-Air booster output at a separate configurable pressure.

## Selected equipment semantics

- Air is a built-in 21/0 source with unlimited quantity. It is not rendered, edited, enabled, disabled, or persisted as a supply-bank row.
- `maxCompressorPressureBar` defaults to 232 bar. A compressor Air stage may raise the receiver only to this pressure. Compressor Air is never treated as a booster operation.
- `maxBoosterOutputPressureBar` defaults to 200 bar. This limit applies only to non-Air stages classified as `Boost`. Decants and equalization remain governed by source pressure.
- Compressor Air may be used before later non-Air decant/boost stages. This permits mixed fills above the compressor ceiling when the later operation is physically possible.
- Existing user-saved Air records are discarded on load because their finite inventory is obsolete. Non-Air records are preserved. An empty user-bank list is valid.

## Settings model

The existing persisted `settings.booster` object gains:

```js
{
  maxCompressorPressureBar: 232,
  maxBoosterOutputPressureBar: 200
}
```

The fields are copied, defaulted when loading older settings, validated as finite pressures from 10 through 350 bar, rendered in the existing Booster settings section, and passed to static and thermal optimizer paths. Existing settings remain valid through default-field migration.

## Optimizer model

The optimizer creates an internal compressor source with a stable non-user-facing ID and Air composition. Its capacity is finite only for the LP solve, using the requested target moles as an upper bound; this is sufficient because all source variables are non-negative and total source moles equal the requested target moles. The source is not saved or exposed to bank validation/UI.

The compressor source has no reservoir depletion. Protocol stage helpers therefore keep compressor source pressure at the configured compressor ceiling rather than calculating a residual bank pressure. Air stages are always marked `Top-up`, regardless of thermal mode, so thermal simulation selects compressor flow consistently.

For each candidate solver result, equipment safety is checked alongside the existing oxygen-transfer safety:

1. Build the ordered transfer stages, with compressor Air available before later non-Air stages when needed above the compressor ceiling.
2. Reject a candidate if a compressor stage ends above `maxCompressorPressureBar`.
3. Reject a candidate if a non-Air boost stage ends above `maxBoosterOutputPressureBar`.
4. Permit non-Air decant/equalize stages above the booster limit when source pressure supports them.

The existing safe-candidate search and maximum-pressure fallback use this equipment safety result, so an unsafe exact target falls back to the highest safe exact-mix pressure rather than returning an unsafe recipe.

## Persistence and UI

- `DEFAULT_BANKS` contains only non-Air examples.
- Bank loading removes legacy Air records identified by the old Air composition (21/0) and the old Air IDs/names before validation. Empty results are returned as an empty list.
- The supply-bank table remains unchanged for non-Air banks; no synthetic compressor row is rendered.
- Settings labels explain the two independent limits and their units.

## Tests and documentation

Add tests for:

- default settings and legacy settings migration;
- persistence and validation of both pressure fields;
- removal of legacy Air banks and acceptance of an empty bank list;
- implicit Air feasibility without an Air bank;
- compressor ceiling behavior;
- booster ceiling behavior for boost but not decant;
- protocol operation labels and thermal compressor selection.

Update architecture, optimizer, development, and relevant browser-smoke documentation to describe implicit Air, both limits, migration, and the sequential compressor/booster rule.
