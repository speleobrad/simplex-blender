import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculatorInputSignature,
  gasCanBeBelowAmbient,
  interimMeasurementLockMessage,
  interimPressureWithinTolerance,
  latestInterimMeasurementIndex,
  protocolStepNumber,
  signatureAfterClearingMeasurement
} from '../js/interim-measurements.js';

const step = (type, rateSource) => ({ type, thermal: { rateSource } });

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

test('latest reading index ignores empty slots', () => {
  assert.equal(latestInterimMeasurementIndex([]), -1);
  assert.equal(latestInterimMeasurementIndex([null, null]), -1);
  assert.equal(latestInterimMeasurementIndex([{ pressureBar: 1, temperatureC: 1 }, null, null]), 0);
  assert.equal(latestInterimMeasurementIndex([null, { pressureBar: 1, temperatureC: 1 }, null]), 1);
});

test('earlier readings are locked; only the latest can be edited or cleared', () => {
  const measurements = [{ pressureBar: 50, temperatureC: 21 }, { pressureBar: 55, temperatureC: 25 }];
  assert.match(interimMeasurementLockMessage(measurements, 0, 'apply'), /step 1 is locked/i);
  assert.match(interimMeasurementLockMessage(measurements, 0, 'clear'), /step 1 is locked/i);
  assert.equal(interimMeasurementLockMessage(measurements, 1, 'apply'), null);
  assert.equal(interimMeasurementLockMessage(measurements, 1, 'clear'), null);
  assert.equal(interimMeasurementLockMessage(measurements, 2, 'apply'), null);
  assert.match(interimMeasurementLockMessage(measurements, 2, 'clear'), /step 3 is locked/i);
});

test('empty slots before the latest reading cannot be recorded', () => {
  const measurements = [null, null, { pressureBar: 55, temperatureC: 25 }];
  assert.match(interimMeasurementLockMessage(measurements, 1, 'apply'), /step 2 is locked/i);
  assert.equal(interimMeasurementLockMessage([null, null], 1, 'apply'), null);
});

test('pressure tolerance is inclusive and relative to the plan', () => {
  assert.equal(interimPressureWithinTolerance({ measuredBar: 103, plannedBar: 100, tolerancePercent: 3 }), true);
  assert.equal(interimPressureWithinTolerance({ measuredBar: 97, plannedBar: 100, tolerancePercent: 3 }), true);
  assert.equal(interimPressureWithinTolerance({ measuredBar: 103.1, plannedBar: 100, tolerancePercent: 3 }), false);
  assert.equal(interimPressureWithinTolerance({ measuredBar: 30, plannedBar: 55, tolerancePercent: 3 }), false);
});

test('zero planned pressure requires an exact zero measurement', () => {
  assert.equal(interimPressureWithinTolerance({ measuredBar: 0, plannedBar: 0, tolerancePercent: 3 }), true);
  assert.equal(interimPressureWithinTolerance({ measuredBar: 0.1, plannedBar: 0, tolerancePercent: 3 }), false);
});

test('gas below ambient needs a pressure-lowering drain before the reading', () => {
  assert.equal(gasCanBeBelowAmbient([step('boost', 'booster')], 1), false);
  assert.equal(gasCanBeBelowAmbient([step('drain', 'draining-rate')], 1), true);
  assert.equal(gasCanBeBelowAmbient([], 0), false);
});

test('waits and keeps carry drain provenance forward', () => {
  assert.equal(gasCanBeBelowAmbient([step('drain', 'draining-rate'), step('wait', 'none')], 2), true);
  assert.equal(gasCanBeBelowAmbient([step('drain', 'draining-rate'), step('keep', 'none')], 2), true);
});

test('a boost, decant, or top-up after a drain removes drain provenance', () => {
  assert.equal(gasCanBeBelowAmbient([step('drain', 'draining-rate'), step('boost', 'booster')], 2), false);
  assert.equal(gasCanBeBelowAmbient([step('drain', 'draining-rate'), step('decant', 'decant-rate')], 2), false);
  assert.equal(gasCanBeBelowAmbient([step('drain', 'draining-rate'), step('boost', 'compressor')], 2), false);
  assert.equal(gasCanBeBelowAmbient([step('drain', 'draining-rate'), step('equalize', 'none')], 2), false);
});

test('a drain after a boost establishes provenance again', () => {
  assert.equal(gasCanBeBelowAmbient([
    step('drain', 'draining-rate'),
    step('boost', 'booster'),
    step('drain', 'draining-rate')
  ], 3), true);
});

test('a titled step shows its plan number and an untitled step falls back to index + 1', () => {
  assert.equal(protocolStepNumber({ title: 'Step 1: Decant Oxygen to 46.9 bar' }, 1), 1);
  assert.equal(protocolStepNumber({ title: 'step   7: Boost Helium' }, 2), 7);
  assert.equal(protocolStepNumber({ title: 'Preserve 100% of Cylinder Gas' }, 0), 1);
  assert.equal(protocolStepNumber(undefined, 3), 4);
});
