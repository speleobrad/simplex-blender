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
    this.hidden = false;
    this.disabled = false;
    this._textContent = '';
    this.className = '';
    this.classList = {
      add: name => {
        this.className = [...new Set(`${this.className} ${name}`.trim().split(/\s+/).filter(Boolean))].join(' ');
      },
      remove: name => {
        this.className = this.className.split(/\s+/).filter(candidate => candidate && candidate !== name).join(' ');
      },
      contains: name => this.className.split(/\s+/).includes(name)
    };
  }

  get textContent() {
    return this._textContent + this.children.map(child => child.textContent).join('');
  }

  set textContent(value) {
    this._textContent = String(value);
  }

  append(...children) {
    for (const child of children) {
      child.parentNode = this;
      this.children.push(child);
    }
  }

  remove() {
    if (!this.parentNode) return;
    this.parentNode.children = this.parentNode.children.filter(child => child !== this);
    this.parentNode = null;
  }

  closest(selector) {
    if (selector !== 'dialog[open]') return null;
    let candidate = this.parentNode;
    while (candidate) {
      if (candidate.tagName === 'dialog' && candidate.open) return candidate;
      candidate = candidate.parentNode;
    }
    return null;
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
    if (name === 'id') this.ownerDocument.elements.set(String(value), this);
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  dispatchEvent(event) {
    for (const listener of this.listeners.get(event.type) ?? []) listener(event);
  }

  focus() {
    this.ownerDocument.activeElement = this;
  }
}

function createFakeDocument() {
  const document = {
    elements: new Map(),
    querySelectorCalls: [],
    activeElement: null,
    createElement(tagName) {
      return new FakeElement(tagName, document);
    },
    getElementById(id) {
      return document.elements.get(id) ?? null;
    },
    querySelector(selector) {
      document.querySelectorCalls.push(selector);
      const match = selector.match(/^\[data-result-host="([^"]+)"\] \[data-result-key="([^"]+)"\]$/);
      if (!match) return null;
      const find = (root, predicate) => {
        if (predicate(root)) return root;
        for (const child of root.children) {
          const found = find(child, predicate);
          if (found) return found;
        }
        return null;
      };
      const host = find(document.body, element => element.getAttribute('data-result-host') === match[1]);
      return host
        ? find(host, element => element.getAttribute('data-result-key') === match[2])
        : null;
    }
  };
  document.defaultView = { driver: { js: {} } };
  document.body = document.createElement('body');
  return document;
}

function memoryStorage({ failWrites = false } = {}) {
  const values = new Map();
  let writeCount = 0;
  return {
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) {
      writeCount += 1;
      if (failWrites) throw new Error('Storage unavailable');
      values.set(key, String(value));
    },
    readState() { return JSON.parse(values.get(ONBOARDING_STORAGE_KEY)); },
    writeCount() { return writeCount; }
  };
}

class FakeDriver {
  constructor(config) {
    this.config = config;
    this.active = false;
    this.index = null;
    this.destroyCount = 0;
  }

  drive(index = 0) {
    this.active = true;
    this.moveTo(index);
  }

  moveTo(index) {
    this.index = index;
    const step = this.config.steps[index];
    this.config.onHighlightStarted?.(null, step, {
      config: this.config,
      state: { activeIndex: index },
      driver: this,
      index
    });
  }

  moveNext() {
    this.moveTo(this.index + 1);
  }

  movePrevious() {
    this.moveTo(this.index - 1);
  }

  clickNext() {
    const step = this.config.steps[this.index];
    const callback = this.index === this.config.steps.length - 1
      ? this.config.onDoneClick
      : this.config.onNextClick;
    callback?.(null, step, {
      config: this.config,
      state: { activeIndex: this.index },
      driver: this,
      index: this.index
    });
  }

  clickPrevious() {
    const step = this.config.steps[this.index];
    this.config.onPrevClick?.(null, step, {
      config: this.config,
      state: { activeIndex: this.index },
      driver: this,
      index: this.index
    });
  }

  clickClose() {
    const step = this.config.steps[this.index];
    this.config.onCloseClick?.(null, step, {
      config: this.config,
      state: { activeIndex: this.index },
      driver: this,
      index: this.index
    });
  }

