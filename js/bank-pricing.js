import { optimizeBlend } from './optimizer.js';
import { computeFillCost, litresPerMole } from './cost.js';
import { calcMolarDensity } from './physics.js';

export const VIRTUAL_BANK_VOLUME_L = 200;
export const VIRTUAL_BANK_PRESSURE_BAR = 200;
export const MAX_VIRTUAL_BANKS_PER_GAS = 6;
const DEFAULT_MINIMUM_SOURCE_PRESSURE_BAR = 20;
const SAFETY_MARGIN = 2;
const MIN_TARGET_PRESSURE_BAR = 10;

export function virtualBankCount({ needMoles, perBankMoles }) {
  if (!(needMoles > 1e-12)) return 0;
  return Math.ceil(SAFETY_MARGIN * needMoles / perBankMoles);
}

const anyPrice = costs => Object.values(costs.operationPrices).some(value => value > 0); // redesign: replaced in Task 2

function virtualBanks(gasId, composition, count, price) {
  return Array.from({ length: count }, (_, index) => ({
    id: `virtual-${gasId}-${index + 1}`,
    name: `Virtual ${gasId} ${index + 1}`,
    volumeL: VIRTUAL_BANK_VOLUME_L,
    pressureBar: VIRTUAL_BANK_PRESSURE_BAR,
    enabled: true,
    pricePerLitre: price,
    ...composition
  }));
}

/**
 * Prices a real bank by planning, with the optimizer, an empty virtual cylinder
 * that reaches the bank's pressure and composition from pure O2/He virtual banks
 * and Compressor Air. Side-effect free: no real bank or setting is modified.
 *
 * `operationCount` maps each operation (boost, decant, equalize, topUp) present in
 * the recipe to its count from `computeFillCost`: distinct top-up IDs for topUp,
 * and 1 for a per-litre operation that is present (presence only).
 *
 * @returns {{ok: true, pricePerLitre: number, recipeCost: number, litres: number,
 *   exhaustedSources: number, sourceCount: number, operationCount: Object}
 *   | {ok: false, reason: string}}
 */
export function priceBankByRecipe({ bank, costs, settings, physics }) {
  if (!anyPrice(costs)) return { ok: false, reason: 'No prices are configured in Settings → Costs.' };
  if (bank.pressureBar < MIN_TARGET_PRESSURE_BAR) {
    return { ok: false, reason: `Banks below ${MIN_TARGET_PRESSURE_BAR} bar cannot be priced by recipe. Enter a price manually.` };
  }
  const useVdw = physics.model === 'vdw';
  const temperatureC = physics.temperatureC;
  const totalMoles = calcMolarDensity(bank.pressureBar, bank.oxygenPercent, bank.heliumPercent, temperatureC, useVdw) * bank.volumeL;
  const minimumPressureBar = Number.isFinite(settings?.booster?.minimumSourcePressureBar)
    ? settings.booster.minimumSourcePressureBar
    : DEFAULT_MINIMUM_SOURCE_PRESSURE_BAR;

  const sources = [];
  for (const [gasId, composition, fraction, price] of [
    ['oxygen', { oxygenPercent: 100, heliumPercent: 0 }, bank.oxygenPercent / 100, 0], // redesign: replaced in Task 2
    ['helium', { oxygenPercent: 0, heliumPercent: 100 }, bank.heliumPercent / 100, 0] // redesign: replaced in Task 2
  ]) {
    const perBankMoles = (
      calcMolarDensity(VIRTUAL_BANK_PRESSURE_BAR, composition.oxygenPercent, composition.heliumPercent, temperatureC, useVdw)
      - calcMolarDensity(minimumPressureBar, composition.oxygenPercent, composition.heliumPercent, temperatureC, useVdw)
    ) * VIRTUAL_BANK_VOLUME_L;
    const count = virtualBankCount({ needMoles: totalMoles * fraction, perBankMoles });
    if (count > MAX_VIRTUAL_BANKS_PER_GAS) {
      return { ok: false, reason: `This bank needs more than ${MAX_VIRTUAL_BANKS_PER_GAS} virtual ${gasId} sources and cannot be priced by recipe. Enter a price manually.` };
    }
    sources.push(...virtualBanks(gasId, composition, count, price));
  }

  const result = optimizeBlend({
    cylinder: {
      volumeL: bank.volumeL,
      initialPressureBar: 0,
      initialOxygenPercent: 21,
      initialHeliumPercent: 0,
      targetPressureBar: bank.pressureBar,
      targetOxygenPercent: bank.oxygenPercent,
      targetHeliumPercent: bank.heliumPercent,
      workingPressureBar: bank.pressureBar
    },
    physics: { model: physics.model, temperatureC },
    banks: sources,
    settings
  });
  if (result.feasible !== true || !Array.isArray(result.protocolSteps)) {
    return { ok: false, reason: result.error ?? 'The optimizer cannot build this mix from pure gases.' };
  }

  const cost = computeFillCost({ steps: result.protocolSteps, banks: sources, costs, temperatureC });
  const litres = totalMoles * litresPerMole(temperatureC);
  const exhaustedSources = new Set(result.protocolSteps.filter(step => step.sourceExhausted).map(step => step.sourceBankId)).size;
  return {
    ok: true,
    pricePerLitre: cost.total * (1 - costs.leftoverDiscountPercent / 100) / litres,
    recipeCost: cost.total,
    litres,
    exhaustedSources,
    sourceCount: sources.length,
    operationCount: Object.fromEntries(cost.operationLines.map(line => [line.operation, line.count ?? 1]))
  };
}
