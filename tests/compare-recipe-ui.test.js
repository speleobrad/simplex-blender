import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { renderCompareRecipe } from '../js/ui/compare-recipe.js';

class FakeElement {
  constructor(tagName = 'div') {
    this.tagName = tagName;
    this.attributes = new Map();
    this.children = [];
    this.className = '';
    this.hidden = false;
    this.disabled = false;
    this._textContent = '';
  }

  get textContent() {
    return this._textContent + this.children.map(child => child.textContent).join('');
  }

  set textContent(value) {
    this._textContent = String(value);
  }

  append(...children) {
    this.children.push(...children);
  }

  replaceChildren(...children) {
    this.children = children;
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }
}

function createFakeDocument() {
  return {
    createElement(tagName) {
      return new FakeElement(tagName);
    }
  };
}

function findAll(element, predicate, matches = []) {
  if (predicate(element)) matches.push(element);
  for (const child of element.children) findAll(child, predicate, matches);
  return matches;
}

function hasAttribute(element, name, value) {
  return element.attributes.get(name) === value;
}

const rows = [
  { id: 'keep-1', type: 'keep' },
  {
    id: 'add-1',
    type: 'add',
    bankId: 'helium-bank',
    pressureAddedBar: 50,
    targetPressureBar: 100,
    pressureInputMode: 'added'
  },
  {
    id: 'wait-1',
    type: 'wait',
    waitMode: 'target',
    waitMinutes: 15,
    targetTemperatureC: 20
  }
];

const banks = [
  { id: 'helium-bank', name: 'Helium bank', enabled: true, volumeL: 50, pressureBar: 200, oxygenPercent: 0, heliumPercent: 100 },
  { id: 'unnamed-bank', name: '  ', enabled: true, volumeL: 12, pressureBar: 200, oxygenPercent: 21, heliumPercent: 0 },
  { id: 'disabled-bank', name: 'Disabled bank', enabled: false, volumeL: 12, pressureBar: 200, oxygenPercent: 21, heliumPercent: 0 }
];

test('renders enabled supply-bank controls and synchronized pressure fields for add rows', () => {
  const previousDocument = globalThis.document;
  globalThis.document = createFakeDocument();
  const container = new FakeElement();

  try {
    renderCompareRecipe(container, { rows, banks, errors: [], pressureStarts: { 'add-1': 50 } });
    const cards = findAll(container, element => element.tagName === 'fieldset');
    assert.equal(cards.length, 3);

    for (const field of ['bankId', 'pressureAddedBar', 'targetPressureBar']) {
      assert.equal(findAll(container, element => hasAttribute(element, 'data-row-id', 'add-1') && hasAttribute(element, 'data-compare-field', field)).length, 1, `add row has ${field}`);
    }
    assert.equal(findAll(container, element => hasAttribute(element, 'data-row-id', 'add-1') && hasAttribute(element, 'data-compare-field', 'method')).length, 0);
    assert.equal(findAll(container, element => hasAttribute(element, 'data-row-id', 'add-1') && hasAttribute(element, 'data-compare-field', 'sourcePressureBar')).length, 0);
    assert.equal(findAll(container, element => hasAttribute(element, 'data-row-id', 'add-1') && hasAttribute(element, 'data-compare-field', 'oxygenPercent')).length, 0);
    assert.match(container.textContent, /Helium bank/);
    assert.match(container.textContent, /O₂ 0%.*He 100%/);
    assert.match(container.textContent, /50 L.*200 bar/);

    const added = findAll(container, element => hasAttribute(element, 'data-row-id', 'add-1') && hasAttribute(element, 'data-compare-field', 'pressureAddedBar'))[0];
    const target = findAll(container, element => hasAttribute(element, 'data-row-id', 'add-1') && hasAttribute(element, 'data-compare-field', 'targetPressureBar'))[0];
    assert.equal(added.attributes.get('data-pressure-input-mode'), 'added');
    assert.equal(target.attributes.get('data-pressure-input-mode'), 'target');
    assert.equal(target.value, 100);
    assert.doesNotMatch(container.textContent, /Disabled bank|unnamed-bank/);
    assert.equal(findAll(container, element => element.tagName === 'option' && hasAttribute(element, 'value', 'unnamed-bank')).length, 0);
  } finally {
    globalThis.document = previousDocument;
  }
});

test('renders Compressor Air as an unlimited add source alongside finite banks', () => {
  const previousDocument = globalThis.document;
  globalThis.document = createFakeDocument();
  const container = new FakeElement();
  const compressorRow = {
    id: 'air-1',
    type: 'add',
    bankId: 'compressor-air',
    pressureAddedBar: 50,
    targetPressureBar: 100,
    pressureInputMode: 'added'
  };

  try {
    renderCompareRecipe(container, { rows: [compressorRow], banks: [banks[0]], errors: [], pressureStarts: { 'air-1': 50 } });
    assert.equal(findAll(container, element => element.tagName === 'option' && hasAttribute(element, 'value', 'compressor-air')).length, 1);
    assert.match(container.textContent, /Compressor Air/);
    assert.match(container.textContent, /Infinite supply/);
    assert.match(container.textContent, /O₂ 21%.*He 0%/);
  } finally {
    globalThis.document = previousDocument;
  }
});

test('renders target-temperature wait controls and associates field errors', () => {
  const previousDocument = globalThis.document;
  globalThis.document = createFakeDocument();
  const container = new FakeElement();
  const errors = [{ rowId: 'wait-1', field: 'targetTemperatureC', message: 'Target temperature is unreachable.' }];

  try {
    renderCompareRecipe(container, { rows, banks, errors });

    for (const field of ['waitMode', 'targetTemperatureC']) {
      assert.equal(findAll(container, element => hasAttribute(element, 'data-row-id', 'wait-1') && hasAttribute(element, 'data-compare-field', field)).length, 1, `wait row has ${field}`);
    }
    assert.equal(findAll(container, element => hasAttribute(element, 'data-row-id', 'wait-1') && hasAttribute(element, 'data-compare-field', 'targetPressureBar')).length, 0);
    assert.equal(findAll(container, element => hasAttribute(element, 'data-row-id', 'wait-1') && hasAttribute(element, 'data-compare-field', 'waitMinutes')).length, 0);
    const invalidTarget = findAll(container, element => hasAttribute(element, 'data-row-id', 'wait-1') && hasAttribute(element, 'data-compare-field', 'targetTemperatureC'))[0];
    assert.equal(invalidTarget.attributes.get('aria-invalid'), 'true');
    assert.ok(invalidTarget.attributes.get('aria-describedby'));
    assert.match(container.textContent, /Target temperature is unreachable\./);

    const controls = findAll(container, element => hasAttribute(element, 'data-row-id', 'keep-1'));
    assert.equal(controls.find(element => hasAttribute(element, 'data-action', 'move-compare-row-up')).disabled, true);
    const lastControls = findAll(container, element => hasAttribute(element, 'data-row-id', 'wait-1'));
    assert.equal(lastControls.find(element => hasAttribute(element, 'data-action', 'move-compare-row-down')).disabled, true);
  } finally {
    globalThis.document = previousDocument;
  }
});

test('provides a polite compare run status host', async () => {
  const markup = await readFile(new URL('../index.html', import.meta.url), 'utf8');

  assert.match(markup, /id="compare-run-status"[^>]*role="status"[^>]*aria-live="polite"/);
});
