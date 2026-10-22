import test from 'node:test';
import assert from 'node:assert/strict';
import { renderResults } from '../js/ui/results.js';
import { buildThermalSeries } from '../js/ui/thermal-charts.js';
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
    this.children = [];
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
    }, {
      cylinder: {
        workingPressureBar: 232,
        targetPressureBar: 200,
        targetOxygenPercent: 18,
        targetHeliumPercent: 45
      },
      settings: { units: 'metric' }
    });

    assert.equal(document.elements.get('res-fill-duration').textContent, '10.0 min');
    assert.equal(document.elements.get('res-max-temperature').textContent, '36.0 °C');
    assert.match(document.elements.get('res-retained-p').className, /text-slate-300/);
    assert.match(document.elements.get('res-vented-p').className, /text-amber-400/);
    assert.match(document.elements.get('res-he-salvaged').className, /text-emerald-400/);
    assert.match(document.elements.get('res-final-mix').className, /text-emerald-400/);
    assert.match(document.elements.get('res-fill-duration').className, /text-slate-300/);
    assert.match(document.elements.get('res-max-temperature').className, /text-rose-400/);
    assert.match(document.elements.get('res-hot-pressure').className, /text-slate-300/);
    assert.match(document.elements.get('res-ambient-pressure').className, /text-slate-300/);
    assert.match(document.elements.get('res-in-water-pressure').className, /text-rose-400/);
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
test('highlights technical details at source, cooloff, and pressure limits and shows oxygen boost ratio', () => {
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
        finalPressureBar: 200,
        finalOxygenPercent: 18,
        finalHeliumPercent: 45
      },
      thermal: {
        finalTransferEndPressureBar: 205,
        finalTransferEndTemperatureC: 40,
        finalAmbientPressureBar: 201,
        finalAmbientTemperatureC: 25,
        finalInWaterPressureBar: 200,
        finalInWaterTemperatureC: 10
      },
      protocolSteps: [{
        type: 'boost',
        title: 'Boost Oxygen',
        sourceEndPressureBar: 5,
        minimumSourcePressureBar: 5,
        sourceExhausted: true,
        oxygenCompressionRatio: 1.5,
        thermal: {
          rateSource: 'booster',
          rateBarPerMin: 5,
          durationMinutes: 10,
          pressureAtTransferEndBar: 205,
          temperatureAtTransferEndC: 40,
          waitMinutes: 4,
          pressureAfterWaitBar: 201,
          temperatureAfterWaitC: 30
        }
      }]
    }, {
      cylinder: {
        workingPressureBar: 200,
        hotOverfillPercent: 5,
        targetPressureBar: 200,
        targetOxygenPercent: 18,
        targetHeliumPercent: 45
      },
      settings: { units: 'metric' }
    });

    const step = document.elements.get('steps-container').children[0];
    const technicalDetails = step.children[0].children.find(child =>
      child.tagName === 'details' && child.children[0]?.textContent === 'Technical details'
    );
    const cells = technicalDetails.children[1].children;
    const cell = label => cells.find(item => item.children[0].textContent === label);

    assert.match(cell('Source leftover pressure').children[0].className, /text-amber-300/);
    assert.match(cell('Cooloff period').children[0].className, /text-slate-500/);
    assert.match(cell('Pressure at transfer end').children[0].className, /text-amber-300/);
    assert.match(cell('Pressure at transfer end').children[1].className, /text-amber-300/);
    assert.match(cell('Pressure after cooloff').children[0].className, /text-rose-400/);
    assert.match(cell('Pressure after cooloff').children[1].className, /text-rose-400/);
    assert.equal(cell('O₂ boost ratio').children[1].textContent, '1.50:1');
  } finally {
    globalThis.document = previousDocument;
  }
});

