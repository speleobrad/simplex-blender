import { GAS_CONSTANT, calcMolarDensity, calcPressure } from './physics.js';

export const SALVAGE_HE_PRICE_PER_LITRE = 0.075;
export const SALVAGE_O2_PRICE_PER_LITRE = 0.007;
export const SALVAGE_MIN_VALUE = 1.0;
export const SALVAGE_ATTRACTIVENESS_GATE = -2;
// Attractiveness changes within this many points of the best are a near tie; a near tie is
// decided by the number of standard targets the receiving banks can still reach.
export const SALVAGE_NEAR_TIE_POINTS = 1.0;

const TOLERANCE = 1e-9;
const RETENTION_RELATIVE_TOLERANCE = 1e-9;
const BISECTION_STEPS = 100;

function usesVdw(physics) {
  return physics.model === 'vdw';
}

function molesOf(bank, physics, pressureBar = bank.pressureBar) {
  const molarDensity = calcMolarDensity(
    pressureBar, bank.oxygenPercent, bank.heliumPercent, physics.temperatureC, usesVdw(physics)
  );
  return molarDensity * bank.volumeL;
}

function pressureOfMoles(moles, volumeL, oxygenPercent, heliumPercent, physics) {
  if (moles <= 0) return 0;
  return calcPressure(moles / volumeL, oxygenPercent, heliumPercent, physics.temperatureC, usesVdw(physics));
}

function freeGasLitres(moles, physics) {
  return moles * GAS_CONSTANT * (physics.temperatureC + 273.15);
}

// Gas in `bank` after adding `addedMoles` of `tank`'s gas (composition mixes by moles).
function mixInto(bank, bankMoles, tank, addedMoles) {
  const totalMoles = bankMoles + addedMoles;
  if (totalMoles <= 0) {
    return { moles: 0, oxygenPercent: bank.oxygenPercent, heliumPercent: bank.heliumPercent };
  }
  const oxygenMoles = bankMoles * bank.oxygenPercent / 100 + addedMoles * tank.oxygenPercent / 100;
  const heliumMoles = bankMoles * bank.heliumPercent / 100 + addedMoles * tank.heliumPercent / 100;
  return {
    moles: totalMoles,
    oxygenPercent: 100 * oxygenMoles / totalMoles,
    heliumPercent: 100 * heliumMoles / totalMoles
  };
}

// Largest x in [0, hi] for which predicate holds, assuming it holds on a prefix.
function largestWhere(hi, predicate) {
  if (hi <= 0 || !predicate(0)) return 0;
  if (predicate(hi)) return hi;
  let low = 0;
  let high = hi;
  for (let step = 0; step < BISECTION_STEPS; step++) {
    const middle = (low + high) / 2;
    if (predicate(middle)) low = middle;
    else high = middle;
  }
  return low;
}

function bankPressureAfter(bank, bankMoles, tank, addedMoles, physics) {
  const mixed = mixInto(bank, bankMoles, tank, addedMoles);
  return pressureOfMoles(mixed.moles, bank.volumeL, mixed.oxygenPercent, mixed.heliumPercent, physics);
}

// Descending/ascending comparators treating values within TOLERANCE as ties; Infinity ties with Infinity.
function compareDescending(a, b) {
  if (a === b || Math.abs(a - b) <= TOLERANCE) return 0;
  return a > b ? -1 : 1;
}

function compareAscending(a, b) {
  if (a === b || Math.abs(a - b) <= TOLERANCE) return 0;
  return a < b ? -1 : 1;
}

/**
 * Chooses the preferred entry: among entries whose `change` is within SALVAGE_NEAR_TIE_POINTS of
 * the best, the one with the most reachable targets (`reach`), then the larger `change`.
 */
function preferredEntry(entries) {
  const bestChange = Math.max(...entries.map(entry => entry.change));
  const nearTie = entries.filter(entry => bestChange - entry.change <= SALVAGE_NEAR_TIE_POINTS + TOLERANCE);
  return nearTie.reduce((best, entry) => (
    entry.reach > best.reach || (entry.reach === best.reach && compareDescending(entry.change, best.change) < 0)
      ? entry
      : best
  ));
}

export function isSalvageReceiver(bank) {
  return bank?.enabled === true
    && Number.isFinite(bank.maxPressureBar)
    && bank.isCompressor !== true
    && bank.oxygenPercent < 100
    && bank.heliumPercent < 100;
}

