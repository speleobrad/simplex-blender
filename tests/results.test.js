import test from 'node:test';
import assert from 'node:assert/strict';
import { renderResults } from '../js/ui/results.js';
import { isPressureAboveWorkingPressure } from '../js/ui/water-pressure.js';

class FakeElement {
  constructor(tagName = 'div') {
    this.tagName = tagName;
    this.attributes = new Map();
    this.children = [];
    this.className = '';
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
  const elements = new Map([
    ['steps-container', new FakeElement()]
  ]);
  return {
    createElement(tagName) {
      return new FakeElement(tagName);
    },
    getElementById(id) {
      return elements.get(id) ?? null;
    },
    elements
  };
}

test('marks an exhausted transfer source before its source-end pressure', () => {
  const previousDocument = globalThis.document;
  const document = createFakeDocument();
  globalThis.document = document;

  try {
    renderResults({
      feasible: true,
      blend: {
        retainedPressureBar: 0,
        retainedPercent: 0,
        ventedPressureBar: 0,
        ventedGasLitres: 0,
        heliumSalvagedLitres: 0,
        finalPressureBar: 100,
        finalOxygenPercent: 21,
        finalHeliumPercent: 0
      },
      thermal: null,
      protocolSteps: [{
        title: 'Add helium',
        description: 'Transfer helium from the source bank.',
        resultingPressureBar: 100,
        sourceEndPressureBar: 20,
        minimumSourcePressureBar: 20,
        sourceExhausted: true
      }]
    });

    const result = document.elements.get('steps-container').children[0].children[1];
    const sourceEnd = result.children[2];
    const warning = sourceEnd.children[1];
    const sourceEndValue = sourceEnd.children[2];
    assert.equal(warning.tagName, 'i');
    assert.match(warning.className, /\bfa-solid\b/);
    assert.match(warning.className, /\bfa-circle-exclamation\b/);
    assert.match(warning.className, /\btext-orange-400\b/);
    assert.ok(sourceEnd.children.indexOf(warning) < sourceEnd.children.indexOf(sourceEndValue));
    assert.match(sourceEnd.textContent, /20\.0 bar/);
  } finally {
    globalThis.document = previousDocument;
  }
});
test('renders a collapsed interim measurement control between mixing steps', () => {
  const previousDocument = globalThis.document;
  const document = createFakeDocument();
  globalThis.document = document;

  try {
    renderResults({
      feasible: true,
      blend: {
        retainedPressureBar: 50,
        retainedPercent: 100,
        ventedPressureBar: 0,
        ventedGasLitres: 0,
        heliumSalvagedLitres: 0,
        finalPressureBar: 100,
        finalOxygenPercent: 21,
        finalHeliumPercent: 0
      },
      thermal: null,
      protocolSteps: [
        { title: 'Step 1', description: 'First transfer.', resultingPressureBar: 60 },
        { title: 'Step 2', description: 'Second transfer.', resultingPressureBar: 100 }
      ]
    }, {
      cylinder: { workingPressureBar: 232 },
      thermal: { interimMeasurements: [null, null] }
    });

    const children = document.elements.get('steps-container').children;
    assert.equal(children.length, 3);
    assert.equal(children[1].tagName, 'details');
    assert.match(children[1].textContent, /record actual readings/i);
  } finally {
    globalThis.document = previousDocument;
  }
});


test('does not offer an interim reading before the first mixing transfer', () => {
  const previousDocument = globalThis.document;
  const document = createFakeDocument();
  globalThis.document = document;

  try {
    renderResults({
      feasible: true,
      blend: {
        retainedPressureBar: 50,
        retainedPercent: 100,
        ventedPressureBar: 0,
        ventedGasLitres: 0,
        heliumSalvagedLitres: 0,
        finalPressureBar: 100,
        finalOxygenPercent: 21,
        finalHeliumPercent: 0
      },
      thermal: null,
      protocolSteps: [
        { type: 'keep', title: 'Preserve gas', description: 'Keep it.', resultingPressureBar: 50 },
        { type: 'boost', title: 'Add oxygen', description: 'Add it.', resultingPressureBar: 100 }
      ]
    }, {
      cylinder: { workingPressureBar: 232 },
      thermal: { interimMeasurements: [null, null] }
    });

    const children = document.elements.get('steps-container').children;
    assert.equal(children.length, 2);
    assert.notEqual(children[0].tagName, 'details');
  } finally {
    globalThis.document = previousDocument;
  }
});

test('renders a successful compare protocol without an infeasible alert', () => {
  const previousDocument = globalThis.document;
  const document = createFakeDocument();
  globalThis.document = document;

  try {
    renderResults({
      mode: 'compare',
      compare: {
        protocolSteps: [{
          title: 'Decant',
          resultingPressureBar: 100,
          resultingMix: { oxygenPercent: 32, heliumPercent: 0 }
        }],
        initialMix: { oxygenPercent: 21, heliumPercent: 0 },
        final: {
          recipeEnd: { pressureBar: 100, temperatureC: 25, oxygenPercent: 32, heliumPercent: 0 },
          ambientSettled: { pressureBar: 98, temperatureC: 20, oxygenPercent: 32, heliumPercent: 0 }
        }
      }
    });

    const [card] = document.elements.get('steps-container').children;
    assert.match(card.textContent, /Decant/);
    assert.match(card.textContent, /100\.0 bar/);
    assert.doesNotMatch(card.textContent, /No Feasible Solution Found/);
  } finally {
    globalThis.document = previousDocument;
  }
});

test('pressure warnings trigger only above the cylinder working pressure', () => {
  assert.equal(isPressureAboveWorkingPressure(232, 232), false);
  assert.equal(isPressureAboveWorkingPressure(232.1, 232), true);
  assert.equal(isPressureAboveWorkingPressure(Number.NaN, 232), false);
});
