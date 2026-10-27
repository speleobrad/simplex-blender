export const ONBOARDING_STORAGE_KEY = 'simplex-gas-remixer-onboarding';

export const DEFAULT_ONBOARDING_STATE = Object.freeze({
  consentAccepted: false,
  wizardSeen: false
});

export const WIZARD_STEPS = Object.freeze([
  Object.freeze({
    id: 'main-menu',
    title: 'Main menu',
    body: 'Use the main menu to navigate between Blending, Inventory, and few other options. Inventory is where you define your available gases and equipment, and Blending is where you get a recipe for your fill.',
    targetId: 'primary-navigation',
    screen: 'blending'
  }),
  Object.freeze({
    id: 'inventory-gases',
    title: 'Define the gases you have',
    body: 'You would start here: define the inventory of gases you have available as ingredients. Add each gas bank with its pressure and mix. Compressor with air is assumed to exist, so don\'t bother adding Air',
    targetId: 'supply-banks-section',
    screen: 'inventory'
  }),
  Object.freeze({
    id: 'inventory-equipment',
    title: 'Check your equipment',
    body: 'Select your compressor and booster from the list. Their properties will determine speed of transfering gases.',
    targetId: 'equipment-section',
    screen: 'inventory'
  }),
  Object.freeze({
    id: 'settings-equipment',
    title: 'Add missing equipment',
    body: 'If your compressor or booster is not listed, you can add it here with New compressor or New booster.',
    spotlights: Object.freeze([
      Object.freeze({ targetId: 'settings-pane-equipment' }),
      Object.freeze({ targetId: 'settings-category-equipment' })
    ]),
    screen: 'blending',
    settingsCategory: 'equipment'
  }),
  Object.freeze({
    id: 'working-tank',
    title: 'Define your mix',
    body: 'Once your equipment and inventory are set, configure the working tank by defining its current pressure and gas mix. Then set the target pressure and mix you want to reach.',
    targetId: 'working-tank-section',
    screen: 'blending'
  }),
  Object.freeze({
    id: 'temperatures',
    title: 'Set the temperatures',
    body: 'Pay close attention to two temperatures: the ambient temperature of environment where you fill, and the dive site\'s water temperature, entered as the target in-water temperature.',
    spotlights: Object.freeze([
      Object.freeze({ targetId: 'ambient-temperature' }),
      Object.freeze({ targetId: 'target-temperature' })
    ]),
    screen: 'blending'
  }),
  Object.freeze({
    id: 'recipe',
    title: 'Follow the recipe',
    body: 'The recipe shows how to get there, step by step. It will not allow unsafe fills, and it gives you more gas now so you have exactly what you need at the dive site when tanks cool off.',
    targetId: 'mixing-steps-section',
    screen: 'blending',
    tab: 'recipe'
  }),
  Object.freeze({
    id: 'explore-options',
    title: 'Explore other options',
    body: 'Use the result tabs on the right to explore other views: Thermal Graph that will show you how temperature changes as you will, In-water pressures that can show you pressures in other water temperatures, but also if it\'s safe to drive around in a hot summer day, Tanks and costs that will tell you what you are left with after the mix and what the fill costs, and Simplex diagram to show you visual path you will be making as you move from starting to target mix.',
    targetId: 'results-tablist',
    screen: 'blending'
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
