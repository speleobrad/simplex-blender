import test from 'node:test';
import assert from 'node:assert/strict';
import { buildThermalSeries, calculateChartDomain } from '../js/ui/thermal-charts.js';

const protocolSteps = [
  {
    title: 'Drain / Vent Cylinder Gas',
    recipeLabel: 'Drain / Vent Cylinder Gas',
    receiverStartPressureBar: 80,
    receiverEndPressureBar: 60,
    thermal: {
      durationMinutes: 0,
      waitMinutes: 10,
      temperatureStartC: 20,
      temperatureAtTransferEndC: 20,
      pressureAtTransferEndBar: 60,
      temperatureAfterWaitC: 20,
      pressureAfterWaitBar: 60
    }
  },
  {
    title: 'Step 1: Decant Supply Bank to 100 bar',
    recipeLabel: 'Decant Supply Bank',
    recipeAction: 'Decant',
    recipeGas: 'Supply Bank',
    receiverStartPressureBar: 60,
    receiverEndPressureBar: 100,
    thermal: {
      durationMinutes: 3,
      waitMinutes: 10,
      temperatureStartC: 20,
      temperatureAtTransferEndC: 35,
      pressureAtTransferEndBar: 100,
      temperatureAfterWaitC: 25,
      pressureAfterWaitBar: 90
    }
  }
];

test('thermal series includes drain, transfer, and settled points in order', () => {
  const series = buildThermalSeries(protocolSteps, {
    initialPressureBar: 80,
    initialTemperatureC: 20
  });

  assert.deepEqual(series.points.map(point => point.phase), [
    'start', 'transfer-end', 'settled',
    'start', 'transfer-end', 'settled'
  ]);
  assert.deepEqual(series.points.map(point => point.pressureBar), [80, 60, 60, 60, 100, 90]);
  assert.deepEqual(series.points.map(point => point.temperatureC), [20, 20, 20, 20, 35, 25]);
  assert.deepEqual(series.points.map(point => point.title), [
    'Drain / Vent Cylinder Gas',
    'Drain / Vent Cylinder Gas',
    'Drain / Vent Cylinder Gas',
    'Decant Supply Bank',
    'Decant Supply Bank',
    'Decant Supply Bank'
  ]);
  assert.deepEqual(series.points.map(point => [point.recipeAction, point.recipeGas]), [
    [undefined, undefined],
    [undefined, undefined],
    [undefined, undefined],
    ['Decant', 'Supply Bank'],
    ['Decant', 'Supply Bank'],
    ['Decant', 'Supply Bank']
  ]);
  assert.equal(series.points[0].step, 1);
  assert.equal(series.points.at(-1).step, 2);
  assert.deepEqual(series.bands.map(band => [band.step, band.title, band.startMinute, band.endMinute]), [
    [1, 'Drain / Vent Cylinder Gas', 0, 10],
    [2, 'Decant Supply Bank', 10, 23]
  ]);
});

test('thermal bands alternate caption rows', () => {
  const series = buildThermalSeries([...protocolSteps, protocolSteps[1]], {
    initialPressureBar: 80,
    initialTemperatureC: 20
  });

  assert.deepEqual(series.bands.map(band => band.labelRow), [0, 1, 0]);
});

test('thermal series omits a preserve-only step without interrupting caption rows', () => {
  const preserveStep = {
    type: 'keep',
    recipeLabel: 'Preserve 100% of Cylinder Gas',
    thermal: {
      durationMinutes: 0,
      waitMinutes: 0,
      temperatureStartC: 20,
      temperatureAtTransferEndC: 20,
      pressureAtTransferEndBar: 80,
      temperatureAfterWaitC: 20,
      pressureAfterWaitBar: 80
    }
  };
  const series = buildThermalSeries([protocolSteps[0], preserveStep, protocolSteps[1]], {
    initialPressureBar: 80,
    initialTemperatureC: 20
  });

  assert.deepEqual(series.bands.map(band => [band.step, band.title, band.startMinute, band.endMinute]), [
    [1, 'Drain / Vent Cylinder Gas', 0, 10],
    [2, 'Decant Supply Bank', 10, 23]
  ]);
  assert.deepEqual(series.bands.map(band => band.labelRow), [0, 1]);
});

test('thermal series ends at the final ambient-settled state', () => {
  const series = buildThermalSeries(protocolSteps, {
    initialPressureBar: 80,
    initialTemperatureC: 20
  });
  const finalPoint = series.points.at(-1);

  assert.equal(finalPoint.phase, 'settled');
  assert.equal(finalPoint.pressureBar, 90);
  assert.equal(finalPoint.temperatureC, 25);
  assert.equal(finalPoint.elapsedMinutes, 23);
  assert.equal(series.final.pressureBar, 90);
  assert.equal(series.final.temperatureC, 25);
  assert.equal(series.final.elapsedMinutes, 23);
});

test('empty or incomplete protocol produces no chart points', () => {
  assert.deepEqual(buildThermalSeries([]), { points: [], bands: [], final: null });
  assert.deepEqual(buildThermalSeries([{ title: 'Missing thermal state' }]), { points: [], bands: [], final: null });
});

test('pressure chart domain never extends below zero bar', () => {
  const domain = calculateChartDomain([0, 80, 210], 'bar');

  assert.equal(domain.min, 0);
  assert.ok(domain.max > 210);
});
