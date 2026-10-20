import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildThermalSeries,
  buildChartPath,
  calculateChartDomain,
  calculateReferenceLineY,
  interpolateThermalSample,
  thermalCurveAttributes,
  thermalPointMarkerAttributes,
  thermalChartAriaLabel
} from '../js/ui/thermal-charts.js';

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

test('compare series retains explicit waits before adding an ambient-settled projection', () => {
  const series = buildThermalSeries([
    {
      title: 'Add trimix',
      recipeLabel: 'Add trimix',
      recipeAction: 'Decant',
      recipeGas: 'Trimix',
      thermal: {
        durationMinutes: 2,
        waitMinutes: 0,
        temperatureStartC: 20,
        temperatureAtTransferEndC: 32,
        pressureAtTransferEndBar: 125,
        temperatureAfterWaitC: 32,
        pressureAfterWaitBar: 125
      }
    },
    {
      type: 'wait',
      title: 'Wait 15 minutes',
      recipeLabel: 'Wait 15 minutes',
      recipeAction: 'Wait',
      thermal: {
        durationMinutes: 0,
        waitMinutes: 15,
        temperatureStartC: 32,
        temperatureAtTransferEndC: 32,
        pressureAtTransferEndBar: 125,
        temperatureAfterWaitC: 24,
        pressureAfterWaitBar: 121
      }
    }
  ], {
    initialPressureBar: 100,
    initialTemperatureC: 20
  }, {
    pressureBar: 119,
    temperatureC: 20,
    durationMinutes: 46
  });

  assert.deepEqual(series.points.map(point => point.phase), [
    'start', 'transfer-end', 'settled',
    'start', 'transfer-end', 'settled',
    'ambient-settled'
  ]);
  assert.deepEqual(series.points.map(point => point.elapsedMinutes), [0, 2, 2, 2, 2, 17, 63]);
  assert.deepEqual(series.bands.map(band => band.endMinute), [2, 17]);
  assert.equal(series.points.at(-1).label, 'Ambient-settled projection');
  assert.equal(series.final.pressureBar, 119);
  assert.equal(series.final.temperatureC, 20);
  assert.equal(series.final.elapsedMinutes, 63);
});

test('keep-only compare series projects from the initial state to ambient settled', () => {
  const series = buildThermalSeries([{ type: 'keep' }], {
    initialPressureBar: 100,
    initialTemperatureC: 24
  }, {
    pressureBar: 98,
    temperatureC: 20,
    durationMinutes: 46
  });

  assert.deepEqual(series.bands, []);
  assert.deepEqual(series.points.map(point => [
    point.phase,
    point.elapsedMinutes,
    point.pressureBar,
    point.temperatureC
  ]), [['ambient-settled', 46, 98, 20]]);
  assert.deepEqual(series.samples.map(sample => [
    sample.elapsedMinutes,
    sample.pressureBar,
    sample.temperatureC
  ]), [[0, 100, 24], [46, 98, 20]]);
  assert.deepEqual(series.segments, [{
    style: 'estimated',
    samples: series.samples
  }]);
});

test('empty or incomplete protocol produces no chart points', () => {
  assert.deepEqual(buildThermalSeries([]), { points: [], samples: [], bands: [], segments: [], final: null });
  assert.deepEqual(buildThermalSeries([{ title: 'Missing thermal state' }]), {
    points: [],
    samples: [],
    bands: [],
    segments: [],
    final: null
  });
});

test('pressure chart domain never extends below zero bar', () => {
  const domain = calculateChartDomain([0, 80, 210], 'bar');

  assert.equal(domain.min, 0);
  assert.ok(domain.max > 210);
});
test('ambient reference line uses the temperature chart scale', () => {
  assert.equal(calculateReferenceLineY(25, 15, 35, 200), 128);
  assert.equal(calculateReferenceLineY(15, 15, 35, 200), 228);
});
test('estimated thermal curve uses dotted presentation', () => {
  assert.deepEqual(thermalCurveAttributes('var(--chart-feasible)'), {
    fill: 'none',
    stroke: 'var(--chart-feasible)',
    'stroke-width': 2.5,
    'stroke-dasharray': '2 4',
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round'
  });
});
test('observed thermal curve uses solid presentation', () => {
  assert.equal(thermalCurveAttributes('var(--chart-feasible)', 'observed')['stroke-dasharray'], undefined);
});
test('measured thermal points use a distinct marker presentation', () => {
  const color = 'var(--chart-feasible)';

  assert.deepEqual(thermalPointMarkerAttributes({ phase: 'measured-start' }, color), {
    r: 5,
    fill: 'var(--chart-badge)',
    stroke: color,
    'stroke-width': 2
  });
  assert.deepEqual(thermalPointMarkerAttributes({ phase: 'transfer-end' }, color), {
    r: 4,
    fill: color,
    stroke: 'var(--chart-point-outline)',
    'stroke-width': 1.5
  });
});

