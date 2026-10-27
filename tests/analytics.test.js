import test from 'node:test';
import assert from 'node:assert/strict';
import { ANALYTICS_MEASUREMENT_ID, disableAnalytics, loadAnalytics } from '../js/analytics.js';

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

test('queues the initial tag commands as argument objects', () => {
  const scripts = [];
  const document = {
    head: { append(node) { scripts.push(node); } },
    createElement() { return { async: false, src: '', setAttribute() {} }; },
    querySelector(selector) { return selector === 'script[data-simplex-analytics]' ? scripts[0] ?? null : null; }
  };
  const window = { dataLayer: [] };

  loadAnalytics(document, window);

  assert.equal(typeof window.gtag, 'function');
  assert.equal(Array.isArray(window.dataLayer[0]), false);
  assert.deepEqual([...window.dataLayer[0]], ['js', window.dataLayer[0][1]]);
  assert.deepEqual([...window.dataLayer[1]], ['config', 'G-KDQH39FXV3']);
});

test('factory reset opt-out disables Analytics until consent loads it again', () => {
  const scripts = [];
  const document = {
    head: { append(node) { scripts.push(node); } },
    createElement() { return { async: false, src: '', setAttribute() {} }; },
    querySelector(selector) {
      return selector === 'script[data-simplex-analytics]' ? scripts[0] ?? null : null;
    }
  };
  const window = { dataLayer: [] };
  const flag = `ga-disable-${ANALYTICS_MEASUREMENT_ID}`;

  loadAnalytics(document, window);
  assert.equal(window[flag], false);
  disableAnalytics(window);
  assert.equal(window[flag], true);
  assert.equal(loadAnalytics(document, window), false);
  assert.equal(window[flag], false);
});