test('highlights oxygen boost ratios above 3.5:1 and 3.8:1', () => {
  const previousDocument = globalThis.document;
  try {
    for (const [ratio, expectedColor] of [
      [3.5, 'text-slate-300'],
      [3.51, 'text-amber-300'],
      [3.8, 'text-amber-300'],
      [3.81, 'text-rose-400']
    ]) {
      const document = createFakeDocument();
      globalThis.document = document;
      renderResults({
        feasible: true,
        blend: {
          retainedPressureBar: 100,
          retainedPercent: 100,
          ventedPressureBar: 0,
          ventedGasLitres: 0,
          heliumSalvagedLitres: 0,
          finalPressureBar: 200,
          finalOxygenPercent: 50,
          finalHeliumPercent: 0
        },
        protocolSteps: [{
          type: 'boost',
          title: 'Boost Oxygen',
          oxygenCompressionRatio: ratio,
          thermal: {
            rateSource: 'booster',
            rateBarPerMin: 5,
            durationMinutes: 10,
            pressureAtTransferEndBar: 200,
            temperatureAtTransferEndC: 25,
            waitMinutes: 0,
            pressureAfterWaitBar: 200,
            temperatureAfterWaitC: 25
          }
        }]
      }, {
        cylinder: { workingPressureBar: 232, targetPressureBar: 200 },
        settings: { units: 'metric' }
      });

      const step = document.elements.get('steps-container').children[0];
      const technicalDetails = step.children[0].children.find(child =>
        child.tagName === 'details' && child.children[0]?.textContent === 'Technical details'
      );
      const ratioCell = technicalDetails.children[1].children.find(item =>
        item.children[0].textContent === 'O₂ boost ratio'
      );
      assert.match(ratioCell.children[1].className, new RegExp(expectedColor));
    }
  } finally {
    globalThis.document = previousDocument;
  }
});


test('shows planned start readings struck out beside manually recorded readings', () => {
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
        finalPressureBar: 200,
        finalOxygenPercent: 18,
        finalHeliumPercent: 45
      },
      thermal: {
        finalTransferEndPressureBar: 200,
        finalTransferEndTemperatureC: 40,
        finalAmbientPressureBar: 198,
        finalAmbientTemperatureC: 25,
        finalInWaterPressureBar: 200,
        finalInWaterTemperatureC: 10,
        interimMeasurements: [{ pressureBar: 110, temperatureC: 30 }]
      },
      protocolSteps: [{
        title: 'Boost Helium',
        receiverStartPressureBar: 100,
        thermal: {
          measurementIndex: 0,
          measurementApplied: true,
          plannedStartPressureBar: 100,
          plannedStartTemperatureC: 25,
          pressureStartBar: 110,
          temperatureStartC: 30,
          rateSource: 'booster',
          rateBarPerMin: 5,
          durationMinutes: 10,
          pressureAtTransferEndBar: 200,
          temperatureAtTransferEndC: 40,
          waitMinutes: 4,
          pressureAfterWaitBar: 198,
          temperatureAfterWaitC: 30
        }
      }]
    }, {
      cylinder: {
        workingPressureBar: 232,
        targetPressureBar: 200,
        targetOxygenPercent: 18,
        targetHeliumPercent: 45
      },
      thermal: {
        interimMeasurements: [{ pressureBar: 110, temperatureC: 30 }]
      },
      settings: { units: 'metric' }
    });

    const step = document.elements.get('steps-container').children[0];
    const technicalDetails = step.children[0].children.find(child =>
      child.tagName === 'details' && child.children[0]?.textContent === 'Technical details'
    );
    const cells = technicalDetails.children[1].children;
    const cell = label => cells.find(item => item.children[0].textContent === label);

    for (const [label, planned, actual] of [
      ['Start pressure', '100.0 bar', '110.0 bar'],
      ['Start temperature', '25.0 °C', '30.0 °C']
    ]) {
      const reading = cell(label).children[1].children[0];
      assert.equal(reading.children[0].tagName, 's');
      assert.equal(reading.children[0].textContent, planned);
      assert.match(reading.children[0].className, /line-through/);
      assert.equal(reading.children[2].textContent, actual);
      assert.match(reading.children[2].className, /text-amber-300/);
    }
  } finally {
    globalThis.document = previousDocument;
  }
});


