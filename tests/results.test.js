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
    ['res-final-temperature', new FakeElement()],
    ['res-hot-state', new FakeElement()],
    ['res-ambient-state', new FakeElement()],
    ['res-hot-pressure', new FakeElement()],
    ['res-hot-temperature', new FakeElement()],
    ['res-ambient-pressure', new FakeElement()],
    ['res-ambient-temperature', new FakeElement()],
    ['res-in-water-pressure', new FakeElement()],
    ['res-in-water-temperature', new FakeElement()],
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
function findElement(root, predicate) {
  if (!root) return null;
  if (predicate(root)) return root;
  for (const child of root.children ?? []) {
    const match = findElement(child, predicate);
    if (match) return match;
  }
  return null;
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

    const card = document.elements.get('steps-container').children[0];
    assert.doesNotMatch(card.textContent, /Source end:/i);
    assert.doesNotMatch(card.textContent, /Source leftover pressure/i);
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
      cylinder: { workingPressureBar: 100, hotOverfillPercent: 2 },
      thermal: { interimMeasurements: [null, null] }
    });

    const children = document.elements.get('steps-container').children;
    assert.equal(children.length, 2);
    assert.equal(children[1].children[0].children[0].tagName, 'details');
    const pressureInput = findElement(children[1], element => element.tagName === 'input' && element.name === 'pressureBar');
    assert.equal(Number(pressureInput.max), 102, `max=${String(pressureInput.max)}`);
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
    assert.equal(children.length, 2);
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
    assert.equal(step.children[0].children[1].tagName, 'details');
    assert.match(step.children[0].children[1].textContent, /technical details/i);
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
        finalAmbientTemperatureC: 25,
        finalInWaterPressureBar: 188.6,
        finalInWaterTemperatureC: 10
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
    assert.doesNotMatch(step.textContent, /°C °C/);

    const technicalDetails = step.children[0].children.find(child =>
      child.tagName === 'details' && child.children[0]?.textContent === 'Technical details'
    );
    assert.ok(technicalDetails);
    const cells = technicalDetails.children[1].children;
    const labels = cells.map(cell => cell.children[0].textContent);
    const values = cells.map(cell => cell.children[1].textContent);
    assert.equal(technicalDetails.children[1].tagName, 'dl');
    assert.deepEqual(labels, [
      'Rate',
      'Source leftover pressure',
      'Duration',
      'Cooloff period',
      'Pressure at transfer end',
      'Pressure after cooloff',
      'Temperature at transfer end',
      'Temperature after cooloff',
      'Interim mix',
      ''
    ]);
    assert.deepEqual(values, [
      'booster · 5.0 bar/min',
      '25.0 bar',
      '10.0 min',
      'Final cool-off to 30.0 °C (4.0 min)',
      '200.0 bar',
      '198.0 bar',
      '36.0 °C',
      '30.0 °C',
      'Tx 18.0/45.0',
      ''
    ]);
  } finally {
    globalThis.document = previousDocument;
  }
});

test('keeps wait-only technical details in a uniform single-column grid', () => {
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
      protocolSteps: [{
        type: 'wait',
        title: 'Wait for cooling',
        description: 'Let the receiver cool.',
        resultingPressureBar: 98,
        thermal: {
          rateSource: 'none',
          waitMinutes: 7,
          pressureAfterWaitBar: 98,
          temperatureAfterWaitC: 25
        }
      }]
    });

    const step = document.elements.get('steps-container').children[0];
    const technicalDetails = step.children[0].children.find(child =>
      child.tagName === 'details' && child.children[0]?.textContent === 'Technical details'
    );
    assert.ok(technicalDetails);
    const detailsGrid = technicalDetails.children[1];
    assert.equal(detailsGrid.tagName, 'dl');
    assert.match(detailsGrid.className, /\bgrid-cols-1\b/);
    assert.deepEqual(detailsGrid.children.map(cell => cell.children[0].textContent), [
      'Cooloff period',
      'Pressure after cooloff',
      'Temperature after cooloff'
    ]);
    assert.deepEqual(detailsGrid.children.map(cell => cell.children[1].textContent), [
      '7.0 min',
      '98.0 bar',
      '25.0 °C'
    ]);
  } finally {
    globalThis.document = previousDocument;
  }
});

