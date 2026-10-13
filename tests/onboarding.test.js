import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_ONBOARDING_STATE,
  WIZARD_STEPS,
  loadOnboardingState,
  saveOnboardingState
} from '../js/onboarding.js';

function memoryStorage(initialEntries = []) {
  const values = new Map(initialEntries);
  return {
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, String(value)); },
    value(key) { return values.get(key) ?? null; }
  };
}

test('missing onboarding state starts without consent or a seen tour', () => {
  assert.deepEqual(loadOnboardingState(memoryStorage()), DEFAULT_ONBOARDING_STATE);
});

test('valid onboarding state survives save and load', () => {
  const storage = memoryStorage();
  const state = { consentAccepted: true, wizardSeen: true };
  saveOnboardingState(state, storage);
  assert.deepEqual(loadOnboardingState(storage), state);
});

test('malformed and invalid onboarding values use a fresh default', () => {
  const storage = memoryStorage([
    ['simplex-gas-remixer-onboarding', '{not json']
  ]);
  assert.deepEqual(loadOnboardingState(storage), DEFAULT_ONBOARDING_STATE);
  storage.setItem('simplex-gas-remixer-onboarding', JSON.stringify({ consentAccepted: true }));
  assert.deepEqual(loadOnboardingState(storage), DEFAULT_ONBOARDING_STATE);
});

test('invalid onboarding state is rejected before replacing saved data', () => {
  const storage = memoryStorage();
  saveOnboardingState({ consentAccepted: true, wizardSeen: false }, storage);
  assert.throws(() => saveOnboardingState({ consentAccepted: 'yes', wizardSeen: false }, storage), RangeError);
  assert.deepEqual(loadOnboardingState(storage), { consentAccepted: true, wizardSeen: false });
});

test('wizard steps cover the ordered tour destinations', () => {
  assert.deepEqual(WIZARD_STEPS.map(step => step.id), [
    'welcome', 'working-tank', 'supply-banks', 'mixing-steps',
    'tank-summary', 'water-pressure', 'equipment', 'diagram'
  ]);
  assert.equal(WIZARD_STEPS[0].targetId, null);
  assert.equal(WIZARD_STEPS.find(step => step.id === 'tank-summary').tab, 'summary');
  assert.equal(WIZARD_STEPS.find(step => step.id === 'water-pressure').tab, 'water-pressure');
  assert.equal(WIZARD_STEPS.find(step => step.id === 'diagram').tab, 'ternary');
});
