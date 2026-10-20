import test from 'node:test';
import assert from 'node:assert/strict';
import { validateCalculatorInputs, validateSupplyBankInput } from '../js/input-validation.js';

const defaultCylinder = {
  volumeL: 12,
  initialPressureBar: 80,
  targetPressureBar: 210
};
const defaultPhysics = { temperatureC: 20 };

test('accepts supported cylinder-input boundaries', () => {
  assert.deepEqual(validateCalculatorInputs(
    { ...defaultCylinder, volumeL: 0.1, initialPressureBar: 0, targetPressureBar: 10 },
    { temperatureC: 5 }
  ), []);
  assert.deepEqual(validateCalculatorInputs(
    { ...defaultCylinder, initialPressureBar: 350, targetPressureBar: 350 },
    { temperatureC: 40 }
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
test('enforces the selected cylinder working pressure', () => {
  const thermal = {
    tankMaterial: 'steel',
    coolingMedium: 'air',
    ambientTemperatureC: 20,
    waitMode: 'minutes',
    waitMinutes: 10,
    targetTemperatureC: 25
  };
  const ratedCylinder = {
    ...defaultCylinder,
    workingPressureBar: 232
  };

  assert.deepEqual(validateCalculatorInputs(
    { ...ratedCylinder, targetPressureBar: 232 },
    defaultPhysics,
    thermal
  ), []);
  assert.match(
    validateCalculatorInputs({ ...ratedCylinder, targetPressureBar: 232.1 }, defaultPhysics, thermal).join(' '),
    /working pressure/i
  );
  assert.match(
    validateCalculatorInputs({ ...ratedCylinder, initialPressureBar: 232.1 }, defaultPhysics, thermal).join(' '),
    /working pressure/i
  );
});
test('validates measured interim readings against supported tank limits', () => {
  const thermal = {
    tankMaterial: 'steel',
    coolingMedium: 'air',
    ambientTemperatureC: 20,
    waitMode: 'minutes',
    waitMinutes: 10,
    targetTemperatureC: 25,
    interimMeasurements: [null, { pressureBar: 232.1, temperatureC: 25 }]
  };
  const ratedCylinder = { ...defaultCylinder, workingPressureBar: 232 };

  assert.match(
    validateCalculatorInputs(ratedCylinder, defaultPhysics, thermal).join(' '),
    /measured.*working pressure/i
  );
  assert.match(
    validateCalculatorInputs(ratedCylinder, defaultPhysics, {
      ...thermal,
      interimMeasurements: [null, { pressureBar: 60.2, temperatureC: -20.1 }]
    }).join(' '),
    /measured.*temperature/i
  );
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
test('allows a settled temperature below ambient for water cooling', () => {
  const errors = validateCalculatorInputs(
    { volumeL: 12, initialPressureBar: 50, targetPressureBar: 200 },
    { temperatureC: 25 },
    {
      tankMaterial: 'steel',
      coolingMedium: 'water',
      ambientTemperatureC: 25,
      settledTemperatureC: 15,
      waitMode: 'minutes',
      waitMinutes: 10,
      targetTemperatureC: 15
    }
  );

  assert.deepEqual(errors, []);
});

test('rejects a settled temperature below ambient for air cooling', () => {
  const errors = validateCalculatorInputs(
    { volumeL: 12, initialPressureBar: 50, targetPressureBar: 200 },
    { temperatureC: 25 },
    {
      tankMaterial: 'steel',
      coolingMedium: 'air',
      ambientTemperatureC: 25,
      targetMediumTemperatureC: 15,
      targetInWaterTemperatureC: 15,
      inletTemperatureC: 25,
      waitMode: 'minutes',
      waitMinutes: 10,
      targetTemperatureC: 15
    }
  );

  assert.match(errors.join(' '), /target-medium temperature cannot be below ambient/i);
});

test('fixed-minute waits do not validate the hidden target temperature against ambient', () => {
  const errors = validateCalculatorInputs(
    { volumeL: 12, initialPressureBar: 80, targetPressureBar: 210 },
    { temperatureC: 20 },
    {
      tankMaterial: 'steel',
      coolingMedium: 'air',
      ambientTemperatureC: 26,
      waitMode: 'minutes',
      waitMinutes: 10,
      targetTemperatureC: 25
    }
  );

  assert.doesNotMatch(errors.join(' '), /target.*ambient/i);
});


test('rejects unsupported thermal selectors and negative fixed waits', () => {
  const errors = validateCalculatorInputs(
    { volumeL: 12, initialPressureBar: 80, targetPressureBar: 210 },
    { temperatureC: 20 },
    {
      tankMaterial: 'carbon',
      coolingMedium: 'oil',
      ambientTemperatureC: 20,
      inletTemperatureC: 20,
      targetMediumTemperatureC: 25,
      targetInWaterTemperatureC: 20,
      waitMode: 'temperature',
      waitMinutes: -1,
      targetTemperatureC: 25
    }
  );
  assert.ok(errors.length >= 2);
});

test('rejects finite Air supply banks because Air is an implicit compressor source', () => {
  const errors = validateSupplyBankInput({
    id: 'air-bank',
    name: 'Air bank',
    volumeL: 10,
    pressureBar: 200,
    oxygenPercent: 21,
    heliumPercent: 0,
    enabled: true
  });

  assert.match(errors.join(' '), /Air.*compressor|compressor.*Air/i);
});