test('classifies summary metrics at zero, full, partial, and over-limit boundaries', () => {
  const previousDocument = globalThis.document;
  const document = createFakeDocument();
  globalThis.document = document;
  const calculation = {
    cylinder: {
      workingPressureBar: 232,
      targetOxygenPercent: 18,
      targetHeliumPercent: 45
    },
    settings: { units: 'metric' }
  };
  const renderSummary = ({
    retainedPercent,
    ventedPressureBar,
    heliumSalvagedLitres,
    finalOxygenPercent,
    finalHeliumPercent,
    hotPressureBar,
    ambientPressureBar,
    inWaterPressureBar
  }) => renderResults({
    feasible: true,
    blend: {
      retainedPressureBar: retainedPercent,
      retainedPercent,
      ventedPressureBar,
      ventedGasLitres: ventedPressureBar,
      heliumSalvagedLitres,
      finalPressureBar: ambientPressureBar,
      finalOxygenPercent,
      finalHeliumPercent
    },
    thermal: {
      finalTransferEndPressureBar: hotPressureBar,
      finalTransferEndTemperatureC: 40,
      finalAmbientPressureBar: ambientPressureBar,
      finalAmbientTemperatureC: 25,
      finalInWaterPressureBar: inWaterPressureBar,
      finalInWaterTemperatureC: 10,
      requestedInWaterPressureBar: 200,
      requestedInWaterTemperatureC: 10
    },
    protocolSteps: [{
      resultingPressureBar: ambientPressureBar,
      thermal: {
        durationMinutes: 5,
        temperatureStartC: 25,
        temperatureAtTransferEndC: 40,
        temperatureAfterWaitC: 25
      }
    }]
  }, calculation);

  try {
    renderSummary({
      retainedPercent: 100,
      ventedPressureBar: 0,
      heliumSalvagedLitres: 0,
      finalOxygenPercent: 18,
      finalHeliumPercent: 45,
      hotPressureBar: 200,
      ambientPressureBar: 200,
      inWaterPressureBar: 200
    });
    assert.match(document.elements.get('res-retained-p').className, /text-emerald-400/);
    assert.match(document.elements.get('res-vented-p').className, /text-emerald-400/);
    assert.match(document.elements.get('res-he-salvaged').className, /text-slate-300/);
    assert.match(document.elements.get('res-final-mix').className, /text-emerald-400/);
    assert.match(document.elements.get('res-in-water-pressure').className, /text-emerald-400/);

    renderSummary({
      retainedPercent: 0,
      ventedPressureBar: 100,
      heliumSalvagedLitres: 1,
      finalOxygenPercent: 20,
      finalHeliumPercent: 40,
      hotPressureBar: 240,
      ambientPressureBar: 233,
      inWaterPressureBar: 195
    });
    assert.match(document.elements.get('res-retained-p').className, /text-rose-400/);
    assert.match(document.elements.get('res-vented-p').className, /text-rose-400/);
    assert.match(document.elements.get('res-he-salvaged').className, /text-emerald-400/);
    assert.match(document.elements.get('res-final-mix').className, /text-amber-400/);
    assert.match(document.elements.get('res-hot-pressure').className, /text-rose-400/);
    assert.match(document.elements.get('res-ambient-pressure').className, /text-rose-400/);
    assert.match(document.elements.get('res-in-water-pressure').className, /text-rose-400/);
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

test('renders explicit thermal states and one adjusted cooloff warning in the step', () => {
  const previousDocument = globalThis.document;
  const document = createFakeDocument();
  globalThis.document = document;
  try {
    renderResults({
      feasible: true,
      blend: { retainedPressureBar: 1, retainedPercent: 1, ventedPressureBar: 0, ventedGasLitres: 0, heliumSalvagedLitres: 0, finalPressureBar: 200, finalOxygenPercent: 18, finalHeliumPercent: 45 },
      thermal: { finalInWaterPressureBar: 188.6, finalInWaterTemperatureC: 10, finalTransferEndPressureBar: 204.8, finalTransferEndTemperatureC: 40, finalAmbientPressureBar: 200, finalAmbientTemperatureC: 25 },
      protocolSteps: [{
        title: 'Step 4: Boost Helium to 192.5 bar',
        description: 'Transfer gas.',
        resultingPressureBar: 200,
        automaticWaitMetadata: { configuredWaitMinutes: 7, actualWaitMinutes: 12.8, addedWaitMinutes: 5.8 },
        thermal: { durationMinutes: 1, temperatureAtTransferEndC: 40, temperatureAfterWaitC: 29.1 }
      }]
    });
    assert.match(document.elements.get('res-hot-pressure').textContent, /204\.8 bar/);
    assert.match(document.elements.get('res-ambient-pressure').textContent, /200\.0 bar/);
    assert.match(document.elements.get('res-in-water-temperature').textContent, /10\.0 °C/);
    const statusText = document.elements.get('blend-status').textContent;
    assert.doesNotMatch(statusText, /Adjusted cooloff|Automatic wait/);
    const step = document.elements.get('steps-container').children[0];
    assert.equal((step.textContent.match(/⚠️ Adjusted cooloff:/g) ?? []).length, 1);
    assert.match(step.textContent, /cylinder pressure limit reached \(Step 4: Boost Helium to 192\.5 bar\)/);
    assert.match(step.textContent, /Waiting time extended to 12\.8 min or until temperature lower than 29\.1 °C is reached\./);
    const warning = findElement(step, element => element.attributes.get('role') === 'status');
    assert.ok(warning);
    assert.match(warning.className, /rounded-lg/);
    const technicalDetails = step.children[0].children.find(child =>
      child.tagName === 'details' && child.children[0]?.textContent === 'Technical details'
    );
    const cooloff = technicalDetails.children[1].children.find(cell =>
      cell.children[0].textContent === 'Cooloff period'
    );
    assert.match(cooloff.children[0].className, /text-amber-300/);
    assert.match(cooloff.children[1].className, /text-amber-300/);
  } finally {
    globalThis.document = previousDocument;
  }
});
test('renders Warning mode pressure exceedances with measured limit and step', () => {
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
      protocolSteps: [{ title: 'Transfer 2', description: 'Transfer gas.', resultingPressureBar: 100 }],
      pressureLimitWarnings: [{
        kind: 'hot-overfill',
        pressureBar: 103,
        limitBar: 102,
        source: 'transfer',
        stepIdentifier: 'Transfer 2'
      }]
    }, { settings: { pressureLimitMode: 'warning' } });

    const status = document.elements.get('blend-status').textContent;
    assert.match(status, /warning mode/i);
    assert.match(status, /103\.0 bar/);
    assert.match(status, /102\.0 bar/);
    assert.match(status, /Transfer 2/);
  } finally {
    globalThis.document = previousDocument;
  }
});

