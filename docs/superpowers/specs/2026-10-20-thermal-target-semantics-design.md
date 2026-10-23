# Thermal Target Semantics and Safe Recipe Planning

## Status

Approved in conversation; implementation not started.

## Goal

Make Optimize mode accept the pressure the user wants at the in-water temperature, while modeling mixing and normal waiting at ambient temperature. The optimizer must produce a recipe whose hot and intermediate pressures never exceed the selected cylinder working pressure.

Example:

- Current gas: Air at 50 bar
- Ambient/mixing temperature: 25°C
- Target gas: 18/45
- Requested in-water state: 188.6 bar at 10°C
- Expected hot end of mix: approximately 204.8 bar at 31.3°C
- Expected ambient-settled state: 200.0 bar at 25°C
- Expected in-water projection: 188.6 bar at 10°C

## Scope

This changes the Optimize thermal target contract, temperature validation, thermal result reporting, and safe recipe scheduling. It updates terminology in the existing Optimize and Compare wait controls. It does not redesign the existing in-water pressure calculation; it reuses that thermodynamic projection in reverse for Optimize target normalization and forward for final reporting.

## Temperature semantics

### Ambient temperature

`ambientTemperatureC` is the temperature of the environment during mixing. It is also the convergence temperature for ordinary cooling waits, regardless of whether the surrounding medium is air or water. Valid range: 5–40°C.

### Target in-water temperature

`targetInWaterTemperatureC` is the temperature at which the requested target pressure applies after the cylinder is taken diving. It is independent of ambient temperature and may be below ambient. Valid range: 1–30°C.

### Target medium temperature

`targetMediumTemperatureC` is the existing wait-mode target temperature, currently entered as “Wait target temperature.” It is the temperature used when a between-fill wait is configured as target-temperature mode. It must be in the ambient range, 5–40°C, and must be greater than or equal to ambient temperature.

An equal target-medium and ambient temperature is valid and represents convergence to ambient. A target-medium temperature below ambient is invalid.

### Inlet gas temperature

`inletTemperatureC` remains the gas temperature entering during filling. Valid range: 5–40°C, matching the ambient range.

The cooling medium still affects transfer heating/cooling behavior and the cooling time constant. It does not change the convergence temperature: ordinary waiting converges to ambient.

## User-facing target contract

The TARGET pressure input is the requested pressure at `targetInWaterTemperatureC`. It is no longer an ambient-settled pressure input.

Before thermal optimization, derive the equivalent ambient-settled pressure with the selected physics model:

```js
ambientSettledTargetPressureBar = calculatePressureAtTemperature({
  pressureBar: requestedInWaterPressureBar,
  fromTemperatureC: targetInWaterTemperatureC,
  toTemperatureC: ambientTemperatureC,
  volumeL,
  useVdw
});
```

The conversion must use the same ideal-gas or Van der Waals implementation as the existing in-water tab. No second conversion formula is allowed.

The existing thermal search then solves for a hot recipe whose final ambient-settled pressure equals `ambientSettledTargetPressureBar`. After the recipe is simulated, project the final ambient state from ambient temperature to `targetInWaterTemperatureC`. Feasibility is judged against the requested in-water pressure.

## Calculation flow

1. Validate all cylinder, physics, thermal, and inventory inputs.
2. Convert the requested in-water pressure to the internal ambient-settled target.
3. Generate a static gas recipe using the existing gas-mixing solver.
4. Simulate transfer stages using ambient and inlet temperatures, selected medium, tank properties, and configured rates.
5. Apply configured waits between fills; normal cooling converges toward ambient.
6. Automatically extend waits when needed to keep the next transfer below working pressure.
7. Split a transfer at the working-pressure boundary when one transfer cannot be performed safely as a single stage.
8. Simulate the final hot mix and its ambient settling.
9. Project the ambient-settled state to the requested in-water temperature.
10. Return hot, ambient-settled, and in-water states.

## Working-pressure safety

The selected cylinder working pressure is a hard invariant. Every modeled transfer endpoint and intermediate state must satisfy:

```text
pressure <= cylinder.workingPressureBar
```

Checking only the final settled pressure is insufficient because transfer heating can temporarily increase pressure above the working limit.

When a configured wait is insufficient:

- the optimizer may automatically extend it;
- it chooses the minimum additional wait that makes the next transfer safe;
- it never shortens a user-configured wait;
- it continues to use ambient as the waiting convergence temperature;
- it may split a transfer at the safe hot-pressure boundary, wait, then continue;
- it rejects the recipe only when no safe sequence exists within the supported wait limit.

