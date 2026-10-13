import {
  WIZARD_STEPS,
  loadOnboardingState,
  saveOnboardingState
} from '../onboarding.js';

function createElement(document, tagName, { className, id, text, attributes } = {}) {
  const element = document.createElement(tagName);
  if (className) element.className = className;
  if (id) element.id = id;
  if (text !== undefined) element.textContent = text;
  for (const [name, value] of Object.entries(attributes ?? {})) element.setAttribute(name, value);
  return element;
}

function tourDestinations() {
  return WIZARD_STEPS.flatMap((step, stepIndex) => {
    const destinations = step.views ?? [step];
    return destinations.map((destination, viewIndex) => {
      const targetIds = destination.spotlights?.map(spotlight => spotlight.targetId)
        ?? (destination.targetId ? [destination.targetId] : step.targetId ? [step.targetId] : []);
      return {
        stepIndex,
        viewIndex,
        title: destination.title ?? step.title,
        body: destination.body ?? step.body,
        targetId: targetIds[0] ?? null,
        secondaryTargetIds: targetIds.slice(1),
        tab: destination.tab ?? step.tab ?? null,
        settingsCategory: destination.settingsCategory ?? null
      };
    });
  });
}

function driverSteps(destinations) {
  return destinations.map(destination => ({
    ...(destination.targetId ? { element: `#${destination.targetId}` } : {}),
    popover: {
      title: destination.title,
      description: destination.body,
      showButtons: ['previous', 'next'],
      showProgress: true,
      progressText: `Step ${destination.stepIndex + 1} of ${WIZARD_STEPS.length}`,
      side: destination.targetId ? 'bottom' : undefined,
      align: destination.targetId ? 'start' : 'center'
    },
  }));
}

function defaultCreateDriver(document) {
  const factory = document.defaultView?.driver?.js?.driver;
  if (typeof factory !== 'function') {
    throw new Error('Driver.js is unavailable; the guided tour cannot start.');
  }
  return factory;
}

