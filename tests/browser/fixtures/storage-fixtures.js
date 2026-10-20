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