Automatically extended waits must be visible. Each affected step shows an exclamation-mark warning and the added duration, for example:

```text
! Extended wait: 18 min
The configured wait was extended by 8 min to keep the cylinder below its 232 bar working pressure.
```

The warning appears on the affected step, in the recipe summary, and in thermal details.

## Data model

Thermal input semantics become:

```js
thermal: {
  ambientTemperatureC,
  inletTemperatureC,
  targetMediumTemperatureC,
  targetInWaterTemperatureC,
  waitMode,
  waitMinutes,
  coolingMedium,
  ...
}
```

The existing persisted/user-facing target pressure field remains the requested in-water pressure. The derived ambient target is calculation state, not an editable field.

## Result model

Thermal results expose both pressure projections explicitly:

```js
thermal: {
  finalTransferEndPressureBar,
  finalTransferEndTemperatureC,
  finalAmbientPressureBar,
  finalAmbientTemperatureC,
  finalInWaterPressureBar,
  finalInWaterTemperatureC,
  requestedInWaterPressureBar,
  requestedInWaterTemperatureC,
  ambientSettledTargetPressureBar
}
```

The gas/result target pressure shown to users remains the requested in-water pressure. Internal recipe search and safety diagnostics may use the derived ambient target, but must label it as ambient-settled.

## UI

Labels:

- CURRENT: `Ambient temperature`
- TARGET: `Target pressure`, `Target in-water temperature`
- Wait controls: `Target medium temperature`

Results distinguish:

- hot pressure/temperature immediately after mixing;
- ambient-settled pressure/temperature;
- projected in-water pressure/temperature.

The thermal chart keeps the final mixing state at ambient and labels the in-water projection separately when shown.

The existing in-water tab continues to use the shared pressure-at-temperature projection and must agree with Optimize’s in-water result.

## Compare mode

Compare row pressure semantics use the entered pressure as the pressure reached at the end of the transfer, at the modeled hot transfer temperature. The simulator solves the lower reference-temperature pressure needed to reach that endpoint, then reports the pressure after the configured wait and ambient settling. Compare target-temperature waits use `targetMediumTemperatureC` terminology and the same constraints:

- target medium temperature: 5–40°C;
- target medium temperature >= ambient;
- ambient: 5–40°C;
- inlet gas temperature: 5–40°C.

The Optimize in-water pressure conversion does not alter Compare row pressure targets.

## Validation and errors

Validation messages identify the actual field and relationship:

- `Ambient temperature must be between 5 and 40°C.`
- `Target in-water temperature must be between 1 and 30°C.`
- `Target medium temperature must be between 5 and 40°C.`
- `Target medium temperature cannot be below ambient temperature.`
- `Inlet gas temperature must be between 5 and 40°C.`

Invalid input returns the existing invalid-result shape before optimization. Conversion/projection failures return an infeasible result without silently substituting another temperature or pressure.

## Components

- `js/input-validation.js`: shared ranges and temperature relationships.
- `js/main.js`: input collection, field names, labels, and calculation orchestration.
- `js/optimizer.js`: in-water-to-ambient target conversion, safe wait extension/splitting, thermal target search, and result fields.
- `js/thermodynamics.js`: ambient convergence, target-medium wait handling, pressure projection, and safe stage simulation.
- `js/ui/results.js`: labeled hot, ambient, and in-water result states plus automatic-wait warnings.
- `js/ui/thermal-charts.js`: ambient final state and explicit in-water projection.
- Compare UI/validation: terminology and shared temperature constraints only.

## Verification

Permanent tests must cover:

1. 188.6 bar at 10°C converting to approximately 200 bar at 25°C.
2. The 50 bar Air to 18/45 example producing approximately 204.8 bar hot, 200 bar ambient-settled, and 188.6 bar in-water.
3. Ideal-gas and Van der Waals target conversion.
4. Target in-water temperature below ambient.
5. Equal target-medium and ambient temperatures.
6. Target-medium below ambient rejection.
7. All lower, upper, and out-of-range temperature boundaries.
8. Inlet temperature range enforcement.
9. Automatic wait extension when a hot transfer would exceed working pressure.
10. Transfer splitting at the working-pressure boundary.
11. Exclamation-mark warnings and reported added wait duration.
12. Existing air/water transfer and wait behavior.
13. Agreement between Optimize’s in-water projection and the existing in-water tab.
14. Full unit suite and browser checks for labels, input ranges, result states, warnings, and thermal charts.
