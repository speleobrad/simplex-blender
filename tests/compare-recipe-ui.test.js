import test from 'node:test';
import assert from 'node:assert/strict';
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
  { id: 'drain-1', type: 'drain', targetPressureBar: 40 },
  {
    id: 'add-1',
    type: 'add',
    gas: { presetName: 'Nitrox 32', name: 'Nitrox 32', oxygenPercent: 32, heliumPercent: 0 },
    targetPressureBar: 180,
    method: 'boost',
    sourcePressureBar: 150
  },
  { id: 'wait-1', type: 'wait', waitMinutes: 15 }
];

const gasPresets = [
  { name: 'Air', oxygenPercent: 21, heliumPercent: 0 },
  { name: 'Nitrox 32', oxygenPercent: 32, heliumPercent: 0 }
];

test('renders each recipe row with complete add-gas controls and delegated actions', () => {
  const previousDocument = globalThis.document;
  globalThis.document = createFakeDocument();
  const container = new FakeElement();

  try {
    renderCompareRecipe(container, { rows, gasPresets, errors: [] });
    const cards = findAll(container, element => element.tagName === 'fieldset');
    assert.equal(cards.length, 4);
    assert.match(container.textContent, /Keep/);
    assert.match(container.textContent, /Drain/);
    assert.match(container.textContent, /Add gas/);
    assert.match(container.textContent, /Wait/);

    for (const field of ['presetName', 'name', 'oxygenPercent', 'heliumPercent', 'targetPressureBar', 'method', 'sourcePressureBar']) {
      assert.equal(findAll(container, element => hasAttribute(element, 'data-row-id', 'add-1') && hasAttribute(element, 'data-compare-field', field)).length, 1, `add row has ${field}`);
    }
    assert.match(container.textContent, /Custom/);
    assert.match(container.textContent, /Nitrox 32/);
    assert.equal(findAll(container, element => hasAttribute(element, 'data-action', 'add-compare-row')).length, 1);
    assert.equal(findAll(container, element => hasAttribute(element, 'data-action', 'run-compare')).length, 1);
  } finally {
    globalThis.document = previousDocument;
  }
});

test('shows boost source pressure, compressor errors, row boundaries, and field error association', () => {
  const previousDocument = globalThis.document;
  globalThis.document = createFakeDocument();
  const container = new FakeElement();
  const errors = [
    { rowId: 'add-1', field: 'method', message: 'Compressor is available only for Air.' },
    { rowId: 'add-1', field: 'targetPressureBar', message: 'Target pressure must not decrease.' }
  ];

  try {
    renderCompareRecipe(container, {
      rows: [{ ...rows[0] }, { ...rows[2], method: 'compressor' }, { ...rows[3] }],
      gasPresets,
      errors
    });

    const sourcePressure = findAll(container, element => hasAttribute(element, 'data-row-id', 'add-1') && hasAttribute(element, 'data-compare-field', 'sourcePressureBar'))[0];
    assert.equal(sourcePressure.hidden, true);
    assert.match(container.textContent, /Compressor is available only for Air\./);
    assert.match(container.textContent, /Target pressure must not decrease\./);

    const controls = findAll(container, element => hasAttribute(element, 'data-row-id', 'keep-1'));
    assert.equal(controls.find(element => hasAttribute(element, 'data-action', 'move-compare-row-up')).disabled, true);
    const lastControls = findAll(container, element => hasAttribute(element, 'data-row-id', 'wait-1'));
    assert.equal(lastControls.find(element => hasAttribute(element, 'data-action', 'move-compare-row-down')).disabled, true);

    const invalidTarget = findAll(container, element => hasAttribute(element, 'data-row-id', 'add-1') && hasAttribute(element, 'data-compare-field', 'targetPressureBar'))[0];
    assert.equal(invalidTarget.attributes.get('aria-invalid'), 'true');
    assert.ok(invalidTarget.attributes.get('aria-describedby'));
  } finally {
    globalThis.document = previousDocument;
  }
});
