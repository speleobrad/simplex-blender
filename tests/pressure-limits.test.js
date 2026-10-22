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