test('renders only the Warning mode policy notice when no limit is exceeded', () => {
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
      protocolSteps: [{ title: 'Transfer 2', description: 'Transfer gas.', resultingPressureBar: 100 }],
      pressureLimitWarnings: []
    }, { settings: { pressureLimitMode: 'warning' } });

    const status = document.elements.get('blend-status').textContent;
    assert.match(status, /warning mode/i);
    assert.match(status, /cylinder limits are not enforced/i);
    assert.doesNotMatch(status, /exceeded/i);
  } finally {
    globalThis.document = previousDocument;
  }
});

test('keeps Warning notices separate from the adjusted cooloff box', () => {
  const previousDocument = globalThis.document;
  const document = createFakeDocument();
  globalThis.document = document;
  try {
    renderResults({
      feasible: true,
      blend: {
        retainedPressureBar: 50, retainedPercent: 100, ventedPressureBar: 0, ventedGasLitres: 0, heliumSalvagedLitres: 0, finalPressureBar: 100,
        finalOxygenPercent: 21, finalHeliumPercent: 0
      },
      thermal: {
        finalTransferEndPressureBar: 103,
        finalTransferEndTemperatureC: 40,
        finalAmbientPressureBar: 100,
        finalAmbientTemperatureC: 25,
        finalInWaterPressureBar: 98,
        finalInWaterTemperatureC: 20
      },
      protocolSteps: [{
        title: 'Transfer 2',
        description: 'Transfer gas.',
        resultingPressureBar: 100,
        automaticWaitMetadata: {
          stepIdentifier: 'Transfer 2',
          configuredWaitMinutes: 4,
          actualWaitMinutes: 9,
          addedWaitMinutes: 5
        },
        thermal: {
          durationMinutes: 1,
          temperatureAtTransferEndC: 40,
          temperatureAfterWaitC: 25
        }
      }],
      pressureLimitWarnings: [{
        kind: 'working-pressure',
        pressureBar: 103,
        limitBar: 100,
        source: 'transfer',
        stepIdentifier: 'Transfer 2'
      }]
    }, { settings: { pressureLimitMode: 'warning' } });

    const status = document.elements.get('blend-status');
    assert.match(status.textContent, /warning mode/i);
    assert.match(status.textContent, /103\.0 bar/);
    assert.match(status.textContent, /working pressure/i);
    assert.doesNotMatch(status.textContent, /Adjusted cooloff|Automatic wait/);
    const notices = status.children.filter(child => child.attributes.get('role') === 'status');
    assert.equal(notices.length, 2);
    assert.ok(notices.every(notice => /\btext-amber-300\b/.test(notice.className)));
    const step = document.elements.get('steps-container').children[0];
    assert.equal((step.textContent.match(/⚠️ Adjusted cooloff:/g) ?? []).length, 1);
  } finally {
    globalThis.document = previousDocument;
  }
});

