import test from 'node:test';
import assert from 'node:assert/strict';
import { optimizeBlend } from '../js/optimizer.js';
import { planWithReadings } from '../js/plan-with-readings.js';
import { DEFAULT_BANKS } from '../js/bank-storage.js';
import { DEFAULT_SETTINGS } from '../js/settings.js';

// Default page recipe: 45 bar Air at 21 °C to 195 bar 18/45 with the default banks.
const input = {
  cylinder: {
    volumeL: 11.1, initialPressureBar: 45, targetPressureBar: 195,
    initialOxygenPercent: 21, initialHeliumPercent: 0,
    targetOxygenPercent: 18, targetHeliumPercent: 45,
    workingPressureBar: 207, hotOverfillPercent: 2
  },
  physics: { model: 'vdw', temperatureC: 21 },
  banks: DEFAULT_BANKS.map(bank => ({ ...bank })),
  thermal: {
    tankMaterial: 'aluminum', coolingMedium: 'air', ambientTemperatureC: 21, inletTemperatureC: 25,
    targetMediumTemperatureC: 21, targetInWaterTemperatureC: 10,
    waitMode: 'minutes', waitMinutes: 5, interimMeasurements: []
  },
  settings: DEFAULT_SETTINGS
};

const withReadings = readings => ({
  ...input,
  thermal: { ...input.thermal, interimMeasurements: Object.assign([], readings) }
});
const stepAt = (plan, index) => plan.protocolSteps.find(step => step._measurementIndex === index);
const titles = plan => plan.protocolSteps.map(step => `${step._measurementIndex}:${step.title}`);

const base = optimizeBlend(input);
const scrapIndex = base.protocolSteps.find(step => step.sourceBankId === 'bank-sample-scrap')._measurementIndex;
const plannedScrapStart = stepAt(base, scrapIndex).thermal;

// Transfer steps are numbered by their transfer count, not their logical index. Salvage
// and drain steps carry no number and no transfer.
function assertNumbersFollowIndices(plan) {
  let transfers = 0;
  for (const step of plan.protocolSteps) {
    if (!step.sourceBankId) continue;
    transfers += 1;
    const match = /^Step (\d+)/.exec(step.title ?? '');
    if (match) {
      assert.equal(Number(match[1]), transfers, `${step.title} is transfer ${transfers}`);
    }
  }
}

test('a plan without readings is the optimizer plan', () => {
  assert.deepEqual(titles(planWithReadings(input)), titles(base));
});

test('a reading at the planned state reproduces the original recipe, thermal states and blend summary', () => {
  const plan = planWithReadings(withReadings({
    [scrapIndex]: { pressureBar: plannedScrapStart.plannedStartPressureBar, temperatureC: plannedScrapStart.plannedStartTemperatureC }
  }));
  assert.equal(plan.interimReadings.error, null);
  assert.deepEqual(titles(plan), titles(base));
  plan.protocolSteps.forEach((step, position) => {
    const expected = base.protocolSteps[position].thermal;
    for (const key of ['pressureStartBar', 'temperatureStartC', 'pressureAtTransferEndBar', 'pressureAfterWaitBar', 'temperatureAfterWaitC']) {
      assert.ok(Math.abs(step.thermal[key] - expected[key]) < 1e-6, `${step.title} ${key}`);
    }
  });
  for (const [key, value] of Object.entries(base.blend)) {
    assert.ok(Math.abs(plan.blend[key] - value) < 1e-6, `blend.${key} ${plan.blend[key]} vs ${value}`);
  }
  for (const key of ['finalAmbientPressureBar', 'finalInWaterPressureBar', 'finalTransferEndPressureBar']) {
    assert.ok(Math.abs(plan.thermal[key] - base.thermal[key]) < 1e-6, key);
  }
});

