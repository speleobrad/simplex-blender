import test from 'node:test';
import assert from 'node:assert/strict';
import { parseNumericInput, splitGasInput } from '../js/gas-input.js';

test('slash-delimited O2/He input separates both values and trims whitespace', () => {
  assert.deepEqual(splitGasInput(' 21 / 35 '), { oxygenText: '21', heliumText: '35' });
});

test('ordinary O2 input does not split', () => {
  assert.equal(splitGasInput('21'), null);
});
test('numeric inputs do not turn blank or malformed text into a fallback value', () => {
  assert.equal(parseNumericInput(' 21.5 '), 21.5);
  assert.equal(parseNumericInput('1.5e1'), 15);
  assert.ok(Number.isNaN(parseNumericInput('')));
  assert.ok(Number.isNaN(parseNumericInput('not a number')));
  assert.ok(Number.isNaN(parseNumericInput('0x15')));
});