/**
 * Moles the working tank can move into `bank` in one salvage step.
 * Decant goes up to pressure equalization (and never past the bank maximum);
 * the booster may continue beyond equalization up to the booster output cap.
 */
export function salvageTransferMoles({
  bank,
  tank,
  surplusMoles,
  physics,
  minimumSourcePressureBar,
  maxBoosterOutputPressureBar,
  retainedMoles = 0
}) {
  const tankMoles = molesOf(tank, physics, tank.pressureBar);
  const bankMoles = molesOf(bank, physics);
  const floorMoles = Math.max(
    retainedMoles,
    molesOf(tank, physics, minimumSourcePressureBar)
  );
  const available = Math.max(0, Math.min(surplusMoles, tankMoles - floorMoles));

  const roomUnder = capPressureBar => largestWhere(
    tankMoles,
    addedMoles => bankPressureAfter(bank, bankMoles, tank, addedMoles, physics) <= capPressureBar
  );

  const equalizationMoles = largestWhere(
    tankMoles,
    addedMoles => pressureOfMoles(tankMoles - addedMoles, tank.volumeL, tank.oxygenPercent, tank.heliumPercent, physics)
      - bankPressureAfter(bank, bankMoles, tank, addedMoles, physics) >= 0
  );

  const decantMoles = Math.min(available, equalizationMoles, roomUnder(bank.maxPressureBar));

  let movedMoles = decantMoles;
  if (Number.isFinite(maxBoosterOutputPressureBar)) {
    const boostCap = Math.min(bank.maxPressureBar, maxBoosterOutputPressureBar);
    movedMoles = Math.min(available, Math.max(decantMoles, roomUnder(boostCap)));
  }

  const boostMoles = movedMoles - decantMoles;
  let stage = 'decant';
  if (boostMoles > TOLERANCE) {
    stage = decantMoles > TOLERANCE ? 'decant+boost' : 'boost';
  }

  return {
    movedMoles,
    stage,
    receiverEndPressureBar: bankPressureAfter(bank, bankMoles, tank, movedMoles, physics)
  };
}

/** Bank state after receiving `movedMoles` of the tank's gas. Volume is unchanged. */
export function applyTransferToBank(bank, tankMix, movedMoles, physics) {
  const bankMoles = molesOf(bank, physics);
  const mixed = mixInto(bank, bankMoles, tankMix, movedMoles);
  return {
    ...bank,
    pressureBar: pressureOfMoles(mixed.moles, bank.volumeL, mixed.oxygenPercent, mixed.heliumPercent, physics),
    oxygenPercent: mixed.oxygenPercent,
    heliumPercent: mixed.heliumPercent
  };
}

/** Bank state after the recipe draws `drawnMoles` of its gas. Mix and volume are unchanged. */
export function applyDrawToBank(bank, drawnMoles, physics) {
  if (!(drawnMoles > 0)) return bank;
  const remainingMoles = Math.max(0, molesOf(bank, physics) - drawnMoles);
  return {
    ...bank,
    pressureBar: pressureOfMoles(remainingMoles, bank.volumeL, bank.oxygenPercent, bank.heliumPercent, physics)
  };
}

/** Price of the He and O2 free-gas litres held in enabled banks. */
export function netStockValue(banks, physics) {
  let value = 0;
  for (const bank of banks) {
    if (bank.enabled !== true) continue;
    const litres = freeGasLitres(molesOf(bank, physics), physics);
    value += litres * bank.heliumPercent / 100 * SALVAGE_HE_PRICE_PER_LITRE;
    value += litres * bank.oxygenPercent / 100 * SALVAGE_O2_PRICE_PER_LITRE;
  }
  return value;
}

function attractivenessDeltas(baselineBanks, variantBanks, bankScoresOf) {
  const variantById = new Map(variantBanks.map(bank => [bank.id, bank]));
  const deltas = [];
  for (const baselineBank of baselineBanks) {
    const variantBank = variantById.get(baselineBank.id);
    if (!variantBank) continue;
    deltas.push(bankScoresOf(variantBank) - bankScoresOf(baselineBank));
  }
  return deltas;
}

