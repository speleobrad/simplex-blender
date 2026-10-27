# Cost redesign implementation plan

> Spec: `docs/superpowers/specs/2026-10-27-cost-redesign-amendment.md` (wins over the 2026-10-26 spec). Same branch/worktree. TDD; focused tests then `npm test`; commit per task; no baseline changes until Task 5.

## Global constraints
- Cost is display-only; never alter planner results. No screenshot baseline or maxDiffPixelRatio change before Task 5; read docs/ci-reproduction.md first in Task 5.
- Prices stored per litre; money 2 decimals except per-litre prices (6 decimals); fees never unit-converted.

### Task 1: Settings -> Costs flat fees
Files: js/settings.js (DEFAULT_SETTINGS.costs, copyCosts, addDefaultCosts), js/input-validation.js (validateCostSettings), js/ui/settings-dialog.js, index.html (Costs pane), js/main.js (costs draft branch), tests/settings*.test.js, tests/input-validation.test.js, tests/settings-dialog.test.js, tests/browser/settings.spec.js, tests/browser/helpers/settings.js.
Produces: `settings.costs = { currencySymbol, leftoverDiscountPercent, operationPrices: { boost, decant, topUp } }`; legacy shape loads to zero fees keeping valid symbol/discount. UI: symbol, discount, three fee inputs (step 0.01, 2 decimals, labels "Boost (per operation)", "Decant incl. equalize (per operation)", "Top-up (per operation, includes compressor air)"); no unit conversion; remove O2/He/per-litre inputs and now-unused helpers.
### Task 2: Cost model, pure prices, savings (pure modules)
Files: js/cost.js, js/pure-prices.js (new), js/bank-pricing.js, js/savings.js (new), tests.
Produces: `computeFillCost` per spec fee model (`operationLines [{operation:'boost'|'decant'|'topUp', count, fee, cost}]`, equalize counted as decant, `configured` = any fee>0 or any used bank priced); `pureGasPrices({banks, physics, inventoryTemperatureC}) -> {oxygen:number|null, helium:number|null}` (volume-weighted by free-gas litres, enabled+priced pure banks only); `priceBankByRecipe` takes prices from `pureGasPrices`, flat fees from settings.costs, fails naming the missing pure gas, refuses pure banks; `computeSavings({result, banks, costs, physics, settings, inventoryTemperatureC}) -> {savedCost, salvagedSaving, missing: ['oxygen'|'helium'...]}` per spec definitions.
### Task 3: Inventory UI
Files: js/ui/supply-banks.js, js/main.js, index.html, tests. Price mode select (per volume / full tank, conversion at entry), 6-decimal price display/input, no Calculate button on pure banks, suggestion/Apply flow uses new pricer contract, inventory gas temperature default 21 + "Same as ambient" (follows Blending ambient; disabled input shows it) with calculation wiring and tests.
### Task 4: Results UI
Files: js/ui/cost-summary.js, js/ui/results.js/main.js, index.html, tests. Banner items (Total cost of fill, Saved cost, Salvaged saving), tab rename "Tanks and costs" (button text, headings, sr text, tests/docs references), Total gas cost and Operations cost rows, right-aligned 2-decimal amounts, operation table (operation, count, fee, cost).
### Task 5: Docs, baselines, verification
Update docs (architecture, UI, development, optimizer if needed, 2026-10-26 spec status note); regenerate only intentionally changed baselines in the CI container per docs/ci-reproduction.md; full container run; host smoke.