test('keeps step numbering singular and places actual readings inside the next step', () => {
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
        { title: 'Preserve gas', description: 'Keep it.', resultingPressureBar: 50 },
        { type: 'keep', title: 'Step 2: Warm start', description: 'Keep it.', resultingPressureBar: 60 },
        { type: 'boost', title: 'Step 2: Boost Sample scrap to 104.9 bar', description: 'Add it.', resultingPressureBar: 104.9 }
      ]
    }, {
      cylinder: { workingPressureBar: 232 },
      thermal: { interimMeasurements: [null, null, null] }
    });

    const children = document.elements.get('steps-container').children;
    assert.equal(children.length, 3);
    assert.match(children[0].textContent, /Step 1: Preserve gas/);
    assert.match(children[1].textContent, /Step 2: Warm start/);
    const recordReadingsSummary = children[2].children[0].children[0].children[0];
    assert.equal(recordReadingsSummary.textContent, 'Record actual readings before Step 2');
    assert.doesNotMatch(recordReadingsSummary.textContent, /Boost Sample scrap|104\.9 bar/);
    assert.match(children[2].textContent, /Step 2: Boost Sample scrap to 104.9 bar/);
    assert.doesNotMatch(children[2].textContent, /Step 3:/);
    assert.doesNotMatch(children[2].textContent, /Source end:/i);
    assert.doesNotMatch(children[2].textContent, /This will leave/i);
    assert.doesNotMatch(children[2].textContent, /Interim mix is/i);
  } finally {
    globalThis.document = previousDocument;
  }
});

test('uses the thermal receiver endpoint for the visible step result', () => {
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
      protocolSteps: [{
        type: 'equalize',
        title: 'Equalize helium to 140.2 bar',
        description: 'Transfer helium.',
        resultingPressureBar: 140.2,
        sourceEndPressureBar: 140.2,
        thermal: {
          rateSource: 'decant',
          rateBarPerMin: 10,
          durationMinutes: 3.5,
          pressureAtTransferEndBar: 142.6,
          temperatureAtTransferEndC: 29.5,
          waitMinutes: 7,
          pressureAfterWaitBar: 142.0,
          temperatureAfterWaitC: 28.4
        }
      }]
    });

    const card = document.elements.get('steps-container').children[0];
    assert.match(card.children[0].textContent, /Boost helium to 142\.6 bar/);
    assert.match(card.children[1].textContent, /142\.6 bar/);
    assert.doesNotMatch(card.children[1].textContent, /142\.0 bar/);
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
    assert.equal(children.length, 2);
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

test('renders explicit thermal states and metadata-driven automatic wait warning', () => {
  const previousDocument = globalThis.document;
  const document = createFakeDocument();
  globalThis.document = document;
  try {
    renderResults({
      feasible: true,
      blend: { retainedPressureBar: 1, retainedPercent: 1, ventedPressureBar: 0, ventedGasLitres: 0, heliumSalvagedLitres: 0, finalPressureBar: 200, finalOxygenPercent: 18, finalHeliumPercent: 45 },
      thermal: { finalInWaterPressureBar: 188.6, finalInWaterTemperatureC: 10, finalTransferEndPressureBar: 204.8, finalTransferEndTemperatureC: 40, finalAmbientPressureBar: 200, finalAmbientTemperatureC: 25 },
      protocolSteps: [{ title: 'Transfer', description: 'Transfer gas.', resultingPressureBar: 200, automaticWaitMetadata: { configuredWaitMinutes: 4, actualWaitMinutes: 9, addedWaitMinutes: 5 }, thermal: { durationMinutes: 1, temperatureAtTransferEndC: 40, temperatureAfterWaitC: 25 } }]
    });
    assert.match(document.elements.get('res-hot-pressure').textContent, /204\.8 bar/);
    assert.match(document.elements.get('res-ambient-pressure').textContent, /200\.0 bar/);
    assert.match(document.elements.get('res-in-water-temperature').textContent, /10\.0 °C/);
    const waitText = document.elements.get('steps-container').textContent;
    assert.match(waitText, /! Automatic wait:.*cylinder pressure limit/);
    assert.ok((waitText.match(/! Automatic wait:/g) ?? []).length >= 2);
  } finally {
    globalThis.document = previousDocument;
  }
});
