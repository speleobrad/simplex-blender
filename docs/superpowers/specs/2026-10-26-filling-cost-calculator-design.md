# Filling Cost Calculator Design

Resolves GitHub issue #3.

## Status

Approved by the user after review on 2026-10-26. Implementation has not started.

## Goal

Show the cost of a fill on the Tank summary tab, with a breakdown of gas drawn from each source and of each operation (boost, decant, equalize, top-up). Prices are configured by the user. Cost is display-only: it never influences the optimizer, the Compare/What-if planners, or the helium-retention priority invariant in `docs/development.md`.

Each Inventory bank carries an editable price. A **Calculate price** action, run on demand, builds the bank's gas from pure gases with the existing recipe optimizer, costs that recipe, and shows the result as a suggestion. Nothing is stored until the user applies it; the user may then edit it.

## Approved decisions

- **Scope:** Optimize, Compare and What-if. All three mount the shared `result-panel-template`, so the Costs section lives once in the Tank summary pane.
- **Price storage:** Settings holds pure O₂ and He prices, a leftover discount and operation prices. Each Inventory bank has an optional stored price, per free-gas litre of that bank's composition.
- **Bank price suggestion:** computed on demand only, by a recipe (see below). Never computed automatically; never refreshed when Settings or the bank change. The result is shown as a suggestion and stored only when the user applies it; a price already entered is never replaced without that explicit step. The user can then edit it.
- **Unpriced banks:** costed at 0 and flagged; the total is marked incomplete.
- **Per-litre operations:** Boost, Decant and Equalize are priced per litre of free gas moved.
- **Top-up:** a flat fee per top-up operation, independent of quantity. The fee includes the compressor air; a top-up has no separate gas charge, and there is no Air price setting.
- **Free-gas litre:** ideal-gas litres at 1 bar and the flow's ambient calculation temperature, `litres = moles × GAS_CONSTANT × (temperatureC + 273.15)`. This is the convention already used for `ventedGasLitres`. Identical gas quantities cost slightly differently if the ambient temperature changes; this is accepted.
- **Vented gas:** no money figure. The existing summary keeps reporting vented litres and helium vented.
- **Currency:** free-text symbol or code; amounts shown with 2 decimals.
- **Units:** prices follow the unit setting (per L metric, per cu ft imperial). Storage is always per litre.

## Accounting boundary

- Only gas transferred in a modeled step is charged. A bank's remaining inventory is never charged or valued.
- The initial working-tank contents are neither charged nor credited.
- Drain steps are not operations: no operation charge, no gas charge.
- No purchase ledger is persisted. Cost is recomputed from each calculation result; stored bank prices are the only persisted cost data besides Settings.

## Step contract (planner change)

Today no flow exposes the quantity `cost.js` needs:

- Optimize keeps `addedMoles` on trajectory points; `sourceConsumedMoles` exists only on thermal-split steps (`js/optimizer.js`, split stages near lines 487 and 512). `plan-with-readings.js` pairs steps to trajectory points by position.
- Compare and What-if planners (`js/compare-recipe.js`) compute `requiredMoles` and `equalizationMoles` but discard them; `plannedTransferStep` and `plannedCompressorStep` carry only pressures and `sourceMolesAfter`.
- `js/thermodynamics.js` rewrites `type`: `equalize` becomes `decant`, and compressor adds become `boost` with `operation: 'Top-up'`.

Every executed transfer step in every flow therefore gets three planner-owned fields, stamped when the step is built so later `type` rewrites cannot affect them:

| Field | Meaning |
|---|---|
| `sourceConsumedMoles` | Moles drawn from the source (or delivered by the compressor) in this step. Existing name and semantics. |
| `costOperation` | `'boost' \| 'decant' \| 'equalize' \| 'topUp'` |
| `costOperationId` | String identifying one logical operation, e.g. `op-1`. |

`costOperationId` rules:

- Assigned by the planner from a per-run sequential counter; not derived from a bank index, row ID or `_thermalSplit`.
- Unique within a run; shared only by the stages of that one operation.
- A safe-stage thermal split reuses the ID of the operation it splits. Both stages keep their own `sourceConsumedMoles`, which sum to the operation total.
- Separate operations get separate IDs even when they come from one input row: `pressureTransferStages` can yield a decant then a boost for one bank, and a Compare Add row can yield an equalize then a boost. The row link stays in the existing `compareRowId`.
- Every compressor-Air step has `costOperation: 'topUp'`; no other step does.
- Optimize never emits `equalize`; that rate applies to Compare and What-if.

