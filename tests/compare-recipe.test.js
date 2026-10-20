import test from 'node:test';
import assert from 'node:assert/strict';
import * as compareRecipe from '../js/compare-recipe.js';
import { calcMolarDensity } from '../js/physics.js';

const {
  buildCompareProtocol,
  createCompareRow,
  validateCompareRecipe
} = compareRecipe;

const cylinder = {
  volumeL: 12,
  workingPressureBar: 232,
  initialPressureBar: 50,
  initialOxygenPercent: 21,
  initialHeliumPercent: 0
};
const physics = { model: 'ideal', temperatureC: 20 };
const settings = {
  booster: {
    minimumSourcePressureBar: 5,
    maxCompressorPressureBar: 232,
    compressorInletFlowLPerMin: 100,
    compressorTemperatureModifierC: 5,
    maxBoosterOutputPressureBar: 300,
    oxygenDecantRateBarPerMin: 5,
    otherDecantRateBarPerMin: 10,
    oxygenBoostBpm: 35,
    otherBoostBpm: 50
  }
};
const banks = [
  {
    id: 'he-bank',
    name: 'Helium supply',
    volumeL: 40,
    pressureBar: 200,
    oxygenPercent: 0,
    heliumPercent: 100,
    enabled: true
  },
  {
    id: 'disabled-o2',
    name: 'Disabled oxygen',
    volumeL: 40,
    pressureBar: 200,
    oxygenPercent: 100,
    heliumPercent: 0,
    enabled: false
  }
];

test('accepts unlimited compressor Air without a supply-bank record', () => {
  const result = validateCompareRecipe([{
    id: 'air',
    type: 'add',
    bankId: 'compressor-air',
    pressureAddedBar: 150,
    targetPressureBar: 200,
    pressureInputMode: 'target'
  }], { cylinder, banks, physics, settings });

  assert.equal(result.valid, true);
  assert.deepEqual(result.normalizedRows[0].sourceBank, {
    id: 'compressor-air',
    name: 'Compressor Air',
    volumeL: 1,
    pressureBar: 232,
    oxygenPercent: 21,
    heliumPercent: 0,
    enabled: true,
    isCompressor: true
  });

  const protocol = buildCompareProtocol(result.normalizedRows, {
    cylinder, banks, physics, settings
  });
  assert.deepEqual(protocol.protocolSteps.map(step => [step.type, step.method, step.operation]), [
    ['add', 'compressor', 'Top-up']
  ]);
  assert.equal(protocol.protocolSteps[0].sourceBankId, 'compressor-air');
  assert.equal(protocol.protocolSteps[0].sourceEndPressureBar, null);
  assert.equal(banks.length, 2);
});

test('creates independent keep rows', () => {
  const first = createCompareRow('keep', 'row-1');
  const second = createCompareRow('keep', 'row-2');
  assert.deepEqual(first, { id: 'row-1', type: 'keep' });
  assert.notEqual(first, second);
});

test('creates a bank-backed add row and target-state wait row', () => {
  assert.deepEqual(createCompareRow('add', 'row-1'), {
    id: 'row-1',
    type: 'add',
    bankId: null,
    pressureAddedBar: 0,
    targetPressureBar: 0,
    pressureInputMode: 'added'
  });
  assert.deepEqual(createCompareRow('wait', 'row-2'), {
    id: 'row-2',
    type: 'wait',
    waitMode: 'minutes',
    waitMinutes: 0,
    targetTemperatureC: null
  });
});

test('rejects an add row that does not select an enabled supply bank', () => {
  const result = validateCompareRecipe([{
    id: 'add',
    type: 'add',
    bankId: 'missing',
    pressureAddedBar: 50,
    targetPressureBar: 100,
    pressureInputMode: 'added'
  }], { cylinder, banks, physics, settings });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some(error => error.field === 'bankId'));
});

test('rejects disabled and duplicate supply bank IDs', () => {
  const disabled = validateCompareRecipe([{
    id: 'add',
    type: 'add',
    bankId: 'disabled-o2',
    pressureAddedBar: 50,
    targetPressureBar: 100,
    pressureInputMode: 'added'
  }], { cylinder, banks, physics, settings });
  assert.ok(disabled.errors.some(error => error.field === 'bankId'));

  const duplicateBanks = [...banks, { ...banks[0] }];
  const duplicate = validateCompareRecipe([{
    id: 'add',
    type: 'add',
    bankId: 'he-bank',
    pressureAddedBar: 50,
    targetPressureBar: 100,
    pressureInputMode: 'added'
  }], { cylinder, banks: duplicateBanks, physics, settings });
  assert.ok(duplicate.errors.some(error => error.field === 'bankId'));
});

