# Gas Physics

`js/physics.js` exports the gas-property functions used by both the optimizer and supply-bank display. Pressure is in bar, volume in litres, molar density in mol/L, and temperature input in °C; equations convert temperature with `T = temperatureC + 273.15`. The gas constant is `R = 0.083144626 bar·L/(mol·K)`.

## Ideal gas

For molar density `ρ`:

- `P = ρRT`
- `ρ = P/(RT)`
- `Z = 1`

## Van der Waals gas

The app uses the mixture equation:

`P = (ρRT)/(1 - bρ) - aρ²`

For oxygen, helium, and nitrogen mole fractions `yi`, the mixture parameters are:

- `a_mix = (Σ yi √ai)²`
- `b_mix = Σ yi bi`

Pure-component parameters `(a, b)` are oxygen `(1.382, 0.0319)`, helium `(0.0346, 0.0238)`, and nitrogen `(1.370, 0.0387)`, with `a` in bar·L²/mol² and `b` in L/mol. Nitrogen fraction is the non-negative remainder after oxygen and helium fractions.

Given a pressure, `calcMolarDensity` starts from the ideal-gas estimate and uses Newton–Raphson for at most 40 iterations. It retains the current derivative threshold, convergence threshold, and density clamps near the excluded-volume limit. `calcZ` reports `P/(ρRT)` for the VDW model and returns one for the ideal model or non-positive pressure; `calcZFromDensity` applies the same formula when the caller already has density, avoiding another density solve.

These are the model assumptions implemented by the app, not a general-purpose gas-property library. See [Optimizer](optimizer.md) for how density is used to compute available supply-bank moles.
