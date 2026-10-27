import { computeFillCost } from './cost.js';
import { priceBankByRecipe } from './bank-pricing.js';
import { isPureBank, pureGasPrices } from './pure-prices.js';

const RETAINED_TOLERANCE_L = 1e-9;

/**
 * Saved cost and salvaged saving for the blending summary. Display-only: never alters a plan.
 *
 * - savedCost: retained helium litres of the original tank × weighted pure helium price.
 *   No retained helium gives 0 without needing a price.
 * - salvagedSaving: for each used non-pure bank, litres used × its discount-0 recipe price
 *   minus the gas it charged.
 *
 * `missing` lists what prevented a number. Each entry appears once, as one of:
 * - {code: 'pure-price', gas: 'oxygen'|'helium'}: a needed pure-gas price is unavailable.
 *   The gas is missing, so salvagedSaving is null. savedCost is null when it is helium.
 * - {code: 'unpriced-bank', bankId, name}: a used non-pure bank has no price. It is left out
 *   of salvagedSaving, which stays numeric.
 * - {code: 'recipe-unavailable', bankId, name}: a used bank cannot be priced by recipe for a
 *   reason other than a missing pure price (equipment limits, more than 6 virtual sources,
 *   pressure below 10 bar). salvagedSaving is null.
 *
 * Without a feasible result, savedCost and salvagedSaving are null and `missing` is empty.
 *
 * @returns {{savedCost: number|null, salvagedSaving: number|null, missing: Array<Object>}}
 */
export function computeSavings({ result, banks = [], costs, settings, physics, inventoryTemperatureC }) {
  if (!result?.blend || result.feasible === false) {
    return { savedCost: null, salvagedSaving: null, missing: [] };
  }

  const missing = [];
  const seen = new Set();
  const addMissing = entry => {
    const key = JSON.stringify(entry);
    if (seen.has(key)) return;
    seen.add(key);
    missing.push(entry);
  };

  const pure = pureGasPrices({ banks, physics, inventoryTemperatureC });
  const retainedHelium = result.blend.heliumRetainedLitres ?? 0;
  let savedCost = 0;
  if (retainedHelium > RETAINED_TOLERANCE_L) {
    if (pure.helium === null) {
      addMissing({ code: 'pure-price', gas: 'helium' });
      savedCost = null;
    } else {
      savedCost = retainedHelium * pure.helium;
    }
  }

  const cost = computeFillCost({ steps: result.protocolSteps ?? [], banks, costs, temperatureC: physics.temperatureC });
  let salvagedSaving = 0;
  for (const line of cost.gasLines) {
    const bank = banks.find(candidate => candidate.id === line.sourceBankId);
    if (bank && isPureBank(bank)) continue;
    if (line.unitPrice === null) {
      addMissing({ code: 'unpriced-bank', bankId: line.sourceBankId, name: line.name });
      continue;
    }
    const recipe = priceBankByRecipe({ bank, costs, settings, physics, inventoryBanks: banks, inventoryTemperatureC });
    if (!recipe.ok) {
      salvagedSaving = null;
      addMissing(recipe.missingGas
        ? { code: 'pure-price', gas: recipe.missingGas }
        : { code: 'recipe-unavailable', bankId: line.sourceBankId, name: line.name });
      continue;
    }
    if (salvagedSaving !== null) {
      salvagedSaving += line.litres * (recipe.recipeCost / recipe.litres) - line.cost;
    }
  }

  return { savedCost, salvagedSaving, missing };
}
