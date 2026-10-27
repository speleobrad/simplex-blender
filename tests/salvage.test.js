import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SALVAGE_ATTRACTIVENESS_GATE,
  SALVAGE_HE_PRICE_PER_LITRE,
  SALVAGE_MIN_VALUE,
  SALVAGE_NEAR_TIE_POINTS,
  SALVAGE_O2_PRICE_PER_LITRE,
  applyTransferToBank,
  isSalvageReceiver,
  netStockValue,
  rankReceivers,
  salvageTransferMoles,
  selectSalvageVariant
} from '../js/salvage.js';
import { GAS_CONSTANT, calcMolarDensity, calcPressure } from '../js/physics.js';

const IDEAL = Object.freeze({ model: 'ideal', temperatureC: 20 });
const VDW = Object.freeze({ model: 'vdw', temperatureC: 20 });
const RT = GAS_CONSTANT * (20 + 273.15);

// Ideal-gas moles for a pressure in bar and a volume in litres at 20 C.
const molesFor = (pressureBar, volumeL) => pressureBar * volumeL / RT;

const tankAt = (pressureBar, volumeL = 10) => ({ volumeL, pressureBar, oxygenPercent: 21, heliumPercent: 35 });
const bankAt = (pressureBar, { maxPressureBar = 200, volumeL = 10, oxygenPercent = 18, heliumPercent = 45 } = {}) => ({
  id: 'recv', name: 'Receiver', enabled: true, volumeL, pressureBar, maxPressureBar, oxygenPercent, heliumPercent
});

test('constants match the approved prices, gate, and minimum value', () => {
  assert.equal(SALVAGE_HE_PRICE_PER_LITRE, 0.075);
  assert.equal(SALVAGE_O2_PRICE_PER_LITRE, 0.007);
  assert.equal(SALVAGE_MIN_VALUE, 1.0);
  assert.equal(SALVAGE_ATTRACTIVENESS_GATE, -2);
});

test('receiver eligibility truth table', () => {
  const base = { enabled: true, maxPressureBar: 200, oxygenPercent: 18, heliumPercent: 45 };
  assert.equal(isSalvageReceiver(base), true);
  assert.equal(isSalvageReceiver({ ...base, oxygenPercent: 21, heliumPercent: 0 }), true, 'air-like gas');
  assert.equal(isSalvageReceiver({ ...base, oxygenPercent: 0, heliumPercent: 0 }), true, 'nitrogen balance');
  assert.equal(isSalvageReceiver({ ...base, enabled: false }), false, 'disabled');
  assert.equal(isSalvageReceiver({ ...base, maxPressureBar: undefined }), false, 'missing max');
  assert.equal(isSalvageReceiver({ ...base, maxPressureBar: Number.NaN }), false, 'NaN max');
  assert.equal(isSalvageReceiver({ ...base, maxPressureBar: Infinity }), false, 'infinite max');
  assert.equal(isSalvageReceiver({ ...base, oxygenPercent: 100, heliumPercent: 0 }), false, 'pure O2');
  assert.equal(isSalvageReceiver({ ...base, oxygenPercent: 0, heliumPercent: 100 }), false, 'pure He');
  assert.equal(isSalvageReceiver({ ...base, isCompressor: true, oxygenPercent: 21, heliumPercent: 0 }), false, 'compressor');
});

test('transfer is capped by the surplus', () => {
  const surplus = molesFor(5, 10);
  const result = salvageTransferMoles({
    bank: bankAt(20), tank: tankAt(200), surplusMoles: surplus, physics: IDEAL,
    minimumSourcePressureBar: 10, maxBoosterOutputPressureBar: 200, retainedMoles: 0
  });
  assert.ok(Math.abs(result.movedMoles - surplus) < 1e-9);
  assert.equal(result.stage, 'decant');
  assert.ok(Math.abs(result.receiverEndPressureBar - 25) < 1e-6);
});

