import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAccessibleTernaryData, calculateMaxZoom, createVertices, formatGasMix, getInfeasibleRegionVertices, getNextZoom, toCanvasPoint, transformPointForZoom } from '../js/ui/ternary.js';

test('air is the solid-region vertex on the O2/N2 edge', () => {
  const vertices = createVertices(300, 300);
  const air = toCanvasPoint(21, 0, 79, vertices);
  assert.ok(Math.abs(air.x - vertices.air.x) < 1e-9);
  assert.ok(Math.abs(air.y - vertices.air.y) < 1e-9);
  assert.notDeepEqual(air, vertices.nitrogen);
});

test('infeasible region uses nitrogen, air, and helium vertices in drawing order', () => {
  const vertices = createVertices(300, 300);

  assert.deepEqual(getInfeasibleRegionVertices(vertices), [
    toCanvasPoint(0, 0, 100, vertices),
    toCanvasPoint(21, 0, 79, vertices),
    toCanvasPoint(0, 100, 0, vertices)
  ]);
});

test('15/0 lies beyond the feasible Air/O2 edge', () => {
  const vertices = createVertices(300, 300);
  const lowOxygen = toCanvasPoint(15, 0, 85, vertices);
  assert.ok(lowOxygen.y > vertices.air.y);
});

test('maximum zoom keeps every projected trajectory point inside the inset canvas', () => {
  const trajectory = [
    { x: 30, y: 30 },
    { x: 40, y: 38 },
    { x: 50, y: 40 }
  ];
  const project = point => point;
  const width = 220;
  const height = 140;
  const margin = 20;
  const zoom = calculateMaxZoom(trajectory, project, width, height, margin);
  const center = { x: 40, y: 35 };
  assert.ok(zoom >= 1);
  for (const point of trajectory) {
    const x = (point.x - center.x) * zoom + width / 2;
    const y = (point.y - center.y) * zoom + height / 2;
    assert.ok(x >= margin - 1e-9 && x <= width - margin + 1e-9);
    assert.ok(y >= margin - 1e-9 && y <= height - margin + 1e-9);
  }
});

test('empty and point-sized paths cannot create an unbounded zoom', () => {
  assert.equal(calculateMaxZoom([], point => point, 220, 140), 1);
  assert.equal(calculateMaxZoom([{ x: 10, y: 10 }], point => point, 220, 140), 1);
});

test('zoom preserves the full view at 1x and centers the path at maximum zoom', () => {
  const point = { x: 30, y: 30 };
  const center = { x: 40, y: 35 };
  assert.deepEqual(transformPointForZoom(point, center, 1, 9, 220, 140), { x: 30, y: 30 });
  assert.deepEqual(transformPointForZoom(point, center, 9, 9, 220, 140), { x: 20, y: 25 });
});

test('zoom controls change zoom within the diagram bounds', () => {
  assert.equal(getNextZoom(1, 3, 1), 1.25);
  assert.equal(getNextZoom(2.8, 3, 1), 3);
  assert.equal(getNextZoom(1.1, 3, -1), 1);
});

test('formats gas composition as O2/He with one decimal place', () => {
  assert.equal(formatGasMix(21, 0), '21.0/0.0');
  assert.equal(formatGasMix(0, 100), '0.0/100.0');
  assert.equal(formatGasMix(19.46, 40.04), '19.5/40.0');
});

test('compare accessible data keeps manual stages without supply banks', () => {
  const data = buildAccessibleTernaryData({
    mode: 'compare',
    banks: [],
    initialMix: { oxygenPercent: 21, heliumPercent: 0, nitrogenPercent: 79 },
    targetMix: { oxygenPercent: 18, heliumPercent: 35, nitrogenPercent: 47 },
    trajectory: [
      { step: 0, label: 'Start mix', oxygenPercent: 21, heliumPercent: 0, nitrogenPercent: 79, pressureBar: 100 },
      { step: 1, label: 'Step 1', oxygenPercent: 20, heliumPercent: 15, nitrogenPercent: 65, pressureBar: 120 },
      { step: 2, label: 'Step 2', oxygenPercent: 18, heliumPercent: 35, nitrogenPercent: 47, pressureBar: 200 }
    ]
  });

  assert.deepEqual(data.mixRows.map(row => row.label), ['Air reference', 'Initial mix', 'Final mix']);
  assert.deepEqual(data.trajectoryRows.map(row => [row.label, row.pressureBar]), [
    ['Start mix', 100],
    ['Step 1', 120],
    ['Step 2', 200]
  ]);
  assert.equal(data.status, 'Data covers 2 recipe stages.');
});