  destroy() {
    this.destroyCount += 1;
    this.active = false;
    this.config.onDestroyed?.();
  }
}

function createController(options = {}) {
  const document = createFakeDocument();
  const storage = options.storage ?? memoryStorage();
  const launchButton = document.createElement('button');
  document.body.append(launchButton);
  for (const id of ['primary-navigation', 'supply-banks-section', 'equipment-section', 'ambient-temperature', 'target-temperature']) {
    const target = document.createElement(id.endsWith('-section') ? 'section' : 'button');
    target.setAttribute('id', id);
    document.body.append(target);
  }
  const resultKeys = ['mixing-steps-section', 'results-tablist'];
  if (options.resultLayout === 'ordinary') {
    for (const key of resultKeys) {
      const target = document.createElement('button');
      target.setAttribute('id', key);
      document.body.append(target);
    }
  } else {
    for (const [hostName, idPrefix] of [['blending', 'blend'], ['what-if', 'what-if']]) {
      const resultHost = document.createElement('section');
      resultHost.setAttribute('data-result-host', hostName);
      for (const key of resultKeys) {
        const target = document.createElement('button');
        target.setAttribute('id', `${idPrefix}-${key}`);
        target.setAttribute('data-result-key', key);
        resultHost.append(target);
      }
      document.body.append(resultHost);
    }
  }
  const settingsDialog = document.createElement('dialog');
  settingsDialog.open = true;
  const equipmentPane = document.createElement('div');
  equipmentPane.setAttribute('id', 'settings-pane-equipment');
  settingsDialog.append(equipmentPane);
  document.body.append(settingsDialog);
  const navigations = [];
  const drivers = [];
  let acceptedState = null;
  const createDriver = config => {
    const instance = new FakeDriver(config);
    drivers.push(instance);
    return instance;
  };
  document.defaultView.driver.js.driver = createDriver;
  const controllerOptions = {
    document,
    storage,
    initialState: options.initialState ?? { consentAccepted: true, wizardSeen: false },
    launchButton,
    onNavigate: destination => navigations.push(destination),
    onConsentAccepted: nextState => {
      acceptedState = nextState;
    }
  };
  if (!options.useDefaultDriver) controllerOptions.createDriver = createDriver;
  const controller = createOnboardingController(controllerOptions);
  return {
    controller,
    document,
    storage,
    launchButton,
    navigations,
    drivers,
    get acceptedState() { return acceptedState; }
  };
}

function resultTarget(document, key, host = 'blending') {
  return document.querySelector(`[data-result-host="${host}"] [data-result-key="${key}"]`);
}

function consentDialog(document) {
  return document.body.children.find(element => element.getAttribute('role') === 'dialog');
}

function findElement(root, predicate) {
  if (predicate(root)) return root;
  for (const child of root.children) {
    const found = findElement(child, predicate);
    if (found) return found;
  }
  return null;
}

function buttonWithText(root, text) {
  return findElement(root, element => element.tagName === 'button' && element.textContent === text);
}

test('uses the browser Driver.js factory when no test adapter is supplied', () => {
  const fixture = createController({ useDefaultDriver: true });

  fixture.controller.open();

  assert.equal(fixture.drivers[0].active, true);
});

test('opening an accepted user creates a Driver.js tour for the new layout', () => {
  const fixture = createController();

  fixture.controller.open();

  assert.equal(fixture.drivers.length, 1);
  assert.equal(fixture.drivers[0].active, true);
  assert.equal(fixture.drivers[0].index, 0);
  assert.equal(fixture.drivers[0].config.animate, false);
  const steps = fixture.drivers[0].config.steps;
  assert.equal(steps.length, 8);
  assert.equal(steps[0].element, '#primary-navigation');
  assert.equal(steps[0].popover.title, 'Main menu');
  assert.equal(steps[1].element, '#supply-banks-section');
  assert.equal(steps[2].element, '#equipment-section');
  assert.equal(steps[3].element, '#settings-pane-equipment');
  assert.equal(steps[4].element, '#working-tank-section');
  assert.equal(steps[5].element, '#ambient-temperature');
  assert.equal(steps[6].element, resultTarget(fixture.document, 'mixing-steps-section'));
  assert.notEqual(steps[6].element, resultTarget(fixture.document, 'mixing-steps-section', 'what-if'));
  assert.equal(steps[7].element, resultTarget(fixture.document, 'results-tablist'));
  assert.equal(steps[7].popover.progressText, 'Step 8 of 8');
});