test('transfer is capped by the bank maximum pressure', () => {
  const result = salvageTransferMoles({
    bank: bankAt(20, { maxPressureBar: 50 }), tank: tankAt(200), surplusMoles: molesFor(100, 10), physics: IDEAL,
    minimumSourcePressureBar: 10, maxBoosterOutputPressureBar: 200, retainedMoles: 0
  });
  assert.ok(Math.abs(result.movedMoles - molesFor(30, 10)) < 1e-9);
  assert.equal(result.stage, 'decant');
  assert.ok(Math.abs(result.receiverEndPressureBar - 50) < 1e-6);
});

test('without a booster, decant stops at pressure equalization', () => {
  // Equal volumes: equalization moves half the pressure difference, 30 -> 20 bar gives 5 bar-equivalent.
  const result = salvageTransferMoles({
    bank: bankAt(20), tank: tankAt(30), surplusMoles: molesFor(25, 10), physics: IDEAL,
    minimumSourcePressureBar: 10, maxBoosterOutputPressureBar: undefined, retainedMoles: 0
  });
  assert.ok(Math.abs(result.movedMoles - molesFor(5, 10)) < 1e-9);
  assert.equal(result.stage, 'decant');
  assert.ok(Math.abs(result.receiverEndPressureBar - 25) < 1e-6);
});

test('with a booster, transfer continues past equalization down to the minimum source pressure', () => {
  const result = salvageTransferMoles({
    bank: bankAt(20), tank: tankAt(30), surplusMoles: molesFor(25, 10), physics: IDEAL,
    minimumSourcePressureBar: 10, maxBoosterOutputPressureBar: 200, retainedMoles: 0
  });
  // Tank can give 30 -> 10 bar (20 bar-equivalent); bank 20 -> 40 bar.
  assert.ok(Math.abs(result.movedMoles - molesFor(20, 10)) < 1e-9);
  assert.equal(result.stage, 'decant+boost');
  assert.ok(Math.abs(result.receiverEndPressureBar - 40) < 1e-6);
});

test('booster minimum source pressure leaves the remainder to be vented', () => {
  const result = salvageTransferMoles({
    bank: bankAt(0, { maxPressureBar: 350 }), tank: tankAt(200), surplusMoles: molesFor(190, 10), physics: IDEAL,
    minimumSourcePressureBar: 50, maxBoosterOutputPressureBar: 350, retainedMoles: 0
  });
  // Tank keeps 50 bar; 150 bar-equivalent moves; 200 - 150 = 50 remains for the vent step.
  assert.ok(Math.abs(result.movedMoles - molesFor(150, 10)) < 1e-9);
  assert.equal(result.stage, 'decant+boost');
  assert.ok(Math.abs(result.receiverEndPressureBar - 150) < 1e-6);
});

test('under van der Waals the reported receiver end pressure holds exactly the moved moles', () => {
  const bank = bankAt(20, { maxPressureBar: 350, volumeL: 10 });
  const tank = { volumeL: 10, pressureBar: 200, oxygenPercent: 21, heliumPercent: 35 };
  const result = salvageTransferMoles({
    bank, tank, surplusMoles: molesFor(190, 10), physics: VDW,
    minimumSourcePressureBar: 50, maxBoosterOutputPressureBar: 350, retainedMoles: 0
  });
  const bankMoles = calcMolarDensity(20, 18, 45, 20, true) * 10;
  // Moles are conserved: bank before + moved = bank after, at the mixed composition.
  const next = applyTransferToBank(bank, { oxygenPercent: 21, heliumPercent: 35 }, result.movedMoles, VDW);
  const total = bankMoles + result.movedMoles;
  assert.ok(Math.abs(calcMolarDensity(next.pressureBar, next.oxygenPercent, next.heliumPercent, 20, true) * 10 - total) < 1e-6);
  assert.ok(Math.abs(next.pressureBar - result.receiverEndPressureBar) < 1e-6);
});

test('retained moles raise the tank floor above the minimum source pressure', () => {
  const result = salvageTransferMoles({
    bank: bankAt(0, { maxPressureBar: 350 }), tank: tankAt(200), surplusMoles: molesFor(190, 10), physics: IDEAL,
    minimumSourcePressureBar: 10, maxBoosterOutputPressureBar: 350, retainedMoles: molesFor(120, 10)
  });
  // Tank may only fall to the 120 bar it retains: 80 bar-equivalent moves, all by decant (equalization is 100 bar).
  assert.ok(Math.abs(result.movedMoles - molesFor(80, 10)) < 1e-9);
  assert.equal(result.stage, 'decant');
  assert.ok(Math.abs(result.receiverEndPressureBar - 80) < 1e-6);
});

