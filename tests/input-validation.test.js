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
    interimMeasurements: [null, { pressureBar: 237, temperatureC: 25 }]
  };
  const ratedCylinder = { ...defaultCylinder, workingPressureBar: 232 };

  assert.match(
    validateCalculatorInputs(ratedCylinder, defaultPhysics, thermal).join(' '),
    /measured.*hot overfill/i
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
      inletTemperatureC: 25,
      targetMediumTemperatureC: 24,
      targetInWaterTemperatureC: 1,
      waitMode: 'temperature',
      waitMinutes: 10
    }
  );
  assert.match(errors.join(' '), /target.*ambient/i);
});
test('rejects target-medium below ambient regardless of cooling medium', () => {
  const errors = validateCalculatorInputs(
    { volumeL: 12, initialPressureBar: 50, targetPressureBar: 200 },
    { temperatureC: 25 },
    {
      tankMaterial: 'steel',
      coolingMedium: 'water',
      ambientTemperatureC: 25,
      inletTemperatureC: 25,
      targetMediumTemperatureC: 15,
      targetInWaterTemperatureC: 15,
      waitMode: 'minutes',
      waitMinutes: 10
    }
  );
  assert.match(errors.join(' '), /target-medium temperature cannot be below ambient/i);
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

test('fixed-minute waits require a target-medium temperature at or above ambient', () => {
  const errors = validateCalculatorInputs(
    { volumeL: 12, initialPressureBar: 80, targetPressureBar: 210 },
    { temperatureC: 20 },
    {
      tankMaterial: 'steel',
      coolingMedium: 'air',
      ambientTemperatureC: 26,
      inletTemperatureC: 26,
      targetMediumTemperatureC: 26,
      targetInWaterTemperatureC: 25,
      waitMode: 'minutes',
      waitMinutes: 10
    }
  );
  assert.deepEqual(errors, []);
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

test('accepts thermal temperature boundaries and semantic combinations', () => {
  const valid = { tankMaterial: 'steel', coolingMedium: 'air', ambientTemperatureC: 5, inletTemperatureC: 5, targetMediumTemperatureC: 5, targetInWaterTemperatureC: 1, waitMode: 'minutes', waitMinutes: 0 };
  for (const field of ['ambientTemperatureC', 'inletTemperatureC', 'targetMediumTemperatureC']) for (const value of [5, 40]) { const thermal = { ...valid, [field]: value }; if (field === 'ambientTemperatureC') thermal.targetMediumTemperatureC = value; assert.deepEqual(validateCalculatorInputs(defaultCylinder, defaultPhysics, thermal), []); }
  for (const value of [1, 30]) assert.deepEqual(validateCalculatorInputs(defaultCylinder, defaultPhysics, { ...valid, targetInWaterTemperatureC: value }), []);
});
test('rejects values outside every thermal temperature range', () => {
  const valid = { tankMaterial: 'steel', coolingMedium: 'air', ambientTemperatureC: 20, inletTemperatureC: 20, targetMediumTemperatureC: 20, targetInWaterTemperatureC: 15, waitMode: 'minutes', waitMinutes: 0 };
  for (const [field, value, message] of [['ambientTemperatureC', 4, /ambient.*5 and 40/i], ['ambientTemperatureC', 41, /ambient.*5 and 40/i], ['inletTemperatureC', 4, /inlet.*5 and 40/i], ['inletTemperatureC', 41, /inlet.*5 and 40/i], ['targetMediumTemperatureC', 4, /target-medium.*5 and 40/i], ['targetMediumTemperatureC', 41, /target-medium.*5 and 40/i], ['targetInWaterTemperatureC', 0, /target in-water.*1 and 30/i], ['targetInWaterTemperatureC', 31, /target in-water.*1 and 30/i]]) assert.match(validateCalculatorInputs(defaultCylinder, defaultPhysics, { ...valid, [field]: value }).join(' '), message);
});
test('allows target in-water below ambient while target medium remains valid', () => assert.deepEqual(validateCalculatorInputs(defaultCylinder, defaultPhysics, { tankMaterial: 'steel', coolingMedium: 'air', ambientTemperatureC: 25, inletTemperatureC: 25, targetMediumTemperatureC: 25, targetInWaterTemperatureC: 1, waitMode: 'minutes', waitMinutes: 0 }), []));
test('allows target medium equal to ambient in temperature mode', () => assert.deepEqual(validateCalculatorInputs(defaultCylinder, defaultPhysics, { tankMaterial: 'steel', coolingMedium: 'air', ambientTemperatureC: 25, inletTemperatureC: 25, targetMediumTemperatureC: 25, targetInWaterTemperatureC: 10, waitMode: 'temperature', waitMinutes: 0 }), []));
test('measured interim overfill is allowed only while hotter than ambient and within the allowance', () => {
  const cylinder = {
    ...defaultCylinder,
    initialPressureBar: 80,
    targetPressureBar: 100,
    workingPressureBar: 100,
    hotOverfillPercent: 2
  };
  const thermal = {
    tankMaterial: 'steel',
    coolingMedium: 'air',
    ambientTemperatureC: 20,
    inletTemperatureC: 20,
    targetMediumTemperatureC: 20,
    targetInWaterTemperatureC: 10,
    waitMode: 'minutes',
    waitMinutes: 10,
    interimMeasurements: [{ pressureBar: 101.5, temperatureC: 40 }]
  };

  assert.deepEqual(validateCalculatorInputs(cylinder, defaultPhysics, thermal), []);
  assert.match(
    validateCalculatorInputs(cylinder, defaultPhysics, {
      ...thermal,
      interimMeasurements: [{ pressureBar: 102.1, temperatureC: 40 }]
    }).join(' '),
    /measured.*(working pressure|hot overfill)/i
  );
  assert.match(
    validateCalculatorInputs(cylinder, defaultPhysics, {
      ...thermal,
      interimMeasurements: [{ pressureBar: 101.5, temperatureC: 20 }]
    }).join(' '),
    /measured.*working pressure/i
  );
});
test('Warning mode bypasses only cylinder ceilings, not supported calculator inputs', () => {
  const warning = { pressureLimitMode: 'warning' };
  const rated = { ...defaultCylinder, workingPressureBar: 100, hotOverfillPercent: 2 };
  const thermal = {
    tankMaterial: 'steel',
    coolingMedium: 'air',
    ambientTemperatureC: 20,
    inletTemperatureC: 20,
    targetMediumTemperatureC: 20,
    targetInWaterTemperatureC: 10,
    waitMode: 'minutes',
    waitMinutes: 0,
    interimMeasurements: [null]
  };
  assert.deepEqual(validateCalculatorInputs(
    { ...rated, initialPressureBar: 101, targetPressureBar: 110 },
    defaultPhysics,
    thermal,
    warning
  ), []);
  assert.match(validateCalculatorInputs(
    { ...rated, targetPressureBar: 110 }, defaultPhysics, thermal
  ).join(' '), /working pressure/i);
  assert.match(validateCalculatorInputs(
    { ...rated, initialPressureBar: 101 }, defaultPhysics, thermal
  ).join(' '), /working pressure/i);
  assert.match(validateCalculatorInputs(
    { ...rated, targetPressureBar: 351 }, defaultPhysics, thermal, warning
  ).join(' '), /target pressure/i);
  assert.match(validateCalculatorInputs(
    { ...rated, initialPressureBar: 351 }, defaultPhysics, thermal, warning
  ).join(' '), /initial pressure/i);
  assert.match(validateCalculatorInputs(
    { ...rated, targetPressureBar: 100.0000000005 },
    defaultPhysics,
    thermal
  ).join(' '), /working pressure/i);
  assert.match(validateCalculatorInputs(
    rated,
    defaultPhysics,
    { ...thermal, interimMeasurements: [{ pressureBar: 90, temperatureC: 100.1 }] },
    warning
  ).join(' '), /measured temperature/i);
  assert.deepEqual(validateCalculatorInputs(
    rated,
    defaultPhysics,
    { ...thermal, interimMeasurements: [{ pressureBar: 103, temperatureC: 40 }] },
    warning
  ), []);
  assert.match(validateCalculatorInputs(
    rated,
    defaultPhysics,
    { ...thermal, interimMeasurements: [{ pressureBar: 351, temperatureC: 40 }] },
    warning
  ).join(' '), /measured pressure/i);
  assert.match(validateCalculatorInputs(
    { ...rated, hotOverfillPercent: 2.25 },
    defaultPhysics,
    thermal,
    warning
  ).join(' '), /hot overfill/i);
  const invalidHotCylinder = { ...rated, hotOverfillPercent: 2.25 };
  const overLimitReading = {
    ...thermal,
    interimMeasurements: [{ pressureBar: 103, temperatureC: 40 }]
  };
  const hardStopInvalidHotErrors = validateCalculatorInputs(
    invalidHotCylinder, defaultPhysics, overLimitReading
  );
  assert.match(hardStopInvalidHotErrors.join(' '), /hot overfill/i);
  assert.match(hardStopInvalidHotErrors.join(' '), /measured.*hot overfill/i);
  const warningInvalidHotErrors = validateCalculatorInputs(
    invalidHotCylinder, defaultPhysics, overLimitReading, warning
  );
  assert.match(warningInvalidHotErrors.join(' '), /hot overfill/i);
  assert.doesNotMatch(warningInvalidHotErrors.join(' '), /measured.*hot overfill/i);
});
