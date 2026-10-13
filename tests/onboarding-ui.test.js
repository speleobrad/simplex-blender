import test from 'node:test';
import assert from 'node:assert/strict';
import { ONBOARDING_STORAGE_KEY } from '../js/onboarding.js';
import { createOnboardingController } from '../js/ui/onboarding.js';

class FakeElement {
  constructor(tagName, document) {
    this.tagName = tagName;
    this.ownerDocument = document;
    this.attributes = new Map();
    this.children = [];
    this.parentNode = null;
    this.listeners = new Map();
    this.style = {
      values: new Map(),
      setProperty: (name, value) => this.style.values.set(name, String(value))
    };
    this.className = '';
    this.classList = {
      add: (...names) => this.#updateClasses(new Set([...this.#classes(), ...names])),
      remove: (...names) => this.#updateClasses(new Set([...this.#classes()].filter(name => !names.includes(name)))),
      toggle: (name, force) => {
        const classes = this.#classes();
        const enabled = force ?? !classes.has(name);
        if (enabled) classes.add(name);
        else classes.delete(name);
        this.#updateClasses(classes);
        return enabled;
      },
      contains: name => this.#classes().has(name)
    };
    this.hidden = false;
    this.disabled = false;
    this.inert = false;
    this.tabIndex = 0;
    this._textContent = '';
    this._rect = { top: 120, left: 100, right: 420, bottom: 280, width: 320, height: 160 };
  }

  #classes() {
    return new Set(this.className.split(/\s+/).filter(Boolean));
  }

  #updateClasses(classes) {
    this.className = [...classes].join(' ');
  }

  get textContent() {
    return this._textContent + this.children.map(child => child.textContent).join('');
  }

  set textContent(value) {
    this._textContent = String(value);
  }

  set id(value) {
    this.setAttribute('id', value);
  }

  get id() {
    return this.getAttribute('id') ?? '';
  }

  append(...children) {
    for (const child of children) {
      child.remove?.();
      child.parentNode = this;
      this.children.push(child);
    }
  }

  replaceChildren(...children) {
    for (const child of this.children) child.parentNode = null;
    this.children = [];
    this.append(...children);
  }

  remove() {
    if (!this.parentNode) return;
    this.parentNode.children = this.parentNode.children.filter(child => child !== this);
    this.parentNode = null;
  }

  setAttribute(name, value) {
    const normalized = String(value);
    this.attributes.set(name, normalized);
    if (name === 'id') this.ownerDocument.elements.set(normalized, this);
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type, listener) {
    this.listeners.get(type)?.delete(listener);
  }

  dispatchEvent(event) {
    event.target ??= this;
    event.currentTarget = this;
    event.preventDefault ??= () => { event.defaultPrevented = true; };
    for (const listener of this.listeners.get(event.type) ?? []) listener(event);
    return !event.defaultPrevented;
  }

  focus() {
    this.ownerDocument.activeElement = this;
  }

  getBoundingClientRect() {
    return this._rect;
  }

  scrollIntoView() {}
}

class FakeWindow {
  constructor() {
    this.listeners = new Map();
    this.innerWidth = 1280;
    this.innerHeight = 800;
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type, listener) {
    this.listeners.get(type)?.delete(listener);
  }

  dispatchEvent(event) {
    event.preventDefault ??= () => { event.defaultPrevented = true; };
    for (const listener of this.listeners.get(event.type) ?? []) listener(event);
  }

  listenerCount() {
    return [...this.listeners.values()].reduce((total, listeners) => total + listeners.size, 0);
  }
}

function createFakeDocument() {
  const window = new FakeWindow();
  const document = {
    elements: new Map(),
    activeElement: null,
    defaultView: window,
    createElement(tagName) {
      return new FakeElement(tagName, document);
    },
    getElementById(id) {
      return document.elements.get(id) ?? null;
    }
  };
  document.body = document.createElement('body');
  return { document, window };
}

function memoryStorage({ failWrites = false } = {}) {
  const values = new Map();
  return {
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) {
      if (failWrites) throw new Error('Storage unavailable');
      values.set(key, String(value));
    },
    readState() { return JSON.parse(values.get(ONBOARDING_STORAGE_KEY)); }
  };
}

function findElement(root, predicate) {
  if (predicate(root)) return root;
  for (const child of root.children) {
    const found = findElement(child, predicate);
    if (found) return found;
  }
  return null;
}

function findButton(root, name) {
  const button = findElement(root, element => element.tagName === 'button' && element.textContent === name);
  assert.ok(button, `expected ${name} button`);
  return button;
}

function createController(options = {}) {
  const { document, window } = createFakeDocument();
  const storage = options.storage ?? memoryStorage();
  const launchButton = document.createElement('button');
  document.body.append(launchButton);
  const navigations = [];
  let consentAccepted = 0;
  const controller = createOnboardingController({
    document,
    storage,
    initialState: options.initialState ?? { consentAccepted: true, wizardSeen: false },
    launchButton,
    onNavigate: tab => navigations.push(tab),
    onConsentAccepted: () => { consentAccepted += 1; }
  });
  return {
    controller,
    document,
    window,
    storage,
    launchButton,
    navigations,
    get consentAccepted() { return consentAccepted; }
  };
}

function dialog(document) {
  const root = findElement(document.body, element => element.getAttribute('role') === 'dialog');
  assert.ok(root, 'expected onboarding dialog');
  return root;
}