test('boost-only transfer when the bank is already above tank pressure', () => {
  const result = salvageTransferMoles({
    bank: bankAt(120, { maxPressureBar: 200 }), tank: tankAt(100), surplusMoles: molesFor(90, 10), physics: IDEAL,
    minimumSourcePressureBar: 10, maxBoosterOutputPressureBar: 200, retainedMoles: 0
  });
  // Bank room to 200 bar is 80 bar-equivalent; tank can give 90.
  assert.ok(Math.abs(result.movedMoles - molesFor(80, 10)) < 1e-9);
  assert.equal(result.stage, 'boost');
  assert.ok(Math.abs(result.receiverEndPressureBar - 200) < 1e-6);
});

test('booster output cap does not cut a decant that stops at equalization', () => {
  // Bank 10 L at 150 bar (max 300), tank 10 L at 300 bar, booster cap 200.
  // Equalization: (3000 - m) / 10 = (1500 + m) / 10 -> m = 750 bar*L, i.e. 225 bar in both.
  // The cap 200 bar allows only (200 - 150) * 10 = 500 bar*L, but the decant (750) is already past it.
  const result = salvageTransferMoles({
    bank: bankAt(150, { maxPressureBar: 300 }), tank: tankAt(300), surplusMoles: molesFor(300, 10), physics: IDEAL,
    minimumSourcePressureBar: 10, maxBoosterOutputPressureBar: 200, retainedMoles: 0
  });
  assert.ok(Math.abs(result.movedMoles - molesFor(75, 10)) < 1e-9);
  assert.equal(result.stage, 'decant');
  assert.ok(Math.abs(result.receiverEndPressureBar - 225) < 1e-6);
});

test('booster continues past equalization and stops at its output cap', () => {
  // Bank 10 L at 20 bar (max 300); tank 40 L at 100 bar; booster cap 150 bar.
  // Equalization: (4000 - m) / 40 = (200 + m) / 10 -> m = 640 bar*L, i.e. bank 84 bar, tank 84 bar.
  // Moving 1300 bar*L takes the bank to 150 bar; the tank keeps 4000 - 1300 = 2700 bar*L, far above its floor, and the 2000 bar*L surplus is not binding.
  const result = salvageTransferMoles({
    bank: bankAt(20, { maxPressureBar: 300 }), tank: tankAt(100, 40), surplusMoles: molesFor(200, 10), physics: IDEAL,
    minimumSourcePressureBar: 10, maxBoosterOutputPressureBar: 150, retainedMoles: 0
  });
  assert.ok(Math.abs(result.movedMoles - molesFor(130, 10)) < 1e-9);
  assert.equal(result.stage, 'decant+boost');
  assert.ok(Math.abs(result.receiverEndPressureBar - 150) < 1e-6);
});

test('applyTransferToBank mixes composition by moles and keeps volume', () => {
  const bank = bankAt(20, { oxygenPercent: 0, heliumPercent: 100, maxPressureBar: 200 });
  const next = applyTransferToBank(bank, { oxygenPercent: 21, heliumPercent: 35 }, molesFor(30, 10), IDEAL);
  assert.equal(next.volumeL, 10);
  assert.ok(Math.abs(next.pressureBar - 50) < 1e-6);
  assert.ok(Math.abs(next.heliumPercent - 61) < 1e-6);
  assert.ok(Math.abs(next.oxygenPercent - 12.6) < 1e-6);
});

test('applyTransferToBank with no moved gas leaves pressure and mix unchanged', () => {
  const bank = bankAt(20);
  const next = applyTransferToBank(bank, { oxygenPercent: 21, heliumPercent: 35 }, 0, IDEAL);
  assert.ok(Math.abs(next.pressureBar - 20) < 1e-9);
  assert.equal(next.oxygenPercent, 18);
  assert.equal(next.heliumPercent, 45);
});