Stamp sites:

- `optimizer.js` protocol-step construction (the stage loop near line 2242, where `stageAddedMoles` is known), and the thermal-split builder, which already spreads `transferStep`.
- `compare-recipe.js`: the compressor top-up, the finite-bank boost/decant, and the equalize-then-boost split (equalized moles, then the remainder).
- `plan-with-readings.js`: prefix steps keep the IDs and `sourceConsumedMoles` they already have (the re-solved previous step is overwritten at line 220 and must keep its ID). The re-planned suffix comes from a fresh `optimizeBlend` whose counter restarts, so merging must namespace each segment's IDs so that no two operations share one. Splits within a segment stay shared.
- `thermodynamics.js` already spreads `...step`; a test proves the fields survive in every flow.

## Cost model (`js/cost.js`, pure, no DOM)

```js
computeFillCost({ steps, banks, costs, temperatureC })
```

- `steps`: executed protocol steps carrying the contract fields above, plus `sourceBankId`.
- `banks`: current banks, for stored-price lookup by `sourceBankId`.
- `costs`: the Settings `costs` object.

Returns:

```js
{
  gasLines: [{ sourceBankId, name, litres, unitPrice /* null when unpriced */, cost }],
  operationLines: [{ operation, litres /* per-litre ops; for topUp, compressor-air litres shown as information only */, count /* top-up */, rate, cost }],
  gasTotal, operationTotal, total,
  unpricedSources: [{ sourceBankId, name }],
  incomplete: boolean,   // unpricedSources is not empty
  configured: boolean    // false when every Settings price is 0 and no used bank has a stored price
}
```

Rules:

- **Gas lines:** one per finite bank, aggregated over its steps, `litres = Σ sourceConsumedMoles × litresPerMole`. Compressor Air produces no gas line. The unit price is the bank's stored price; a bank with no stored price (or missing from `banks`) is unpriced: cost 0, listed in `unpricedSources`.
- **Per-litre operations** (boost, decant, equalize): `litres × rate`, summed over all stages with that `costOperation`. Splitting an operation does not change its cost.
- **Top-up:** `count × fee`, where `count` is the number of distinct `costOperationId` among top-up steps.
- `total = gasTotal + operationTotal`. Totals come from unrounded values; displayed line items may differ from the displayed total by rounding. When `incomplete`, the UI labels the total incomplete and names the unpriced sources.

## Bank price calculation (`js/bank-pricing.js`, pure, no DOM)

```js
priceBankByRecipe({ bank, costs, settings })  // settings: physics model, equipment and pressure-limit settings, ambient temperature
// => { ok: true, pricePerLitre, recipeCost, litres, operationCount }
//  | { ok: false, reason }
```

Run only when the user presses **Calculate price** on an Inventory bank row. It is side-effect free: it mutates no real bank and writes no price. It is never called from the recalculation path, and a Settings or bank edit never recomputes a stored price.

Bank state reproduced: the bank's volume, pressure, O₂/He composition, and the current ambient calculation temperature (the same `temperatureC` used for free-gas litres), under the active physics model.

Procedure:

