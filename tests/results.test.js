import test from 'node:test';
import assert from 'node:assert/strict';
import { isPressureAboveWorkingPressure } from '../js/ui/water-pressure.js';

test('pressure warnings trigger only above the cylinder working pressure', () => {
  assert.equal(isPressureAboveWorkingPressure(232, 232), false);
  assert.equal(isPressureAboveWorkingPressure(232.1, 232), true);
  assert.equal(isPressureAboveWorkingPressure(Number.NaN, 232), false);
});
