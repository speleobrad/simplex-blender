import { GAS_CONSTANT, calcMolarDensity, calcPressure } from './physics.js';

export const SALVAGE_HE_PRICE_PER_LITRE = 0.075;
export const SALVAGE_O2_PRICE_PER_LITRE = 0.007;
export const SALVAGE_MIN_VALUE = 1.0;
export const SALVAGE_ATTRACTIVENESS_GATE = -2;

const TOLERANCE = 1e-9;
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

/**
 * Picks the salvage variant to apply, or null when none passes the gates.
 * Gates: feasible (re-solved surplus covers the salvaged moles), no bank loses
 * more than |SALVAGE_ATTRACTIVENESS_GATE| points, and net value kept is at least
 * SALVAGE_MIN_VALUE. Ranking: value kept, then summed attractiveness change, then LP cost
 * (missing LP cost ranks last). `bankScoresOf(bank)` returns that bank's attractiveness score.
 */
export function selectSalvageVariant({ baseline, variants, bankScoresOf, physics }) {
  const baselineValue = netStockValue(baseline.finalBanks, physics);
  const qualifying = [];

  for (const variant of variants) {
    if (variant.resolvedSurplusMoles < variant.salvagedMoles - TOLERANCE) continue;

    const deltas = attractivenessDeltas(baseline.finalBanks, variant.finalBanks, bankScoresOf);
    if (deltas.some(delta => delta < SALVAGE_ATTRACTIVENESS_GATE - TOLERANCE)) continue;

    const valueKept = netStockValue(variant.finalBanks, physics) - baselineValue;
    if (valueKept < SALVAGE_MIN_VALUE - TOLERANCE) continue;

    qualifying.push({
      variant,
      valueKept,
      attractivenessChange: deltas.reduce((sum, delta) => sum + delta, 0)
    });
  }

  qualifying.sort((a, b) => (
    compareDescending(a.valueKept, b.valueKept)
    || compareDescending(a.attractivenessChange, b.attractivenessChange)
    || compareAscending(a.variant.lpCost ?? Infinity, b.variant.lpCost ?? Infinity)
  ));

  return qualifying[0]?.variant ?? null;
}

/**
 * Sorts receiver candidates `{ receiver, transferredReceiver }` by how much the
 * receiving bank's attractiveness changes right after the transfer, best first.
 * Deltas within TOLERANCE are ties; ties keep input order.
 */
export function rankReceivers(candidates, bankScoresOf) {
  return candidates
    .map(candidate => ({
      candidate,
      delta: bankScoresOf(candidate.transferredReceiver) - bankScoresOf(candidate.receiver)
    }))
    .sort((a, b) => compareDescending(a.delta, b.delta))
    .map(entry => entry.candidate);
}
