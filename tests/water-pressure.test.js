import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPressureProjectionData,
  isPressureAboveWorkingPressure,
  renderWaterPressurePane
} from '../js/ui/water-pressure.js';

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

  querySelectorAll(tagName) {
    return this.children.flatMap(child => [
      ...(child.tagName === tagName ? [child] : []),
      ...child.querySelectorAll(tagName)
    ]);
  }
}

test('places the water-pressure warning icon before the pressure value', () => {
  const previousDocument = globalThis.document;
  globalThis.document = {
    createElement(tagName) {
      return new FakeElement(tagName);
    }
  };

  try {
    const container = new FakeElement();
    renderWaterPressurePane({
      container,
      thermal: {
        finalAmbientPressureBar: 250,
        finalAmbientTemperatureC: 20
      },
      blend: {
        finalOxygenPercent: 21,
        finalHeliumPercent: 0
      },
      volumeL: 12,
      workingPressureBar: 232,
      useVdw: false
    });

    const pressureCell = container.querySelectorAll('td').find(cell => cell.children[0]?.tagName === 'i');
    assert.ok(pressureCell);
    assert.deepEqual(pressureCell.children.map(child => child.tagName), ['i', 'span']);
    assert.match(pressureCell.children[0].className, /\bmr-1\b/);
    assert.doesNotMatch(pressureCell.children[0].className, /\bml-1\b/);
  } finally {
    globalThis.document = previousDocument;
  }
});

test('builds water and car pressure series with working-pressure flags', () => {
  const data = buildPressureProjectionData({
    pressureBar: 210,
    oxygenPercent: 18,
    heliumPercent: 45,
    fromTemperatureC: 20,
    volumeL: 12,
    workingPressureBar: 220,
    useVdw: false
  });

  assert.deepEqual(
    data.water.map(({ temperatureC }) => temperatureC),
    [4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28]
  );
  assert.deepEqual(
    data.car.map(({ temperatureC }) => temperatureC),
    [25, 30, 35, 40, 45, 50, 55, 60]
  );
  assert.equal(data.water.every(({ exceedsWorkingPressure }) => !exceedsWorkingPressure), true);
  assert.equal(data.car.some(({ exceedsWorkingPressure }) => exceedsWorkingPressure), true);
  assert.equal(isPressureAboveWorkingPressure(220, 220), false);
  assert.equal(isPressureAboveWorkingPressure(220.1, 220), true);
});

test('splits projection rows into balanced contiguous table columns', async () => {
  const { splitPressureProjections } = await import('../js/ui/water-pressure.js');
  const projections = Array.from({ length: 13 }, (_, index) => ({ temperatureC: index }));

  assert.deepEqual(
    splitPressureProjections(projections),
    [
      projections.slice(0, 7),
      projections.slice(7)
    ]
  );
});
