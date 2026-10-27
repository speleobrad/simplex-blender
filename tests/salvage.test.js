import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SALVAGE_ATTRACTIVENESS_GATE,
  SALVAGE_HE_PRICE_PER_LITRE,
  SALVAGE_MIN_VALUE,
  SALVAGE_O2_PRICE_PER_LITRE,
  applyTransferToBank,
  isSalvageReceiver,
  netStockValue,
  rankReceivers,
  salvageTransferMoles,
  selectSalvageVariant
} from '../js/salvage.js';
import { GAS_CONSTANT } from '../js/physics.js';

const IDEAL = Object.freeze({ model: 'ideal', temperatureC: 20 });
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
    bank: bankAt(20), tank: tankAt(30), surplusMoles: molesFor(100, 10), physics: IDEAL,
    minimumSourcePressureBar: 10, maxBoosterOutputPressureBar: undefined, retainedMoles: 0
  });
  assert.ok(Math.abs(result.movedMoles - molesFor(5, 10)) < 1e-9);
  assert.equal(result.stage, 'decant');
  assert.ok(Math.abs(result.receiverEndPressureBar - 25) < 1e-6);
});

test('with a booster, transfer continues past equalization down to the minimum source pressure', () => {
  const result = salvageTransferMoles({
    bank: bankAt(20), tank: tankAt(30), surplusMoles: molesFor(100, 10), physics: IDEAL,
    minimumSourcePressureBar: 10, maxBoosterOutputPressureBar: 200, retainedMoles: 0
  });
  // Tank can give 30 -> 10 bar (20 bar-equivalent); bank 20 -> 40 bar.
  assert.ok(Math.abs(result.movedMoles - molesFor(20, 10)) < 1e-9);
  assert.equal(result.stage, 'decant+boost');
  assert.ok(Math.abs(result.receiverEndPressureBar - 40) < 1e-6);
});

test('booster minimum source pressure leaves the remainder to be vented', () => {
  const result = salvageTransferMoles({
    bank: bankAt(0, { maxPressureBar: 350 }), tank: tankAt(200), surplusMoles: molesFor(400, 10), physics: IDEAL,
    minimumSourcePressureBar: 50, maxBoosterOutputPressureBar: 350, retainedMoles: 0
  });
  // Tank keeps 50 bar; 150 bar-equivalent moves; 200 - 150 = 50 remains for the vent step.
  assert.ok(Math.abs(result.movedMoles - molesFor(150, 10)) < 1e-9);
  assert.equal(result.stage, 'decant+boost');
  assert.ok(Math.abs(result.receiverEndPressureBar - 150) < 1e-6);
});

test('retained moles lower the deliverable floor above the minimum source pressure', () => {
  const result = salvageTransferMoles({
    bank: bankAt(0, { maxPressureBar: 350 }), tank: tankAt(200), surplusMoles: molesFor(400, 10), physics: IDEAL,
    minimumSourcePressureBar: 10, maxBoosterOutputPressureBar: 350, retainedMoles: molesFor(120, 10)
  });
  // Tank may only fall to the 120 bar it retains: 80 bar-equivalent moves, all by decant (equalization is 100 bar).
  assert.ok(Math.abs(result.movedMoles - molesFor(80, 10)) < 1e-9);
  assert.equal(result.stage, 'decant');
  assert.ok(Math.abs(result.receiverEndPressureBar - 80) < 1e-6);
});

test('boost-only transfer when the bank is already above tank pressure', () => {
  const result = salvageTransferMoles({
    bank: bankAt(120, { maxPressureBar: 200 }), tank: tankAt(100), surplusMoles: molesFor(200, 10), physics: IDEAL,
    minimumSourcePressureBar: 10, maxBoosterOutputPressureBar: 200, retainedMoles: 0
  });
  // Bank room to 200 bar is 80 bar-equivalent; tank can give 90.
  assert.ok(Math.abs(result.movedMoles - molesFor(80, 10)) < 1e-9);
  assert.equal(result.stage, 'boost');
  assert.ok(Math.abs(result.receiverEndPressureBar - 200) < 1e-6);
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
  // Empty receiver holds nothing: only the donor's 1000 L He (10 L at 100 bar) counts.
  const baseline = netStockValue([donor, receiverEmptyAfterDraws], IDEAL);
  assert.ok(Math.abs(baseline - 75) < 1e-6);
  // Gas left in the receiver (20 bar, 10 L = 200 L of 18/45) counts at its price.
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