test('applyTransferToBank under van der Waals mixes by moles and uses the real-gas pressure', () => {
  const bank = bankAt(100);
  const tankMix = { oxygenPercent: 21, heliumPercent: 35 };
  const moved = calcMolarDensity(30, 21, 35, 20, true) * 10;
  const next = applyTransferToBank(bank, tankMix, moved, VDW);
  const bankMoles = calcMolarDensity(100, 18, 45, 20, true) * 10;
  const total = bankMoles + moved;
  const oxygen = (bankMoles * 18 + moved * 21) / total;
  const helium = (bankMoles * 45 + moved * 35) / total;
  assert.ok(Math.abs(next.pressureBar - calcPressure(total / 10, oxygen, helium, 20, true)) < 1e-6);
  assert.ok(Math.abs(next.oxygenPercent - oxygen) < 1e-9);
  assert.ok(Math.abs(next.heliumPercent - helium) < 1e-9);
  // The real-gas result must differ from the ideal-gas one at this pressure, otherwise the vdW branch is not exercised.
  const idealPressure = total * RT / 10;
  assert.ok(Math.abs(next.pressureBar - idealPressure) > 0.1);
});

test('net stock value prices He and O2 free litres in enabled banks only', () => {
  const he = { enabled: true, volumeL: 10, pressureBar: 100, oxygenPercent: 0, heliumPercent: 100 };
  const o2 = { enabled: true, volumeL: 10, pressureBar: 100, oxygenPercent: 100, heliumPercent: 0 };
  const mixed = { enabled: true, volumeL: 10, pressureBar: 100, oxygenPercent: 18, heliumPercent: 45 };
  const disabled = { ...he, enabled: false };
  assert.ok(Math.abs(netStockValue([he], IDEAL) - 75) < 1e-6);
  assert.ok(Math.abs(netStockValue([o2], IDEAL) - 7) < 1e-9);
  assert.ok(Math.abs(netStockValue([mixed], IDEAL) - (450 * 0.075 + 180 * 0.007)) < 1e-6);
  assert.ok(Math.abs(netStockValue([he, disabled], IDEAL) - 75) < 1e-6);
});

test('net value counts salvage only through stock left after the recipe draws', () => {
  const donor = { id: 'donor', enabled: true, volumeL: 10, pressureBar: 100, oxygenPercent: 0, heliumPercent: 100 };
  const receiverEmptyAfterDraws = { id: 'recv', enabled: true, volumeL: 10, pressureBar: 0, oxygenPercent: 18, heliumPercent: 45 };
  // Empty receiver holds nothing: only the donor's 1000 bar*L of He (10 L at 100 bar) counts.
  const baseline = netStockValue([donor, receiverEmptyAfterDraws], IDEAL);
  assert.ok(Math.abs(baseline - 75) < 1e-6);
  // Gas left in the receiver (20 bar, 10 L = 200 bar*L of 18/45) counts at its price.
  const retained = { ...receiverEmptyAfterDraws, pressureBar: 20 };
  const delta = netStockValue([donor, retained], IDEAL) - baseline;
  assert.ok(Math.abs(delta - (200 * 0.45 * 0.075 + 200 * 0.18 * 0.007)) < 1e-6);
});

// Selection fixtures: bankScoresOf reads the score carried on each bank state.
const scoreOf = bank => bank.score;
const donorAt = (pressureBar, score = 50) => ({
  id: 'donor', enabled: true, volumeL: 10, pressureBar, maxPressureBar: 350,
  oxygenPercent: 0, heliumPercent: 100, score
});
const receiverAt = (pressureBar, score = 60) => ({
  id: 'recv', enabled: true, volumeL: 10, pressureBar, maxPressureBar: 200,
  oxygenPercent: 18, heliumPercent: 45, score
});
const baseline = { finalBanks: [donorAt(100), receiverAt(20)] };
const variant = (id, { receiver = receiverAt(30), donor = donorAt(100), salvaged = 5, resolved = 10, lpCost = 1 } = {}) => ({
  id, salvagedMoles: salvaged, resolvedSurplusMoles: resolved, finalBanks: [donor, receiver], lpCost, transfers: []
});
const select = variants => selectSalvageVariant({ baseline, variants, bankScoresOf: scoreOf, physics: IDEAL });

