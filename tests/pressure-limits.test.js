import test from 'node:test';
import assert from 'node:assert/strict';

async function pressureLimitApiForRedTest() {
  try {
    return await import('../js/pressure-limits.js');
  } catch (error) {
    if (error.code === 'ERR_MODULE_NOT_FOUND'
      && error.message.includes('pressure-limits.js')) return null;
    throw error;
  }
}

test('classifies working and transient hot-overfill boundaries', async () => {
  const helpers = await pressureLimitApiForRedTest();
  const cylinder = { workingPressureBar: 100, hotOverfillPercent: 2 };
  assert.deepEqual(helpers?.getCylinderPressureLimit?.({ cylinder }), {
    kind: 'working-pressure', limitBar: 100
  });
  assert.deepEqual(helpers?.getCylinderPressureLimit?.({ cylinder, isTransientHot: true }), {
    kind: 'hot-overfill', limitBar: 102
  });
  assert.equal(helpers?.getCylinderPressureExceedance?.({
    pressureBar: 102, cylinder, isTransientHot: true
  }), null);
  assert.deepEqual(helpers?.getCylinderPressureExceedance?.({
    pressureBar: 102.1, cylinder, isTransientHot: true
  }), { kind: 'hot-overfill', pressureBar: 102.1, limitBar: 102 });
  assert.deepEqual(helpers?.getCylinderPressureExceedance?.({
    pressureBar: 100.1, cylinder
  }), { kind: 'working-pressure', pressureBar: 100.1, limitBar: 100 });
});

test('aggregates the highest limit exceedance per source and step', async () => {
  const helpers = await pressureLimitApiForRedTest();
  const cylinder = { workingPressureBar: 100, hotOverfillPercent: 2 };
  const warnings = helpers?.collectCylinderPressureWarnings?.({
    cylinder,
    observations: [
      { pressureBar: 102.1, isTransientHot: true, source: 'transfer', stepIdentifier: 'Transfer 2' },
      { pressureBar: 103, isTransientHot: true, source: 'transfer', stepIdentifier: 'Transfer 2' },
      { pressureBar: 100.1, isTransientHot: false, source: 'settled', stepIdentifier: null }
    ]
  });
  assert.equal(warnings?.length, 2);
  assert.ok(warnings?.some(warning => warning.kind === 'hot-overfill'
    && warning.pressureBar === 103
    && warning.limitBar === 102
    && warning.source === 'transfer'
    && warning.stepIdentifier === 'Transfer 2'));
  assert.ok(warnings?.some(warning => warning.kind === 'working-pressure'
    && warning.pressureBar === 100.1
    && warning.limitBar === 100
    && warning.source === 'settled'
    && warning.stepIdentifier === null));
});

test('classifies thermal samples by target-wait endpoint rather than matching temperature', async () => {
  const helpers = await pressureLimitApiForRedTest();
  const cylinder = { workingPressureBar: 100, hotOverfillPercent: 5 };
  const protocolSteps = [
    {
      type: 'wait',
      title: 'Wait to 24 °C',
      waitMode: 'target',
      targetTemperatureC: 24,
      thermal: {
        durationMinutes: 0,
        waitMinutes: 5,
        rateSource: 'none',
        pressureStartBar: 90,
        temperatureStartC: 20,
        pressureAtTransferEndAmbientBar: 90,
        pressureAtTransferEndHotBar: 90,
        temperatureAtTransferEndC: 20,
        pressureAfterWaitBar: 90,
        temperatureAfterWaitC: 24,
        samples: [
          { elapsedMinutes: 0, pressureBar: 90, projectedPressureBar: 90, temperatureC: 20 },
          { elapsedMinutes: 5, pressureBar: 90, projectedPressureBar: 90, temperatureC: 24 }
        ]
      }
    },
    {
      type: 'boost',
      title: 'Transfer from the target state',
      thermal: {
        durationMinutes: 2,
        waitMinutes: 0,
        rateSource: 'booster',
        pressureStartBar: 90,
        temperatureStartC: 24,
        pressureAtTransferEndAmbientBar: 99,
        pressureAtTransferEndHotBar: 103,
        temperatureAtTransferEndC: 30,
        pressureAfterWaitBar: 103,
        temperatureAfterWaitC: 30,
        samples: [
          { elapsedMinutes: 0, pressureBar: 90, projectedPressureBar: 90, temperatureC: 24 },
          { elapsedMinutes: 1, pressureBar: 101.5, projectedPressureBar: 101.5, temperatureC: 24 },
          { elapsedMinutes: 2, pressureBar: 103, projectedPressureBar: 103, temperatureC: 30 }
        ]
      }
    },
    {
      type: 'wait',
      title: 'Wait to 22 °C',
      waitMode: 'target',
      targetTemperatureC: 22,
      thermal: {
        durationMinutes: 0,
        waitMinutes: 5,
        rateSource: 'none',
        pressureStartBar: 103,
        temperatureStartC: 30,
        pressureAtTransferEndAmbientBar: 99,
        pressureAtTransferEndHotBar: 103,
        temperatureAtTransferEndC: 30,
        pressureAfterWaitBar: 99.5,
        temperatureAfterWaitC: 21,
        samples: [
          { elapsedMinutes: 0, pressureBar: 103, projectedPressureBar: 103, temperatureC: 30 },
          { elapsedMinutes: 1, pressureBar: 101.5, projectedPressureBar: 101.5, temperatureC: 24 },
          { elapsedMinutes: 3, pressureBar: 101, projectedPressureBar: 101, temperatureC: 22 },
          { elapsedMinutes: 5, pressureBar: 99.5, projectedPressureBar: 99.5, temperatureC: 21 }
        ]
      }
    }
  ];
  const observations = helpers?.collectThermalPressureWarningObservations?.({
    protocolSteps,
    ambientTemperatureC: 20
  });

  assert.ok(Array.isArray(observations));
  assert.deepEqual(helpers.collectCylinderPressureWarnings({ cylinder, observations }), []);
});