// Mean number of reachable standard targets over the banks this variant changed (the receivers
// and any bank whose draw changed), judged on their final post-recipe state. 0 when none changed.
function receiverReach(baselineBanks, variantBanks, bankReachOf) {
  const baselineById = new Map(baselineBanks.map(bank => [bank.id, bank]));
  const reaches = [];
  for (const bank of variantBanks) {
    const before = baselineById.get(bank.id);
    const changed = !before
      || Math.abs(bank.pressureBar - before.pressureBar) > TOLERANCE
      || Math.abs(bank.oxygenPercent - before.oxygenPercent) > TOLERANCE
      || Math.abs(bank.heliumPercent - before.heliumPercent) > TOLERANCE;
    if (changed) reaches.push(bankReachOf(bank));
  }
  return reaches.length === 0 ? 0 : reaches.reduce((sum, reach) => sum + reach, 0) / reaches.length;
}

/**
 * Picks the salvage variant to apply, or null when none passes the gates.
 * Gates: cylinder retention (re-solved retained moles at least the baseline's, within a
 * relative 1e-9), feasible (re-solved surplus covers the salvaged moles), no bank loses
 * more than |SALVAGE_ATTRACTIVENESS_GATE| points, and net value kept is at least
 * SALVAGE_MIN_VALUE. Ranking: value kept, then summed attractiveness change, then LP cost
 * (missing LP cost ranks last). `bankScoresOf(bank)` returns that bank's attractiveness score.
 * Each variant and the baseline carry `retainedMoles`, the re-solved cylinder moles.
 */
export function selectSalvageVariant({ baseline, variants, bankScoresOf, bankReachOf = () => 0, physics }) {
  const baselineValue = netStockValue(baseline.finalBanks, physics);
  const qualifying = [];

  for (const variant of variants) {
    if (variant.retainedMoles < baseline.retainedMoles * (1 - RETENTION_RELATIVE_TOLERANCE)) continue;
    if (variant.resolvedSurplusMoles < variant.salvagedMoles - TOLERANCE) continue;

    const deltas = attractivenessDeltas(baseline.finalBanks, variant.finalBanks, bankScoresOf);
    if (deltas.some(delta => delta < SALVAGE_ATTRACTIVENESS_GATE - TOLERANCE)) continue;

    const valueKept = netStockValue(variant.finalBanks, physics) - baselineValue;
    if (valueKept < SALVAGE_MIN_VALUE - TOLERANCE) continue;

    qualifying.push({
      variant,
      valueKept,
      attractivenessChange: deltas.reduce((sum, delta) => sum + delta, 0),
      reachChange: receiverReach(baseline.finalBanks, variant.finalBanks, bankReachOf)
    });
  }

  qualifying.sort((a, b) => (
    compareDescending(a.valueKept, b.valueKept)
    || compareDescending(a.attractivenessChange, b.attractivenessChange)
    || compareAscending(a.variant.lpCost ?? Infinity, b.variant.lpCost ?? Infinity)
  ));
  if (qualifying.length === 0) return null;

  // Near ties in attractiveness (at equal value kept) go to the variant that leaves more targets reachable.
  const sameValue = qualifying.filter(entry => compareDescending(entry.valueKept, qualifying[0].valueKept) === 0);
  return preferredEntry(sameValue.map(entry => ({
    ...entry,
    change: entry.attractivenessChange,
    reach: entry.reachChange
  }))).variant;
}

/**
 * Sorts receiver candidates `{ receiver, transferredReceiver }` best first by how much the
 * receiving bank's attractiveness changes right after the transfer. Changes within
 * SALVAGE_NEAR_TIE_POINTS of the best are a near tie, decided by the number of standard targets
 * the receiver can still reach after the transfer (`bankReachOf`, default: no preference).
 * Exact ties keep input order.
 */
export function rankReceivers(candidates, bankScoresOf, bankReachOf = () => 0) {
  const remaining = candidates.map(candidate => ({
    candidate,
    change: bankScoresOf(candidate.transferredReceiver) - bankScoresOf(candidate.receiver),
    reach: bankReachOf(candidate.transferredReceiver)
  }));
  const ranked = [];
  while (remaining.length > 0) {
    const next = preferredEntry(remaining);
    ranked.push(next.candidate);
    remaining.splice(remaining.indexOf(next), 1);
  }
  return ranked;
}
