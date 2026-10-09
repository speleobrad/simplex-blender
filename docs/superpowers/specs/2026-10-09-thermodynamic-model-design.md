# Thermodynamic Recipe Model Design

**Status:** Approved design

## Goal

Estimate gas-transfer duration, tank heating, cooling, and post-wait gauge pressure for every mixing stage, while producing a final hot transfer pressure that settles to the requested target after the tank cools to ambient temperature.

## Scope

This feature extends the existing browser-only gas remixer. It does not replace the simplex gas-allocation solver, the existing ideal/Van der Waals gas models, or supply-bank accounting.

The feature has two categories of inputs:

- **Equipment settings**, persisted with the existing settings record:
  - booster cylinder displacement in cm³;
  - boost speeds in BPM for oxygen-rich and regular gases;
  - direct decant speeds in bar/min for oxygen-rich and regular gases;
  - compressor inlet flow in L/min for air top-up;
  - the existing shared minimum source pressure remains unchanged.
- **Working-tank inputs**, entered on the main screen beside tank volume:
  - tank material: steel or aluminum;
  - surrounding medium: air or water;
  - ambient temperature in °C;
  - wait mode: fixed minutes or absolute target temperature;
  - wait value for the selected mode.

Oxygen-rich means source oxygen percentage greater than or equal to 40%.

## Architecture

`js/thermodynamics.js` is a pure calculation module. It uses the existing gas-property functions from `js/physics.js` and owns rate, heating, cooling, sequential simulation, and final-target convergence helpers.

`js/optimizer.js` retains the current static recipe solver as an inner calculation. `optimizeBlend(input)` keeps its current behavior when no thermal input is supplied. When main-screen thermal input is supplied, it calls the static solver through a thermal-target wrapper that converges the final hot target pressure.

The wrapper does not put thermal equations into the simplex constraints. It repeatedly solves a candidate recipe, simulates the recipe, and adjusts the candidate final hot pressure until the final ambient-settled pressure matches the user-requested target or the supported pressure range is exhausted.

The main screen owns tank/environment input state. The Settings dialog owns persisted equipment settings. Result rendering remains in `js/ui/results.js`.

## Equipment settings

The default persisted booster configuration is:

```js
{
  minimumSourcePressureBar: 20,
  cylinderVolumeCm3: 9,
  oxygenBoostBpm: 50,
  otherBoostBpm: 50,
  oxygenDecantRateBarPerMin: 5,
  otherDecantRateBarPerMin: 5,
  compressorInletFlowLPerMin: 100
}
```

Validation ranges:

- `cylinderVolumeCm3`: 0.1–1000 cm³;
- boost BPM values: 1–1000 BPM;
- direct decant rates: 0.01–1000 bar/min;
- compressor inlet flow: 0.1–10000 L/min.

Older saved settings gain these defaults during normalization. Invalid saved settings fall back to the complete built-in settings object using the existing warning path.

## Main-screen thermal inputs

The main working-tank card adds:

```js
{
  tankMaterial: 'steel',
  coolingMedium: 'air',
  ambientTemperatureC: 20,
  waitMode: 'minutes',
  waitMinutes: 10,
  targetTemperatureC: 25
}
```

Defaults are steel, air, 20°C ambient, and a 10-minute fixed wait. The target-temperature value is retained as an input when the fixed-minute mode is selected, but is not used until that mode is chosen.

The existing header gas-temperature input remains the initial gas/tank temperature used by the gas model. It may differ from ambient temperature.

Validation accepts:

- material values `steel` and `aluminum`;
- medium values `air` and `water`;
- wait modes `minutes` and `temperature`;
- ambient temperature 0–50°C;
- fixed wait 0–1440 minutes;
- target temperature 0–100°C and strictly above ambient temperature.

A target at or below ambient is rejected because exponential cooling reaches ambient asymptotically and cannot reach or cross it in finite time.

## Transfer-rate model

All pressure values retain the application's existing bar convention. Volumes are litres except where a setting explicitly says cm³ or L/min.

### Booster stages

For a boost stage, choose `oxygenBoostBpm` when source O₂ is at least 40%; otherwise choose `otherBoostBpm`.

Use fixed clearance ratio 0.05 and ratio of specific heats 1.4. Volumetric efficiency is:

```text
etaV = clamp(
  1 - clearanceRatio × ((P_receiver / P_source)^(1 / gamma) - 1),
  0.10,
  0.98
)
```

When receiver pressure is not above source pressure, use `etaV = 1` before clamping.

Displacement is:

```text
Q_displacement = cylinderVolumeCm3 / 1000 × BPM  [L/min]
Q_effective = Q_displacement × etaV
```

At the current source and receiver state:

```text
n_dot = P_source × Q_effective / (Z_source × R × T_source)
rate_bar_per_min = n_dot × Z_receiver × R × T_receiver / receiverVolumeL
```

`Z_source` and `Z_receiver` come from the selected existing ideal/Van der Waals gas model. Stage duration uses the midpoint source/receiver state and the positive receiver pressure change.

### Decant/equalize stages

For decant and equalize stages, use a direct configured rate:

- source O₂ ≥ 40%: `oxygenDecantRateBarPerMin`;
- otherwise: `otherDecantRateBarPerMin`.

Duration is pressure change divided by the selected direct rate.

### Air top-up stages

For the existing `Top-up` operation, use `compressorInletFlowLPerMin`, not booster or decant settings. Interpret this as actual inlet volume at 1.01325 bar and ambient temperature. Inlet gas is air (21% O₂, 0% He):

```text
n_dot = 1.01325 × inletFlowLPerMin
        / (Z_inlet × R × (ambientTemperatureC + 273.15))
rate_bar_per_min = n_dot × Z_receiver × R × T_receiver / receiverVolumeL
```