test('temperatures step highlights the in-water target beside the ambient input', () => {
  const fixture = createController();
  fixture.controller.open();
  const driver = fixture.drivers[0];
  const targetInput = fixture.document.getElementById('target-temperature');

  for (let index = 0; index < 5; index += 1) driver.clickNext();
  assert.equal(targetInput.classList.contains('onboarding-secondary-highlight'), true);
  driver.clickNext();
  assert.equal(targetInput.classList.contains('onboarding-secondary-highlight'), false);
});

test('result target popovers resolve through the scoped Blending selector', () => {
  const fixture = createController();
  fixture.controller.open();
  const driver = fixture.drivers[0];

  for (let index = 0; index < 6; index += 1) driver.clickNext();

  const popover = fixture.document.createElement('div');
  driver.config.onPopoverRender({ wrapper: popover }, { index: 6, driver });

  assert.equal(
    fixture.document.querySelectorCalls.includes('[data-result-host="blending"] [data-result-key="mixing-steps-section"]'),
    true
  );
  assert.equal(popover.parentNode, fixture.document.body);
});

test('result tour primary targets fall back to ordinary IDs', () => {
  const fixture = createController({ resultLayout: 'ordinary' });
  fixture.controller.open();
  const driver = fixture.drivers[0];
  const target = fixture.document.getElementById('mixing-steps-section');

  assert.equal(driver.config.steps[6].element, target);
  for (let index = 0; index < 6; index += 1) driver.clickNext();

  const popover = fixture.document.createElement('div');
  driver.config.onPopoverRender({ wrapper: popover }, { index: 6, driver });

  assert.equal(
    fixture.document.querySelectorCalls.includes('[data-result-host="blending"] [data-result-key="mixing-steps-section"]'),
    true
  );
  assert.equal(popover.parentNode, fixture.document.body);
});

test('equipment tour popover moves into the native Settings dialog layer', () => {
  const fixture = createController();
  fixture.controller.open();
  const driver = fixture.drivers[0];

  for (let index = 0; index < 3; index += 1) driver.clickNext();

  const popover = fixture.document.createElement('div');
  const footer = fixture.document.createElement('div');
  driver.config.onPopoverRender(
    { wrapper: popover, footerButtons: footer },
    { index: 3, driver }
  );

  assert.equal(popover.parentNode.tagName, 'dialog');
});

test('Driver navigation selects the screen needed by each destination', () => {
  const fixture = createController();
  fixture.controller.open();
  const driver = fixture.drivers[0];

  const expected = [
    { screen: 'blending', tab: null, settingsCategory: null },
    { screen: 'inventory', tab: null, settingsCategory: null },
    { screen: 'inventory', tab: null, settingsCategory: null },
    { screen: 'blending', tab: null, settingsCategory: 'equipment' },
    { screen: 'blending', tab: null, settingsCategory: null },
    { screen: 'blending', tab: null, settingsCategory: null },
    { screen: 'blending', tab: 'recipe', settingsCategory: null },
    { screen: 'blending', tab: null, settingsCategory: null }
  ];
  assert.deepEqual(fixture.navigations.at(-1), expected[0]);
  for (let index = 1; index < expected.length; index += 1) {
    driver.clickNext();
    assert.deepEqual(fixture.navigations.at(-1), expected[index]);
  }
});

test('public next and back methods move the Driver.js tour', () => {
  const fixture = createController();
  fixture.controller.open();

  fixture.controller.next();
  assert.equal(fixture.drivers[0].index, 1);
  fixture.controller.back();
  assert.equal(fixture.drivers[0].index, 0);
});

