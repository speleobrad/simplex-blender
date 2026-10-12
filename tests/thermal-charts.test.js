import test from 'node:test';
import assert from 'node:assert/strict';
import { buildThermalSeries, calculateChartDomain } from '../js/ui/thermal-charts.js';

const protocolSteps = [
  {
    title: 'Drain / Vent Cylinder Gas',
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
  assert.deepEqual(series.points.map(point => point.elapsedMinutes), [0, 0, 10, 10, 13, 23]);
  assert.equal(series.points[0].step, 1);
  assert.equal(series.points.at(-1).step, 2);
  assert.deepEqual(series.bands.map(band => [band.step, band.startMinute, band.endMinute]), [
    [1, 0, 10],
    [2, 10, 23]
  ]);
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