test('consent mode presents an accessible browser-storage disclosure without a target spotlight', () => {
  const fixture = createController({ initialState: { consentAccepted: false, wizardSeen: false } });

  fixture.controller.open({ requireConsent: true });

  const root = dialog(fixture.document);
  assert.equal(root.getAttribute('aria-modal'), 'true');
  for (const detail of ['settings', 'supply banks', 'theme', 'onboarding state', 'this browser']) {
    assert.equal(root.textContent.includes(detail), true, `expected disclosure to name ${detail}`);
  }
  assert.equal(findElement(root, element => element.getAttribute('data-onboarding-highlight') === 'true'), null);
  assert.equal(findElement(root, element => element.tagName === 'button' && element.textContent === 'Skip'), null);
});

test('consent action persists acceptance, loads analytics callback, and opens Welcome', () => {
  const fixture = createController({ initialState: { consentAccepted: false, wizardSeen: false } });
  fixture.controller.open({ requireConsent: true });

  findButton(dialog(fixture.document), 'Accept and continue').dispatchEvent({ type: 'click' });

  assert.deepEqual(fixture.storage.readState(), { consentAccepted: true, wizardSeen: false });
  assert.equal(fixture.consentAccepted, 1);
  assert.equal(dialog(fixture.document).textContent.includes('Welcome to Simplex Blender'), true);
});

test('failed consent persistence remains visible and does not enable analytics', () => {
  const fixture = createController({
    initialState: { consentAccepted: false, wizardSeen: false },
    storage: memoryStorage({ failWrites: true })
  });
  fixture.controller.open({ requireConsent: true });

  findButton(dialog(fixture.document), 'Accept and continue').dispatchEvent({ type: 'click' });

  const root = dialog(fixture.document);
  assert.equal(root.textContent.includes('Storage unavailable'), true);
  assert.ok(findButton(root, 'Accept and continue'));
  assert.equal(fixture.consentAccepted, 0);
});

test('Skip closes the wizard even when dismissal persistence is unavailable', () => {
  const fixture = createController({ storage: memoryStorage({ failWrites: true }) });
  fixture.controller.open();

  findButton(dialog(fixture.document), 'Skip').dispatchEvent({ type: 'click' });

  assert.equal(findElement(fixture.document.body, element => element.getAttribute('role') === 'dialog'), null);
  assert.equal(fixture.document.activeElement, fixture.launchButton);
});

test('button navigation follows tour tabs and backs up to Recipe without going negative', () => {
  const fixture = createController();
  fixture.controller.open();
  fixture.navigations.length = 0;

  for (let index = 0; index < 5; index += 1) findButton(dialog(fixture.document), 'Next').dispatchEvent({ type: 'click' });
  assert.deepEqual(fixture.navigations, [null, null, null, 'summary', 'water-pressure']);

  findButton(dialog(fixture.document), 'Back').dispatchEvent({ type: 'click' });
  assert.equal(fixture.navigations.at(-1), 'summary');
  for (let index = 0; index < 4; index += 1) findButton(dialog(fixture.document), 'Back').dispatchEvent({ type: 'click' });
  const back = findButton(dialog(fixture.document), 'Back');
  assert.equal(back.disabled, true);
  back.dispatchEvent({ type: 'click' });
  assert.equal(dialog(fixture.document).textContent.includes('Welcome to Simplex Blender'), true);
  assert.equal(fixture.navigations.at(-1), null);
});

test('closing persists dismissal, restores the launch focus, and later opens at Welcome', () => {
  const fixture = createController();
  fixture.controller.open();
  fixture.controller.close({ markSeen: true });

  assert.deepEqual(fixture.storage.readState(), { consentAccepted: true, wizardSeen: true });
  assert.equal(fixture.document.activeElement, fixture.launchButton);
  assert.equal(findElement(fixture.document.body, element => element.getAttribute('role') === 'dialog'), null);

  fixture.controller.open();
  assert.equal(dialog(fixture.document).textContent.includes('Welcome to Simplex Blender'), true);
});

test('keyboard containment cycles wizard controls and Escape dismisses the tour', () => {
  const fixture = createController();
  fixture.controller.open();
  const root = dialog(fixture.document);
  assert.equal(fixture.document.activeElement.getAttribute('id'), 'onboarding-title');

  fixture.window.dispatchEvent({ type: 'keydown', key: 'Tab' });
  assert.equal(fixture.document.activeElement, findButton(root, 'Skip'));
  fixture.window.dispatchEvent({ type: 'keydown', key: 'Tab', shiftKey: true });
  assert.equal(fixture.document.activeElement, findButton(root, 'Next'));
  fixture.window.dispatchEvent({ type: 'keydown', key: 'Escape' });

  assert.equal(findElement(fixture.document.body, element => element.getAttribute('role') === 'dialog'), null);
  assert.deepEqual(fixture.storage.readState(), { consentAccepted: true, wizardSeen: true });
});

test('destroy removes the overlay and registered window listeners', () => {
  const fixture = createController();
  fixture.controller.open();
  assert.equal(fixture.window.listenerCount(), 3);

  fixture.controller.destroy();

  assert.equal(findElement(fixture.document.body, element => element.getAttribute('role') === 'dialog'), null);
  assert.equal(fixture.window.listenerCount(), 0);
});