test('qualifies Warning-mode maximum pressure by the active non-cylinder constraints', () => {
  const previousDocument = globalThis.document;
  const document = createFakeDocument();
  globalThis.document = document;
  try {
    renderResults({
      feasible: false,
      error: 'Requested pressure is unavailable.',
      gas: { initialPressureBar: 50, targetPressureBar: 200 },
      maximumPressure: {
        pressureBar: 150,
        blend: {
          retainedPressureBar: 50,
          retainedPercent: 100,
          ventedPressureBar: 0,
          ventedGasLitres: 0,
          heliumSalvagedLitres: 0,
          finalPressureBar: 150,
          finalOxygenPercent: 21,
          finalHeliumPercent: 0
        },
        protocolSteps: []
      }
    }, {
      settings: { pressureLimitMode: 'warning', units: 'metric' },
      cylinder: { volumeL: 12, workingPressureBar: 100 },
      physics: { model: 'ideal' }
    });

    const status = document.elements.get('blend-status').textContent;
    const details = document.elements.get('steps-container').textContent;
    assert.match(status, /maximum under active non-cylinder constraints/i);
    assert.match(details, /maximum pressure under active non-cylinder constraints/i);
    assert.doesNotMatch(status, /\bsafe(?:ly)?\b/i);
    assert.doesNotMatch(details, /\bsafe(?:ly)?\b/i);
  } finally {
    globalThis.document = previousDocument;
  }
});
test('replaces the previous recipe summary with the safety-limited target-temperature result', () => {
  const previousDocument = globalThis.document;
  const document = createFakeDocument();
  globalThis.document = document;
  try {
    renderResults({
      feasible: true,
      blend: {
        retainedPressureBar: 20,
        retainedPercent: 40,
        ventedPressureBar: 30,
        ventedGasLitres: 360,
        heliumSalvagedLitres: 120,
        finalPressureBar: 200,
        finalOxygenPercent: 18,
        finalHeliumPercent: 45
      },
      protocolSteps: [{ title: 'Previous recipe step', resultingPressureBar: 200 }],
      thermal: {
        finalTransferEndPressureBar: 205,
        finalTransferEndTemperatureC: 35,
        finalAmbientPressureBar: 200,
        finalAmbientTemperatureC: 25,
        finalInWaterPressureBar: 200,
        finalInWaterTemperatureC: 25,
        requestedInWaterPressureBar: 200,
        requestedInWaterTemperatureC: 25
      }
    }, { settings: { pressureLimitMode: 'hard-stop', units: 'metric' } });

    renderResults({
      feasible: false,
      error: 'Requested in-water pressure is unavailable.',
      gas: { targetPressureBar: 200 },
      diagnostics: {
        componentShortfalls: [
          { component: 'Oxygen', sourceBank: null },
          { component: 'Helium', sourceBank: null }
        ],
        exhaustedBanks: []
      },
      maximumPressure: {
        pressureBar: 207,
        blend: {
          retainedPressureBar: 80,
          retainedPercent: 100,
          ventedPressureBar: 0,
          ventedGasLitres: 0,
          heliumSalvagedLitres: 240,
          finalPressureBar: 207,
          finalOxygenPercent: 18,
          finalHeliumPercent: 45
        },
        protocolSteps: [{ title: 'Safety-limited recipe step', resultingPressureBar: 207 }],
        thermal: {
          finalTransferEndPressureBar: 211,
          finalTransferEndTemperatureC: 30,
          finalAmbientPressureBar: 207,
          finalAmbientTemperatureC: 25,
          finalInWaterPressureBar: 195,
          finalInWaterTemperatureC: 10,
          requestedInWaterPressureBar: 200,
          requestedInWaterTemperatureC: 10
        }
      }
    }, {
      settings: { pressureLimitMode: 'hard-stop', units: 'metric' },
      cylinder: { volumeL: 11.1, workingPressureBar: 207 },
      physics: { model: 'vdw' }
    });

    assert.equal(document.elements.get('res-retained-p').textContent, '80.0 bar');
    assert.equal(document.elements.get('res-vented-p').textContent, '0.0 bar');
    assert.equal(document.elements.get('res-he-salvaged').textContent, '240 L');
    assert.equal(document.elements.get('res-final-p').textContent, '195.0 bar');
    assert.equal(document.elements.get('res-final-mix').textContent, 'Tx 18/45');
    assert.equal(document.elements.get('res-in-water-pressure').textContent, '195.0 bar');
    assert.equal(document.elements.get('res-in-water-temperature').textContent, '10.0 °C');
    assert.match(document.elements.get('blend-status').textContent, /maximum safely achievable pressure is 195\.0 bar/i);
    const alert = findElement(document.elements.get('steps-container'), element =>
      element.attributes.get('role') === 'alert'
    );
    assert.ok(alert);
    assert.equal(alert.children[1].textContent, [
      'The target mix (18/45) cannot reach 200.0 bar at target 10.0 °C.',
      'No enabled source bank can add oxygen.',
      'No enabled source bank can add helium.',
      'The maximum safely achievable pressure is 195.0 bar at 10.0 °C.',
      'Predicted settled pressure is 207.0 bar at 25.0 °C.'
    ].join('\n'));
    assert.match(document.elements.get('steps-container').textContent, /Safety-limited recipe step/);
    assert.doesNotMatch(document.elements.get('steps-container').textContent, /Previous recipe step/);
  } finally {
    globalThis.document = previousDocument;
  }
});


