import { GAS_CONSTANT } from './physics.js';

// Fee class of each operation: `equalize` is charged as a decant.
const FEE_KEY_BY_OPERATION = Object.freeze({ boost: 'boost', decant: 'decant', equalize: 'decant', topUp: 'topUp' });
const OPERATION_LINE_ORDER = Object.freeze(['boost', 'decant', 'topUp']);

export function litresPerMole(temperatureC) {
  return GAS_CONSTANT * (temperatureC + 273.15);
}

const hasPrice = value => Number.isFinite(value) && value >= 0;

// Bank prices are display-only cost inputs; they never change a plan, so recipe
// signatures (interim readings, What-if) must ignore them.
export function withoutBankPrices(banks) {
  if (!Array.isArray(banks)) return banks;
  return banks.map(bank => {
    if (!bank || typeof bank !== 'object' || !('pricePerLitre' in bank)) return bank;
    const { pricePerLitre: _price, ...rest } = bank;
    return rest;
  });
}

function feeOf(costs, key) {
  const fee = costs?.operationPrices?.[key];
  return Number.isFinite(fee) ? fee : 0;
}

/**
 * Flat fee model: each distinct `costOperationId` is one operation, charged once at
 * the fee of its class (boost, decant incl. equalize, topUp). Gas is charged per litre
 * of each bank's stored price; compressor air (topUp) has no gas line.
 */
export function computeFillCost({ steps = [], banks = [], costs, temperatureC }) {
  const perMole = litresPerMole(temperatureC);
  const bankById = new Map(banks.map(bank => [bank.id, bank]));
  const gas = new Map();
  const operationIds = { boost: new Set(), decant: new Set(), topUp: new Set() };

  for (const step of steps) {
    const operation = step?.costOperation;
    if (!operation) continue;
    if (operation === 'topUp') {
      operationIds.topUp.add(step.costOperationId);
      continue;
    }
    const feeKey = FEE_KEY_BY_OPERATION[operation];
    if (feeKey) operationIds[feeKey].add(step.costOperationId);
    const litres = (Number.isFinite(step.sourceConsumedMoles) ? step.sourceConsumedMoles : 0) * perMole;
    const bank = bankById.get(step.sourceBankId);
    const line = gas.get(step.sourceBankId) ?? {
      sourceBankId: step.sourceBankId,
      name: bank?.name ?? step.sourceBankName ?? step.recipeGas ?? step.sourceBankId,
      litres: 0,
      unitPrice: hasPrice(bank?.pricePerLitre) ? bank.pricePerLitre : null,
      cost: 0
    };
    line.litres += litres;
    gas.set(step.sourceBankId, line);
  }

  const gasLines = [...gas.values()].map(line => ({
    ...line,
    cost: line.unitPrice === null ? 0 : line.litres * line.unitPrice
  }));
  const unpricedSources = gasLines.filter(line => line.unitPrice === null)
    .map(({ sourceBankId, name }) => ({ sourceBankId, name }));

  const operationLines = OPERATION_LINE_ORDER
    .filter(operation => operationIds[operation].size > 0)
    .map(operation => {
      const count = operationIds[operation].size;
      const fee = feeOf(costs, operation);
      return { operation, count, fee, cost: count * fee };
    });

  const gasTotal = gasLines.reduce((sum, line) => sum + line.cost, 0);
  const operationTotal = operationLines.reduce((sum, line) => sum + line.cost, 0);
  return {
    gasLines,
    operationLines,
    gasTotal,
    operationTotal,
    total: gasTotal + operationTotal,
    unpricedSources,
    incomplete: unpricedSources.length > 0,
    configured: OPERATION_LINE_ORDER.some(key => feeOf(costs, key) > 0) || gasLines.some(line => line.unitPrice !== null)
  };
}