test('a lower reading re-plans the rest of the recipe to the same target, keeping the planned start visible', () => {
  const plan = planWithReadings(withReadings({ [scrapIndex]: { pressureBar: 54, temperatureC: 22 } }));
  assert.equal(plan.feasible, true);
  assert.equal(plan.interimReadings.error, null);
  assert.ok(plan.protocolSteps.length > base.protocolSteps.length, 'the missing oxygen adds a step');
  const first = stepAt(plan, scrapIndex).thermal;
  assert.equal(first.pressureStartBar, 54);
  assert.equal(first.temperatureStartC, 22);
  assert.ok(Math.abs(first.plannedStartPressureBar - plannedScrapStart.plannedStartPressureBar) < 1e-6);
  assert.ok(Math.abs(first.plannedStartTemperatureC - plannedScrapStart.plannedStartTemperatureC) < 1e-6);
  assertNumbersFollowIndices(plan);
  assert.ok(Math.abs(plan.blend.finalOxygenPercent - 18) < 1e-6);
  assert.ok(Math.abs(plan.blend.finalHeliumPercent - 45) < 1e-6);
  assert.ok(Math.abs(plan.thermal.finalInWaterPressureBar - 195) < 1e-3, `in-water ${plan.thermal.finalInWaterPressureBar}`);
  const trajectoryEnd = plan.trajectory.at(-1);
  assert.ok(Math.abs(trajectoryEnd.oxygenPercent - 18) < 0.1 && Math.abs(trajectoryEnd.heliumPercent - 45) < 0.1);
});

test('a reading above the plan that needs venting is a normal step with exact vent accounting', () => {
  const plan = planWithReadings(withReadings({ [scrapIndex]: { pressureBar: 57, temperatureC: 22 } }));
  assert.equal(plan.feasible, true);
  const drain = stepAt(plan, scrapIndex);
  assert.equal(drain.type, 'drain');
  assertNumbersFollowIndices(plan);
  assert.ok(plan.blend.ventedMoles > 0);
  assert.ok(plan.blend.retainedPercent < 100 && plan.blend.retainedPercent > 80);
  assert.ok(Math.abs(plan.thermal.finalInWaterPressureBar - 195) < 1e-3);
});

test('a reading that implies no gas was added keeps the original recipe and reports why', () => {
  const plan = planWithReadings(withReadings({ [scrapIndex]: { pressureBar: 40, temperatureC: 21 } }));
  assert.match(plan.interimReadings.error, /cannot be derived/);
  assert.deepEqual(titles(plan), titles(base));
});

test('later readings chain on the re-planned recipe and every recompute keeps index to step mapping stable', () => {
  const first = { [scrapIndex]: { pressureBar: 54, temperatureC: 22 } };
  const afterFirst = planWithReadings(withReadings(first));
  const laterIndex = afterFirst.protocolSteps.at(-2)._measurementIndex;
  const laterPlanned = stepAt(afterFirst, laterIndex).thermal;
  const both = { ...first, [laterIndex]: {
    pressureBar: laterPlanned.plannedStartPressureBar - 2,
    temperatureC: laterPlanned.plannedStartTemperatureC + 0.3
  } };
  const afterBoth = planWithReadings(withReadings(both));
  assert.equal(afterBoth.interimReadings.error, null);
  assert.equal(afterBoth.interimReadings.count, 2);
  assertNumbersFollowIndices(afterBoth);

  // Steps before the later reading are exactly the recipe with only the first reading.
  const beforeLater = plan => plan.protocolSteps.filter(step => (step._measurementIndex ?? -1) < laterIndex);
  assert.deepEqual(beforeLater(afterBoth).map(step => step.title), beforeLater(afterFirst).map(step => step.title));
  assert.equal(stepAt(afterBoth, laterIndex).thermal.pressureStartBar, laterPlanned.plannedStartPressureBar - 2);
  assert.equal(stepAt(afterBoth, scrapIndex).thermal.pressureStartBar, 54);

  // Clearing in order returns to the earlier recipes exactly.
  assert.deepEqual(titles(planWithReadings(withReadings(first))), titles(afterFirst));
  assert.deepEqual(titles(planWithReadings(withReadings([]))), titles(base));
});

