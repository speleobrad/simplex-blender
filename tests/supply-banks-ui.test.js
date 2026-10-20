import test from 'node:test';
import assert from 'node:assert/strict';
import { renderSupplyBanks } from '../js/ui/supply-banks.js';

class FakeElement {
  constructor(tagName = 'div') {
    this.tagName = tagName;
    this.children = [];
    this.className = '';
    this.dataset = {};
    this.attributes = new Map();
    this.value = '';
    this.type = '';
    this.checked = false;
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

  querySelectorAll(tagName) {
    const matches = [];
    const visit = element => {
      for (const child of element.children) {
        if (child.tagName === tagName) matches.push(child);
        visit(child);
      }
    };
    visit(this);
    return matches;
  }
}

function createFixture() {
  const tbody = new FakeElement('tbody');
  const document = {
    createElement: tagName => new FakeElement(tagName),
    getElementById: id => id === 'tanks-tbody' ? tbody : null
  };
  return { document, tbody };
}

test('renders inventory bank values and main-screen-sized editable controls', () => {
  const previousDocument = globalThis.document;
  const { document, tbody } = createFixture();
  globalThis.document = document;

  try {
    renderSupplyBanks([
      {
        id: 'bank-helium',
        name: 'Helium',
        volumeL: 40,
        pressureBar: 150,
        oxygenPercent: 0,
        heliumPercent: 100,
        enabled: true
      }
    ], [
      { name: 'Helium', oxygenPercent: 0, heliumPercent: 100 }
    ]);

    const inputs = tbody.querySelectorAll('input').filter(input => input.type !== 'checkbox');
    assert.deepEqual(inputs.map(input => input.value), ['Helium', 40, 150, 0, 100]);
    assert.ok(inputs.slice(1).every(input => input.className.includes('w-20')));
  } finally {
    globalThis.document = previousDocument;
  }
});
