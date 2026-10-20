import test from 'node:test';
import assert from 'node:assert/strict';
import {
  UNIT_SYSTEMS,
  convertFromDisplay,
  convertToDisplay,
  formatPressure,
  formatQuantity,
  getUnitLabel,
  normalizeUnits
} from '../js/units.js';

test('metric display is identity for every supported quantity', () => {
  for (const [quantity, value] of Object.entries({ pressure: 12.5, volume: 11.1, mass: 14.3, temperature: 25, flow: 100 })) {
    assert.equal(convertToDisplay(value, quantity, 'metric'), value);
    assert.equal(convertFromDisplay(value, quantity, 'metric'), value);
  }
});

test('imperial display conversions preserve canonical metric values', () => {
  assert.ok(Math.abs(convertToDisplay(10, 'pressure', 'imperial') - 145.037738) < 1e-6);
  assert.ok(Math.abs(convertToDisplay(10, 'volume', 'imperial') - 2.641720526) < 1e-6);
  assert.ok(Math.abs(convertToDisplay(10, 'mass', 'imperial') - 22.0462262185) < 1e-6);
  assert.ok(Math.abs(convertToDisplay(25, 'temperature', 'imperial') - 77) < 1e-9);
  assert.ok(Math.abs(convertToDisplay(100, 'flow', 'imperial') - 3.53146667) < 1e-6);
  for (const [quantity, display] of [['pressure', 145.037738], ['volume', 2.641720526], ['mass', 22.0462262185], ['temperature', 77], ['flow', 3.53146667]]) {
    assert.ok(Math.abs(convertFromDisplay(display, quantity, 'imperial') - (quantity === 'temperature' ? 25 : quantity === 'pressure' ? 10 : quantity === 'volume' ? 10 : quantity === 'mass' ? 10 : 100)) < 1e-5);
  }
});

test('pressure formatting uses stable precision at PSI boundaries', () => {
  assert.equal(formatPressure(0, 'imperial'), '0 psi');
  assert.equal(formatPressure(1, 'imperial'), '14.5 psi');
  assert.equal(formatPressure(10, 'imperial'), '145.0 psi');
  assert.equal(formatPressure(68.9475729, 'imperial'), '1000 psi');
  assert.equal(formatPressure(10, 'metric'), '10.0 bar');
});

test('unit labels and normalization expose only supported choices', () => {
  assert.equal(normalizeUnits(), 'metric');
  assert.equal(normalizeUnits('imperial'), 'imperial');
  assert.equal(normalizeUnits('US'), 'metric');
  assert.deepEqual(UNIT_SYSTEMS.imperial, { pressure: 'psi', volume: 'gal', mass: 'lb', temperature: '°F', flow: 'cfm' });
  assert.equal(getUnitLabel('volume', 'imperial'), 'gal');
  assert.equal(formatQuantity(2.641720526, 'volume', 'imperial'), '2.64 gal');
});
