import {
  WIZARD_STEPS,
  loadOnboardingState,
  saveOnboardingState
} from '../onboarding.js';

const SPOTLIGHT_PADDING = 8;
const CALLOUT_GAP = 16;
const NARROW_VIEWPORT = 640;

function createElement(document, tagName, { className, id, text, attributes } = {}) {
  const element = document.createElement(tagName);
  if (className) element.className = className;
  if (id) element.id = id;
  if (text !== undefined) element.textContent = text;
  for (const [name, value] of Object.entries(attributes ?? {})) element.setAttribute(name, value);
  return element;
}

function rectEdge(rect, edge) {
  if (typeof rect[edge] === 'number') return rect[edge];
  return edge === 'right' ? rect.left + rect.width : rect.top + rect.height;
}

function setCoordinate(element, name, value) {
  element.style.setProperty(name, `${Math.round(value)}px`);
}

export function createOnboardingController({
  document,
  storage,
  initialState = loadOnboardingState(storage),
  onNavigate = () => {},
  onConsentAccepted = () => {},
  launchButton = null
}) {
  const window = document.defaultView ?? globalThis.window;
  let state = { ...initialState };
  let mode = 'closed';
  let stepIndex = 0;
  let previousFocus = null;
  let activeTarget = null;
  let root;
  let scrim;
  let highlight;
  let callout;
  let heading;
  let body;
  let progress;
  let error;
  let notice;
  let controls;
  let consentError = '';
  let destroyed = false;
  const boundHandlers = new Set();

  function listen(target, type, handler) {
    target?.addEventListener(type, handler);
    boundHandlers.add({ target, type, handler });
  }

  function removeListeners() {
    for (const { target, type, handler } of boundHandlers) target?.removeEventListener(type, handler);
    boundHandlers.clear();
  }

  function restoreTarget() {
    if (!activeTarget) return;
    activeTarget.element.inert = activeTarget.inert;
    activeTarget = null;
  }

  function setActiveTarget(target) {
    if (activeTarget?.element === target) return;
    restoreTarget();
    if (!target) return;
    activeTarget = { element: target, inert: target.inert };
    target.inert = true;
  }

  function focusDialogHeading() {
    heading.focus?.();
  }

  function currentControls() {
    return [...controls.children].filter(control => !control.disabled && !control.hidden);
  }

  function updateGeometry() {
    if (mode !== 'wizard') return;
    const step = WIZARD_STEPS[stepIndex];
    const target = step.targetId ? document.getElementById(step.targetId) : null;

    if (!target) {
      restoreTarget();
      highlight.remove();
      root.classList.remove('onboarding-overlay--spotlight');
      callout.classList.remove('onboarding-callout--bottom-sheet');
      callout.classList.add('onboarding-callout--centered');
      return;
    }

    target.scrollIntoView?.({ block: 'center', inline: 'nearest' });
    setActiveTarget(target);
    if (!highlight.parentNode) root.append(highlight);
    root.classList.add('onboarding-overlay--spotlight');
    callout.classList.remove('onboarding-callout--centered');

    const viewportWidth = window?.innerWidth ?? 1024;
    const viewportHeight = window?.innerHeight ?? 768;
    const targetRect = target.getBoundingClientRect();
    const targetRight = rectEdge(targetRect, 'right');
    const targetBottom = rectEdge(targetRect, 'bottom');
    const calloutRect = callout.getBoundingClientRect();
    const calloutWidth = calloutRect.width;
    const calloutHeight = calloutRect.height;
    const availableRight = viewportWidth - targetRight - CALLOUT_GAP;
    const availableLeft = targetRect.left - CALLOUT_GAP;
    const fitsRight = availableRight >= calloutWidth;
    const fitsLeft = availableLeft >= calloutWidth;
    const below = targetBottom + CALLOUT_GAP;
    const above = targetRect.top - calloutHeight - CALLOUT_GAP;
    const fitsBelow = below + calloutHeight <= viewportHeight;
    const fitsAbove = above >= 0;
    const bottomSheet = viewportWidth < NARROW_VIEWPORT || (!fitsRight && !fitsLeft && !fitsBelow && !fitsAbove);

    setCoordinate(root, '--onboarding-highlight-top', Math.max(0, targetRect.top - SPOTLIGHT_PADDING));
    setCoordinate(root, '--onboarding-highlight-left', Math.max(0, targetRect.left - SPOTLIGHT_PADDING));
    setCoordinate(root, '--onboarding-highlight-width', Math.min(viewportWidth, targetRect.width + SPOTLIGHT_PADDING * 2));
    setCoordinate(root, '--onboarding-highlight-height', Math.min(viewportHeight, targetRect.height + SPOTLIGHT_PADDING * 2));

    callout.classList.toggle('onboarding-callout--bottom-sheet', bottomSheet);
    if (bottomSheet) return;

    let left;
    let top;
    if (fitsRight) {
      left = targetRight + CALLOUT_GAP;
      top = Math.max(CALLOUT_GAP, Math.min(targetRect.top, viewportHeight - calloutHeight - CALLOUT_GAP));
    } else if (fitsLeft) {
      left = targetRect.left - calloutWidth - CALLOUT_GAP;
      top = Math.max(CALLOUT_GAP, Math.min(targetRect.top, viewportHeight - calloutHeight - CALLOUT_GAP));
    } else if (fitsBelow) {
      left = Math.max(CALLOUT_GAP, Math.min(targetRect.left, viewportWidth - calloutWidth - CALLOUT_GAP));
      top = below;
    } else {
      left = Math.max(CALLOUT_GAP, Math.min(targetRect.left, viewportWidth - calloutWidth - CALLOUT_GAP));
      top = above;
    }
    setCoordinate(root, '--onboarding-callout-left', left);
    setCoordinate(root, '--onboarding-callout-top', top);
  }

  function handleKeydown(event) {
    if (mode === 'closed') return;
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== 'Tab') return;

    const focusable = currentControls();
    if (focusable.length === 0) return;
    event.preventDefault();
    const currentIndex = focusable.indexOf(document.activeElement);
    const nextIndex = event.shiftKey
      ? (currentIndex <= 0 ? focusable.length - 1 : currentIndex - 1)
      : (currentIndex + 1) % focusable.length;
    focusable[nextIndex].focus?.();
  }

  function createButton(text, action, disabled = false) {
    const button = createElement(document, 'button', {
      className: 'onboarding-button',
      text,
      attributes: { type: 'button' }
    });
    button.disabled = disabled;
    button.addEventListener('click', action);
    return button;
  }

  function renderConsent() {
    restoreTarget();
    highlight.remove();
    root.classList.remove('onboarding-overlay--spotlight');
    heading.textContent = 'Analytics consent';
    body.textContent = 'Allow anonymous usage analytics to help improve Simplex Blender.';
    progress.textContent = '';
    notice.hidden = false;
    error.hidden = !consentError;
    error.textContent = consentError;
    callout.classList.remove('onboarding-callout--bottom-sheet');
    callout.classList.add('onboarding-callout--centered');
    controls.replaceChildren(createButton('Accept and continue', acceptConsent));
    focusDialogHeading();
  }

  function renderWizard() {
    const step = WIZARD_STEPS[stepIndex];
    notice.hidden = true;
    error.hidden = true;
    error.textContent = '';
    heading.textContent = step.title;
    body.textContent = step.body;
    progress.textContent = `Step ${stepIndex + 1} of ${WIZARD_STEPS.length}`;
    controls.replaceChildren(
      createButton('Back', back, stepIndex === 0),
      createButton('Skip', () => close()),
      createButton(stepIndex === WIZARD_STEPS.length - 1 ? 'Done' : 'Next', next)
    );
    onNavigate(step.tab ?? null);
    focusDialogHeading();
    updateGeometry();
  }

  function ensureRoot() {
    if (root) {
      if (!root.parentNode) document.body.append(root);
      return;
    }

    root = createElement(document, 'div', {
      className: 'onboarding-overlay',
      attributes: {
        role: 'dialog',
        'aria-modal': 'true',
        'aria-labelledby': 'onboarding-title'
      }
    });
    scrim = createElement(document, 'div', { className: 'onboarding-scrim', attributes: { 'aria-hidden': 'true' } });
    highlight = createElement(document, 'div', {
      className: 'onboarding-highlight',
      attributes: { 'aria-hidden': 'true', 'data-onboarding-highlight': 'true' }
    });
    callout = createElement(document, 'section', { className: 'onboarding-callout' });
    heading = createElement(document, 'h2', { id: 'onboarding-title' });
    heading.tabIndex = -1;
    body = createElement(document, 'p', { className: 'onboarding-body' });
    progress = createElement(document, 'p', { className: 'onboarding-progress', attributes: { 'aria-live': 'polite' } });
    notice = createElement(document, 'p', {
      className: 'onboarding-notice',
      text: 'Your consent preference is stored locally on this device.'
    });
    error = createElement(document, 'p', { className: 'onboarding-error', attributes: { role: 'alert' } });
    controls = createElement(document, 'div', { className: 'onboarding-controls' });
    callout.append(heading, body, progress, notice, error, controls);
    root.append(scrim, callout);
    document.body.append(root);

    listen(window, 'keydown', handleKeydown);
    listen(window, 'resize', updateGeometry);
    listen(window, 'scroll', updateGeometry);
  }

  function acceptConsent() {
    const nextState = { ...state, consentAccepted: true };
    try {
      saveOnboardingState(nextState, storage);
    } catch (caught) {
      consentError = `Analytics remains disabled because your consent could not be saved: ${caught.message}`;
      renderConsent();
      return;
    }
    state = nextState;
    consentError = '';
    onConsentAccepted();
    stepIndex = 0;
    mode = 'wizard';
    renderWizard();
  }

  function open({ requireConsent = false } = {}) {
    if (destroyed) return;
    previousFocus = document.activeElement;
    ensureRoot();
    stepIndex = 0;
    if (requireConsent && !state.consentAccepted) {
      mode = 'consent';
      consentError = '';
      renderConsent();
      return;
    }
    mode = 'wizard';
    renderWizard();
  }

  function close({ markSeen = true } = {}) {
    if (mode === 'closed') return;
    if (markSeen) {
      const nextState = { ...state, wizardSeen: true };
      saveOnboardingState(nextState, storage);
      state = nextState;
    }
    mode = 'closed';
    restoreTarget();
    root?.remove();
    (launchButton ?? previousFocus)?.focus?.();
  }

  function next() {
    if (mode !== 'wizard') return;
    if (stepIndex === WIZARD_STEPS.length - 1) {
      close();
      return;
    }
    stepIndex += 1;
    renderWizard();
  }

  function back() {
    if (mode !== 'wizard' || stepIndex === 0) return;
    stepIndex -= 1;
    renderWizard();
  }

  function render() {
    if (mode === 'consent') renderConsent();
    if (mode === 'wizard') renderWizard();
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    mode = 'closed';
    restoreTarget();
    root?.remove();
    removeListeners();
    (launchButton ?? previousFocus)?.focus?.();
  }

  return Object.freeze({ open, close, next, back, render, destroy });
}
