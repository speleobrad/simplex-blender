import test from 'node:test';
import assert from 'node:assert/strict';
import { computeFillCost, litresPerMole } from '../js/cost.js';

const costs = () => ({
  currencySymbol: '', pricePerLitre: { oxygen: 0, helium: 0 }, leftoverDiscountPercent: 0,
  operationPrices: { boostPerLitre: 0.002, decantPerLitre: 0.001, equalizePerLitre: 0.0005, topUpPerOperation: 5 }
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
test('per-litre operations sum all stages; splitting does not change cost', () => {
  const whole = computeFillCost({ steps: [step({ sourceConsumedMoles: 2 })], banks, costs: costs(), temperatureC: T });
  const split = computeFillCost({ steps: [step({}), step({})], banks, costs: costs(), temperatureC: T });
  assert.ok(Math.abs(whole.operationTotal - split.operationTotal) < 1e-12);
});
test('top-up fee is charged once per operation id and has no gas line', () => {
  const top = { costOperation: 'topUp', sourceBankId: 'compressor-air', costOperationId: 'op-1' };
  const cost = computeFillCost({ steps: [step(top), step({ ...top, sourceConsumedMoles: 3 })], banks, costs: costs(), temperatureC: T });
  assert.equal(cost.operationLines.find(l => l.operation === 'topUp').cost, 5);
  assert.equal(cost.gasLines.length, 0);
  const two = computeFillCost({ steps: [step(top), step({ ...top, costOperationId: 'op-2' })], banks, costs: costs(), temperatureC: T });
  assert.equal(two.operationLines.find(l => l.operation === 'topUp').cost, 10);
});
test('decant and equalize use their own rates', () => {
  const cost = computeFillCost({ steps: [step({ costOperation: 'decant' }), step({ costOperation: 'equalize', costOperationId: 'op-2' })], banks, costs: costs(), temperatureC: T });
  assert.ok(Math.abs(cost.operationLines.find(l => l.operation === 'decant').cost - perMole * 0.001) < 1e-9);
  assert.ok(Math.abs(cost.operationLines.find(l => l.operation === 'equalize').cost - perMole * 0.0005) < 1e-9);
});
test('unpriced and missing banks are flagged and the total is incomplete', () => {
  const cost = computeFillCost({ steps: [step({ sourceBankId: 'b' }), step({ sourceBankId: 'gone', costOperationId: 'op-2' })], banks, costs: costs(), temperatureC: T });
  assert.equal(cost.incomplete, true);
  assert.deepEqual(cost.unpricedSources.map(s => s.sourceBankId).sort(), ['b', 'gone']);
  assert.equal(cost.gasTotal, 0);
});
test('total is gas plus operations and configured is false with no prices', () => {
  const none = { ...costs(), operationPrices: { boostPerLitre: 0, decantPerLitre: 0, equalizePerLitre: 0, topUpPerOperation: 0 } };
  assert.equal(computeFillCost({ steps: [step({ sourceBankId: 'b' })], banks, costs: none, temperatureC: T }).configured, false);
  const cost = computeFillCost({ steps: [step({})], banks, costs: costs(), temperatureC: T });
  assert.ok(Math.abs(cost.total - (cost.gasTotal + cost.operationTotal)) < 1e-12);
  assert.equal(cost.configured, true);
});
test('steps without a cost operation are ignored', () => {
  const cost = computeFillCost({ steps: [{ type: 'drain' }, { type: 'wait' }], banks, costs: costs(), temperatureC: T });
  assert.equal(cost.total, 0);
});
