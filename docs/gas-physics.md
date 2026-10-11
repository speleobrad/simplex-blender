# Gas Physics

`js/physics.js` exports the gas-property functions used by both the optimizer and supply-bank display. Pressure is in bar, volume in litres, molar density in mol/L, and temperature input in °C; equations convert temperature with `T = temperatureC + 273.15`. The gas constant is `R = 0.083144626 bar·L/(mol·K)`.

The browser UI stores the selected model in Settings. It uses the working-tank ambient temperature as the calculation temperature for the initial gas state; direct callers may still provide a separate `temperatureC` value.

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

## Thermodynamic transfer estimates

`js/thermodynamics.js` is a deterministic, DOM-free estimate layer over these same gas-property functions; it does not introduce another gas model. Booster displacement is converted from cm³ to L and multiplied by BPM. Its effective flow uses 5% clearance and `γ = 1.4`: when receiver pressure exceeds source pressure, volumetric efficiency is `clamp(1 - 0.05 × ((P_receiver / P_source)^(1/1.4) - 1), 0.10, 0.98)`; otherwise it is one. The molar flow and receiver pressure rate are:

- `n_dot = P_source × Q_effective / (Z_source × R × T_source)`
- `rate = n_dot × Z_receiver × R × T_receiver / receiverVolumeL`

Air-compressor inlet flow is interpreted at 1.01325 bar, ambient temperature, and air composition (21% oxygen, 0% helium), then converted with the same `Z`-aware molar-flow and receiver-rate equations.

During every positive booster, compressor, decant, or equalize pressure increase, the module numerically integrates a lumped-capacitance energy balance with 0.5-second Euler steps. The inlet gas temperature is configurable independently from ambient temperature. Booster and compressor settings can add a signed temperature modifier to that inlet value; the default modifiers are 0°C. Gauge start and target pressures are converted to absolute pressure by adding 1 bar when estimating gas mass and mass flow. For current temperature `T`, inlet temperature `T_in`, incoming mass flow `m_dot`, gas heat capacities `Cv` and `Cp`, metal heat capacity `C_metal`, gas mass `m_gas`, heat-transfer area `A`, and coefficient `h`, the integrated equation is `dT/dt = (m_dot × (C…`

To project pressure after a temperature change, the module solves the hot-state molar density with `calcMolarDensity` and evaluates that unchanged density at the new temperature with `calcPressure`. Thus ideal and Van der Waals compressibility continue to come exclusively from `js/physics.js`. These thermodynamic outputs are estimates, not a calibrated tank simulation.
