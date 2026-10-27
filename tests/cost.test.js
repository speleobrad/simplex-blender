import test from 'node:test';
import assert from 'node:assert/strict';
import { computeFillCost, litresPerMole } from '../js/cost.js';

// Fixture fees are per operation: boost 2, decant 1, topUp 5.
const costs = () => ({
  currencySymbol: '', leftoverDiscountPercent: 0,
  operationPrices: { boost: 2, decant: 1, topUp: 5 }
});
const T = 20;
const perMole = litresPerMole(T);
const step = (over) => ({ sourceConsumedMoles: 1, costOperation: 'boost', costOperationId: 'op-1', sourceBankId: 'a', ...over });
const banks = [{ id: 'a', name: 'A', pricePerLitre: 0.01 }, { id: 'b', name: 'B' }];

test('gas lines use stored price and litres from consumed moles', () => {
  const cost = computeFillCost({ steps: [step({}), step({ costOperationId: 'op-2' })], banks, costs: costs(), temperatureC: T });
  const line = cost.gasLines.find(l => l.sourceBankId === 'a');
  assert.ok(Math.abs(line.litres - 2 * perMole) < 1e-9);
  assert.ok(Math.abs(line.cost - 2 * perMole * 0.01) < 1e-9);
});
test('each distinct boost operation id is charged one boost fee', () => {
  const cost = computeFillCost({ steps: [step({}), step({}), step({ costOperationId: 'op-2' })], banks, costs: costs(), temperatureC: T });
  assert.deepEqual(cost.operationLines, [{ operation: 'boost', count: 2, fee: 2, cost: 4 }]);
  assert.equal(cost.operationTotal, 4);
});
test('several steps sharing one operation id are one operation', () => {
  const cost = computeFillCost({ steps: [step({}), step({ sourceBankId: 'b' })], banks, costs: costs(), temperatureC: T });
  assert.deepEqual(cost.operationLines, [{ operation: 'boost', count: 1, fee: 2, cost: 2 }]);
});
test('a decant and an equalize with different ids are two operations at the decant fee', () => {
  const cost = computeFillCost({
    steps: [
      step({ costOperation: 'decant', costOperationId: 'op-1' }),
      step({ costOperation: 'equalize', costOperationId: 'op-2' })
    ],
    banks,
    costs: costs(),
    temperatureC: T
  });
  assert.deepEqual(cost.operationLines, [{ operation: 'decant', count: 2, fee: 1, cost: 2 }]);
});
test('a decant and an equalize with the same id count as one decant operation', () => {
  const cost = computeFillCost({
    steps: [
      step({ costOperation: 'decant', costOperationId: 'op-1' }),
      step({ costOperation: 'equalize', costOperationId: 'op-1' })
    ],
    banks,
    costs: costs(),
    temperatureC: T
  });
  assert.deepEqual(cost.operationLines, [{ operation: 'decant', count: 1, fee: 1, cost: 1 }]);
});
test('top-up fee is charged once per operation id and has no gas line', () => {
  const top = { costOperation: 'topUp', sourceBankId: 'compressor-air', costOperationId: 'op-1' };
  const cost = computeFillCost({ steps: [step(top), step({ ...top, sourceConsumedMoles: 3 })], banks, costs: costs(), temperatureC: T });
  assert.deepEqual(cost.operationLines, [{ operation: 'topUp', count: 1, fee: 5, cost: 5 }]);
  assert.equal(cost.gasLines.length, 0);
  const two = computeFillCost({ steps: [step(top), step({ ...top, costOperationId: 'op-2' })], banks, costs: costs(), temperatureC: T });
  assert.deepEqual(two.operationLines, [{ operation: 'topUp', count: 2, fee: 5, cost: 10 }]);
});
test('operation lines are ordered boost, decant, topUp and omitted when their count is zero', () => {
  const cost = computeFillCost({
    steps: [
      { costOperation: 'topUp', sourceBankId: 'compressor-air', costOperationId: 'op-3', sourceConsumedMoles: 1 },
      step({ costOperation: 'decant', costOperationId: 'op-2' }),
      step({ costOperationId: 'op-1' })
    ],
    banks,
    costs: costs(),
    temperatureC: T
  });
  assert.deepEqual(cost.operationLines.map(line => line.operation), ['boost', 'decant', 'topUp']);
  assert.deepEqual(computeFillCost({ steps: [step({})], banks, costs: costs(), temperatureC: T }).operationLines.map(line => line.operation), ['boost']);
});
test('operation lines carry no litres and no per-litre rate', () => {
  const cost = computeFillCost({ steps: [step({})], banks, costs: costs(), temperatureC: T });
  for (const line of cost.operationLines) {
    assert.deepEqual(Object.keys(line).sort(), ['cost', 'count', 'fee', 'operation']);
  }
});
test('unpriced and missing banks are flagged and the total is incomplete', () => {
  const cost = computeFillCost({ steps: [step({ sourceBankId: 'b' }), step({ sourceBankId: 'gone', costOperationId: 'op-2' })], banks, costs: costs(), temperatureC: T });
  assert.equal(cost.incomplete, true);
  assert.deepEqual(cost.unpricedSources.map(s => s.sourceBankId).sort(), ['b', 'gone']);
  assert.equal(cost.gasTotal, 0);
});
test('total is gas plus operations', () => {
  const cost = computeFillCost({ steps: [step({}), step({ costOperation: 'topUp', sourceBankId: 'compressor-air', costOperationId: 'op-2' })], banks, costs: costs(), temperatureC: T });
  assert.ok(Math.abs(cost.total - (cost.gasTotal + cost.operationTotal)) < 1e-12);
  assert.equal(cost.operationTotal, 2 + 5);
});
test('configured is false with no fees and no priced used bank', () => {
  const none = { ...costs(), operationPrices: { boost: 0, decant: 0, topUp: 0 } };
  assert.equal(computeFillCost({ steps: [step({ sourceBankId: 'b' })], banks, costs: none, temperatureC: T }).configured, false);
});
test('configured is true with a fee alone or a priced used bank alone', () => {
  const noFees = { ...costs(), operationPrices: { boost: 0, decant: 0, topUp: 0 } };
  assert.equal(computeFillCost({ steps: [step({})], banks, costs: costs(), temperatureC: T }).configured, true);
  assert.equal(computeFillCost({ steps: [step({})], banks, costs: noFees, temperatureC: T }).configured, true);
});
test('steps without a cost operation are ignored', () => {
  const cost = computeFillCost({ steps: [{ type: 'drain' }, { type: 'wait' }], banks, costs: costs(), temperatureC: T });
  assert.equal(cost.total, 0);
  assert.deepEqual(cost.operationLines, []);
});
