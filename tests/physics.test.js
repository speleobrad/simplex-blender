import test from 'node:test';
import assert from 'node:assert/strict';
import { calcMolarDensity, calcPressure, calcZ, calcZFromDensity } from '../js/physics.js';

test('ideal-gas pressure uses kelvin and bar-litres per mole', () => {
  assert.ok(Math.abs(calcPressure(1, 21, 0, 20, false) - 24.3738471119) < 1e-10);
});

test('VDW density matches the current 200-bar trimix calculation', () => {
  assert.ok(Math.abs(calcMolarDensity(200, 18, 45, 20, true) - 7.263268210473831) < 1e-10);
});

test('VDW pressure round-trips the requested state and zero pressure is neutral', () => {
  const density = calcMolarDensity(200, 18, 45, 20, true);
  assert.ok(Math.abs(calcPressure(density, 18, 45, 20, true) - 200) < 1e-8);
  assert.equal(calcMolarDensity(0, 18, 45, 20, true), 0);
  assert.equal(calcZ(0, 18, 45, 20, true), 1);
});

test('compressibility uses an already calculated density with the same model', () => {
  assert.ok(Math.abs(calcZFromDensity(200, 7.263268210473831, 20, true) - 1.1297278403662991) < 1e-12);
  assert.equal(calcZFromDensity(0, 0, 20, true), 1);
  assert.equal(calcZFromDensity(200, 3, 20, false), 1);
});