test('closing the Driver.js tour persists dismissal and restores launch focus', () => {
  const fixture = createController();
  fixture.controller.open();
  const driver = fixture.drivers[0];

  driver.clickClose();

  assert.equal(driver.destroyCount, 1);
  assert.deepEqual(fixture.storage.readState(), { consentAccepted: true, wizardSeen: true });
  assert.equal(fixture.document.activeElement, fixture.launchButton);
});

test('Driver.js popover adds a Skip action that dismisses the tour', () => {
  const fixture = createController();
  fixture.controller.open();
  const driver = fixture.drivers[0];
  const footer = fixture.document.createElement('div');
  driver.config.onPopoverRender({ footerButtons: footer }, { index: 0, driver });
  const skip = footer.children.at(-1);
  assert.equal(skip.className, 'onboarding-skip-button');
  skip.dispatchEvent({ type: 'click' });

  assert.equal(driver.destroyCount, 1);
  assert.deepEqual(fixture.storage.readState(), { consentAccepted: true, wizardSeen: true });
});

test('finishing the tour with Done returns to the recipe tab', () => {
  const fixture = createController();
  fixture.controller.open();
  const driver = fixture.drivers[0];

  for (let index = 0; index < driver.config.steps.length - 1; index += 1) driver.clickNext();
  driver.clickNext();

  assert.deepEqual(fixture.navigations.at(-1), { screen: 'blending', tab: 'recipe', settingsCategory: null });
});

test('unaccepted users receive the consent gate before Driver.js starts', () => {
  const fixture = createController({ initialState: { consentAccepted: false, wizardSeen: false } });

  fixture.controller.open();

  const dialog = consentDialog(fixture.document);
  assert.ok(dialog);
  assert.match(dialog.textContent, /anonymous usage analytics/i);
  assert.equal(fixture.drivers.length, 0);
  buttonWithText(dialog, 'Accept and continue').dispatchEvent({ type: 'click' });

  assert.equal(fixture.drivers.length, 1);
  assert.deepEqual(fixture.storage.readState(), { consentAccepted: true, wizardSeen: false });
  assert.deepEqual(fixture.acceptedState, { consentAccepted: true, wizardSeen: false });
});

test('consent traps focus and makes background content inert', () => {
  const fixture = createController({ initialState: { consentAccepted: false, wizardSeen: false } });

  fixture.controller.open();

  const dialog = consentDialog(fixture.document);
  const accept = buttonWithText(dialog, 'Accept and continue');
  assert.equal(fixture.document.activeElement, accept);
  assert.equal(fixture.launchButton.inert, true);

  fixture.document.activeElement = fixture.launchButton;
  const event = {
    type: 'keydown',
    key: 'Tab',
    shiftKey: false,
    preventDefault() {
      this.defaultPrevented = true;
    }
  };
  dialog.dispatchEvent(event);

  assert.equal(event.defaultPrevented, true);
  assert.equal(fixture.document.activeElement, accept);
});

test('failed consent persistence keeps the consent gate open and does not start Driver.js', () => {
  const fixture = createController({
    initialState: { consentAccepted: false, wizardSeen: false },
    storage: memoryStorage({ failWrites: true })
  });

  fixture.controller.open();
  const dialog = consentDialog(fixture.document);
  buttonWithText(dialog, 'Accept and continue').dispatchEvent({ type: 'click' });

  assert.equal(fixture.drivers.length, 0);
  assert.match(dialog.textContent, /could not be saved/i);
});

test('reset destroys the active tour without saving dismissal and restores consent mode', () => {
  const fixture = createController();
  fixture.controller.open();
  const driver = fixture.drivers[0];

  fixture.controller.reset({ consentAccepted: false, wizardSeen: false });

  assert.equal(driver.destroyCount, 1);
  assert.equal(fixture.storage.writeCount(), 0);
  fixture.controller.open();
  assert.ok(consentDialog(fixture.document));
});

test('destroy removes Driver.js without persisting a seen state', () => {
  const fixture = createController();
  fixture.controller.open();

  fixture.controller.destroy();

  assert.equal(fixture.drivers[0].destroyCount, 1);
  assert.equal(fixture.storage.writeCount(), 0);
});
