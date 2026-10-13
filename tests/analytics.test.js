import test from 'node:test';
import assert from 'node:assert/strict';
import { loadAnalytics } from '../js/analytics.js';

test('loads Analytics only when explicitly called and only once', () => {
  const scripts = [];
  const calls = [];
  const document = {
    head: { append(node) { scripts.push(node); } },
    createElement() { return { async: false, src: '', setAttribute() {} }; },
    querySelector(selector) { return selector === 'script[data-simplex-analytics]' ? scripts[0] ?? null : null; }
  };
  const window = { dataLayer: [], gtag(...args) { calls.push(args); } };

  assert.equal(loadAnalytics(document, window), true);
  assert.equal(scripts.length, 1);
  assert.equal(scripts[0].async, true);
  assert.match(scripts[0].src, /googletagmanager\.com\/gtag\/js\?id=G-KDQH39FXV3/);
  assert.deepEqual(calls.at(-1), ['config', 'G-KDQH39FXV3']);
  assert.equal(loadAnalytics(document, window), false);
  assert.equal(scripts.length, 1);
});
