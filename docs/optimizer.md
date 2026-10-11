# Blend Optimizer

`js/optimizer.js` validates the gas model, calculator ranges, user-managed non-Air bank records, physical gas compositions, and thermal equipment input before constructing the requested-mix and maximum-pressure linear programs. It injects unlimited 21/0 compressor Air, applies the shared booster minimum source pressure to finite banks, enforces the compressor and booster operation ceilings, and returns gas quantities, pumping steps, and ternary trajectory data. Per-bank available-mole limits remain internal to optimization.

## Decision variables and constraints

- `x_cyl`: moles retained from the cylinder's initial mix.
- `x_i`: moles transferred from each enabled finite non-Air supply bank; the implicit compressor-Air variable is solver-only and has no persisted bank record.
- Total-mole equality: `x_cyl + Σ x_i = n_target`.
- Oxygen equality: `fO2_initial x_cyl + Σ fO2_i x_i = fO2_target n_target`.
- Helium equality: `fHe_initial x_cyl + Σ fHe_i x_i = fHe_target n_target`.
- Cylinder bound: `x_cyl ≤ n_initial`.
- Compressor Air is an implicit unlimited source. It is available without a bank row, uses the configured `maxCompressorPressureBar` ceiling, and is emitted as a `Top-up` operation rather than a reservoir transfer.
- Non-Air `Boost` stages may end no higher than `maxBoosterOutputPressureBar`. Non-Air `Decant` and `Equalize` stages may exceed that setting when source pressure supports them. Compressor Air may be staged before later non-Air transfers when a final target exceeds the compressor ceiling.
- Legacy finite Air bank records are removed during persistence migration; user-managed bank capacity applies only to non-Air banks.

The solver adds artificial variables for the three equality constraints and performs two phases: phase 1 minimizes artificial-variable residue to test feasibility using a tolerance scaled to the LP right-hand-side magnitudes; phase 2 minimizes the configured gas-cost objective. Before accepting a solution, the optimizer rechecks the recovered variables against the original equality and capacity constraints. This prevents small absolute residuals or phase-two artificial-variable drift from hiding composition mismatches in low-inventory blends.

## Maximum-pressure fallback

If the requested pressure cannot be reached with the exact requested mix, a second LP maximizes total retained and transferred moles under the same cylinder and bank capacity bounds. If that inventory maximum is unsafe, the optimizer tries safety-prioritized, preferred-source, source-excluded, balanced, and adaptively refined pairwise oxygen-rich-bank allocations before searching lower exact-mix pressures. The selected real-gas model converts the maximum safe amount to pressure. Its fallback protocol drains every cylinder amount required by the exact mix, including pressure reductions below 0.5 bar. If no positive safe amount is possible, no fallback recipe is returned.

The optimizer compares requested component moles with gross component inventory in the starting cylinder and enabled banks above the shared booster minimum pressure. For a definite component shortage, the alert selects the enabled bank supplying the most of that component in the fallback recipe (or the bank with the greatest available component inventory) and converts the missing amount into the pressure required in that bank's volume and gas mix, using the selected model. It reports the bank's current pressure and the shared booster minimum as context; if no enabled bank contains the component, it says so instead of using an unrelated volume. When a required source density exceeds the van der Waals model's supported range, the UI states that no numeric pressure estimate is available rather than showing a sentinel.

## Objective and protocol

The retained-gas coefficient is `-5`, favoring gas already in the cylinder. Each supply-bank coefficient is `(He_fraction² × 100) + (O2_fraction × 0.4) + 1`. These weights are part of the existing model, not a market-price calculation. When the first recipe violates an equipment or transfer-safety limit, the safety-prioritized re-solve keeps the retained-gas and non-oxygen-rich bank costs; only oxygen-rich banks switch to pressure-based source selection. A safety re-solve therefore cannot discard usable working gas or cheaper premix gas merely because the original recipe was unsafe.

For a feasible solution, the protocol drains whenever the selected recipe requires venting, including pressure reductions below 0.5 bar; only pressure changes at floating-point roundoff scale are ignored. The retained/vented amounts and final pressure match the physical protocol stages. Non-Air supply transfers retain descending source O₂ ordering. Compressor Air is always labelled `Top-up`; it is placed before later non-Air transfers when the final target exceeds the compressor ceiling and otherwise remains the final Air stage. A transfer is labeled `Boost` when source pressure is lower than the working tank at both ends, `Decant` when it is higher at both ends, and `Equalize` when it starts higher and ends equal. Non-Air `Boost` stages are capped by `maxBoosterOutputPressureBar`; decant/equalize stages remain source-pressure limited.
After each boost from a bank with more than 25% O₂, the optimizer checks that the receiving cylinder's resulting pressure is no more than four times the source bank's residual pressure. Both pressures use the selected gas model. A violation rejects the recipe with an error and no blend protocol. Each mixing stage includes its target pressure, source-gas leftover pressure, interim O₂/He mix, and—when relevant—the O₂ compression ratio. Helium salvaged is the retained helium from the working tank plus helium supplied by source gases and non-pure-helium supply banks.

## Thermal protocol estimates

When the main-screen thermal tank inputs are present, `js/optimizer.js` passes the completed static protocol to `js/thermodynamics.js`. The selected cylinder preset supplies the working tank's volume, material, and empty assembly mass; the simulation applies configured booster/compressor/decant rates, uses the configured inlet gas temperature, applies the signed booster or compressor temperature modifier for those equipment paths, integrates incoming-gas heating and convective heat loss during every positive pressure increase, and applies the selected material and cooling-medium time constant after each stage. Implicit compressor-Air filling is represented as a `Top-up` stage and uses compressor flow; it may be followed by non-Air decant or boost stages when their limits permit it. The final stage receives a full ambient cool-off of `4.6 × tau`; its thermal result reports both hot transfer-end and settled ambient estimates.

The target temperature is validated against ambient only when the wait mode is `temperature`; fixed-minute waits ignore that hidden field.

These are operational estimates, not a pressure guarantee: actual heating, transfer rate, and cooling depend on equipment condition, gas flow, fill technique, and the surrounding environment. The optimizer does not use the estimates to relax gas composition, supply capacity, or transfer-safety constraints.

If the requested pressure is unreachable, the optimizer reports the maximum safely achievable pressure for the exact target mix and its recipe. If no positive safe amount exists, the UI explains why and shows no recipe. See [Gas Physics](gas-physics.md) for the density calculations and [Architecture](architecture.md) for module flow.
