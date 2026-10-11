# Cylinder Presets for the Working Tank

## Status

Approved design.

## Goal

Replace the working tank's independent cylinder-volume and material controls with saved cylinder presets containing the physical properties required for blending, thermodynamic modeling, and working-pressure safety checks.

## Current behavior

The working tank currently has:

- a cylinder-volume selector populated from `settings.volumePresets`, plus a custom volume input;
- an independent `tank-material` selector limited to steel and aluminum;
- initial and target pressures entered directly;
- no working-pressure rating associated with the working tank.

The thermodynamic model uses the selected material for material-specific behavior but hard-codes cylinder mass as 14 kg for steel and 14.2 kg for aluminum. Blending uses only `cylinder.volumeL`. The calculator accepts pressures up to 350 bar and does not compare them with a cylinder rating.

## Approved behavior

1. Settings manage `cylinderPresets` instead of standalone `volumePresets`.
2. Each cylinder preset contains:
   - `name`: non-empty unique name;
   - `volumeL`: internal volume in litres;
   - `material`: `steel` or `aluminum`;
   - `massKg`: empty cylinder assembly mass, including the valve;
   - `workingPressureBar`: rated working pressure.
3. The default settings include a `12 L Steel 232 bar` preset with `volumeL: 12`, `material: 'steel'`, `massKg: 14`, and `workingPressureBar: 232`, alongside the existing standard cylinder sizes represented as steel presets with the same default mass and working pressure.
4. The Working tank section contains one saved-cylinder selector. It has no custom-volume option and no independent material selector.
5. The selected preset supplies:
   - `volumeL` to gas blending and pressure calculations;
   - `material` and `massKg` to thermodynamic calculations;
   - `workingPressureBar` to pressure validation.
6. Initial and target pressure must each be no greater than the selected cylinder's working pressure. The existing generic limits of 0–350 bar for initial pressure and 10–350 bar for target pressure remain in force. Equality with the working pressure is valid.
7. The thermodynamic transfer-temperature calculation uses the preset `massKg` rather than a material-based hard-coded mass. Material-specific cooling behavior remains unchanged.
8. Existing saved settings containing `volumePresets` migrate on load to generated cylinder presets using the saved volumes, steel, 14 kg, and 232 bar. New saves contain `cylinderPresets` only.
9. The default Working tank selection is the `12 L Steel 232 bar` preset. The selected cylinder is a current recipe input, not a separate persisted user preference. If saving Settings removes the selected preset, the first available preset becomes selected before recalculation.
10. Existing supply-bank behavior, gas presets, gas inlet temperature, calculation temperature, gas model, and optimizer equations remain otherwise unchanged.

## Data flow

`main.js` resolves the selected cylinder preset from the working-tank selector and constructs:

```js
cylinder: {
  presetName,
  volumeL,
  workingPressureBar,
  initialPressureBar,
  initialOxygenPercent,
  initialHeliumPercent,
  targetPressureBar,
  targetOxygenPercent,
  targetHeliumPercent
},
thermal: {
  tankMaterial: preset.material,
  tankMassKg: preset.massKg,
  coolingMedium,
  ambientTemperatureC,
  inletTemperatureC,
  waitMode,
  waitMinutes,
  targetTemperatureC
}
```

`optimizeBlend` continues to consume `cylinder.volumeL` for blending. The thermal simulation receives `thermal.tankMassKg` and passes it to `estimateTransferTemperature`, which uses it in the tank heat-capacity term. The selected preset's `workingPressureBar` is validated before optimization.

## Settings schema and migration

The normalized Settings shape becomes:

```js
{
  physics: { model: 'vdw' | 'ideal' },
  gasPresets: [...],
  cylinderPresets: [{
    name: string,
    volumeL: number,
    material: 'steel' | 'aluminum',
    massKg: number,
    workingPressureBar: number
  }],
  booster: { ... }
}
```

`loadSettings` accepts legacy objects with `volumePresets` and converts each volume to a generated cylinder preset. It also accepts already-normalized `cylinderPresets`. Validation requires at least one valid cylinder preset, unique names, positive finite volume and mass, supported material, and working pressure between 10 and 350 bar. `saveSettings` writes only the normalized `cylinderPresets` shape.

The migration is intentionally one-way at the serialized schema boundary: old data is read and normalized, but obsolete `volumePresets` are not retained in newly saved data.

## UI behavior

The Settings dialog replaces “Cylinder sizes (L)” with “Cylinder presets”. Each row exposes name, internal volume, material, mass, and working pressure, with add/remove controls. The Working tank selector displays the preset name and its key rating information through the option text. The selected preset's volume and material are not editable on the main screen.

The existing cooling-medium, ambient-temperature, wait-mode, and wait-target controls remain in the Working tank section. The incoming gas temperature remains under Supply banks → Transfer conditions.

## Error handling

Invalid cylinder preset settings prevent Settings from being saved and leave the previous settings intact. A missing or invalid selected cylinder falls back to the first normalized preset before calculation. A pressure above the selected working pressure produces the existing invalid-input result path with a clear working-pressure message; optimization is not attempted.

## Tests and verification

Add tests for:

- default cylinder preset shape and independent copies;
- legacy volume-preset migration;
- cylinder preset validation and save/load round trips;
- invalid material, mass, volume, name, and working-pressure rejection;
- working-pressure equality acceptance and overfill rejection;
- selected cylinder mass reaching thermodynamic calculations;
- transfer temperature changing when cylinder mass changes;
- no custom working-tank volume path;
- existing blending and supply-bank behavior remaining unchanged.

Run the complete Node test suite, syntax checks, and a browser smoke test covering Settings add/edit/remove/save, working-tank selection, calculation changes from volume/material/mass, and rejection of a target pressure above the selected working pressure.
