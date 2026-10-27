import test from 'node:test';
import assert from 'node:assert/strict';
import { leftoverAttractiveness, STANDARD_TARGETS, SCORE_REFERENCE_HELIUM_LITRES } from '../js/leftover-attractiveness.js';

// Independent line term: exp(-15 * |3.077 O2 + He - 1| / sqrt(3.077^2 + 1)), fractions.
function lineTerm(oxygenPercent, heliumPercent) {
  const residual = Math.abs(3.077 * (oxygenPercent / 100) + heliumPercent / 100 - 1);
  return Math.exp(-15 * residual / Math.hypot(3.077, 1));
}

// Ideal-gas mix of two same-volume, same-temperature gases: pressures add, mole fractions weight by pressure.
function mixAtSameVolume(bank, added) {
  const totalBar = bank.pressureBar + added.pressureBar;
  return {
    pressureBar: totalBar,
    oxygenPercent: (bank.pressureBar * bank.oxygenPercent + added.pressureBar * added.oxygenPercent) / totalBar,
    heliumPercent: (bank.pressureBar * bank.heliumPercent + added.pressureBar * added.heliumPercent) / totalBar
  };
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

test('heliox built from moles that sums to 100 plus float error is valid, not 0', () => {
  // (2/11)*100 + (9/11)*100 = 100.00000000000001 in IEEE doubles.
  const oxygenPercent = (2 / 11) * 100;
  const heliumPercent = (9 / 11) * 100;
  assert.ok(oxygenPercent + heliumPercent > 100);
  const score = leftoverAttractiveness({
    oxygenPercent, heliumPercent, pressureBar: 10, volumeL: 10, maxPressureBar: 350
  });
  // All five targets reachable at 10 bar (max ratio 1.818 -> 18 bar <= 350). He energy: 10*10*(9/11) = 81.8 L -> 0.0818.
  const expected = 100 * (0.4 * lineTerm(oxygenPercent, heliumPercent) + 0.4 * 1 + 0.2 * (100 * 9 / 11 / 100) * 10 * 10 / 1000);
  assert.ok(Math.abs(score - expected) < 1e-9);
  // Hand: line term exp(-15*0.37764/3.1) ~ 0.1736 -> 100*(0.0695 + 0.4 + 0.0164) ~ 48.58.
  assert.ok(score > 48.5 && score < 48.7);
});

test('pure O2 reaches no standard target at 200 bar with a 350 bar max', () => {
  // Every target needs at least 1/0.21 times the pure-O2 moles: 200 * 4.76 > 350.
  const score = leftoverAttractiveness({
    oxygenPercent: 100, heliumPercent: 0, pressureBar: 200, volumeL: 10, maxPressureBar: 350
  });
  // Only the line term remains: 100 * 0.4 * exp(-15 * 2.077 / sqrt(3.077^2 + 1)).
  assert.ok(Math.abs(score - 100 * 0.4 * lineTerm(100, 0)) < 1e-9);
});

test('pure O2 with a 350 bar max is 5/5 reachable at 35 bar and 0/5 at 74 bar', () => {
  const base = { oxygenPercent: 100, heliumPercent: 0, volumeL: 10, maxPressureBar: 350 };
  const at35 = leftoverAttractiveness({ ...base, pressureBar: 35 });
  const at74 = leftoverAttractiveness({ ...base, pressureBar: 74 });
  // Energy is zero (no He); line term is pressure-independent. Versatility 5/5 -> 0/5 is 40 points.
  assert.ok(Math.abs((at35 - at74) - 40) < 1e-9);
  assert.ok(Math.abs(at74 - 100 * 0.4 * lineTerm(100, 0)) < 1e-9);
});

test('pure He with a 350 bar max is 5/5 reachable at 122.5 bar and 4/5 just above', () => {
  // 21/35 needs He ratio 1/0.35 = 2.857: 122.5 * 2.857 = 350 (inclusive); 122.6 exceeds the max.
  const base = { oxygenPercent: 0, heliumPercent: 100, volumeL: 10, maxPressureBar: 350 };
  const at1225 = leftoverAttractiveness({ ...base, pressureBar: 122.5 });
  const at1226 = leftoverAttractiveness({ ...base, pressureBar: 122.6 });
  const at122 = leftoverAttractiveness({ ...base, pressureBar: 122 });
  // Energy clamps at 1 for both (1220+ bar*L of He), so the only change is 21/35: 0.4 * 100 * 1/5 = 8.
  assert.ok(Math.abs((at1225 - at1226) - 8) < 1e-9);
  assert.ok(Math.abs(at122 - at1225) < 1e-9);
  assert.ok(Math.abs(at122 - 100 * (0.4 + 0.4 + 0.2)) < 1e-9);
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

test('reachability boundary is inclusive for an exact ratio of 1', () => {
  // 21/35 gas: top-up ratio to 21/35 is exactly 1 (every component matches), to 18/45 it is 1.1667.
  // At P = max = 200 only 21/35 is reachable; at max 199.99 it is not, so the score drops by 0.4*100*(1/5) = 8.
  const base = { oxygenPercent: 21, heliumPercent: 35, pressureBar: 200, volumeL: 10 };
  const atBoundary = leftoverAttractiveness({ ...base, maxPressureBar: 200 });
  const justBelow = leftoverAttractiveness({ ...base, maxPressureBar: 199.99 });
  assert.ok(Math.abs((atBoundary - justBelow) - 8) < 1e-9);
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

test('12/65 dump into a 21/35 bank at 100 bar of 200 max lowers the score by about 6 (refused by the -2 gate)', () => {
  const bank = { oxygenPercent: 21, heliumPercent: 35, pressureBar: 100 };
  const dump = { oxygenPercent: 12, heliumPercent: 65, pressureBar: 10 };
  const mixed = mixAtSameVolume(bank, dump);
  const before = leftoverAttractiveness({ ...bank, volumeL: 12, maxPressureBar: 200 });
  const after = leftoverAttractiveness({ ...mixed, volumeL: 12, maxPressureBar: 200 });
  // Hand arithmetic: 12/65 becomes unreachable (N2 0.4209 * 110 = 46.3 bar-equivalent ratio -> 201.3 > 200): -8.
  // Helium energy 420 -> 498 bar*L adds +1.56; line term moves +0.39. Net about -6.05.
  const delta = after - before;
  assert.ok(delta > -6.2 && delta < -5.9, `delta ${delta}`);
  assert.ok(delta < -2);
});

test('the same 21/35 bank at 45 bar of 12/65 at 50 bar raises the score by about 7 (accepted)', () => {
  const bank = { oxygenPercent: 21, heliumPercent: 35, pressureBar: 45 };
  const dump = { oxygenPercent: 12, heliumPercent: 65, pressureBar: 50 };
  const mixed = mixAtSameVolume(bank, dump);
  const before = leftoverAttractiveness({ ...bank, volumeL: 12, maxPressureBar: 200 });
  const after = leftoverAttractiveness({ ...mixed, volumeL: 12, maxPressureBar: 200 });
  // Reachability stays 5/5. Helium energy 189 -> 579 L adds +7.8; line term drops about 0.82. Net about +6.98.
  const delta = after - before;
  assert.ok(delta > 6.8 && delta < 7.2, `delta ${delta}`);
});