test('selection drops infeasible variants', () => {
  const infeasible = variant('infeasible', { receiver: receiverAt(40), salvaged: 5, resolved: 4 });
  const feasible = variant('feasible', { receiver: receiverAt(30) });
  assert.equal(select([infeasible, feasible]).id, 'feasible');
  assert.equal(select([infeasible]), null);
});

test('selection drops variants where a bank loses more than two points, keeping an exact -2 change', () => {
  const violating = variant('violating', { receiver: receiverAt(40, 57) });
  const boundary = variant('boundary', { receiver: receiverAt(30, 58) });
  assert.equal(select([violating]), null);
  assert.equal(select([violating, boundary]).id, 'boundary');
});

test('selection drops a variant whose donor bank loses more than two points', () => {
  // Receiver gains 200 bar*L of 18/45 (about 7.0 value); only the donor's score differs.
  const donorDrop = variant('donor-drop', { donor: donorAt(100, 47), receiver: receiverAt(40, 60) });
  const donorOk = variant('donor-ok', { donor: donorAt(100, 50), receiver: receiverAt(40, 60) });
  assert.equal(select([donorDrop]), null);
  assert.equal(select([donorDrop, donorOk]).id, 'donor-ok');
});

test('selection rejects a variant with moved gas whose final banks equal the baseline', () => {
  const noop = { ...variant('noop', { receiver: receiverAt(20) }), transfers: [{ receiverId: 'recv', movedMoles: 5 }] };
  assert.equal(noop.salvagedMoles, 5);
  assert.equal(select([noop]), null);
});

test('selection drops variants below the minimum value and keeps one exactly at it', () => {
  // Pure He donor: 10 L of He at 1 bar is 10 bar*L = 0.75 value, so 4/3 bar is exactly 1.0.
  const exact = variant('exact', { donor: donorAt(100 + 4 / 3), receiver: receiverAt(20) });
  const short = variant('short', { donor: donorAt(100 + 4 / 3 - 0.01), receiver: receiverAt(20) });
  assert.equal(select([short]), null);
  assert.equal(select([short, exact]).id, 'exact');
});

test('selection ranks value kept first, then attractiveness change, then LP cost', () => {
  const bigger = variant('bigger', { receiver: receiverAt(40, 60), lpCost: 5 });
  const smallerButBetterScores = variant('smaller', { receiver: receiverAt(30, 62), lpCost: 1 });
  assert.equal(select([smallerButBetterScores, bigger]).id, 'bigger');

  const higherScore = variant('higher-score', { receiver: receiverAt(40, 61), lpCost: 9 });
  const lowerScore = variant('lower-score', { receiver: receiverAt(40, 60), lpCost: 1 });
  assert.equal(select([lowerScore, higherScore]).id, 'higher-score');

  const cheap = variant('cheap', { receiver: receiverAt(40, 60), lpCost: 2 });
  const expensive = variant('expensive', { receiver: receiverAt(40, 60), lpCost: 3 });
  assert.equal(select([expensive, cheap]).id, 'cheap');
});

test('selection ranks a missing LP cost last among otherwise tied variants', () => {
  const costed = variant('costed', { receiver: receiverAt(40, 60), lpCost: 3 });
  const unknown = { ...variant('unknown', { receiver: receiverAt(40, 60) }), lpCost: undefined };
  assert.equal(select([unknown, costed]).id, 'costed');
});

test('selection returns null when no variant qualifies', () => {
  assert.equal(select([]), null);
  assert.equal(select([variant('tiny', { receiver: receiverAt(20.01) })]), null);
});

test('rankReceivers sorts by attractiveness change right after transfer, stable for ties', () => {
  const candidate = (id, afterScore) => ({
    id, receiver: receiverAt(20, 60), transferredReceiver: receiverAt(30, afterScore)
  });
  const ranked = rankReceivers([candidate('down', 58), candidate('up', 61), candidate('flat-a', 60), candidate('flat-b', 60)], scoreOf);
  assert.deepEqual(ranked.map(entry => entry.id), ['up', 'flat-a', 'flat-b', 'down']);
});

