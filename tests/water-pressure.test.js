import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPressureProjectionData,
  isPressureAboveWorkingPressure
} from '../js/ui/water-pressure.js';

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
