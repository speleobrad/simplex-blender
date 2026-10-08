import test from 'node:test';
import assert from 'node:assert/strict';
import { validateCalculatorInputs } from '../js/input-validation.js';

const defaultCylinder = {
  volumeL: 12,
  initialPressureBar: 80,
  targetPressureBar: 210
};
const defaultPhysics = { temperatureC: 20 };

test('accepts supported cylinder-input boundaries', () => {
  assert.deepEqual(validateCalculatorInputs(
    { ...defaultCylinder, volumeL: 0.1, initialPressureBar: 0, targetPressureBar: 10 },
    { temperatureC: 0 }
  ), []);
  assert.deepEqual(validateCalculatorInputs(
    { ...defaultCylinder, initialPressureBar: 350, targetPressureBar: 350 },
    { temperatureC: 50 }
  ), []);
});

test('rejects blank and out-of-range cylinder inputs', () => {
  const invalidCases = [
    [{ ...defaultCylinder, volumeL: Number.NaN }, defaultPhysics, /cylinder capacity/i],
    [{ ...defaultCylinder, volumeL: 0.09 }, defaultPhysics, /cylinder capacity/i],
    [{ ...defaultCylinder, initialPressureBar: 351 }, defaultPhysics, /initial pressure/i],
    [{ ...defaultCylinder, targetPressureBar: 9 }, defaultPhysics, /target pressure/i],
    [{ ...defaultCylinder, targetPressureBar: 351 }, defaultPhysics, /target pressure/i],
    [defaultCylinder, { temperatureC: Number.NaN }, /temperature/i],
    [defaultCylinder, { temperatureC: 50.1 }, /temperature/i]
  ];

  for (const [cylinder, physics, expectedMessage] of invalidCases) {
    assert.match(validateCalculatorInputs(cylinder, physics).join(' '), expectedMessage);
  }
});

test('rejects a temperature wait target at or below ambient', () => {
  const errors = validateCalculatorInputs(
    { volumeL: 12, initialPressureBar: 80, targetPressureBar: 210 },
    { temperatureC: 20 },
    {
      tankMaterial: 'steel',
      coolingMedium: 'air',
      ambientTemperatureC: 25,
      waitMode: 'temperature',
      waitMinutes: 10,
      targetTemperatureC: 25
    }
  );
  assert.match(errors.join(' '), /target.*ambient/i);
});

test('rejects unsupported thermal selectors and negative fixed waits', () => {
  const errors = validateCalculatorInputs(
    { volumeL: 12, initialPressureBar: 80, targetPressureBar: 210 },
    { temperatureC: 20 },
    {
      tankMaterial: 'carbon',
      coolingMedium: 'oil',
      ambientTemperatureC: 20,
      waitMode: 'temperature',
      waitMinutes: -1,
      targetTemperatureC: 25
    }
  );
  assert.ok(errors.length >= 3);
});