test('thermal pressure notices classify target states by endpoint phase', async () => {
  const helpers = await pressureLimitApiForRedTest();
  const cylinder = { workingPressureBar: 100, hotOverfillPercent: 5 };
  const protocolSteps = [
    {
      type: 'wait',
      title: 'Wait to 24 °C',
      waitMode: 'target',
      targetTemperatureC: 24,
      thermal: {
        durationMinutes: 0,
        waitMinutes: 5,
        rateSource: 'none',
        pressureStartBar: 90,
        temperatureStartC: 20,
        pressureAtTransferEndAmbientBar: 90,
        pressureAtTransferEndHotBar: 90,
        temperatureAtTransferEndC: 20,
        pressureAfterWaitBar: 90,
        temperatureAfterWaitC: 24,
        samples: [
          { elapsedMinutes: 0, pressureBar: 90, projectedPressureBar: 90, temperatureC: 20 },
          { elapsedMinutes: 5, pressureBar: 90, projectedPressureBar: 90, temperatureC: 24 }
        ]
      }
    },
    {
      type: 'boost',
      title: 'Transfer from the target state',
      thermal: {
        durationMinutes: 2,
        waitMinutes: 0,
        rateSource: 'booster',
        pressureStartBar: 90,
        temperatureStartC: 24,
        pressureAtTransferEndAmbientBar: 99,
        pressureAtTransferEndHotBar: 103,
        temperatureAtTransferEndC: 30,
        pressureAfterWaitBar: 103,
        temperatureAfterWaitC: 30,
        samples: [
          { elapsedMinutes: 0, pressureBar: 90, projectedPressureBar: 90, temperatureC: 24 },
          { elapsedMinutes: 1, pressureBar: 101.5, projectedPressureBar: 101.5, temperatureC: 24 },
          { elapsedMinutes: 2, pressureBar: 103, projectedPressureBar: 103, temperatureC: 30 }
        ]
      }
    },
    {
      type: 'wait',
      title: 'Wait to 22 °C',
      waitMode: 'target',
      targetTemperatureC: 22,
      thermal: {
        durationMinutes: 0,
        waitMinutes: 5,
        rateSource: 'none',
        pressureStartBar: 103,
        temperatureStartC: 30,
        pressureAtTransferEndAmbientBar: 99,
        pressureAtTransferEndHotBar: 103,
        temperatureAtTransferEndC: 30,
        pressureAfterWaitBar: 99.5,
        temperatureAfterWaitC: 21,
        samples: [
          { elapsedMinutes: 0, pressureBar: 103, projectedPressureBar: 103, temperatureC: 30 },
          { elapsedMinutes: 1, pressureBar: 101.5, projectedPressureBar: 101.5, temperatureC: 24 },
          { elapsedMinutes: 3, pressureBar: 101, projectedPressureBar: 101, temperatureC: 22 },
          { elapsedMinutes: 5, pressureBar: 99.5, projectedPressureBar: 99.5, temperatureC: 21 }
        ]
      }
    }
  ];

  assert.equal(typeof helpers?.collectThermalPressureWarningObservations, 'function');
  const observations = helpers.collectThermalPressureWarningObservations({
    protocolSteps,
    ambientTemperatureC: 20
  });
  assert.deepEqual(helpers.collectCylinderPressureWarnings({ cylinder, observations }), []);
  const endpointSteps = protocolSteps.map(step => ({
    ...step,
    thermal: {
      ...step.thermal,
      samples: step.thermal.samples.map(sample => ({ ...sample }))
    }
  }));
  const endpoint = endpointSteps.at(-1).thermal;
  endpoint.pressureAfterWaitBar = 101.5;
  endpoint.temperatureAfterWaitC = 22;
  Object.assign(endpoint.samples.at(-1), {
    pressureBar: 101.5,
    projectedPressureBar: 101.5
  });
  const endpointWarnings = helpers.collectCylinderPressureWarnings({
    cylinder,
    observations: helpers.collectThermalPressureWarningObservations({
      protocolSteps: endpointSteps,
      ambientTemperatureC: 20
    })
  });
  assert.deepEqual(endpointWarnings, [{
    kind: 'working-pressure',
    pressureBar: 101.5,
    limitBar: 100,
    source: 'settled',
    stepIdentifier: 'Wait to 22 °C'
  }]);

});
