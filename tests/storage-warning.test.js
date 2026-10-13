import test from 'node:test';
import assert from 'node:assert/strict';
import { getStorageWarningMessages, renderStorageWarning } from '../js/ui/storage-warning.js';

function warningElement() {
  const classes = new Set(['hidden']);
  return {
    classes,
    textContent: '',
    classList: {
      toggle(name, force) {
        if (force) classes.add(name);
        else classes.delete(name);
      }
    }
  };
}

test('shows bank-save failures in the visible warning element', () => {
  const warning = warningElement();

  renderStorageWarning(warning, { bankSaveFailure: new Error('storage unavailable') });

  assert.match(warning.textContent, /supply bank changes could not be saved/i);
  assert.equal(warning.classes.has('hidden'), false);
});
test('reports supply-bank save failures in the visible storage warning', () => {
  const messages = getStorageWarningMessages({ bankSaveFailure: new Error('storage unavailable') });

  assert.equal(messages.length, 1);
  assert.match(messages[0], /supply bank changes could not be saved/i);
});

test('reports onboarding-load failures in the visible storage warning', () => {
  const messages = getStorageWarningMessages({ onboardingLoadFailure: new Error('storage unavailable') });

  assert.equal(messages.length, 1);
  assert.match(messages[0], /guided-tour preference could not be loaded/i);
});
