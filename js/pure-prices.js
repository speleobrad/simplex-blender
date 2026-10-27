import { calcMolarDensity } from './physics.js';
import { litresPerMole } from './cost.js';

const hasPrice = value => Number.isFinite(value) && value >= 0;

export function isPureOxygenBank(bank) {
  return Boolean(bank?.enabled) && bank.oxygenPercent === 100 && bank.heliumPercent === 0;
}

export function isPureHeliumBank(bank) {
  return Boolean(bank?.enabled) && bank.oxygenPercent === 0 && bank.heliumPercent === 100;
}

export function isPureBank(bank) {
  return isPureOxygenBank(bank) || isPureHeliumBank(bank);
}

// Free-gas litres a bank holds now: moles at its pressure and volume under the active
// physics model, times litres per mole at the inventory gas temperature.
function freeGasLitres(bank, physics, inventoryTemperatureC) {
  const moles = calcMolarDensity(
    bank.pressureBar,
    bank.oxygenPercent,
    bank.heliumPercent,
    inventoryTemperatureC,
    physics?.model === 'vdw'
  ) * bank.volumeL;
  return moles * litresPerMole(inventoryTemperatureC);
}

function weightedPrice(banks, isPure, { physics, inventoryTemperatureC }) {
  let weightSum = 0;
  let costSum = 0;
  for (const bank of banks) {
    if (!isPure(bank) || !hasPrice(bank.pricePerLitre)) continue;
    const weight = freeGasLitres(bank, physics, inventoryTemperatureC);
    if (!(weight > 0)) continue;
    weightSum += weight;
    costSum += weight * bank.pricePerLitre;
  }
  return weightSum > 0 ? costSum / weightSum : null;
}

/**
 * Volume-weighted (free-gas-litre) average per-litre price of the enabled, priced pure
 * banks of each gas. `null` when no such bank has free gas to weigh.
 */
export function pureGasPrices({ banks = [], physics, inventoryTemperatureC }) {
  const options = { physics, inventoryTemperatureC };
  return {
    oxygen: weightedPrice(banks, isPureOxygenBank, options),
    helium: weightedPrice(banks, isPureHeliumBank, options)
  };
}