test('synchronizes pressure-added and receiver-target values from the row start', () => {
  assert.equal(typeof compareRecipe.normalizeComparePressureFields, 'function');
  const result = compareRecipe.normalizeComparePressureFields({
    pressureAddedBar: 100,
    targetPressureBar: 150,
    pressureInputMode: 'target'
  }, 50);
  assert.deepEqual(result, {
    pressureAddedBar: 100,
    targetPressureBar: 150,
    pressureInputMode: 'target'
  });
});

test('normalizes an added-pressure row against the prior receiver state', () => {
  const result = validateCompareRecipe([{
    id: 'add',
    type: 'add',
    bankId: 'he-bank',
    pressureAddedBar: 50,
    targetPressureBar: 0,
    pressureInputMode: 'added'
  }], { cylinder, banks, physics, settings });
  assert.equal(result.valid, true);
  assert.equal(result.normalizedRows[0].targetPressureBar, 100);
  assert.equal(result.normalizedRows[0].pressureAddedBar, 50);
});

test('plans decant equalize and boost stages without mutating bank inventory', () => {
  const result = buildCompareProtocol([{
    id: 'add',
    type: 'add',
    bankId: 'he-bank',
    pressureAddedBar: 150,
    targetPressureBar: 200,
    pressureInputMode: 'target'
  }], { cylinder, physics, banks, settings });
  assert.deepEqual(result.protocolSteps.map(step => step.type), ['equalize', 'boost']);
  assert.ok(result.protocolSteps.every(step => step.compareRowId === 'add'));
  assert.ok(result.protocolSteps.every(step => step.sourceBankId === 'he-bank'));
  assert.ok(result.protocolSteps.every(step => Number.isFinite(step.sourceStartPressureBar)));
  assert.ok(result.protocolSteps.every(step => Number.isFinite(step.sourceEndPressureBar)));
  assert.ok(result.protocolSteps.at(-1).sourceEndPressureBar < result.protocolSteps[0].sourceStartPressureBar);
  assert.equal(banks[0].pressureBar, 200);
});

test('keeps wait and keep rows between planned transfer stages', () => {
  const result = buildCompareProtocol([
    { id: 'keep', type: 'keep' },
    { id: 'wait', type: 'wait', waitMode: 'minutes', waitMinutes: 5, targetPressureBar: null, targetTemperatureC: null },
    {
      id: 'add',
      type: 'add',
      bankId: 'he-bank',
      pressureAddedBar: 50,
      targetPressureBar: 100,
      pressureInputMode: 'added'
    }
  ], { cylinder, physics, banks, settings });
  assert.deepEqual(result.protocolSteps.map(step => step.type), ['keep', 'wait', 'decant']);
  assert.equal(result.protocolSteps[1].waitMinutes, 5);
});

test('rejects a finite bank that cannot supply the requested addition', () => {
  const smallBank = {
    id: 'small-he',
    name: 'Small helium',

    volumeL: 2,
    pressureBar: 20,
    oxygenPercent: 0,
    heliumPercent: 100,
    enabled: true
  };
  assert.throws(() => buildCompareProtocol([{
    id: 'add',
    type: 'add',
    bankId: 'small-he',
    pressureAddedBar: 170,
    targetPressureBar: 220,
    pressureInputMode: 'target'
  }], {
    cylinder,
    physics,
    banks: [smallBank],
    settings
  }), /supply bank/i);
});

test('plans an add after a wait from the modeled post-wait pressure', () => {
  const result = buildCompareProtocol([
    { id: 'wait', type: 'wait', waitMode: 'minutes', waitMinutes: 10 },
    {
      id: 'add',
      type: 'add',
      bankId: 'he-bank',
      pressureAddedBar: 0,
      targetPressureBar: 100,
      pressureInputMode: 'target'
    }
  ], {
    cylinder,
    physics,
    banks,
    settings,
    waitStates: { wait: { pressureBar: 45 } }
  });

  const add = result.protocolSteps.find(step => step.compareRowId === 'add');
  assert.equal(add.receiverStartPressureBar, 45);
});

test('uses the full modeled wait state when planning a following add', () => {
  const totalMoles = calcMolarDensity(45, 21, 0, 15, false) * cylinder.volumeL;
  const waitState = {
    pressureBar: 45,
    temperatureC: 15,
    oxygenPercent: 21,
    heliumPercent: 0,
    totalMoles,
    oxygenMoles: totalMoles * 0.21,
    heliumMoles: 0,
    mix: { oxygenPercent: 21, heliumPercent: 0 }
  };
  const rows = [
    { id: 'wait', type: 'wait', waitMode: 'minutes', waitMinutes: 10 },
    { id: 'add', type: 'add', bankId: 'he-bank', pressureAddedBar: 0, targetPressureBar: 100, pressureInputMode: 'target' }
  ];
  const partial = buildCompareProtocol(rows, {
    cylinder, physics, banks, settings, waitStates: { wait: { pressureBar: 45 } }
  });
  const full = buildCompareProtocol(rows, {
    cylinder, physics, banks, settings, waitStates: { wait: waitState }
  });

  const partialAdd = partial.protocolSteps.find(step => step.compareRowId === 'add');
  const fullAdd = full.protocolSteps.find(step => step.compareRowId === 'add');
  assert.ok(fullAdd.resultingMix.heliumPercent > partialAdd.resultingMix.heliumPercent);
});

