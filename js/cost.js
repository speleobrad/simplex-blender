import { GAS_CONSTANT } from './physics.js';

const PER_LITRE_RATE = { boost: 'boostPerLitre', decant: 'decantPerLitre', equalize: 'equalizePerLitre' };
const OPERATION_ORDER = ['boost', 'decant', 'equalize', 'topUp'];

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

function anySettingsPrice(costs) {
  return [
    costs?.pricePerLitre?.oxygen, costs?.pricePerLitre?.helium,
    ...Object.values(costs?.operationPrices ?? {})
  ].some(value => Number.isFinite(value) && value > 0);
}

export function computeFillCost({ steps = [], banks = [], costs, temperatureC }) {
  const perMole = litresPerMole(temperatureC);
  const bankById = new Map(banks.map(bank => [bank.id, bank]));
  const gas = new Map();
  const operationLitres = { boost: 0, decant: 0, equalize: 0, topUp: 0 };
  const topUpIds = new Set();

  for (const step of steps) {
    const operation = step?.costOperation;
    if (!operation) continue;
    const litres = (Number.isFinite(step.sourceConsumedMoles) ? step.sourceConsumedMoles : 0) * perMole;
    operationLitres[operation] += litres;
    if (operation === 'topUp') {
      topUpIds.add(step.costOperationId);
      continue;
    }
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

  const prices = costs?.operationPrices ?? {};
  const operationLines = OPERATION_ORDER
    .filter(operation => operation === 'topUp' ? topUpIds.size > 0 : operationLitres[operation] > 0)
    .map(operation => {
      if (operation === 'topUp') {
        const rate = prices.topUpPerOperation ?? 0;
        return { operation, litres: operationLitres.topUp, count: topUpIds.size, rate, cost: topUpIds.size * rate };
      }
      const rate = prices[PER_LITRE_RATE[operation]] ?? 0;
      return { operation, litres: operationLitres[operation], count: null, rate, cost: operationLitres[operation] * rate };
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
    configured: anySettingsPrice(costs) || gasLines.some(line => line.unitPrice !== null)
  };
}