test('a later reading at the exact planned state of the re-planned recipe leaves the recipe unchanged', () => {
  const first = { [scrapIndex]: { pressureBar: 54, temperatureC: 22 } };
  const afterFirst = planWithReadings(withReadings(first));
  for (const index of [scrapIndex + 1, scrapIndex + 2]) {
    const planned = stepAt(afterFirst, index).thermal;
    const again = planWithReadings(withReadings({
      ...first,
      [index]: { pressureBar: planned.plannedStartPressureBar, temperatureC: planned.plannedStartTemperatureC }
    }));
    assert.equal(again.interimReadings.error, null);
    assert.deepEqual(titles(again), titles(afterFirst), `reading at step ${index}`);
  }
});

test('recalculating from a reading keeps vented helium as the helium share of the vented original mix', () => {
  const heliumStart = {
    ...input,
    cylinder: { ...input.cylinder, initialPressureBar: 100, initialOxygenPercent: 40, initialHeliumPercent: 20 }
  };
  const planned = optimizeBlend(heliumStart);
  assert.ok(planned.blend.ventedGasLitres > 100);
  const transfer = planned.protocolSteps.find(step => step.sourceBankId && step.thermal);
  const plan = planWithReadings({
    ...heliumStart,
    thermal: {
      ...heliumStart.thermal,
      interimMeasurements: Object.assign([], {
        [transfer._measurementIndex]: {
          pressureBar: transfer.thermal.plannedStartPressureBar,
          temperatureC: transfer.thermal.plannedStartTemperatureC
        }
      })
    }
  });
  assert.equal(plan.interimReadings.error, null);
  assert.ok(Math.abs(plan.blend.heliumVentedLitres - planned.blend.heliumVentedLitres) < 1e-6);
  assert.ok(Math.abs(plan.blend.heliumVentedLitres - plan.blend.ventedGasLitres * 0.2) < 1e-6);
});

test('merged plans keep one operation id per operation and consumed moles on every transfer', () => {
  const plan = planWithReadings(withReadings({ [scrapIndex]: { pressureBar: 54, temperatureC: 22 } }));
  const transfers = plan.protocolSteps.filter(s => s.costOperationId);
  const logical = transfers.filter(s => !/safe stage/.test(s.title ?? ''));
  assert.equal(new Set(logical.map(s => s.costOperationId)).size, logical.length);
  for (const step of transfers) assert.ok(Number.isFinite(step.sourceConsumedMoles));
});

test('a second chained reading never collides', () => {
  const first = { [scrapIndex]: { pressureBar: 54, temperatureC: 22 } };
  const afterFirst = planWithReadings(withReadings(first));
  const laterIndex = afterFirst.protocolSteps.at(-2)._measurementIndex;
  const laterPlanned = stepAt(afterFirst, laterIndex).thermal;
  const both = { ...first, [laterIndex]: {
    pressureBar: laterPlanned.plannedStartPressureBar - 2,
    temperatureC: laterPlanned.plannedStartTemperatureC + 0.3
  } };
  const afterBoth = planWithReadings(withReadings(both));
  assert.equal(afterBoth.interimReadings.error, null);
  assert.equal(afterBoth.interimReadings.count, 2);
  assertNumbersFollowIndices(afterBoth);

  // Steps before the later reading are exactly the recipe with only the first reading.
  const beforeLater = plan => plan.protocolSteps.filter(step => (step._measurementIndex ?? -1) < laterIndex);
  assert.deepEqual(beforeLater(afterBoth).map(step => step.title), beforeLater(afterFirst).map(step => step.title));
  assert.equal(stepAt(afterBoth, laterIndex).thermal.pressureStartBar, laterPlanned.plannedStartPressureBar - 2);
  assert.equal(stepAt(afterBoth, scrapIndex).thermal.pressureStartBar, 54);

  const logical = afterBoth.protocolSteps.filter(s => s.costOperationId && !/safe stage/.test(s.title ?? ''));
  assert.equal(new Set(logical.map(s => s.costOperationId)).size, logical.length);
  for (const step of afterBoth.protocolSteps.filter(s => s.costOperationId)) {
    assert.ok(Number.isFinite(step.sourceConsumedMoles));
  }
});

