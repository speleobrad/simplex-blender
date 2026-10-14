import test from 'node:test';
import assert from 'node:assert/strict';
import { calculatorInputSignature, signatureAfterClearingMeasurement } from '../js/interim-measurements.js';

const input = {
  cylinder: { initialPressureBar: 50, targetPressureBar: 200 },
  physics: { model: 'vdw', temperatureC: 25 },
  thermal: {
    ambientTemperatureC: 25,
    waitMode: 'minutes',
    waitMinutes: 7,
    interimMeasurements: [null, { pressureBar: 60.2, temperatureC: 25.7 }]
  },
  banks: [{ id: 'oxygen', pressureBar: 200 }],
  settings: { booster: { otherBoostBpm: 50 } }
};

test('calculator recipe signature ignores interim readings themselves', () => {
  assert.equal(
    calculatorInputSignature(input),
    calculatorInputSignature({
      ...input,
      thermal: { ...input.thermal, interimMeasurements: [null, { pressureBar: 61, temperatureC: 26 }] }
    })
  );
});

test('calculator recipe signature changes when a recipe input changes', () => {
  assert.notEqual(
    calculatorInputSignature(input),
    calculatorInputSignature({
      ...input,
      cylinder: { ...input.cylinder, targetPressureBar: 210 }
    })
  );
});
test('clearing one reading keeps the recipe signature while others remain', () => {
  const multiInput = {
    ...input,
    thermal: {
      ...input.thermal,
      interimMeasurements: [
        null,
        { pressureBar: 60.2, temperatureC: 25.7 },
        { pressureBar: 104.6, temperatureC: 26.9 }
      ]
    }
  };
  assert.equal(
    signatureAfterClearingMeasurement(multiInput, 1),
    calculatorInputSignature(multiInput)
  );
});