test('selection rejects a variant that lowers the retained cylinder moles, even when value and attractiveness pass', () => {
  const retainedBaseline = { ...baseline, retainedMoles: 10 };
  const lowerRetained = { ...variant('lower-retained', { receiver: receiverAt(40, 60) }), retainedMoles: 9.9999 };
  const equalRetained = { ...variant('equal-retained', { receiver: receiverAt(40, 60) }), retainedMoles: 10 };
  const selectRetained = variants => selectSalvageVariant({
    baseline: retainedBaseline, variants, bankScoresOf: scoreOf, physics: IDEAL
  });

  assert.equal(selectRetained([lowerRetained]), null);
  assert.equal(selectRetained([lowerRetained, equalRetained]).id, 'equal-retained');
});

// Near ties in attractiveness are decided by how many standard targets the receiving bank can
// still reach. Fixtures carry the reach on each bank state, like the score.
const reachOf = bank => bank.reach;
const reaching = (reach, score) => ({ ...receiverAt(30, score), reach });
const selectWithReach = variants => selectSalvageVariant({
  baseline, variants, bankScoresOf: scoreOf, bankReachOf: reachOf, physics: IDEAL
});

test('selection prefers more reachable targets when attractiveness changes are within the near-tie margin', () => {
  const fewerTargets = variant('fewer', { receiver: reaching(3, 62.0) });
  const moreTargets = variant('more', { receiver: reaching(5, 61.6) });
  assert.equal(selectWithReach([fewerTargets, moreTargets]).id, 'more');
  assert.equal(selectWithReach([moreTargets, fewerTargets]).id, 'more');
});

test('selection keeps the larger attractiveness change when it leads by more than the near-tie margin', () => {
  const fewerTargets = variant('fewer', { receiver: reaching(3, 62.0) });
  const moreTargets = variant('more', { receiver: reaching(5, 62.0 - SALVAGE_NEAR_TIE_POINTS - 0.5) });
  assert.equal(selectWithReach([moreTargets, fewerTargets]).id, 'fewer');
});

test('selection ignores reach when no reach function is given', () => {
  const fewerTargets = variant('fewer', { receiver: reaching(3, 62.0) });
  const moreTargets = variant('more', { receiver: reaching(5, 61.6) });
  assert.equal(select([moreTargets, fewerTargets]).id, 'fewer');
});

test('selection judges reach on the banks the variant changed, not on untouched banks', () => {
  // Both variants leave the donor untouched at reach 5; only the receiver differs.
  const lowReach = variant('low', { receiver: reaching(2, 62.0), donor: { ...donorAt(100), reach: 5 } });
  const highReach = variant('high', { receiver: reaching(4, 61.8), donor: { ...donorAt(100), reach: 5 } });
  const baselineWithReach = { finalBanks: [{ ...donorAt(100), reach: 5 }, { ...receiverAt(20), reach: 1 }] };
  const chosen = selectSalvageVariant({
    baseline: baselineWithReach, variants: [lowReach, highReach], bankScoresOf: scoreOf, bankReachOf: reachOf, physics: IDEAL
  });
  assert.equal(chosen.id, 'high');
});

test('rankReceivers puts a near-tie receiver with more reachable targets first, and respects clear leads', () => {
  const candidate = (id, afterScore, reach) => ({
    id, receiver: receiverAt(20, 60), transferredReceiver: { ...receiverAt(30, afterScore), reach }
  });
  const nearTie = rankReceivers(
    [candidate('shallow', 62.6, 3), candidate('deep', 62.14, 5)], scoreOf, reachOf
  );
  assert.deepEqual(nearTie.map(entry => entry.id), ['deep', 'shallow']);
  const clearLead = rankReceivers(
    [candidate('shallow', 64.5, 3), candidate('deep', 62.0, 5)], scoreOf, reachOf
  );
  assert.deepEqual(clearLead.map(entry => entry.id), ['shallow', 'deep']);
  const noReach = rankReceivers([candidate('shallow', 62.6, 3), candidate('deep', 62.14, 5)], scoreOf);
  assert.deepEqual(noReach.map(entry => entry.id), ['shallow', 'deep']);
});
