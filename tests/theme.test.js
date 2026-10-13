import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_THEME, loadTheme, saveTheme } from '../js/theme.js';

function memoryStorage(initialEntries = []) {
  const values = new Map(initialEntries);
  return {
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, String(value)); }
  };
}

test('missing or unknown theme preference uses the light default', () => {
  const storage = memoryStorage();
  assert.equal(loadTheme(storage), DEFAULT_THEME);
  storage.setItem('simplex-gas-remixer-theme', 'system');
  assert.equal(loadTheme(storage), 'light');
});

test('light and dark theme preferences survive save/load', () => {
  const storage = memoryStorage();
  saveTheme('light', storage);
  assert.equal(loadTheme(storage), 'light');
  saveTheme('dark', storage);
  assert.equal(loadTheme(storage), 'dark');
});

test('invalid theme values are rejected before replacing a saved preference', () => {
  const storage = memoryStorage([['simplex-gas-remixer-theme', 'light']]);
  assert.throws(() => saveTheme('system', storage), RangeError);
  assert.equal(storage.getItem('simplex-gas-remixer-theme'), 'light');
});

test('theme load falls back to light when storage cannot be read', () => {
  const storage = { getItem() { throw new Error('storage unavailable'); } };
  assert.equal(loadTheme(storage), 'light');
});
