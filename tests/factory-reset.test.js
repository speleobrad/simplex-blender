import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS } from '../js/settings.js';
import { DEFAULT_BANKS } from '../js/bank-storage.js';
import { DEFAULT_THEME } from '../js/theme.js';
import { resetApplicationData, resetApplicationState } from '../js/factory-reset.js';
import { DEFAULT_ONBOARDING_STATE } from '../js/onboarding.js';

function memoryStorage(initialEntries = []) {
  const values = new Map(initialEntries);
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    clear: () => values.clear(),
    entries: () => [...values.entries()]
  };
}

test('factory reset clears storage and returns independent built-in defaults', () => {
  const storage = memoryStorage([
    ['simplex-gas-remixer-settings', '{"custom":true}'],
    ['simplex-gas-remixer-banks', '[{"custom":true}]'],
    ['simplex-gas-remixer-theme', 'dark'],
    ['unrelated-app-data', 'also removed']
  ]);

  const result = resetApplicationData(storage);

  assert.deepEqual(storage.entries(), []);
  assert.deepEqual(result.settings, DEFAULT_SETTINGS);
  assert.deepEqual(result.banks, DEFAULT_BANKS);
  assert.equal(result.theme, DEFAULT_THEME);
  assert.notStrictEqual(result.settings.gasPresets, DEFAULT_SETTINGS.gasPresets);
  assert.notStrictEqual(result.banks, DEFAULT_BANKS);
});

test('factory reset honors cancellation and replaces live state after confirmation', () => {
  const storage = memoryStorage([['saved-data', 'present']]);
  const state = {
    settings: { custom: true },
    banks: [{ custom: true }],
    theme: 'dark',
    onboarding: { consentAccepted: true, wizardSeen: true }
  };
  const beforeCancel = structuredClone(state);

  assert.equal(resetApplicationState(state, storage, () => false), false);
  assert.deepEqual(state, beforeCancel);
  assert.deepEqual(storage.entries(), [['saved-data', 'present']]);

  assert.equal(resetApplicationState(state, storage, () => true), true);
  assert.deepEqual(state.settings, DEFAULT_SETTINGS);
  assert.deepEqual(state.banks, DEFAULT_BANKS);
  assert.equal(state.theme, DEFAULT_THEME);
  assert.deepEqual(state.onboarding, DEFAULT_ONBOARDING_STATE);
  assert.notStrictEqual(state.onboarding, DEFAULT_ONBOARDING_STATE);
  assert.notStrictEqual(state.settings, DEFAULT_SETTINGS);
  assert.notStrictEqual(state.banks, DEFAULT_BANKS);
  assert.deepEqual(storage.entries(), []);
});

test('factory reset leaves live state unchanged when storage cannot be cleared', () => {
  const state = {
    settings: { custom: true },
    banks: [{ custom: true }],
    theme: 'dark'
  };
  const before = structuredClone(state);
  const storage = {
    clear() {
      throw new Error('storage unavailable');
    }
  };

  assert.throws(() => resetApplicationState(state, storage, () => true), /storage unavailable/);
  assert.deepEqual(state, before);
});
