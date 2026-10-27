# Filling Cost Calculator: redesign amendment (user-approved 2026-10-27)

Amends `2026-10-26-filling-cost-calculator-design.md`. Where they conflict, this file wins.

## Settings -> Costs
- Keeps: `currencySymbol`, `leftoverDiscountPercent`.
- Replaces `pricePerLitre` and per-litre `operationPrices` with flat fees per operation, entered and shown with 2 decimals, never unit-converted: `operationPrices: { boost, decant, topUp }` (all 0 by default). `decant` also applies to `equalize` steps. Top-up includes compressor air.
- Settings saved with the old shape load with zero defaults for the new fields (and keep symbol and discount when valid).
- O2 and He prices are no longer settings.

## Fee model
Each operation is charged once per distinct `costOperationId`: boost fee for `boost`, decant fee for `decant` and `equalize`, top-up fee for `topUp`. No per-litre operation charge. Operation lines carry `{ operation: 'boost'|'decant'|'topUp', count, fee, cost }`. Gas lines are unchanged (litres x the bank's stored per-litre price; compressor air has no gas line).

## Pure banks and pure-gas prices
- A pure bank is an enabled bank with exactly 100% O2 / 0% He (pure oxygen) or 0% / 100% (pure helium).
- The oxygen price and helium price used everywhere (recipe pricing, saved cost, salvaged saving) is the volume-weighted average per-litre price of the enabled, priced pure banks of that gas. Weight = each bank's current free-gas litres (moles at its current pressure and volume under the active physics model and the inventory gas temperature x litres per mole). Banks without a price are ignored. No priced pure bank of a gas -> that price is unavailable (`null`).
- Pure banks have no Calculate price control.

## Inventory price entry
- Stored value stays `pricePerLitre` (canonical, per free-gas litre).
- Each bank row has a price input and a mode select: per volume (`/L`, or `/cu ft` in imperial) or **Full tank**. A full-tank price is divided by the bank's current free-gas litres once, at entry; the stored per-litre value is not re-derived when pressure later changes. Displayed value is always the per-litre (per cu ft) price.
- Price inputs accept and show 6 decimals.
- Calculate price stays for non-pure banks. It prices the recipe from the weighted pure prices and the flat fees, applies the leftover discount once, and fails with a reason naming the pure gas that has no price. Virtual-source sizing and the rest of the earlier pricing contract are unchanged.
- Inventory gas temperature: default 21 C (was 25). A **Same as ambient** option makes it follow the Blending ambient temperature (`inletTemperatureC`); when selected the number input is disabled and shows the ambient value.

## Blending summary (top-left banner)
Three new items: **Total cost of fill** (gas total + operations total, with "incomplete" marker when a used bank is unpriced), **Saved cost** = retained helium litres of the original tank x weighted helium price, **Salvaged saving** = sum over non-pure banks used of (litres used x recipe price per litre of that bank's composition built from pure gases at discount 0, using the bank's current volume and pressure as the pricing target, i.e. gas + operation fees) minus what the bank actually charged. If a needed pure price is missing the item shows a prompt instead of a number. Values use 2 decimals, right-aligned.

`computeSavings` returns `missing` as structured entries, not text: `{code:'pure-price', gas}` (a needed pure price is unavailable), `{code:'unpriced-bank', bankId, name}`, and `{code:'recipe-unavailable', bankId, name}`. Retained helium of 0 gives saved cost 0 with no prompt; no feasible blend gives no prompt and no numbers.

## Tank summary tab
Renamed **Tanks and costs**. Costs section: gas table, **Total gas cost** row, operations table (operation, count, fee, cost), **Operations cost** row, total. All amounts right-aligned, 2 decimals; per-litre prices in the gas table show 6 decimals. Compare mode is out of scope (no UI entry; may be removed later).