Duration uses the stage receiver pressure change and the current receiver state. In thermal mode, a single air-bank transfer is kept as one compressor top-up stage; compressor flow does not depend on the nominal air-bank/receiver pressure crossover.

Drain, keep, and zero-change stages have no transfer rate. They still participate in the configured post-step wait.

## Temperature model

The model is an estimate based on the supplied reference model, not a calibrated tank simulation.

For the working-tank volume:

- `kSize = 0.85` for volume ≤ 7 L;
- `kSize = 1.15` for volume ≥ 15 L;
- otherwise `kSize = 1.0`.

Material factors:

- steel: `1.8`;
- aluminum: `2.6`.

Water multiplies the material factor by `2.8`; air leaves it unchanged.

Gas factor is:

```text
kGas = 1 + 0.45 × heliumFraction
```

Every positive booster, compressor, decant, or equalize pressure increase generates transfer heating. The positive pressure increase is used as `addedPressureBar`:

```text
deltaT = addedPressureBar × kSize × kGas
         / (kMaterial + 0.15 × fillTimeMinutes)
T_transferEnd = T_start + deltaT
```

Drain, keep, and zero-change stages do not add transfer heat.

Cooling uses Newton's law. Time constants are:

- air + aluminum: 25 minutes;
- air + steel: 18 minutes;
- water + aluminum: 5 minutes;
- water + steel: 3.5 minutes.

For a finite wait:

```text
T_after = ambient + (T_transferEnd - ambient) × exp(-waitMinutes / tau)
```

For target-temperature mode:

```text
waitMinutes = tau × ln((T_transferEnd - ambient) / (target - ambient))
```

If the transfer-end temperature is already at or below the target, wait is zero.

## Sequential pressure simulation

Each existing protocol stage remains the source of gas composition, source-bank identity, and nominal recipe order. The thermal pass treats the stage receiver-end pressure as the gauge stop value for that stage and carries the actual cooled pressure into the next stage.

At each stage:

1. Read the current cooled pressure and temperature.
2. Select the rate source and calculate duration.
3. Estimate transfer-end temperature.
4. Treat the stage receiver-end pressure as the hot gauge stop value.
5. Calculate gas density/moles at the hot stop pressure and transfer-end temperature using the existing gas model.
6. Apply the configured wait and evaluate pressure at the post-wait temperature while preserving density/moles.
7. Store both hot-stop and post-wait pressure/temperature for the UI.

Each step receives:

```js
thermal: {
  rateSource: 'booster' | 'decant-rate' | 'compressor' | 'none',
  rateBarPerMin: number | null,
  durationMinutes: number,
  temperatureStartC: number,
  temperatureAtTransferEndC: number,
  waitMinutes: number,
  temperatureAfterWaitC: number,
  pressureAtTransferEndBar: number,
  pressureAfterWaitBar: number
}
```

The final simulation result contains the final transfer-end pressure/temperature and the final ambient-settled pressure/temperature.

## Final ambient-settled target

The requested cylinder target pressure means the pressure after the last tank cools completely to ambient temperature. Earlier steps follow the selected fixed-minute or target-temperature wait mode. The final step always cools to ambient for target purposes.

Because exact ambient temperature is asymptotic, the UI reports an estimated full-cool time of approximately `4.6 × tau`, representing within roughly 1°C of ambient. Pressure is evaluated exactly at ambient temperature for the final target calculation.

The thermal-target wrapper solves a candidate hot target by bisection. It stops when the predicted final ambient pressure is within a small numerical tolerance of the requested target. Candidate hot targets may not exceed the existing 350 bar supported target range. If no feasible candidate reaches the requested settled pressure, the existing maximum-safe-pressure/infeasible result is returned with its predicted final ambient-settled pressure.

## User interface

The Settings dialog adds editable booster fields with units and accessible labels:

- booster cylinder displacement (cm³);
- oxygen-rich boost speed (BPM);
- regular-gas boost speed (BPM);
- oxygen-rich decant speed (bar/min);
- regular-gas decant speed (bar/min);
- air top-up compressor inlet flow (L/min).

The Working tank card adds material, surrounding medium, ambient temperature, wait mode, and the mode-specific wait value.

Each recipe card displays:

- operation and nominal recipe pressure;
- thermal stop pressure;
- selected rate source and rate;
- estimated transfer duration;
- transfer-end temperature;
- wait duration;
- post-wait pressure and temperature.

The final summary displays final transfer-end and ambient-settled values. Text identifies these values as estimates.

## Compatibility and failure behavior

- Direct `optimizeBlend` calls without `input.thermal` retain current output and behavior.
- Existing saved settings are migrated with defaults.
- Invalid thermal input produces the existing invalid-input result shape and no recipe.
- Existing infeasible, maximum-pressure, oxygen-transfer-safety, and diagnostic behavior remains authoritative.
- Thermal convergence must never claim the requested settled pressure when no feasible hot recipe reaches it.

## Verification

Permanent tests cover:

1. booster displacement/BPM conversion and source/receiver compressibility;
2. oxygen-rich threshold at 40%;
3. direct decant rates;
4. compressor inlet conversion;
5. material, medium, tank-size, and helium heating factors;
6. finite-minute and absolute-temperature cooling;
7. pressure drop after cooling with ideal and Van der Waals models;
8. sequential pressure/temperature carry-over;
9. final-target convergence and infeasible convergence limits;
10. settings defaults, migration, validation, and round-trip persistence;
11. no-thermal optimizer regression behavior.

Browser smoke verification confirms main-screen controls, Settings persistence, per-step results, final ambient-settled target, and absence of module/runtime errors.
