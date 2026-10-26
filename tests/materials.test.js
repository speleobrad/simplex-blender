import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MATERIALS, MATERIAL_VALUES, materialThermal } from '../js/materials.js';
import { validateCylinderPreset } from '../js/preset-validation.js';
import { validateCalculatorInputs } from '../js/input-validation.js';
import { coolingTimeConstantMinutes } from '../js/thermodynamics.js';
import { optimizeBlend } from '../js/optimizer.js';
import { materialLabel } from '../js/units.js';
import { DEFAULT_SETTINGS } from '../js/settings.js';

const THERMAL_KEYS = ['defaultTankMassKg', 'specificHeatJPerKgK', 'areaM2', 'airTauMinutes', 'waterTauMinutes'];

test('every accepted material has a complete, positive thermal parameter set', () => {
  for (const value of MATERIAL_VALUES) {
    for (const key of THERMAL_KEYS) {
      const parameter = MATERIALS[value].thermal[key];
      assert.ok(Number.isFinite(parameter) && parameter > 0, `${value}.${key}`);
    }
  }
});

test('unknown materials are rejected instead of inheriting steel behaviour', () => {
  assert.throws(() => materialThermal('carbon'), /Unknown cylinder material/);
  assert.throws(() => coolingTimeConstantMinutes('carbon', 'air'), /Unknown cylinder material/);
  assert.deepEqual(materialThermal(undefined), MATERIALS.steel.thermal);
});

test('carbon-wrapped steel is labelled Fero-carbon and borrows steel thermal parameters', () => {
  assert.equal(materialLabel('carbon-wrapped-steel', 'metric'), 'Fero-carbon');
  assert.equal(materialLabel('aluminum', 'imperial'), 'Aluminum');
  assert.equal(materialLabel('aluminum', 'metric'), 'Aluminium');
  assert.deepEqual(materialThermal('carbon-wrapped-steel'), materialThermal('steel'));
  assert.notDeepEqual(materialThermal('aluminum'), materialThermal('steel'));
});

test('cylinder preset validation accepts carbon-wrapped steel and rejects other materials', () => {
  const preset = { name: 'X', volumeL: 12, material: 'carbon-wrapped-steel', massKg: 10.9, workingPressureBar: 300, hotOverfillPercent: 2 };
  assert.deepEqual(validateCylinderPreset(preset), []);
  assert.equal(validateCylinderPreset({ ...preset, material: 'carbon-steel' }).length, 1);
  assert.equal(validateCylinderPreset({ ...preset, material: 'carbon' }).length, 1);
});

test('every shipped cylinder preset validates', () => {
  const presets = JSON.parse(readFileSync(new URL('../presets/cylinders.json', import.meta.url), 'utf8'));
  for (const preset of presets) assert.deepEqual(validateCylinderPreset(preset), [], preset.name);
  const carbon = presets.filter(preset => preset.material === 'carbon-wrapped-steel');
  assert.deepEqual(carbon.map(preset => [preset.volumeL, preset.massKg, preset.workingPressureBar]), [[6.8, 6.25, 300], [12, 10.9, 300]]);
});

test('a Carbondive 12 L preset runs through validation and the optimizer with thermal output', () => {
  const presets = JSON.parse(readFileSync(new URL('../presets/cylinders.json', import.meta.url), 'utf8'));
  const preset = presets.find(item => item.name === 'Worthington Carbondive 12L 300 bar');
  const thermal = {
    tankMaterial: preset.material,
    tankMassKg: preset.massKg,
    coolingMedium: 'air',
    ambientTemperatureC: 20,
    inletTemperatureC: 20,
    targetMediumTemperatureC: 20,
    targetInWaterTemperatureC: 15,
    waitMode: 'minutes',
    waitMinutes: 10
  };
  const cylinder = {
    volumeL: preset.volumeL,
    initialPressureBar: 50,
    initialOxygenPercent: 21,
    initialHeliumPercent: 0,
    targetPressureBar: 200,
    targetOxygenPercent: 21,
    targetHeliumPercent: 0,
    workingPressureBar: preset.workingPressureBar,
    hotOverfillPercent: preset.hotOverfillPercent
  };
  const physics = { model: 'ideal', temperatureC: 20 };
  assert.deepEqual(validateCalculatorInputs(cylinder, physics, thermal), []);
  const result = optimizeBlend({ cylinder, physics, thermal, settings: DEFAULT_SETTINGS, banks: [] });
  assert.equal(result.feasible, true);
  assert.ok(result.protocolSteps.some(step => step.thermal));
});
