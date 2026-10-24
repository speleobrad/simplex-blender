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

test('unreadable onboarding state falls back and reports the storage failure', () => {
  const failure = new Error('storage unavailable');
  let reportedFailure = null;
  const storage = {
    getItem() {
      throw failure;
    }
  };

  assert.deepEqual(loadOnboardingState(storage, error => {
    reportedFailure = error;
  }), DEFAULT_ONBOARDING_STATE);
  assert.equal(reportedFailure, failure);
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

test('wizard steps walk a new user from the main menu to the result tabs', () => {
  assert.deepEqual(WIZARD_STEPS.map(step => step.id), [
    'main-menu', 'inventory-gases', 'inventory-equipment', 'settings-equipment',
    'working-tank', 'temperatures', 'recipe', 'explore-options'
  ]);
  assert.equal(WIZARD_STEPS[0].targetId, 'primary-navigation');
  const gases = WIZARD_STEPS.find(step => step.id === 'inventory-gases');
  assert.equal(gases.targetId, 'supply-banks-section');
  assert.equal(gases.screen, 'inventory');
  const equipment = WIZARD_STEPS.find(step => step.id === 'inventory-equipment');
  assert.equal(equipment.targetId, 'equipment-section');
  assert.equal(equipment.screen, 'inventory');
  const settings = WIZARD_STEPS.find(step => step.id === 'settings-equipment');
  assert.equal(settings.settingsCategory, 'equipment');
  assert.deepEqual(settings.spotlights.map(spotlight => spotlight.targetId), [
    'settings-pane-equipment',
    'settings-category-equipment'
  ]);
  assert.equal(WIZARD_STEPS.find(step => step.id === 'working-tank').targetId, 'working-tank-section');
  const temperatures = WIZARD_STEPS.find(step => step.id === 'temperatures');
  assert.deepEqual(temperatures.spotlights.map(spotlight => spotlight.targetId), [
    'ambient-temperature',
    'target-temperature'
  ]);
  const recipe = WIZARD_STEPS.find(step => step.id === 'recipe');
  assert.equal(recipe.targetId, 'mixing-steps-section');
  assert.equal(recipe.tab, 'recipe');
  assert.equal(WIZARD_STEPS.find(step => step.id === 'explore-options').targetId, 'results-tablist');
});
