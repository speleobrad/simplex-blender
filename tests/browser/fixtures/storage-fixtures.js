import { DEFAULT_SETTINGS } from '../../../js/settings.js';

export const storageScenarios = {
  factory: {},
  tourSeen: {
    'simplex-gas-remixer-onboarding': JSON.stringify({
      consentAccepted: true,
      wizardSeen: true
    })
  },
  populatedInventory: {
    'simplex-gas-remixer-onboarding': JSON.stringify({ consentAccepted: true, wizardSeen: true }),
    'simplex-gas-remixer-banks': JSON.stringify([
      { id: 'test-helium', name: 'Helium reserve with a deliberately long label', volumeL: 40, pressureBar: 150, oxygenPercent: 0, heliumPercent: 100, enabled: true },
      { id: 'test-oxygen', name: 'Oxygen', volumeL: 50, pressureBar: 200, oxygenPercent: 100, heliumPercent: 0, enabled: false },
      { id: 'test-mix', name: 'Tx 18/45', volumeL: 12, pressureBar: 45, oxygenPercent: 18, heliumPercent: 45, enabled: true, gasPresetName: null }
    ])
  },
  invalidSavedData: {
    'simplex-gas-remixer-banks': '{not-json',
    'simplex-gas-remixer-onboarding': JSON.stringify({ consentAccepted: 'yes', wizardSeen: false })
  },
  settings: {
    'simplex-gas-remixer-onboarding': JSON.stringify({ consentAccepted: true, wizardSeen: true }),
    'simplex-gas-remixer-settings': JSON.stringify(DEFAULT_SETTINGS)
  },
  lightTheme: {
    'simplex-gas-remixer-onboarding': JSON.stringify({ consentAccepted: true, wizardSeen: true }),
    'simplex-gas-remixer-theme': 'light'
  },
  darkTheme: {
    'simplex-gas-remixer-onboarding': JSON.stringify({ consentAccepted: true, wizardSeen: true }),
    'simplex-gas-remixer-theme': 'dark'
  }
};

export async function seedStorage(page, scenarioName = 'factory') {
  const records = storageScenarios[scenarioName];
  if (!records) throw new Error(`Unknown storage scenario: ${scenarioName}`);
  await page.addInitScript(records => {
    if (window.name === '__skipStorageSeed') return;
    for (const [key, value] of Object.entries(records)) window.localStorage.setItem(key, value);
  }, records);
}
const STORAGE_OPERATIONS = Object.freeze({
  'settings-read': { method: 'getItem', key: 'simplex-gas-remixer-settings', label: 'settings read' },
  'settings-write': { method: 'setItem', key: 'simplex-gas-remixer-settings', label: 'settings write' },
  'banks-read': { method: 'getItem', key: 'simplex-gas-remixer-banks', label: 'supply-bank read' },
  'banks-write': { method: 'setItem', key: 'simplex-gas-remixer-banks', label: 'supply-bank write' },
  'onboarding-read': { method: 'getItem', key: 'simplex-gas-remixer-onboarding', label: 'onboarding read' },
  'onboarding-write': { method: 'setItem', key: 'simplex-gas-remixer-onboarding', label: 'onboarding write' },
  'theme-read': { method: 'getItem', key: 'simplex-gas-remixer-theme', label: 'theme read' },
  'theme-write': { method: 'setItem', key: 'simplex-gas-remixer-theme', label: 'theme write' },
  clear: { method: 'clear', key: null, label: 'factory reset' }
});

/**
 * Make one existing browser-storage operation fail for the current document.
 * The override is intentionally page-scoped: a reload recreates the native
 * Storage prototype and context teardown removes the override automatically.
 */
export async function injectStorageFailure(page, operation) {
  const definition = STORAGE_OPERATIONS[operation];
  if (!definition) throw new RangeError(`Unknown storage operation: ${operation}`);
  await page.evaluate(({ method, key, label }) => {
    window.__simplexStorageFailureRestore?.();
    const prototype = Storage.prototype;
    const original = prototype[method];
    if (typeof original !== 'function') throw new TypeError(`Storage operation is unavailable: ${method}`);
    const blocked = function (...args) {
      const requestedKey = args[0];
      if (this === window.localStorage && (key === null || requestedKey === key)) {
        throw new Error(`Injected ${label} failure`);
      }
      return original.apply(this, args);
    };
    Object.defineProperty(prototype, method, {
      configurable: true,
      enumerable: false,
      writable: true,
      value: blocked
    });
    window.__simplexStorageFailureRestore = () => {
      Object.defineProperty(prototype, method, {
        configurable: true,
        enumerable: false,
        writable: true,
        value: original
      });
      delete window.__simplexStorageFailureRestore;
    };
  }, definition);
  return definition;
}
