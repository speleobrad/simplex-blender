import test from 'node:test';
import assert from 'node:assert/strict';
import {
  convertFromDisplay,
  convertToDisplay,
  formatUnitValue,
  formatInputValue,
  materialLabel,
  IMPERIAL_UNITS,
  METRIC_UNITS
} from '../js/units.js';

test('imperial conversions use scuba volume and pressure units', () => {
  assert.ok(Math.abs(convertToDisplay(10, 'volumeL', IMPERIAL_UNITS) - 0.353146667) < 1e-9);
  assert.ok(Math.abs(convertFromDisplay(0.353146667, 'volumeL', IMPERIAL_UNITS) - 10) < 1e-6);
  assert.ok(Math.abs(convertToDisplay(200, 'pressureBar', IMPERIAL_UNITS) - 2900.75476) < 1e-5);
  assert.ok(Math.abs(convertFromDisplay(2900.75476, 'pressureBar', IMPERIAL_UNITS) - 200) < 1e-6);
});
test('material labels follow the selected unit system', () => {
  assert.equal(materialLabel('aluminum', METRIC_UNITS), 'Aluminium');
  assert.equal(materialLabel('aluminum', IMPERIAL_UNITS), 'Aluminum');
  assert.equal(materialLabel('steel', METRIC_UNITS), 'Steel');
});

test('imperial conversions cover mass, temperature, flow, and small volume', () => {
  assert.ok(Math.abs(convertToDisplay(10, 'massKg', IMPERIAL_UNITS) - 22.0462262185) < 1e-9);
  assert.equal(convertToDisplay(25, 'temperatureC', IMPERIAL_UNITS), 77);
  assert.equal(convertToDisplay(10, 'temperatureDeltaC', IMPERIAL_UNITS), 18);
  assert.ok(Math.abs(convertToDisplay(100, 'flowLPerMin', IMPERIAL_UNITS) - 3.53146667) < 1e-8);
  assert.ok(Math.abs(convertToDisplay(5, 'pressureBarPerMin', IMPERIAL_UNITS) - 72.518869) < 1e-6);
  assert.ok(Math.abs(convertToDisplay(9, 'volumeCm3', IMPERIAL_UNITS) - 0.5492136969) < 1e-9);
});

test('metric units are identity conversions and formatting includes the selected unit', () => {
  assert.equal(convertToDisplay(12.5, 'volumeL', METRIC_UNITS), 12.5);
  assert.equal(convertFromDisplay(12.5, 'volumeL', METRIC_UNITS), 12.5);
  assert.equal(formatUnitValue(11.1, 'volumeL', METRIC_UNITS, 1), '11.1 L');
  assert.equal(formatUnitValue(1, 'volumeL', IMPERIAL_UNITS, 2), '0.04 cu ft');
});

test('formats pressure inputs to one decimal place in PSI', () => {
  assert.equal(formatInputValue(200, 'pressureBar', IMPERIAL_UNITS), '2900.8');
  assert.equal(formatInputValue(350, 'pressureBar', IMPERIAL_UNITS), '5076.3');
  assert.equal(formatInputValue(200, 'pressureBar', METRIC_UNITS), '200');
});