test('a reading after the scrap boost splits its operations into distinct prefix and suffix ids', () => {
  const transferIndices = base.protocolSteps.filter(s => s.sourceBankId).map(s => s._measurementIndex);
  const index = transferIndices[transferIndices.indexOf(scrapIndex) + 1];
  const planned = stepAt(base, index).thermal;
  const plan = planWithReadings(withReadings({ [index]: {
    pressureBar: planned.plannedStartPressureBar - 2,
    temperatureC: planned.plannedStartTemperatureC + 0.3
  } }));
  assert.equal(plan.interimReadings.error, null);

  // The re-solved scrap boost keeps its own operation.
  assert.equal(stepAt(plan, scrapIndex).costOperationId, 'op-2');
  assert.equal(stepAt(plan, scrapIndex).costOperation, 'boost');
  assert.ok(Number.isFinite(stepAt(plan, scrapIndex).sourceConsumedMoles));

  const transfers = plan.protocolSteps.filter(s => s.costOperationId && !/safe stage/.test(s.title ?? ''));
  const prefix = transfers.filter(s => s._measurementIndex < index);
  const suffix = transfers.filter(s => s._measurementIndex >= index);
  assert.ok(prefix.length > 0 && suffix.length > 0);
  for (const step of prefix) assert.match(step.costOperationId, /^op-\d+$/);
  for (const step of suffix) assert.match(step.costOperationId, new RegExp(`^r${index}-op-\\d+$`));
  assert.equal(new Set(transfers.map(s => s.costOperationId)).size, transfers.length);
  for (const step of plan.protocolSteps.filter(s => s.costOperationId)) {
    assert.ok(Number.isFinite(step.sourceConsumedMoles));
  }
});

test('a fallback plan keeps unique operation ids and finite consumed moles on every transfer', () => {
  const plan = planWithReadings(withReadings({ [scrapIndex]: { pressureBar: 40, temperatureC: 21 } }));
  assert.match(plan.interimReadings.error, /cannot be derived/);
  const transfers = plan.protocolSteps.filter(s => s.costOperationId && !/safe stage/.test(s.title ?? ''));
  assert.equal(new Set(transfers.map(s => s.costOperationId)).size, transfers.length);
  for (const step of plan.protocolSteps.filter(s => s.costOperationId)) {
    assert.ok(Number.isFinite(step.sourceConsumedMoles));
  }
});

test('a reading-based Air-start plan has finite zero retained helium, so reuse value is 0 without a helium price', async () => {
  const { computeSavings } = await import('../js/savings.js');
  const { computeFillCost } = await import('../js/cost.js');
  const costs = { currencySymbol: '', leftoverDiscountPercent: 0, operationPrices: { boost: 1, decant: 1, topUp: 1 } };
  const plan = planWithReadings(withReadings({ [scrapIndex]: { pressureBar: plannedScrapStart.plannedStartPressureBar, temperatureC: plannedScrapStart.plannedStartTemperatureC } }));
  assert.ok(Number.isFinite(plan.blend.heliumRetainedLitres) && plan.blend.heliumRetainedLitres >= 0);
  const cost = computeFillCost({ steps: plan.protocolSteps, banks: input.banks, costs, temperatureC: 21 });
  assert.ok(Number.isFinite(cost.total));
  const savings = computeSavings({
    result: plan, banks: input.banks, costs, settings: input.settings,
    physics: input.physics, inventoryTemperatureC: 21
  });
  assert.equal(savings.savedCost, 0);
  assert.ok(!savings.missing.some(entry => entry.code === 'pure-price' && entry.gas === 'helium'));
});
// Salvage fixture: the drained gas goes into Leftover N first, then the recipe decants
// Pure Oxygen and Pure Helium. Interim readings can land on those decants.
const salvageInput = {
  cylinder: {
    volumeL: 12, initialPressureBar: 150, initialOxygenPercent: 32, initialHeliumPercent: 0,
    targetPressureBar: 100, targetOxygenPercent: 21, targetHeliumPercent: 35
  },
  physics: { model: 'vdw', temperatureC: 20 },
  banks: [
    { id: 'bank-he', name: 'Pure Helium', volumeL: 50, pressureBar: 200, maxPressureBar: 350, minimumPressureBar: 15, oxygenPercent: 0, heliumPercent: 100, enabled: true },
    { id: 'bank-o2', name: 'Pure Oxygen', volumeL: 40, pressureBar: 180, maxPressureBar: 350, minimumPressureBar: 10, oxygenPercent: 100, heliumPercent: 0, enabled: true },
    { id: 'bank-n', name: 'Leftover N', volumeL: 50, pressureBar: 20, maxPressureBar: 200, minimumPressureBar: 10, oxygenPercent: 32, heliumPercent: 0, enabled: true }
  ],
  thermal: {
    tankMaterial: 'steel', coolingMedium: 'air', ambientTemperatureC: 20, inletTemperatureC: 40,
    targetMediumTemperatureC: 20, targetInWaterTemperatureC: 20, waitMode: 'minutes', waitMinutes: 0,
    interimMeasurements: []
  },
  settings: { booster: { maxCompressorPressureBar: 350, maxBoosterOutputPressureBar: 350 } }
};
const salvageBase = optimizeBlend(salvageInput);
const salvageSteps = plan => plan.protocolSteps.filter(step => step.type === 'salvage');

