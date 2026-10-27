import test from 'node:test';
import assert from 'node:assert/strict';
import { currencyPrefix, formatMoney } from '../js/currency-format.js';

test('currencyPrefix spaces alphanumeric symbols and leaves symbols bare', () => {
  assert.equal(currencyPrefix(''), '');
  assert.equal(currencyPrefix(undefined), '');
  assert.equal(currencyPrefix('€'), '€');
  assert.equal(currencyPrefix('$'), '$');
  assert.equal(currencyPrefix('CHF'), 'CHF ');
  assert.equal(currencyPrefix('kr.'), 'kr.');
  assert.equal(currencyPrefix('Kč'), 'Kč ');
  assert.equal(currencyPrefix('zł'), 'zł ');
});

test('formatMoney prefixes the fixed-precision amount', () => {
  assert.equal(formatMoney(12.4, '€', 2), '€12.40');
  assert.equal(formatMoney(12.4, 'CHF', 2), 'CHF 12.40');
  assert.equal(formatMoney(0.025, '', 4), '0.0250');
  assert.equal(formatMoney(0, '$', 2), '$0.00');
});

test('formatMoney puts the sign before the currency prefix', () => {
  assert.equal(formatMoney(-1.2, '€', 2), '-€1.20');
  assert.equal(formatMoney(-1.2, 'CHF', 2), '-CHF 1.20');
  assert.equal(formatMoney(-0.023, '€', 6), '-€0.023000');
});

test('formatMoney prints no minus for an amount that rounds to zero', () => {
  assert.equal(formatMoney(-0.001, '€', 2), '€0.00');
  assert.equal(formatMoney(-0, '€', 2), '€0.00');
});
