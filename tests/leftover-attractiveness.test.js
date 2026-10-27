import test from 'node:test';
import assert from 'node:assert/strict';
import { leftoverAttractiveness, STANDARD_TARGETS, SCORE_REFERENCE_HELIUM_LITRES } from '../js/leftover-attractiveness.js';

// Independent line term: exp(-15 * |3.077 O2 + He - 1| / sqrt(3.077^2 + 1)), fractions.
function lineTerm(oxygenPercent, heliumPercent) {
  const residual = Math.abs(3.077 * (oxygenPercent / 100) + heliumPercent / 100 - 1);
  return Math.exp(-15 * residual / Math.hypot(3.077, 1));
}

test('exposes the five standard targets and the helium reference', () => {
  assert.deepEqual(
    STANDARD_TARGETS.map(target => [target.oxygenPercent, target.heliumPercent]),
    [[21, 35], [18, 45], [15, 55], [12, 65], [10, 70]]
  );
  assert.equal(SCORE_REFERENCE_HELIUM_LITRES, 1000);
});

test('invalid fractions score 0', () => {
  const base = { pressureBar: 100, volumeL: 10, maxPressureBar: 350 };
  assert.equal(leftoverAttractiveness({ ...base, oxygenPercent: -1, heliumPercent: 40 }), 0);
  assert.equal(leftoverAttractiveness({ ...base, oxygenPercent: 60, heliumPercent: 50 }), 0);
  assert.equal(leftoverAttractiveness({ ...base, oxygenPercent: Number.NaN, heliumPercent: 40 }), 0);
});

test('pure O2 reaches no standard target at 200 bar with a 350 bar max', () => {
  // Every target needs at least 1/0.21 times the pure-O2 moles: 200 * 4.76 > 350.
  const score = leftoverAttractiveness({
    oxygenPercent: 100, heliumPercent: 0, pressureBar: 200, volumeL: 10, maxPressureBar: 350
  });
  // Only the line term remains: 100 * 0.4 * exp(-15 * 2.077 / sqrt(3.077^2 + 1)).
  assert.ok(Math.abs(score - 100 * 0.4 * lineTerm(100, 0)) < 1e-9);
});

test('pure He reaches only 12/65 and 10/70 at 200 bar with a 350 bar max', () => {
  // Ratios 1/t_He: 12/65 -> 200 * 1.538 = 307.7 <= 350; 15/55 -> 200 * 1.818 = 363.6 > 350.
  // Line term 1 (no residual), versatility 2/5, energy clamped to 1 (2000 bar*L He).
  const score = leftoverAttractiveness({
    oxygenPercent: 0, heliumPercent: 100, pressureBar: 200, volumeL: 10, maxPressureBar: 350
  });
  assert.ok(Math.abs(score - 100 * (0.4 * 1 + 0.4 * 0.4 + 0.2 * 1)) < 1e-9);
});

test('18/45 at low pressure reaches all five targets and scores at least 80', () => {
  // Energy: ideal free gas = P * V = 100 bar*L, helium 45 bar*L -> 0.045.
  const score = leftoverAttractiveness({
    oxygenPercent: 18, heliumPercent: 45, pressureBar: 10, volumeL: 10, maxPressureBar: 350
  });
  const expected = 100 * (0.4 * lineTerm(18, 45) + 0.4 * 1 + 0.2 * 0.045);
  assert.ok(Math.abs(score - expected) < 1e-9);
  assert.ok(score >= 80);
});

test('reachability boundary is inclusive: P * max ratio equal to the max counts as reachable', () => {
  // For 18/45 the largest top-up ratio is 10/70's N2 term: 0.37 / 0.20 = 1.85.
  // At 100 bar, max 185 reaches all five; max 184.9 drops only 10/70 (one fifth of 40 = 8 points).
  const base = { oxygenPercent: 18, heliumPercent: 45, pressureBar: 100, volumeL: 10 };
  const atBoundary = leftoverAttractiveness({ ...base, maxPressureBar: 185 });
  const justBelow = leftoverAttractiveness({ ...base, maxPressureBar: 184.9 });
  assert.ok(Math.abs((atBoundary - justBelow) - 8) < 1e-6);
});

test('energy term is zero for helium-free gas', () => {
  // 21/0 at 100 bar: reaches 21/35, 18/45, 15/55, 12/65 (N2 ratio 0.79/0.23 * 100 = 343.5 <= 350), not 10/70 (395).
  const score = leftoverAttractiveness({
    oxygenPercent: 21, heliumPercent: 0, pressureBar: 100, volumeL: 10, maxPressureBar: 350
  });
  assert.ok(Math.abs(score - 100 * (0.4 * lineTerm(21, 0) + 0.4 * 0.8)) < 1e-9);
});

test('energy term scales with helium litres below 1000 and clamps at 1000', () => {
  // Pure He at 200 bar: line 1, versatility 2/5, He litres = 200 * V.
  // V = 2 -> 400 bar*L -> 0.4; V = 10 and V = 20 both clamp to 1.
  const base = { oxygenPercent: 0, heliumPercent: 100, pressureBar: 200, maxPressureBar: 350 };
  const small = leftoverAttractiveness({ ...base, volumeL: 2 });
  const tenL = leftoverAttractiveness({ ...base, volumeL: 10 });
  const twentyL = leftoverAttractiveness({ ...base, volumeL: 20 });
  assert.ok(Math.abs(small - 100 * (0.4 + 0.4 * 0.4 + 0.2 * 0.4)) < 1e-9);
  assert.ok(Math.abs(tenL - 100 * (0.4 + 0.4 * 0.4 + 0.2)) < 1e-9);
  assert.equal(tenL, twentyL);
});

test('moving a mix off the line lowers the score at the same state', () => {
  const base = { pressureBar: 10, volumeL: 10, maxPressureBar: 350 };
  const onLine = leftoverAttractiveness({ ...base, oxygenPercent: 18, heliumPercent: 45 });
  const offLine = leftoverAttractiveness({ ...base, oxygenPercent: 18, heliumPercent: 50 });
  assert.ok(offLine < onLine);
});