test('a re-plan keeps the base plan salvage step first, with the same receiver and moved helium', () => {
  assert.equal(salvageBase.salvageTransfers.length, 1);
  const replanned = planWithReadings({
    ...salvageInput,
    thermal: { ...salvageInput.thermal, interimMeasurements: Object.assign([], { 1: { pressureBar: 40, temperatureC: 20 } }) }
  });
  assert.equal(replanned.interimReadings.error, null);
  assert.equal(replanned.protocolSteps[0].type, 'salvage');
  assert.equal(replanned.protocolSteps[0].receiverBankId, salvageBase.protocolSteps[0].receiverBankId);
  assert.equal(replanned.protocolSteps[0].movedMoles, salvageBase.protocolSteps[0].movedMoles);
});

test('a re-plan starts its bank inventory from the post-salvage banks, not the banks before salvage', () => {
  const replanned = planWithReadings({
    ...salvageInput,
    thermal: { ...salvageInput.thermal, interimMeasurements: Object.assign([], { 1: { pressureBar: 40, temperatureC: 20 } }) }
  });
  const seeded = replanned.readingPlan.segments[0].banks.find(bank => bank.id === 'bank-n');
  const salvaged = salvageBase.salvageBanks.find(bank => bank.id === 'bank-n');
  assert.ok(Math.abs(seeded.pressureBar - salvaged.pressureBar) < 1e-6,
    `seeded ${seeded.pressureBar} bar, expected post-salvage ${salvaged.pressureBar} bar`);
});

test('a re-plan never salvages a second time', () => {
  const replanned = planWithReadings({
    ...salvageInput,
    thermal: { ...salvageInput.thermal, interimMeasurements: Object.assign([], { 1: { pressureBar: 40, temperatureC: 20 } }) }
  });
  assert.equal(salvageSteps(replanned).length, 1);
});

