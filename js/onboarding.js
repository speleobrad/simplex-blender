export const ONBOARDING_STORAGE_KEY = 'simplex-gas-remixer-onboarding';

export const DEFAULT_ONBOARDING_STATE = Object.freeze({
  consentAccepted: false,
  wizardSeen: false
});

export const WIZARD_STEPS = Object.freeze([
  Object.freeze({
    id: 'welcome',
    title: 'Welcome to Simplex Blender',
    body: 'Use the navigation to move between Blending, Inventory, and Settings. This tour introduces the controls and results that turn your target mix into a practical blending recipe.',
    targetId: 'primary-navigation',
    screen: 'blending'
  }),
  Object.freeze({
    id: 'working-tank',
    title: 'Set up your working tank',
    body: 'This is where you define your working tank: enter what you already have and the mix you want to make, choose the tank type, make, and model, and describe the environment where blending will happen. Temperature matters—set and respect the waiting times so the tank can cool and avoid thermal stress.',
    targetId: 'working-tank-section',
    screen: 'blending'
  }),
  Object.freeze({
    id: 'inventory',
    title: 'Manage your inventory',
    body: 'Inventory lists the source gases available to you. Compressor air is always assumed to be available. Add your gases, edit their pressures and mixes, then disable any you want to preserve instead of using as ingredients.',
    targetId: 'inventory-section',
    screen: 'inventory'
  }),
  Object.freeze({
    id: 'mixing-steps',
    title: 'Follow the mixing steps',
    body: 'Your mixing recipe is here, with full details for every step: how long it takes, the tank temperature at transfer end, and the temperature after the cooling wait. Check the interim mix too if you want to analyze the blend as it develops.',
    targetId: 'mixing-steps-section',
    screen: 'blending'
  }),
  Object.freeze({
    id: 'tank-summary',
    title: 'Review the tank summary',
    body: 'Tank summary gives you a quick readout of the final mix and every inventory tank, including the pressure left in each one.',
    spotlights: Object.freeze([
      Object.freeze({ targetId: 'results-navigation' }),
      Object.freeze({ targetId: 'tab-btn-summary', variant: 'control' })
    ]),
    screen: 'blending',
    tab: 'summary'
  }),
  Object.freeze({
    id: 'water-pressure',
    title: 'Check in-water pressure',
    body: 'Check the pressure your SPG may show once the tank is in the water or during transport. Avoid overheating tanks during transport: pressure can rise above their working rating.',
    spotlights: Object.freeze([
      Object.freeze({ targetId: 'results-navigation' }),
      Object.freeze({ targetId: 'tab-btn-water-pressure', variant: 'control' })
    ]),
    screen: 'blending',
    tab: 'water-pressure'
  }),
  Object.freeze({
    id: 'equipment',
    title: 'Configure your equipment',
    body: 'Your tanks and filling equipment behave differently, so choose the presets that match what you have—or define your own. Use Preset management to load the latest list of tanks, compressors, and boosters.',
    views: Object.freeze([
      Object.freeze({
        title: 'Find Settings',
        body: 'This is where you can change the app settings and define your preset gear. Remember that all configuration is stored locally and is not shared. Continue to open Settings and choose Equipment.',
        targetId: 'settings-launch',
        screen: 'blending',
        tab: null,
        settingsCategory: null
      }),
      Object.freeze({
        spotlights: Object.freeze([
          Object.freeze({ targetId: 'settings-pane-equipment' }),
          Object.freeze({ targetId: 'settings-category-equipment', variant: 'control' })
        ]),
        screen: 'blending',
        tab: null,
        settingsCategory: 'equipment'
      })
    ])
  }),
  Object.freeze({
    id: 'diagram',
    title: 'Explore and stay safe',
    body: 'This is the big picture: explore the visual diagram to see how your starting mix is transformed into the target. You can also inspect the graphs for expected tank temperature and pressure over time. Enjoy exploring—and stay safe.',
    spotlights: Object.freeze([
      Object.freeze({ targetId: 'results-navigation' }),
      Object.freeze({ targetId: 'tab-btn-ternary', variant: 'control' })
    ]),
    tab: 'ternary'
  })
]);

function isOnboardingState(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;

  const keys = Object.keys(value);
  return keys.length === 2
    && keys.includes('consentAccepted')
    && keys.includes('wizardSeen')
    && typeof value.consentAccepted === 'boolean'
    && typeof value.wizardSeen === 'boolean';
}

export function loadOnboardingState(storage, onFallback = () => {}) {
  let serialized;
  try {
    serialized = storage.getItem(ONBOARDING_STORAGE_KEY);
  } catch (error) {
    onFallback(error);
    return { ...DEFAULT_ONBOARDING_STATE };
  }
  if (serialized === null) return { ...DEFAULT_ONBOARDING_STATE };

  try {
    const state = JSON.parse(serialized);
    if (isOnboardingState(state)) return { ...state };
    onFallback(new RangeError('Onboarding state requires boolean consentAccepted and wizardSeen fields.'));
  } catch (error) {
    onFallback(error);
  }
  return { ...DEFAULT_ONBOARDING_STATE };
}

export function saveOnboardingState(state, storage) {
  if (!isOnboardingState(state)) {
    throw new RangeError('Onboarding state requires boolean consentAccepted and wizardSeen fields.');
  }

  storage.setItem(ONBOARDING_STORAGE_KEY, JSON.stringify({
    consentAccepted: state.consentAccepted,
    wizardSeen: state.wizardSeen
  }));
}
