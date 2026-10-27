import { computeFillCost } from './cost.js';
import { priceBankByRecipe } from './bank-pricing.js';
import { isPureBank, pureGasPrices } from './pure-prices.js';

const RETAINED_TOLERANCE_L = 1e-9;

/**
 * Reuse value and salvaged saving for the blending summary. Display-only: never alters a plan.
 *
 * - savedCost: retained helium litres of the original tank × weighted pure helium price.
 *   No retained helium gives 0 without needing a price.
 * - salvagedSaving: the avoided purchase. For each used non-pure bank, litres used × the price per
 *   litre of building that bank's composition from pure gases (`priceBankByRecipe` at leftover
 *   discount 0, the bank's own volume and pressure as target: gas + flat operation fees). Nothing
 *   of the bank's own stored price or of what its gas line charged is subtracted, so an unpriced
 *   leftover bank counts in full.
 *
 * `missing` lists what prevented a number. Each entry appears once, as one of:
 * - {code: 'pure-price', gas: 'oxygen'|'helium'}: a needed pure-gas price is unavailable.
 *   Without bankId it is the Reuse value gap; with bankId it is a salvage gap for that bank.
 *   Reuse value is null when it is helium; salvagedSaving is null for a salvage gap.
 * - {code: 'recipe-unavailable', bankId, name}: a used bank cannot be priced by recipe for a
 *   reason other than a missing pure price (equipment limits, more than 6 virtual sources,
 *   pressure below 10 bar), or is no longer in the inventory. salvagedSaving is null.
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

  const discountFree = { ...costs, leftoverDiscountPercent: 0 };
  const cost = computeFillCost({ steps: result.protocolSteps ?? [], banks, costs, temperatureC: physics.temperatureC });
  let salvagedSaving = 0;
  for (const line of cost.gasLines) {
    const bank = banks.find(candidate => candidate.id === line.sourceBankId);
    if (bank && isPureBank(bank)) continue;
    const recipe = bank
      ? priceBankByRecipe({ bank, costs: discountFree, settings, physics, inventoryBanks: banks, inventoryTemperatureC })
      : { ok: false, missingGas: null };
    if (!recipe.ok) {
      salvagedSaving = null;
      addMissing(recipe.missingGas
        ? { code: 'pure-price', gas: recipe.missingGas, bankId: line.sourceBankId, name: line.name }
        : { code: 'recipe-unavailable', bankId: line.sourceBankId, name: line.name });
      continue;
    }
    if (salvagedSaving !== null) {
      salvagedSaving += line.litres * (recipe.recipeCost / recipe.litres);
    }
  }

  return { savedCost, salvagedSaving, missing };
}
