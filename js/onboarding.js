export const ONBOARDING_STORAGE_KEY = 'simplex-gas-remixer-onboarding';

export const DEFAULT_ONBOARDING_STATE = Object.freeze({
  consentAccepted: false,
  wizardSeen: false
});

export const WIZARD_STEPS = Object.freeze([
  Object.freeze({
    id: 'welcome',
    title: 'Welcome to Simplex Blender',
    body: 'This tour introduces the controls and results that turn your target mix into a practical blending recipe.',
    targetId: null,
    tab: null
  }),
  Object.freeze({
    id: 'working-tank',
    title: 'Set up the working tank',
    body: 'Enter the starting gas and target mix, choose the cylinder type, then set the surrounding temperature and wait time between fills.',
    targetId: 'cylinder-preset',
    tab: null
  }),
  Object.freeze({
    id: 'supply-banks',
    title: 'Choose supply banks',
    body: 'Supply banks provide the available gases. Disable a bank to preserve it while the recipe is calculated.',
    targetId: 'tanks-table',
    tab: null
  }),
  Object.freeze({
    id: 'mixing-steps',
    title: 'Follow the mixing steps',
    body: 'Each step gives its target pressure, temperature change, transfer method, and the wait before the next fill.',
    targetId: 'steps-container',
    tab: null
  }),
  Object.freeze({
    id: 'tank-summary',
    title: 'Review the tank summary',
    body: 'Use the tank summary to review the final mix and every stage of the completed fill.',
    targetId: 'tab-pane-summary',
    tab: 'summary'
  }),
  Object.freeze({
    id: 'water-pressure',
    title: 'Check in-water pressure',
    body: 'See how the cylinder pressure changes after it equilibrates at different water temperatures.',
    targetId: 'tab-pane-water-pressure',
    tab: 'water-pressure'
  }),
  Object.freeze({
    id: 'equipment',
    title: 'Inspect equipment',
    body: 'This summary shows the active equipment. Configure its details in Settings, then Equipment.',
    targetId: 'equipment-summary',
    tab: null
  }),
  Object.freeze({
    id: 'diagram',
    title: 'Explore the diagram',
    body: 'Explore the diagram to see the gas-mix trajectory and how each transfer reaches the target.',
    targetId: 'tab-pane-ternary',
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

export function loadOnboardingState(storage) {
  const serialized = storage.getItem(ONBOARDING_STORAGE_KEY);
  if (serialized === null) return { ...DEFAULT_ONBOARDING_STATE };

  try {
    const state = JSON.parse(serialized);
    return isOnboardingState(state) ? state : { ...DEFAULT_ONBOARDING_STATE };
  } catch {
    return { ...DEFAULT_ONBOARDING_STATE };
  }
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