test('thermal chart accessibility names estimated curves', () => {
  assert.equal(
    thermalChartAriaLabel('Temperature'),
    'Temperature during blending steps over time; solid curves show the current/observed path; dotted curves indicate estimated values'
  );
});
test('thermal series includes measured start readings with estimated elapsed time', () => {
  const series = buildThermalSeries([
    {
      title: 'First transfer',
      thermal: {
        durationMinutes: 2,
        waitMinutes: 10,
        temperatureStartC: 20,
        temperatureAtTransferEndC: 40,
        pressureAtTransferEndBar: 100,
        temperatureAfterWaitC: 30,
        pressureAfterWaitBar: 98
      }
    },
    {
      title: 'Measured next transfer',
      thermal: {
        measuredStartPressureBar: 95,
        measuredStartTemperatureC: 25,
        measuredWaitMinutes: 15,
        durationMinutes: 3,
        waitMinutes: 10,
        temperatureStartC: 25,
        temperatureAtTransferEndC: 35,
        pressureAtTransferEndBar: 120,
        temperatureAfterWaitC: 28,
        pressureAfterWaitBar: 118
      }
    }
  ], { initialPressureBar: 80, initialTemperatureC: 20 });

  const measuredStart = series.points[3];
  assert.equal(measuredStart.phase, 'measured-start');
  assert.equal(measuredStart.pressureBar, 95);
  assert.equal(measuredStart.temperatureC, 25);
  assert.equal(measuredStart.elapsedMinutes, 17);
  assert.equal(measuredStart.timeLabel, '~17.0 min');
  assert.deepEqual(series.segments.map(segment => segment.style), [
    'observed', 'estimated', 'observed', 'observed'
  ]);
  assert.deepEqual(series.segments[1].samples.map(sample => sample.elapsedMinutes), [2, 12]);
  assert.deepEqual(series.segments[2].samples.map(sample => sample.elapsedMinutes), [2, 17]);
});

test('thermal series marks measured start time as unknown when it cannot be estimated', () => {
  const series = buildThermalSeries([
    {
      title: 'First transfer',
      thermal: {
        durationMinutes: 2,
        waitMinutes: 10,
        temperatureStartC: 20,
        temperatureAtTransferEndC: 40,
        pressureAtTransferEndBar: 100,
        temperatureAfterWaitC: 30,
        pressureAfterWaitBar: 98
      }
    },
    {
      title: 'Measured next transfer',
      thermal: {
        measuredStartPressureBar: 95,
        measuredStartTemperatureC: 25,
        measuredWaitMinutes: null,
        durationMinutes: 3,
        waitMinutes: 10,
        temperatureStartC: 25,
        temperatureAtTransferEndC: 35,
        pressureAtTransferEndBar: 120,
        temperatureAfterWaitC: 28,
        pressureAfterWaitBar: 118
      }
    }
  ], { initialPressureBar: 80, initialTemperatureC: 20 });

  assert.equal(series.points[3].timeLabel, '? min');
});


test('thermal series maps minute samples while preserving highlighted key points', () => {
  const sampledStep = {
    ...protocolSteps[1],
    thermal: {
      ...protocolSteps[1].thermal,
      samples: [
        { elapsedMinutes: 0, temperatureC: 20, pressureBar: 60 },
        { elapsedMinutes: 1, temperatureC: 28, pressureBar: 73.3 },
        { elapsedMinutes: 2, temperatureC: 34, pressureBar: 86.7 },
        { elapsedMinutes: 3, temperatureC: 35, pressureBar: 100 },
        { elapsedMinutes: 8, temperatureC: 29, pressureBar: 94 },
        { elapsedMinutes: 13, temperatureC: 25, pressureBar: 90 }
      ]
    }
  };

  const series = buildThermalSeries([protocolSteps[0], sampledStep], {
    initialPressureBar: 80,
    initialTemperatureC: 20
  });

  assert.equal(series.points.length, 6);
  assert.deepEqual(series.points.slice(3).map(point => point.phase), [
    'start', 'transfer-end', 'settled'
  ]);
  assert.deepEqual(
    series.samples.slice(-6).map(sample => sample.elapsedMinutes),
    [10, 11, 12, 13, 18, 23]
  );
  assert.deepEqual(
    series.samples.slice(-6).map(sample => [sample.temperatureC, sample.pressureBar]),
    [[20, 60], [28, 73.3], [34, 86.7], [35, 100], [29, 94], [25, 90]]
  );
});

test('chart path follows sampled values while key points stay separate', () => {
  const path = buildChartPath(
    [
      { elapsedMinutes: 0, temperatureC: 20 },
      { elapsedMinutes: 1, temperatureC: 28 },
      { elapsedMinutes: 2, temperatureC: 25 }
    ],
    'temperatureC',
    minutes => minutes * 10,
    value => value
  );

  assert.equal(path, 'M 0 20 L 10 28 L 20 25');
});

test('thermal hover interpolation returns both values at the hovered time', () => {
  const samples = [
    { elapsedMinutes: 0, temperatureC: 20, pressureBar: 40 },
    { elapsedMinutes: 1, temperatureC: 30, pressureBar: 80 },
    { elapsedMinutes: 2, temperatureC: 24, pressureBar: 70 }
  ];

  assert.deepEqual(interpolateThermalSample(samples, 1.5), {
    elapsedMinutes: 1.5,
    temperatureC: 27,
    pressureBar: 75
  });
  assert.deepEqual(interpolateThermalSample(samples, -1), samples[0]);
  assert.deepEqual(interpolateThermalSample(samples, 4), samples.at(-1));
});
