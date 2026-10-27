import { GAS_CONSTANT, calcMolarDensity } from './physics.js';

export const STANDARD_TARGETS = Object.freeze([
  Object.freeze({ oxygenPercent: 21, heliumPercent: 35 }),
  Object.freeze({ oxygenPercent: 18, heliumPercent: 45 }),
  Object.freeze({ oxygenPercent: 15, heliumPercent: 55 }),
  Object.freeze({ oxygenPercent: 12, heliumPercent: 65 }),
  Object.freeze({ oxygenPercent: 10, heliumPercent: 70 })
]);

export const SCORE_REFERENCE_HELIUM_LITRES = 1000;

const LINE_SLOPE = 3.077;
const LINE_DECAY = 15;
const LINE_NORM = Math.sqrt(LINE_SLOPE * LINE_SLOPE + 1);
const WEIGHT_LINE = 0.4;
const WEIGHT_VERSATILITY = 0.4;
const WEIGHT_ENERGY = 0.2;
const RATIO_TOLERANCE_BAR = 1e-9;

function isFiniteNonNegative(value) {
  return Number.isFinite(value) && value >= 0;
}

function hasValidFractions(oxygenPercent, heliumPercent) {
  return isFiniteNonNegative(oxygenPercent)
    && isFiniteNonNegative(heliumPercent)
    && oxygenPercent + heliumPercent <= 100;
}

// Largest f_x / t_x over the components; a component absent from the target
// but present in the gas makes the target unreachable by adding gas.
function maxTopUpRatio(gas, target) {
  let maxRatio = 0;
  for (const key of ['oxygen', 'helium', 'nitrogen']) {
    const fraction = gas[key];
    const targetFraction = target[key];
    if (fraction <= 0) continue;
    if (targetFraction <= 0) return Infinity;
    maxRatio = Math.max(maxRatio, fraction / targetFraction);
  }
  return maxRatio;
}

function componentFractions(oxygenPercent, heliumPercent) {
  const oxygen = oxygenPercent / 100;
  const helium = heliumPercent / 100;
  return { oxygen, helium, nitrogen: Math.max(0, 1 - oxygen - helium) };
}

function reachableTargetCount(gas, pressureBar, maxPressureBar) {
  let count = 0;
  for (const target of STANDARD_TARGETS) {
    const targetGas = componentFractions(target.oxygenPercent, target.heliumPercent);
    const ratio = maxTopUpRatio(gas, targetGas);
    if (pressureBar * ratio <= maxPressureBar + RATIO_TOLERANCE_BAR) count += 1;
  }
  return count;
}

function lineScore(oxygenPercent, heliumPercent) {
  const residual = Math.abs(LINE_SLOPE * (oxygenPercent / 100) + heliumPercent / 100 - 1);
  const perpendicularDistance = residual / LINE_NORM;
  return Math.exp(-LINE_DECAY * perpendicularDistance);
}

function freeGasLitres(pressureBar, volumeL, oxygenPercent, heliumPercent, temperatureC, model) {
  const useVdw = model === 'vdw';
  const moles = calcMolarDensity(pressureBar, oxygenPercent, heliumPercent, temperatureC, useVdw) * volumeL;
  return moles * GAS_CONSTANT * (temperatureC + 273.15);
}

/**
 * Leftover attractiveness of a bank's gas for future blending, on a 0-100 scale.
 * Invalid inputs score 0.
 */
export function leftoverAttractiveness({
  oxygenPercent,
  heliumPercent,
  pressureBar,
  volumeL,
  maxPressureBar,
  temperatureC = 20,
  physics = { model: 'ideal', temperatureC }
}) {
  if (!hasValidFractions(oxygenPercent, heliumPercent)) return 0;
  if (!isFiniteNonNegative(pressureBar) || !isFiniteNonNegative(volumeL)
    || !isFiniteNonNegative(maxPressureBar)) {
    return 0;
  }

  const model = physics?.model ?? 'ideal';
  const temperature = physics?.temperatureC ?? temperatureC;
  const gas = componentFractions(oxygenPercent, heliumPercent);

  const sLine = lineScore(oxygenPercent, heliumPercent);
  const sVersatility = reachableTargetCount(gas, pressureBar, maxPressureBar) / STANDARD_TARGETS.length;
  const heliumLitres = freeGasLitres(pressureBar, volumeL, oxygenPercent, heliumPercent, temperature, model)
    * gas.helium;
  const sEnergy = Math.min(1, heliumLitres / SCORE_REFERENCE_HELIUM_LITRES);

  return 100 * (WEIGHT_LINE * sLine + WEIGHT_VERSATILITY * sVersatility + WEIGHT_ENERGY * sEnergy);
}
