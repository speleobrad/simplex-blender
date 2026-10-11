# Gas Model Settings and Ambient Calculation Temperature

## Status

Approved design.

## Goal

Move the gas-model selector from the page header into persistent Settings and use the working tank's ambient temperature as the browser application's calculation/start temperature, while preserving the existing optimizer and thermodynamic APIs and equations.

## Current behavior

The browser controller reads two independent header controls:

- `gas-physics-model` selects `vdw` or `ideal` and is not persisted.
- `blend-temp` supplies `physics.temperatureC`.

The optimizer uses `physics.temperatureC` for gas density, moles, pressure, compressibility, source-bank pressure estimates, transfer-safety checks, and static transfer calculations. The thermal simulation starts the working tank at the same value. Thermal ambient and inlet temperatures are separate inputs.

## Approved behavior

1. Remove the header gas-model selector.
2. Remove the separate header calculation-temperature input.
3. Use the main-screen `ambient-temperature` value as the browser application's `physics.temperatureC`.
4. Keep `physics.temperatureC` in the internal optimizer/thermodynamics input contract so direct callers can still model a starting gas temperature distinct from ambient.
5. Add `physics.model` to persisted Settings:
   - default: `vdw`;
   - allowed values: `vdw` and `ideal`;
   - old saved settings without `physics` migrate to the default real-gas model.
6. Render the gas model selector in the Settings dialog and apply it when Settings are saved, consistent with the existing draft workflow.
7. Explain in the thermal UI that ambient temperature is also used as the initial gas calculation temperature. Inlet gas temperature remains independent.
8. Do not alter gas equations, optimizer constraints, thermal integration, result formats, or direct library-call semantics.

## Data flow

`main.js` reads `ambient-temperature` once into `thermal.ambientTemperatureC` and uses the same value for `physics.temperatureC`. It reads the selected model from `state.settings.physics.model`. Saving Settings validates and persists the model, updates `state.settings`, and recalculates.

The Settings draft contains:

```js
{
  physics: { model: 'vdw' | 'ideal' },
  gasPresets: [...],
  volumePresets: [...],
  booster: { ... }
}
```

The existing public optimizer input remains:

```js
physics: { model: 'vdw' | 'ideal', temperatureC: number }
```

## Validation and migration

`validateSettings` rejects missing or unsupported `physics.model`. `loadSettings` overlays the default physics setting onto legacy saved objects before validation. `saveSettings` also overlays the default when handed a legacy settings object, preserving existing callers while writing the normalized shape. `copySettings` preserves the physics setting so drafts and loaded settings are independent objects. Invalid settings remain unsaved and existing storage is unchanged.

## UI behavior

The Settings dialog includes a calculation section with a `Gas model` select. The model is not recalculated while editing the draft; Save applies it, while Cancel discards it. The working-tank thermal section labels ambient temperature as the value used for both ambient conditions and the initial gas calculation state. The Supply banks card contains a `Transfer conditions` subsection with the shared incoming gas temperature; it remains independent from ambient temperature.

## Tests and verification

Add tests for:

- default settings containing real-gas model;
- legacy settings gaining the real-gas default;
- model save/load round trip;
- invalid model rejection without storage mutation;
- settings copies preserving model state;
- the existing optimizer and thermodynamic behavior remaining unchanged.

Run the complete Node test suite, JavaScript syntax checks, and a browser smoke test covering Settings save/cancel/reload, both gas models, ambient-temperature changes, thermal results, and absence of the old header gas-model/temperature controls. Existing unrelated worktree changes must remain untouched.