1. **Target.** A virtual working cylinder with the bank's volume, initial pressure 0 bar (empty), and target = the bank's pressure and composition. Its working pressure equals the bank's pressure. It is planned with `optimizeBlend` **without** a `thermal` block, which selects `optimizeBlendWithoutThermal`: thermal waits and splits do not change moles, and omitting them removes any need to guess cooling-medium or inlet-temperature inputs. The physics model, equipment and pressure-limit settings (`settings.booster`, `settings.pressureLimitMode`, compressor ceiling) are those of the current calculator input.
2. **Sources.** Compressor Air (the optimizer's one unlimited source) plus virtual **finite** pure-O₂ and pure-He banks built only from values that `validateSupplyBankInput` accepts (volume 1–200 L, pressure 1–350 bar). The optimizer has no unlimited non-compressor source and this feature does not add one. Each virtual bank is 200 L at 200 bar, a typical supply pressure, and available gas runs from 200 bar down to the active minimum source pressure (`settings.booster.minimumSourcePressureBar` or the optimizer default of 20 bar). One 200 L bank cannot cover the largest supported bank (200 L at 350 bar, about 70,000 free litres), so the pricer adds identical virtual banks, each with a distinct ID, until their usable moles are at least twice the moles the target needs, computed with the optimizer's own density functions. If that needs more than 20 banks per gas, the result is `ok: false`. The 200 bar assumption affects how the optimizer splits decant and boost stages and is part of the indication, not a user setting.
3. **Recipe.** The recipe is whatever `optimizeBlend` produces; it is not cost-minimized, because the optimizer does not know prices. The price is the cost of that recipe.
4. **Costing.** Cost the steps with `computeFillCost`, where each virtual bank has the Settings pure-gas price as its stored price and compressor Air costs only through the top-up fee.
5. **Price.** `pricePerLitre = recipeCost × (1 − leftoverDiscountPercent / 100) / litres`, where `litres` is the free-gas content of the bank (`moles × litresPerMole`, moles from the bank's pressure, composition and the active physics model). The discount is applied here, once; it is not applied again when the price is used. Operation costs, including the flat top-up fee, are part of `recipeCost`, so the fee is amortized over the bank content.

Failure results leave the stored price unchanged and show a message in the row:

- The optimizer cannot build the mix (for example a hypoxic mix that air plus pure O₂ and He cannot produce, or pressure above the compressor or booster ceilings), or more than 20 virtual banks per gas would be needed.
- The bank pressure is below the optimizer's 10 bar target minimum.
- Every price in Settings → Costs is 0: the action reports that no prices are configured instead of storing a price of 0. A single zero pure-gas price is not a failure; the indication is simply lower.

Empty-tank start (initial pressure 0) is permitted by `input-validation.js` (0–350 bar). Whether `optimizeBlendWithoutThermal` plans from zero moles without special cases is unverified; the implementation plan starts with a throwaway check, and any needed handling is part of this work.

## Settings

New persisted `costs` object in `js/settings.js`, normalized for legacy saves, copied, validated and persisted like other fields:

```js
costs: {
  currencySymbol: '',            // trimmed text, max 8 characters
  pricePerLitre: { oxygen: 0, helium: 0 },
  leftoverDiscountPercent: 0,    // 0–100; applied when a bank price is calculated
  operationPrices: {
    boostPerLitre: 0, decantPerLitre: 0, equalizePerLitre: 0,
    topUpPerOperation: 0         // flat fee, currency units, includes compressor air
  }
}
```

- All prices are finite and ≥ 0 (upper bound 1,000,000 each); the discount is 0–100. Validation lives in `js/input-validation.js`. Invalid saved data follows the existing invalid-settings fallback.
- Defaults are all zero, so no invented price is ever shown. With nothing configured the Costs section shows a prompt to set prices in **Settings → Costs** instead of a total of 0.
- Factory reset restores the defaults.
- **Settings → Costs** is a new category in the Settings rail (`index.html`, `setSettingsCategory` in `js/main.js`, `js/ui/settings-dialog.js`). Like all settings it is a draft until Save.
- Labels distinguish quantity-based prices (“Boost, per L”) from the flat top-up fee (“Top-up, per operation, includes compressor air”). Only per-litre prices use unit conversion; the flat fee does not.

## Units and currency

- `js/units.js` gains a `pricePerVolumeL` quantity: `/L` (metric) and `/cu ft` (imperial). Display value = stored per-litre price × `28.316846592`; input conversion is the inverse. Inputs and cost tables convert at the edge.
- Price inputs accept up to 4 decimals in the displayed unit. Stored values are not rounded, so metric/imperial switching is stable.
- Amounts are formatted with 2 decimals. The symbol is a prefix; a symbol ending in a letter or digit (e.g. `CHF`) gets a following space.

## Inventory

- Each bank gets an optional `pricePerLitre` (null/absent means unpriced), the price of one free-gas litre of that bank's composition. Added to `BANK_FIELDS`, `copyBanks`, and bank validation in `js/bank-storage.js` and `js/input-validation.js`. Saved banks without it load unchanged and are unpriced.
- `js/ui/supply-banks.js` adds a price input in the display unit and a **Calculate price** button per bank row (`data-action="calculate-bank-price"`, handled by delegation in `main.js`). Pressing it runs `priceBankByRecipe` and shows the suggestion in an `aria-live` note under the row, such as “Indicative price 0.0230 per L (recipe cost 12.40 for 540 L). Apply”. The price field and storage are untouched until the user presses **Apply**; if the field already holds a price, the note shows that price beside the suggestion and the button reads **Replace**. Applying writes the value through the normal bank edit path, so it persists like other bank edits; the user can then edit it. The suggestion is transient and is discarded when the bank changes. A rejected bank value follows the existing bank-specific alert.

## Results UI

- `js/ui/cost-summary.js` renders the Costs section at the end of the Tank summary pane in `result-panel-template`, scoped per result host like the existing panes (`data-result-key`, not global IDs).
- Content: a gas table (source, litres, price per litre or “no price set”, cost), an operations table (per-litre lines show litres and rate; the top-up line shows count × fee and the note “includes compressor air”, with the compressor-air litres shown as information only), and the total, labelled incomplete with the unpriced source names when `incomplete`. Compressor air never appears as a gas-table row, so it cannot read as a zero-cost gas. Tables have captions and column scopes like the existing ones.
- Empty states: no feasible plan, and nothing configured.
- `main.js` computes `cost` in the same pass that assembles each flow's result (Optimize and Compare through the calculation result, What-if through its terminal projection), so Settings and Inventory edits that already trigger recalculation update costs. Compare's retained last-successful result and What-if's “Out of date” label apply to cost unchanged.

## Out of scope

Cost-aware optimization, currency conversion, price history, refill/purchase cost of banks, inventory valuation, per-minute equipment cost, automatic or bulk refresh of bank prices, a money figure for vented gas.

## Testing

Node tests (`npm test`):

- `cost.js`: stored price used; unpriced bank flagged and total marked incomplete; top-up fee charged once per ID; no gas line for compressor air; equalize versus decant rates; bank missing from the list is unpriced; zero-price `configured: false`.
- `bank-pricing.js`: a pure O₂ bank's price equals the O₂ price plus the recipe's operation rate per litre; an EAN 32 (32/0) bank at a pressure within the compressor ceiling combines one top-up fee with O₂ gas and an O₂ boost, checked against hand-computed litres; the same mix above the compressor ceiling still prices through the air-first path; discount 0 and 100 applied once; a hypoxic mix and a bank pressure below 10 bar return `ok: false` and change nothing; the largest supported banks (200 L at 350 bar, pure O₂ and pure He) price successfully with no virtual source exhausted and the virtual bank count within the 20-per-gas limit; the real banks passed in are not mutated; an empty-tank start plans correctly. 21/0 is not tested as a bank, because validation rejects Air as a finite bank.
- The pricer is invoked only from the Calculate action: recalculation, Settings save and bank edits never call it.
- Step contract per flow (Optimize, Compare, What-if, plan with interim readings): IDs unique per operation; a split top-up yields exactly one fee; a decant-then-boost pair yields two IDs; per-bank `sourceConsumedMoles` sums match the source's pressure drop; every compressor step is `topUp` and no other step is; fields survive `thermodynamics.js`; merged prefix and suffix operations never collide.
- Settings normalization, validation, legacy load and factory reset; bank storage round trip and legacy load; units conversion round trip for `pricePerVolumeL`.

Playwright: Settings → Costs entry and persistence; Calculate price on a bank shows a suggestion, leaves the field untouched until Apply, and Apply stores an editable price (a bank that already has a price shows Replace); a Costs section in Blending (Optimize and Compare) and What-if with an unpriced bank showing the incomplete total; unit-setting switch; empty states.

Screenshot baselines under `tests/browser/screenshots.spec.js-snapshots/` may change. Per `AGENTS.md`, read `docs/ci-reproduction.md` first, update only reviewed deliberate changes, never raise `maxDiffPixelRatio`, and never claim GitHub Actions passed from a local run.

## Documentation

Update `docs/architecture.md` (new modules, step contract), `docs/optimizer.md` (step fields), `docs/development.md` (smoke checks) and `docs/UI.md`.