// Salvage plus drain: the drain's end state is the reading after it. A reading at the
// planned state must reproduce the recipe, so the vent, trajectory and titles of the base.
const drainFixture = {
  cylinder: {
    volumeL: 12, initialPressureBar: 150, initialOxygenPercent: 21, initialHeliumPercent: 35,
    targetPressureBar: 200, targetOxygenPercent: 15, targetHeliumPercent: 55
  },
  physics: { model: 'vdw', temperatureC: 20 },
  banks: [
    { id: 'bank-he', name: 'Pure Helium', volumeL: 50, pressureBar: 200, maxPressureBar: 350, minimumPressureBar: 15, oxygenPercent: 0, heliumPercent: 100, enabled: true },
    { id: 'bank-o2', name: 'Pure Oxygen', volumeL: 40, pressureBar: 180, maxPressureBar: 350, minimumPressureBar: 10, oxygenPercent: 100, heliumPercent: 0, enabled: true },
    { id: 'bank-n', name: 'Leftover N', volumeL: 10, pressureBar: 20, maxPressureBar: 30, minimumPressureBar: 10, oxygenPercent: 32, heliumPercent: 0, enabled: true }
  ],
  thermal: {
    tankMaterial: 'steel', coolingMedium: 'air', ambientTemperatureC: 20, inletTemperatureC: 40,
    targetMediumTemperatureC: 20, targetInWaterTemperatureC: 20, waitMode: 'minutes', waitMinutes: 0,
    interimMeasurements: []
  },
  settings: { booster: { maxCompressorPressureBar: 350, maxBoosterOutputPressureBar: 350 } }
};
const drainBase = optimizeBlend(drainFixture);
const drainStep = drainBase.protocolSteps.find(step => step.type === 'drain');

test('a reading at the drain end reproduces the vented pressure, vented gas and retained share of the base', () => {
  assert.equal(drainBase.protocolSteps[0].type, 'salvage');
  assert.equal(drainStep._measurementIndex, 1);
  // The reading after the drain (index 2) is the drain's end state.
  const drainEnd = drainStep.thermal;
  const plan = planWithReadings({
    ...drainFixture,
    thermal: {
      ...drainFixture.thermal,
      interimMeasurements: Object.assign([], {
        2: { pressureBar: drainEnd.pressureAtTransferEndBar, temperatureC: drainEnd.temperatureAtTransferEndC }
      })
    }
  });
  assert.equal(plan.interimReadings.error, null);
  for (const key of ['retainedPercent', 'ventedPressureBar', 'ventedGasLitres', 'heliumVentedLitres', 'heliumSalvagedLitres']) {
    assert.ok(Math.abs(plan.blend[key] - drainBase.blend[key]) < 1e-6,
      `blend.${key} ${plan.blend[key]} vs base ${drainBase.blend[key]}`);
  }
});

test('a reading after salvage and drain keeps the trajectory to one point per transfer and numbers titles by transfer', () => {
  const drainEnd = drainBase.protocolSteps[1].thermal;
  const plan = planWithReadings({
    ...drainFixture,
    thermal: {
      ...drainFixture.thermal,
      interimMeasurements: Object.assign([], {
        2: { pressureBar: drainEnd.pressureAtTransferEndBar, temperatureC: drainEnd.temperatureAtTransferEndC }
      })
    }
  });
  const transfers = drainBase.protocolSteps.filter(step => step.sourceBankId).length;
  assert.equal(plan.trajectory.length, transfers + 1);
  assert.deepEqual(plan.trajectory.map(point => point.label), drainBase.trajectory.map(point => point.label));
  assert.deepEqual(
    plan.protocolSteps.map(step => step.title),
    drainBase.protocolSteps.map(step => step.title)
  );
});

test('a reading after a full salvage has no vented pressure, like the base plan', () => {
  const salvaged = optimizeBlend(salvageInput);
  assert.equal(salvaged.blend.ventedPressureBar, 0);
  const plan = planWithReadings({
    ...salvageInput,
    thermal: { ...salvageInput.thermal, interimMeasurements: Object.assign([], { 1: { pressureBar: 40, temperatureC: 20 } }) }
  });
  assert.equal(plan.blend.ventedPressureBar, 0);
  assert.equal(plan.blend.ventedGasLitres, 0);
});

test('a re-plan carries the salvage transfers and the post-salvage banks', () => {
  const replanned = planWithReadings({
    ...salvageInput,
    thermal: { ...salvageInput.thermal, interimMeasurements: Object.assign([], { 1: { pressureBar: 40, temperatureC: 20 } }) }
  });
  assert.deepEqual(replanned.salvageTransfers, salvageBase.salvageTransfers);
  assert.deepEqual(replanned.salvageBanks, salvageBase.salvageBanks);
});