test('explains an unavailable EAN50 target with its oxygen-ratio limit', () => {
  const previousDocument = globalThis.document;
  const document = createFakeDocument();
  globalThis.document = document;
  try {
    renderResults({
      feasible: false,
      reasonCode: 'oxygen-boost-ratio',
      error: 'Unsafe 50% O₂ transfer from EAN 50: exceeding the 4:1 limit.',
      gas: { targetPressureBar: 200 },
      diagnostics: { componentShortfalls: [], exhaustedBanks: [] },
      maximumPressure: {
        pressureBar: 112,
        blend: {
          retainedPressureBar: 10,
          retainedPercent: 100,
          ventedPressureBar: 0,
          ventedGasLitres: 0,
          heliumSalvagedLitres: 0,
          finalPressureBar: 112,
          finalOxygenPercent: 50,
          finalHeliumPercent: 0
        },
        protocolSteps: [],
        thermal: {
          finalTransferEndPressureBar: 112,
          finalTransferEndTemperatureC: 25,
          finalAmbientPressureBar: 112,
          finalAmbientTemperatureC: 25,
          finalInWaterPressureBar: 112,
          finalInWaterTemperatureC: 25,
          requestedInWaterPressureBar: 200,
          requestedInWaterTemperatureC: 25
        }
      }
    }, {
      settings: { pressureLimitMode: 'hard-stop', units: 'metric' },
      cylinder: { volumeL: 12, workingPressureBar: 232 },
      physics: { model: 'ideal' }
    });

    const alert = findElement(document.elements.get('steps-container'), element =>
      element.attributes.get('role') === 'alert'
    );
    assert.ok(alert);
    assert.equal(alert.children[0].textContent, 'Requested Mix Is Unavailable');
    assert.match(
      alert.children[1].textContent,
      /The target mix \(50\/0\) cannot safely reach 200\.0 bar at target 25\.0 °C due to unsafe oxygen boost ratio \(maximum 4:1\)\./
    );
  } finally {
    globalThis.document = previousDocument;
  }
});


