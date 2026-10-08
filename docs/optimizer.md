# Blend Optimizer

`js/optimizer.js` validates direct inputs against the supported gas model, calculator ranges, and supply-bank constraints before constructing the requested-mix and maximum-pressure linear programs. It calls `js/simplex.js`, then derives the user-facing gas summary, pumping steps, and ternary trajectory. Per-bank available-mole limits remain internal to optimization.

## Decision variables and constraints

- `x_cyl`: moles retained from the cylinder's initial mix.
- `x_i`: moles transferred from each enabled supply bank.
- Total-mole equality: `x_cyl + Σ x_i = n_target`.
- Oxygen equality: `fO2_initial x_cyl + Σ fO2_i x_i = fO2_target n_target`.
- Helium equality: `fHe_initial x_cyl + Σ fHe_i x_i = fHe_target n_target`.
- Cylinder bound: `x_cyl ≤ n_initial`.
- Bank bound: `x_i ≤ (ρ_current - ρ_booster_minimum) × bank_volume`; every enabled bank uses the shared Booster setting for `ρ_booster_minimum`, with densities calculated using the selected gas model and temperature.
- All decision variables are non-negative through the simplex formulation.

The solver adds artificial variables for the three equality constraints and performs two phases: phase 1 minimizes artificial-variable residue to test feasibility using a tolerance scaled to the LP right-hand-side magnitudes; phase 2 minimizes the configured gas-cost objective. Before accepting a solution, the optimizer rechecks the recovered variables against the original equality and capacity constraints. This prevents small absolute residuals or phase-two artificial-variable drift from hiding composition mismatches in low-inventory blends.

## Maximum-pressure fallback

If the requested pressure cannot be reached with the exact requested mix, a second LP maximizes total retained and transferred moles under the same cylinder and bank capacity bounds. If that inventory maximum is unsafe, the optimizer tries safety-prioritized, preferred-source, source-excluded, balanced, and adaptively refined pairwise oxygen-rich-bank allocations before searching lower exact-mix pressures. The selected real-gas model converts the maximum safe amount to pressure. Its fallback protocol drains every cylinder amount required by the exact mix, including pressure reductions below 0.5 bar. If no positive safe amount is possible, no fallback recipe is returned.

The optimizer compares requested component moles with gross component inventory in the starting cylinder and enabled banks above the shared booster minimum pressure. For a definite component shortage, the alert selects the enabled bank supplying the most of that component in the fallback recipe (or the bank with the greatest available component inventory) and converts the missing amount into the pressure required in that bank's volume and gas mix, using the selected model. It reports the bank's current pressure and the shared booster minimum as context; if no enabled bank contains the component, it says so instead of using an unrelated volume. When a required source density exceeds the van der Waals model's supported range, the UI states that no numeric pressure estimate is available rather than showing a sentinel.

## Objective and protocol

The retained-gas coefficient is `-5`, favoring gas already in the cylinder. Each supply-bank coefficient is `(He_fraction² × 100) + (O2_fraction × 0.4) + 1`. These weights are part of the existing model, not a market-price calculation.

For a feasible solution, the protocol drains whenever the selected recipe requires venting, including pressure reductions below 0.5 bar; only pressure changes at floating-point roundoff scale are ignored. The retained/vented amounts and final pressure match the physical protocol stages. Drain descriptions and pressure badges use enough decimal places to show small changes rather than rounding a required drain to zero. Non-Air supply transfers retain descending source O₂ ordering; Air is always moved last as the final Top-up. A transfer is labeled `Boost` when source pressure is lower than the working tank at both ends, `Decant` when it is higher at both ends, and `Equalize` when it starts higher and ends equal. Air's final transaction is labeled `Top-up`.
After each boost from a bank with more than 25% O₂, the optimizer checks that the receiving cylinder's resulting pressure is no more than four times the source bank's residual pressure. Both pressures use the selected gas model. A violation rejects the recipe with an error and no blend protocol. Each mixing stage includes its target pressure, source-gas leftover pressure, interim O₂/He mix, and—when relevant—the O₂ compression ratio. Helium salvaged is the retained helium from the working tank plus helium supplied by source gases and non-pure-helium supply banks.

## Thermal protocol estimates

When the main-screen thermal tank inputs are present, `js/optimizer.js` passes the completed static protocol to `js/thermodynamics.js`. The simulation applies configured booster/compressor/decant rates, estimates compression heating, and applies the selected tank-material and cooling-medium time constant between stages. The final stage always receives a full ambient cool-off of `4.6 × tau`; its transfer-end gauge pressure can therefore differ from the requested pressure while the predicted ambient-settled pressure matches it.

These are operational estimates, not a pressure guarantee: actual heating, transfer rate, and cooling depend on equipment condition, gas flow, fill technique, and the surrounding environment. The optimizer does not use the estimates to relax gas composition, supply capacity, or transfer-safety constraints.

If the requested pressure is unreachable, the optimizer reports the maximum safely achievable pressure for the exact target mix and its recipe. If no positive safe amount exists, the UI explains why and shows no recipe. See [Gas Physics](gas-physics.md) for the density calculations and [Architecture](architecture.md) for module flow.
