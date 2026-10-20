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
    ['blend-status', new FakeElement()],
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
    ['res-final-mix', new FakeElement()],
    ['res-fill-duration', new FakeElement()],
    ['res-max-temperature', new FakeElement()]
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


test('places readings before the next transfer, not before a preserve step', () => {
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
    assert.equal(children.length, 3);
    assert.doesNotMatch(children[0].textContent, /record actual readings/i);
    assert.match(children[1].textContent, /record actual readings/i);
  } finally {
    globalThis.document = previousDocument;
  }
});

test('announces feasibility and keeps thermal details behind an explicit disclosure', () => {
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
      protocolSteps: [{
        title: 'Step 1',
        description: 'Transfer gas.',
        resultingPressureBar: 100,
        thermal: {
          rateSource: 'booster',
          rateBarPerMin: 5,
          durationMinutes: 10,
          pressureAtTransferEndBar: 100,
          temperatureAtTransferEndC: 30,
          waitMinutes: 7,
          pressureAfterWaitBar: 99,
          temperatureAfterWaitC: 25
        }
      }]
    });

    assert.match(document.elements.get('blend-status').textContent, /feasible/i);
    const step = document.elements.get('steps-container').children[0];
    assert.equal(step.children[0].children[2].tagName, 'details');
    assert.match(step.children[0].children[2].textContent, /technical details/i);
  } finally {
    globalThis.document = previousDocument;
  }
});
test('renders recipe aggregates and normalized technical details', () => {
  const previousDocument = globalThis.document;
  const document = createFakeDocument();
  globalThis.document = document;

  try {
    renderResults({
      feasible: true,
      blend: {
        retainedPressureBar: 80,
        retainedPercent: 80,
        ventedPressureBar: 20,
        ventedGasLitres: 40,
        heliumSalvagedLitres: 12,
        finalPressureBar: 200,
        finalOxygenPercent: 18,
        finalHeliumPercent: 45
      },
      thermal: {
        finalTransferEndPressureBar: 198,
        finalTransferEndTemperatureC: 34,
        finalAmbientPressureBar: 200,
        finalAmbientTemperatureC: 25
      },
      protocolSteps: [{
        title: 'Transfer helium',
        description: 'Add helium from the reserve bank.',
        resultingPressureBar: 200,
        thermal: {
          rateSource: 'booster',
          rateBarPerMin: 5,
          durationMinutes: 10,
          pressureAtTransferEndBar: 200,
          temperatureAtTransferEndC: 36,
          waitMinutes: 4,
          pressureAfterWaitBar: 198,
          temperatureAfterWaitC: 30
        },
        resultingMix: { oxygenPercent: 18, heliumPercent: 45 },
        sourceEndPressureBar: 25
      }]
    });

    assert.equal(document.elements.get('res-fill-duration').textContent, '10.0 min');
    assert.equal(document.elements.get('res-max-temperature').textContent, '36.0 °C');
    const step = document.elements.get('steps-container').children[0];
    assert.match(step.textContent, /Step 1/);
    assert.match(step.textContent, /Transfer helium/);
    assert.match(step.textContent, /Rate/);
    assert.match(step.textContent, /Interim mix/);
    assert.match(step.textContent, /Source leftover pressure/);
    assert.equal(step.children[0].children[2].children[1].tagName, 'table');
  } finally {
    globalThis.document = previousDocument;
  }
});

test('places readings before the next step and omits them before preserve steps', () => {
  const previousDocument = globalThis.document;
  const document = createFakeDocument();
  globalThis.document = document;

  try {
    renderResults({
      feasible: true,
      blend: {
        retainedPressureBar: 50, retainedPercent: 100, ventedPressureBar: 0,
        ventedGasLitres: 0, heliumSalvagedLitres: 0, finalPressureBar: 100,
        finalOxygenPercent: 21, finalHeliumPercent: 0
      },
      protocolSteps: [
        { type: 'keep', title: 'Preserve gas', description: 'Keep it.', resultingPressureBar: 50 },
        { type: 'boost', title: 'Add oxygen', description: 'Add it.', resultingPressureBar: 100 }
      ]
    }, {
      cylinder: { workingPressureBar: 232 },
      thermal: { interimMeasurements: [null, null] }
    });

    const children = document.elements.get('steps-container').children;
    assert.equal(children.length, 3);
    assert.doesNotMatch(children[0].textContent, /record actual readings/i);
    assert.match(children[1].textContent, /record actual readings/i);
  } finally {
    globalThis.document = previousDocument;
  }
});


test('pressure warnings trigger only above the cylinder working pressure', () => {
  assert.equal(isPressureAboveWorkingPressure(232, 232), false);
  assert.equal(isPressureAboveWorkingPressure(232.1, 232), true);
  assert.equal(isPressureAboveWorkingPressure(Number.NaN, 232), false);
});
