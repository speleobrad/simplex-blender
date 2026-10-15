import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCompareProtocol,
  createCompareRow,
  validateCompareRecipe
} from '../js/compare-recipe.js';

const cylinder = {
  volumeL: 12,
  workingPressureBar: 232,
  initialPressureBar: 50,
  initialOxygenPercent: 21,
  initialHeliumPercent: 0
};
const physics = { model: 'ideal', temperatureC: 20 };
const gasPresets = [
  { name: 'EAN32', oxygenPercent: 32, heliumPercent: 0 },
  { name: 'Trimix 18/45', oxygenPercent: 18, heliumPercent: 45 }
];

test('creates a keep row with independent state', async () => {
  const { createCompareRow: create } = await import('../js/compare-recipe.js');
  const first = create('keep', 'row-1');
  const second = create('keep', 'row-2');
  assert.deepEqual(first, { id: 'row-1', type: 'keep' });
  assert.notEqual(first, second);
});

test('validates ordered drain, add, and wait rows and normalizes preset gas', () => {
  const rows = [
    { id: 'keep', type: 'keep' },
    { id: 'drain', type: 'drain', targetPressureBar: 30 },
    {
      id: 'add', type: 'add',
      gas: { presetName: 'EAN32', name: '', oxygenPercent: 0, heliumPercent: 0 },
      targetPressureBar: 100, method: 'decant', sourcePressureBar: null
    },
    { id: 'wait', type: 'wait', waitMinutes: 7 }
  ];
  const result = validateCompareRecipe(rows, { cylinder, gasPresets });
  assert.equal(result.valid, true);
  assert.deepEqual(result.errors, []);
  assert.equal(result.normalizedRows[2].gas.name, 'EAN32');
  assert.equal(result.normalizedRows[2].gas.oxygenPercent, 32);
  assert.deepEqual(rows[2].gas, { presetName: 'EAN32', name: '', oxygenPercent: 0, heliumPercent: 0 });
});

test('calculates cumulative composition from an add-gas target pressure', () => {
  const result = buildCompareProtocol([
    { id: 'keep', type: 'keep' },
    {
      id: 'add', type: 'add',
      gas: { presetName: null, name: 'EAN32', oxygenPercent: 32, heliumPercent: 0 },
      targetPressureBar: 100, method: 'decant', sourcePressureBar: null
    }
  ], { cylinder, physics, gasPresets });
  const add = result.protocolSteps[1];
  assert.equal(add.receiverStartPressureBar, 50);
  assert.equal(add.receiverEndPressureBar, 100);
  assert.ok(add.resultingMix.oxygenPercent > 21);
  assert.equal(result.trajectory.length, 2);
});

test('rejects invalid rows with field-specific errors', () => {
  const cases = [
    {
      name: 'empty recipe', rows: [], rowId: null, field: 'recipe'
    },
    {
      name: 'invalid gas composition',
      rows: [{ id: 'gas', type: 'add', gas: { presetName: null, name: 'Bad', oxygenPercent: 60, heliumPercent: 50 }, targetPressureBar: 100, method: 'decant', sourcePressureBar: null }],
      rowId: 'gas', field: 'gas'
    },
    {
      name: 'add target below current pressure',
      rows: [{ id: 'add', type: 'add', gas: { presetName: null, name: 'Air', oxygenPercent: 21, heliumPercent: 0 }, targetPressureBar: 49, method: 'decant', sourcePressureBar: null }],
      rowId: 'add', field: 'targetPressureBar'
    },
    {
      name: 'drain target above current pressure',
      rows: [{ id: 'drain', type: 'drain', targetPressureBar: 51 }],
      rowId: 'drain', field: 'targetPressureBar'
    },
    {
      name: 'negative wait', rows: [{ id: 'wait', type: 'wait', waitMinutes: -1 }], rowId: 'wait', field: 'waitMinutes'
    },
    {
      name: 'boost without source pressure',
      rows: [{ id: 'boost', type: 'add', gas: { presetName: null, name: 'Air', oxygenPercent: 21, heliumPercent: 0 }, targetPressureBar: 100, method: 'boost', sourcePressureBar: null }],
      rowId: 'boost', field: 'sourcePressureBar'
    },
    {
      name: 'non-Air compressor',
      rows: [{ id: 'compressor', type: 'add', gas: { presetName: null, name: 'EAN32', oxygenPercent: 32, heliumPercent: 0 }, targetPressureBar: 100, method: 'compressor', sourcePressureBar: null }],
      rowId: 'compressor', field: 'gas'
    }
  ];

  for (const { name, rows, rowId, field } of cases) {
    const result = validateCompareRecipe(rows, { cylinder, gasPresets });
    assert.equal(result.valid, false, name);
    assert.ok(result.errors.some((error) => error.rowId === rowId && error.field === field), name);
  }
});