test('consumes finite source moles at the modeled wait temperature for a following add', () => {
  const waitTemperatureC = 15;
  const totalMoles = calcMolarDensity(45, 21, 0, waitTemperatureC, false) * cylinder.volumeL;
  const result = buildCompareProtocol([
    { id: 'wait', type: 'wait', waitMode: 'minutes', waitMinutes: 10 },
    { id: 'add', type: 'add', bankId: 'he-bank', pressureAddedBar: 0, targetPressureBar: 100, pressureInputMode: 'target' }
  ], {
    cylinder,
    physics,
    banks,
    settings,
    waitStates: {
      wait: {
        pressureBar: 45,
        temperatureC: waitTemperatureC,
        totalMoles,
        oxygenMoles: totalMoles * 0.21,
        heliumMoles: 0,
        mix: { oxygenPercent: 21, heliumPercent: 0 }
      }
    }
  });

  const add = result.protocolSteps.find(step => step.compareRowId === 'add');
  const initialSourceMoles = calcMolarDensity(200, 0, 100, physics.temperatureC, false) * 40;
  const expectedAddedMoles = (
    calcMolarDensity(100, 0, 100, waitTemperatureC, false)
    - calcMolarDensity(45, 21, 0, waitTemperatureC, false)
  ) * cylinder.volumeL;
  assert.ok(Math.abs(add.sourceMolesAfter - (initialSourceMoles - expectedAddedMoles)) < 1e-9);
});

test('accepts a target-temperature wait without a target pressure', () => {
  const result = validateCompareRecipe([{
    id: 'wait',
    type: 'wait',
    waitMode: 'target',
    targetTemperatureC: 20
  }], { cylinder, banks, physics, settings });
  assert.equal(result.valid, true);
  assert.equal(result.errors.length, 0);
});

test('rejects pressure modes that would reduce receiver pressure or exceed the limit', () => {
  const result = validateCompareRecipe([{
    id: 'low',
    type: 'add',
    bankId: 'he-bank',
    pressureAddedBar: -1,
    targetPressureBar: 49,
    pressureInputMode: 'added'
  }, {
    id: 'high',
    type: 'add',
    bankId: 'he-bank',
    pressureAddedBar: 301,
    targetPressureBar: 351,
    pressureInputMode: 'added'
  }], { cylinder, banks, physics, settings });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some(error => error.rowId === 'low' && error.field === 'pressureAddedBar'));
  assert.ok(result.errors.some(error => error.rowId === 'high' && error.field === 'targetPressureBar'));
});

test('rejects an add target above the configured cylinder working pressure', () => {
  const result = validateCompareRecipe([{
    id: 'over-working-pressure',
    type: 'add',
    bankId: 'he-bank',
    pressureAddedBar: 183,
    targetPressureBar: 233,
    pressureInputMode: 'target'
  }], { cylinder, banks, physics, settings });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some(error => (
    error.rowId === 'over-working-pressure'
      && error.field === 'targetPressureBar'
      && /working pressure/i.test(error.message)
  )));
});

test('carries configured decant and booster rates on planned stages', () => {
  const result = buildCompareProtocol([{
    id: 'add',
    type: 'add',
    bankId: 'he-bank',
    pressureAddedBar: 150,
    targetPressureBar: 200,
    pressureInputMode: 'target'
  }], { cylinder, physics, banks, settings });
  const [equalize, boost] = result.protocolSteps;
  assert.deepEqual(equalize.transferRate, {
    source: 'decant',
    rateBarPerMin: 10,
    estimatedDurationMinutes: (equalize.receiverEndPressureBar - equalize.receiverStartPressureBar) / 10
  });
  assert.equal(boost.transferRate.source, 'booster');
  assert.equal(boost.transferRate.boosterBpm, 50);
  assert.equal(boost.transferRate.boosterCylinderVolumeCm3, 9);
  assert.ok(Number.isFinite(boost.transferRate.rateBarPerMin));
  assert.ok(Number.isFinite(boost.transferRate.estimatedDurationMinutes));
});

test('rejects a selected supply bank without a name', () => {
  const namelessBank = { ...banks[0], id: 'nameless', name: '' };
  const result = validateCompareRecipe([{
    id: 'add',
    type: 'add',
    bankId: 'nameless',
    pressureAddedBar: 50,
    targetPressureBar: 100,
    pressureInputMode: 'added'
  }], { cylinder, banks: [namelessBank], physics, settings });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some(error => error.field === 'bankId'));
});
