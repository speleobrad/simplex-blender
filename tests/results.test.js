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
    ['steps-container', new FakeElement()],
    ['summary-banner', new FakeElement()],
    ['compare-summary', new FakeElement()],
    ['compare-start-state', new FakeElement()],
    ['compare-recipe-end-state', new FakeElement()],
    ['compare-ambient-settled-state', new FakeElement()],
    ['res-retained-p', new FakeElement()],
    ['res-retained-pct', new FakeElement()],
    ['res-vented-p', new FakeElement()],
    ['res-vented-litres', new FakeElement()],
    ['res-he-salvaged', new FakeElement()],
    ['res-final-p', new FakeElement()],
    ['res-final-mix', new FakeElement()]
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

test('retains optimizer thermal details for a final Keep row', () => {
  const previousDocument = globalThis.document;
  const document = createFakeDocument();
  globalThis.document = document;

  try {
    renderResults({
      feasible: true,
      blend: {
        retainedPressureBar: 100,
        retainedPercent: 100,
        ventedPressureBar: 0,
        ventedGasLitres: 0,
        heliumSalvagedLitres: 0,
        finalPressureBar: 100,
        finalOxygenPercent: 21,
        finalHeliumPercent: 0
      },
      thermal: null,
      protocolSteps: [{
        type: 'keep',
        title: 'Keep',
        description: 'Keep the existing mix.',
        resultingPressureBar: 100,
        thermal: {
          rateSource: 'none',
          rateBarPerMin: null,
          durationMinutes: 0,
          pressureAtTransferEndBar: 100,
          temperatureAtTransferEndC: 25,
          waitMinutes: 30,
          pressureAfterWaitBar: 98,
          temperatureAfterWaitC: 20
        }
      }]
    });

    const [card] = document.elements.get('steps-container').children;
    assert.match(card.textContent, /Rate: none/);
    assert.match(card.textContent, /Estimated transfer end: 100\.0 bar at 25\.0 °C/);
  } finally {
    globalThis.document = previousDocument;
  }
});

test('renders compare endpoints and modeled protocol rows without optimizer accounting', () => {
  const previousDocument = globalThis.document;
  const document = createFakeDocument();
  globalThis.document = document;

  try {
    renderResults({
      mode: 'compare',
      compare: {
        protocolSteps: [
          {
            type: 'keep',
            operation: 'Keep',
            title: 'Keep',
            resultingPressureBar: 100,
            resultingMix: { oxygenPercent: 21, heliumPercent: 0 }
          },
          {
            type: 'add',
            operation: 'Decant',
            title: 'Decant',
            resultingPressureBar: 145.2,
            resultingMix: { oxygenPercent: 25.4, heliumPercent: 12 },
            thermal: {
              rateSource: 'decant-rate',
              rateBarPerMin: 4,
              durationMinutes: 11.3,
              pressureAtTransferEndBar: 145.2,
              temperatureAtTransferEndC: 38.1,
              waitMinutes: 0,
              pressureAfterWaitBar: 145.2,
              temperatureAfterWaitC: 38.1
            }
          },
          {
            type: 'wait',
            operation: 'Wait',
            title: 'Wait',
            resultingPressureBar: 132.8,
            resultingMix: { oxygenPercent: 25.4, heliumPercent: 12 },
            thermal: {
              rateSource: 'none',
              rateBarPerMin: null,
              durationMinutes: 0,
              pressureAtTransferEndBar: 145.2,
              temperatureAtTransferEndC: 38.1,
              waitMinutes: 30,
              pressureAfterWaitBar: 132.8,
              temperatureAfterWaitC: 25
            }
          }
        ],
        trajectory: [{
          pressureBar: 100,
          oxygenPercent: 21,
          heliumPercent: 0
        }],
        initialMix: { oxygenPercent: 21, heliumPercent: 0 },
        final: {
          recipeEnd: { pressureBar: 145.2, temperatureC: 38.1, oxygenPercent: 25.4, heliumPercent: 12 },
          ambientSettled: { pressureBar: 132.8, temperatureC: 25, oxygenPercent: 25.4, heliumPercent: 12 }
        }
      }
    }, {
      physics: { temperatureC: 25 }
    });

    const cards = document.elements.get('steps-container').children;
    assert.equal(cards.length, 3);
    for (const [index, [operation, pressure]] of [
      ['Keep', '100.0 bar'],
      ['Decant', '145.2 bar'],
      ['Wait', '132.8 bar']
    ].entries()) {
      assert.match(cards[index].textContent, new RegExp(operation));
      assert.match(cards[index].textContent, new RegExp(pressure.replace('.', '\\.')));
    }

    const summary = document.elements.get('compare-summary');
    assert.equal(document.elements.get('summary-banner').hidden, true);
    assert.equal(summary.hidden, false);
    assert.match(document.elements.get('compare-start-state').textContent, /100\.0 bar.*Tx 21\.0\/0\.0/);
    assert.match(document.elements.get('compare-recipe-end-state').textContent, /145\.2 bar at 38\.1 °C.*Tx 25\.4\/12\.0/);
    assert.match(document.elements.get('compare-ambient-settled-state').textContent, /132\.8 bar at 25\.0 °C.*Tx 25\.4\/12\.0/);
    assert.doesNotMatch(summary.textContent, /Retained Gas|Helium salvaged/);
  } finally {
    globalThis.document = previousDocument;
  }
});

test('pressure warnings trigger only above the cylinder working pressure', () => {
  assert.equal(isPressureAboveWorkingPressure(232, 232), false);
  assert.equal(isPressureAboveWorkingPressure(232.1, 232), true);
  assert.equal(isPressureAboveWorkingPressure(Number.NaN, 232), false);
});