test('renders working-pressure and source-shortage reasons in unavailable-mix summaries', () => {
  const previousDocument = globalThis.document;
  try {
    for (const [reasonCode, expectedReason] of [
      ['working-pressure', 'due to exceeding the working pressure of the cylinder.'],
      ['insufficient-source-gas', 'due to insufficient source gas.']
    ]) {
      const document = createFakeDocument();
      globalThis.document = document;
      renderResults({
        feasible: false,
        reasonCode,
        error: 'The requested mix is unavailable.',
        gas: { targetPressureBar: 200 },
        diagnostics: { componentShortfalls: [], exhaustedBanks: [] },
        maximumPressure: {
          pressureBar: 150,
          blend: {
            retainedPressureBar: 10,
            retainedPercent: 100,
            ventedPressureBar: 0,
            ventedGasLitres: 0,
            heliumSalvagedLitres: 0,
            finalPressureBar: 150,
            finalOxygenPercent: 32,
            finalHeliumPercent: 0
          },
          protocolSteps: [],
          thermal: {
            finalAmbientPressureBar: 150,
            finalAmbientTemperatureC: 25,
            finalInWaterPressureBar: 150,
            finalInWaterTemperatureC: 25,
            requestedInWaterTemperatureC: 25
          }
        }
      }, {
        settings: { pressureLimitMode: 'hard-stop', units: 'metric' },
        cylinder: { volumeL: 12, workingPressureBar: 232 },
        physics: { model: 'ideal' }
      });

      const alert = findElement(document.elements.get('steps-container'), element =>
        element.attributes.get('role') === 'alert'
      );
      assert.match(alert.children[1].textContent, new RegExp(expectedReason));
    }
  } finally {
    globalThis.document = previousDocument;
  }
});


