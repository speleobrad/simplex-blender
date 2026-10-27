import { computeFillCost } from './cost.js';
import { priceBankByRecipe } from './bank-pricing.js';
import { isPureBank, pureGasPrices } from './pure-prices.js';

const UNPRICED_BANKS = 'unpriced banks';

/**
 * Saved cost and salvaged saving for the blending summary. Display-only: never alters a plan.
 *
 * - savedCost: retained helium litres of the original tank × weighted pure helium price.
 * - salvagedSaving: for each used non-pure bank, litres used × its discount-0 recipe price
 *   minus the gas it charged. Unpriced used banks are skipped and reported in `missing`.
 *   A bank whose recipe cannot be priced makes it `null`, with the reason in `missing`.
 *
 * `missing` lists the gases or reasons that prevented a number; each entry appears once.
 *
 * @returns {{savedCost: number|null, salvagedSaving: number|null, missing: string[]}}
 */
export function computeSavings({ result, banks = [], costs, settings, physics, inventoryTemperatureC }) {
  const missing = [];
  const pure = pureGasPrices({ banks, physics, inventoryTemperatureC });
  let savedCost = null;
  if (pure.helium === null) {
    missing.push('helium');
  } else {
    savedCost = (result?.blend?.heliumRetainedLitres ?? 0) * pure.helium;
  }

  const cost = computeFillCost({ steps: result?.protocolSteps ?? [], banks, costs, temperatureC: physics.temperatureC });
  let salvagedSaving = 0;
  let unpriced = false;
  for (const line of cost.gasLines) {
    const bank = banks.find(candidate => candidate.id === line.sourceBankId);
    if (bank && isPureBank(bank)) continue;
    if (line.unitPrice === null) {
      unpriced = true;
      continue;
    }
    const recipe = priceBankByRecipe({ bank, costs, settings, physics, inventoryBanks: banks, inventoryTemperatureC });
    if (!recipe.ok) {
      missing.push(recipe.reason);
      salvagedSaving = null;
      continue;
    }
    if (salvagedSaving !== null) {
      salvagedSaving += line.litres * (recipe.recipeCost / recipe.litres) - line.cost;
    }
  }
  if (unpriced) missing.push(UNPRICED_BANKS);

  return { savedCost, salvagedSaving, missing: [...new Set(missing)] };
}