export function createOnboardingController({
  document,
  storage,
  initialState = loadOnboardingState(storage),
  onNavigate = () => {},
  onConsentAccepted = () => {},
  launchButton = null,
  createDriver = null
}) {
  const driverFactory = createDriver ?? (config => defaultCreateDriver(document)(config));
  let state = { ...initialState };
  let mode = 'closed';
  let consentRoot = null;
  let consentError = '';
  let consentErrorElement = null;
  let consentControls = [];
  let inertElements = [];
  let driverInstance = null;
  let destinations = [];
  let secondaryTargets = [];
  let activeIndex = 0;
  let previousFocus = null;
  let destroyed = false;

  function handleConsentKeydown(event) {
    if (event.key === 'Escape') {
      event.preventDefault?.();
      event.stopPropagation?.();
      return;
    }
    if (event.key !== 'Tab') return;
    const controls = consentControls.filter(control => !control.disabled && !control.hidden);
    if (controls.length === 0) return;
    event.preventDefault?.();
    event.stopPropagation?.();
    const currentIndex = controls.indexOf(document.activeElement);
    const nextIndex = event.shiftKey
      ? (currentIndex <= 0 ? controls.length - 1 : currentIndex - 1)
      : (currentIndex < 0 || currentIndex === controls.length - 1 ? 0 : currentIndex + 1);
    controls[nextIndex].focus?.();
  }

  function makeBackgroundInert(root) {
    inertElements = [...(document.body.children ?? [])]
      .filter(element => element !== root)
      .map(element => ({ element, inert: element.inert }));
    for (const { element } of inertElements) element.inert = true;
  }

  function restoreBackgroundInert() {
    for (const { element, inert } of inertElements) element.inert = inert;
    inertElements = [];
  }

  function navigateTo(index) {
    const destination = destinations[index];
    if (!destination) return;
    onNavigate({
      tab: destination.tab,
      settingsCategory: destination.settingsCategory
    });
  }

  function clearSecondaryHighlights() {
    for (const element of secondaryTargets) element.classList?.remove('onboarding-secondary-highlight');
    secondaryTargets = [];
  }

  function highlightSecondaryTargets(index) {
    clearSecondaryHighlights();
    for (const targetId of destinations[index]?.secondaryTargetIds ?? []) {
      const element = document.getElementById(targetId);
      if (!element) continue;
      element.classList?.add('onboarding-secondary-highlight');
      secondaryTargets.push(element);
    }
  }

  function positionTourLayer(popover, options) {
    const index = options.index ?? options.driver?.getActiveIndex?.() ?? activeIndex;
    const target = document.getElementById(destinations[index]?.targetId ?? '');
    const host = target?.closest?.('dialog[open]') ?? document.body;
    const overlay = document.querySelector?.('.driver-overlay');
    host.append(...[overlay, popover.wrapper].filter(Boolean));
  }

  function removeConsent() {
    consentRoot?.remove();
    restoreBackgroundInert();
    consentRoot = null;
    consentErrorElement = null;
    consentControls = [];
  }

  function renderConsent() {
    if (!consentErrorElement) return;
    consentErrorElement.hidden = !consentError;
    consentErrorElement.textContent = consentError;
  }

  function createConsent() {
    const root = createElement(document, 'div', {
      className: 'onboarding-consent-overlay',
      attributes: {
        role: 'dialog',
        'aria-modal': 'true',
        'aria-labelledby': 'onboarding-consent-title'
      }
    });
    const card = createElement(document, 'section', { className: 'onboarding-consent-card' });
    const heading = createElement(document, 'h2', {
      id: 'onboarding-consent-title',
      text: 'Analytics consent'
    });
    const body = createElement(document, 'p', {
      text: 'Allow anonymous usage analytics to help improve Simplex Blender.'
    });
    const notice = createElement(document, 'p', {
      className: 'onboarding-consent-notice',
      text: 'Simplex Blender stores settings, supply banks, theme, and onboarding state in this browser. Your consent preference is stored locally on this device.'
    });
    consentErrorElement = createElement(document, 'p', {
      className: 'onboarding-consent-error',
      attributes: { role: 'alert' }
    });
    const controls = createElement(document, 'div', { className: 'onboarding-consent-controls' });
    const accept = createElement(document, 'button', {
      className: 'onboarding-button',
      text: 'Accept and continue',
      attributes: { type: 'button' }
    });
    accept.addEventListener('click', acceptConsent);
    controls.append(accept);
    card.append(heading, body, notice, consentErrorElement, controls);
    root.append(card);
    root.addEventListener('keydown', handleConsentKeydown);
    document.body.append(root);
    consentRoot = root;
    consentControls = [accept];
    makeBackgroundInert(root);
    renderConsent();
    accept.focus?.();
  }

  function acceptConsent() {
    const nextState = { ...state, consentAccepted: true };
    try {
      saveOnboardingState(nextState, storage);
    } catch (error) {
      consentError = `Analytics remains disabled because your consent could not be saved: ${error.message}`;
      renderConsent();
      return;
    }
    state = nextState;
    consentError = '';
    onConsentAccepted(nextState);
    removeConsent();
    startTour();
  }

  function appendSkipButton(popover) {
    const skip = createElement(document, 'button', {
      className: 'onboarding-skip-button',
      text: 'Skip',
      attributes: { type: 'button' }
    });
    skip.addEventListener('click', () => close());
    popover.footerButtons?.append(skip);
  }

  function closeInternal(markSeen, destroyDriver) {
    if (mode === 'closed') return;
    mode = 'closed';
    clearSecondaryHighlights();
    removeConsent();
    const currentDriver = driverInstance;
    driverInstance = null;
    if (currentDriver && destroyDriver) currentDriver.destroy();
    if (markSeen) {
      const nextState = { ...state, wizardSeen: true };
      try {
        saveOnboardingState(nextState, storage);
      } catch {
        // Dismiss the current session even when persistent storage is unavailable.
      }
      state = nextState;
    }
    (launchButton ?? previousFocus)?.focus?.();
  }

  function moveTo(index, driver = driverInstance) {
    if (mode !== 'wizard' || index < 0 || index >= destinations.length || !driver) return;
    activeIndex = index;
    navigateTo(index);
    driver.moveTo(index);
  }

  function startTour() {
    destinations = tourDestinations();
    const steps = driverSteps(destinations);
    activeIndex = 0;
    clearSecondaryHighlights();
    mode = 'wizard';
    navigateTo(0);
    driverInstance = driverFactory({
      steps,
      animate: false,
      showProgress: true,
      showButtons: ['previous', 'next'],
      nextBtnText: 'Next',
      prevBtnText: 'Back',
      doneBtnText: 'Done',
      closeBtnLabel: 'Close tour',
      onPopoverRender: (popover, options) => {
        appendSkipButton(popover);
        positionTourLayer(popover, options);
      },
      onHighlightStarted: (_element, _step, options) => {
        const index = options.index ?? options.driver?.getActiveIndex?.() ?? activeIndex;
        highlightSecondaryTargets(index);
      },
      onNextClick: (_element, _step, options) => {
        const nextIndex = (options.index ?? activeIndex) + 1;
        if (nextIndex >= destinations.length) {
          closeInternal(true, true);
          return;
        }
        moveTo(nextIndex, options.driver);
      },
      onPrevClick: (_element, _step, options) => {
        moveTo((options.index ?? activeIndex) - 1, options.driver);
      },
      onDoneClick: () => closeInternal(true, true),
      onCloseClick: () => closeInternal(true, true),
      onDestroyed: () => {
        if (mode === 'wizard') closeInternal(true, false);
      }
    });
    driverInstance.drive();
  }

  function open() {
    if (destroyed) return;
    previousFocus = document.activeElement;
    if (!state.consentAccepted) {
      mode = 'consent';
      consentError = '';
      createConsent();
      return;
    }
    startTour();
  }

  function close() {
    closeInternal(true, true);
  }

  function reset(nextState) {
    if (destroyed) return;
    closeInternal(false, true);
    state = { ...nextState };
    consentError = '';
  }

  function next() {
    if (mode !== 'wizard') return;
    if (activeIndex === destinations.length - 1) {
      close();
      return;
    }
    moveTo(activeIndex + 1);
  }

  function back() {
    if (mode !== 'wizard' || activeIndex === 0) return;
    moveTo(activeIndex - 1);
  }

  function render() {
    if (mode === 'consent') renderConsent();
    if (mode === 'wizard') driverInstance?.refresh();
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    closeInternal(false, true);
  }

  return Object.freeze({ open, close, next, back, render, reset, destroy });
}