test('explains no-positive-quantity failures as unavailable source-gas combinations', () => {
  const previousDocument = globalThis.document;
  const document = createFakeDocument();
  globalThis.document = document;
  try {
    renderResults({
      feasible: false,
      reasonCode: 'insufficient-source-gas',
      error: 'The exact target mix cannot be made from the current cylinder and enabled gas banks at any positive pressure.',
      gas: { targetPressureBar: 200 },
      maximumPressure: null
    });

    const expected = 'No feasible blend — the combination and availability of source gases in the inventory does not allow this mix to be made in any quantity.';
    assert.equal(document.elements.get('blend-status').textContent, expected);
    const alert = findElement(document.elements.get('steps-container'), element =>
      element.attributes.get('role') === 'alert'
    );
    assert.ok(alert);
    assert.equal(alert.children[0].textContent, 'No Feasible Blend');
    assert.equal(alert.children[1].textContent, expected);
  } finally {
    globalThis.document = previousDocument;
  }
});

test('renders infeasible results without a maximum pressure fallback', () => {
  const previousDocument = globalThis.document;
  const document = createFakeDocument();
  globalThis.document = document;
  try {
    renderResults({
      feasible: false,
      error: 'Invalid input: Initial pressure must be between 0 and 350 bar.',
      maximumPressure: null
    }, { settings: { pressureLimitMode: 'warning' } });

    assert.match(
      document.elements.get('steps-container').textContent,
      /Initial pressure must be between 0 and 350 bar/
    );
    assert.match(document.elements.get('blend-status').textContent, /warning mode/i);
  } finally {
    globalThis.document = previousDocument;
  }
});

test('Warning mode keeps interim pressure input within the supported range', () => {
  const previousDocument = globalThis.document;
  const document = createFakeDocument();
  globalThis.document = document;
  try {
    renderResults({
      feasible: true,
      blend: {
        retainedPressureBar: 50, retainedPercent: 100, ventedPressureBar: 0,
        ventedGasLitres: 0, heliumSalvagedLitres: 0, finalPressureBar: 150,
        finalOxygenPercent: 21, finalHeliumPercent: 0
      },
      protocolSteps: [
        { type: 'keep', title: 'Step 1', resultingPressureBar: 50 },
        { type: 'boost', title: 'Step 2', resultingPressureBar: 150 }
      ]
    }, {
      cylinder: { volumeL: 12, workingPressureBar: 100, hotOverfillPercent: 0 },
      thermal: { interimMeasurements: [null, null] },
      settings: { pressureLimitMode: 'warning', units: 'metric' }
    });

    const pressureInput = findElement(
      document.elements.get('steps-container').children[1],
      element => element.tagName === 'input' && element.name === 'pressureBar'
    );
    assert.equal(Number(pressureInput.max), 350);
  } finally {
    globalThis.document = previousDocument;
  }
});
test('labels What-if terminal projections without optimizer target wording', () => {
  const series = buildThermalSeries([{
    type: 'drain',
    title: 'Step 1: Drain',
    thermal: {
      durationMinutes: 1,
      waitMinutes: 0,
      temperatureStartC: 25,
      temperatureAtTransferEndC: 24,
      pressureAtTransferEndBar: 20,
      pressureAfterWaitBar: 20,
      temperatureAfterWaitC: 24,
      samples: [
        { elapsedMinutes: 0, pressureBar: 50, temperatureC: 25 },
        { elapsedMinutes: 1, pressureBar: 20, temperatureC: 24 }
      ]
    }
  }], {
    initialPressureBar: 50,
    initialTemperatureC: 25
  }, {
    mode: 'what-if',
    pressureBar: 19,
    temperatureC: 25,
    durationMinutes: 4,
    inWaterPressureBar: 18,
    inWaterTemperatureC: 10
  });
  const inWater = series.points.at(-1);
  assert.equal(inWater.phase, 'in-water-projection');
  assert.match(inWater.label, /In-water projection/);
  assert.doesNotMatch(inWater.label, /target/i);
});
