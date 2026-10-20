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

test('wizard steps cover the ordered tour destinations', () => {
  assert.deepEqual(WIZARD_STEPS.map(step => step.id), [
    'welcome', 'working-tank', 'inventory', 'mixing-steps',
    'tank-summary', 'water-pressure', 'equipment', 'diagram'
  ]);
  assert.equal(WIZARD_STEPS[0].targetId, 'primary-navigation');
  assert.deepEqual(
    WIZARD_STEPS.slice(1, 4).map(step => step.targetId),
    ['working-tank-section', 'inventory-section', 'mixing-steps-section']
  );
  const summary = WIZARD_STEPS.find(step => step.id === 'tank-summary');
  assert.deepEqual(summary.spotlights, [
    { targetId: 'results-navigation' },
    { targetId: 'tab-btn-summary', variant: 'control' }
  ]);
  assert.equal(summary.tab, 'summary');
  const waterPressure = WIZARD_STEPS.find(step => step.id === 'water-pressure');
  assert.deepEqual(waterPressure.spotlights, [
    { targetId: 'results-navigation' },
    { targetId: 'tab-btn-water-pressure', variant: 'control' }
  ]);
  assert.equal(waterPressure.tab, 'water-pressure');
  const equipment = WIZARD_STEPS.find(step => step.id === 'equipment');
  assert.equal(equipment.views.length, 2);
  assert.equal(equipment.views[0].targetId, 'settings-launch');
  assert.deepEqual(equipment.views[1].spotlights, [
    { targetId: 'settings-pane-equipment' },
    { targetId: 'settings-category-equipment', variant: 'control' }
  ]);
  assert.equal(equipment.views[1].settingsCategory, 'equipment');
  const diagram = WIZARD_STEPS.find(step => step.id === 'diagram');
  assert.deepEqual(diagram.spotlights, [
    { targetId: 'results-navigation' },
    { targetId: 'tab-btn-ternary', variant: 'control' }
  ]);
  assert.equal(diagram.tab, 'ternary');
});
