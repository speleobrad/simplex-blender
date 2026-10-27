import { convertToDisplay, unitLabel } from '../units.js';
import { formatMoney } from '../currency-format.js';

const OPERATION_LABELS = Object.freeze({
  boost: 'Boost',
  decant: 'Decant',
  topUp: 'Top-up'
});

const NO_PRICE = 'no price set';
const NOT_CONFIGURED = 'Set prices in Settings → Costs.';
const NO_PLAN = 'Costs appear when a feasible blend is available.';

function hook(root, key) {
  return root?.querySelector?.(`[data-result-key="${key}"]`) ?? null;
}

function cell(text) {
  const element = document.createElement('td');
  element.className = 'px-2 py-1 text-right';
  element.textContent = text;
  return element;
}

function labelCell(...parts) {
  const element = document.createElement('th');
  element.className = 'px-2 py-1 text-left';
  element.setAttribute('scope', 'row');
  element.append(...parts);
  return element;
}

function messageRow(text) {
  const row = document.createElement('tr');
  const element = cell(text);
  element.colSpan = 4;
  row.append(element);
  return row;
}

function litresText(litres, units) {
  return `${convertToDisplay(litres, 'volumeL', units).toFixed(1)} ${unitLabel('volumeL', units)}`;
}

function perVolumeText(pricePerLitre, symbol, units) {
  return `${formatMoney(convertToDisplay(pricePerLitre, 'pricePerVolumeL', units), symbol, 6)} ${unitLabel('pricePerVolumeL', units)}`;
}

function gasRow(line, symbol, units) {
  const row = document.createElement('tr');
  const priced = line.unitPrice !== null && line.unitPrice !== undefined;
  row.append(
    labelCell(line.name),
    cell(litresText(line.litres, units)),
    cell(priced ? perVolumeText(line.unitPrice, symbol, units) : NO_PRICE),
    cell(priced ? formatMoney(line.cost, symbol, 2) : '—')
  );
  return row;
}

// Operation table is count × fee; there is no per-litre column.
function operationRow(line, symbol) {
  const row = document.createElement('tr');
  const label = OPERATION_LABELS[line.operation] ?? line.operation;
  if (line.operation === 'topUp') {
    const note = document.createElement('span');
    note.textContent = 'includes compressor air';
    row.append(labelCell(label, ' ', note));
  } else {
    row.append(labelCell(label));
  }
  row.append(
    cell(String(line.count)),
    cell(formatMoney(line.fee, symbol, 2)),
    cell(formatMoney(line.cost, symbol, 2))
  );
  return row;
}

function totalText(cost, symbol) {
  const text = `Total ${formatMoney(cost.total, symbol, 2)}`;
  if (!cost.incomplete) return text;
  const names = (cost.unpricedSources ?? []).map(source => source.name).join(', ');
  return `${text} (incomplete: ${names} unpriced)`;
}

function setVisible(element, visible) {
  if (element) element.hidden = !visible;
}

/**
 * Render the Costs section of one Tank summary host from a derived cost object.
 * `cost` is null when no feasible plan exists; `cost.configured` is false when no price is set.
 */
export function renderCostSummary(cost, { root, units = 'metric', currencySymbol = '' } = {}) {
  const status = hook(root, 'cost-status');
  const tables = hook(root, 'cost-tables');
  const total = hook(root, 'cost-total');
  const gasBody = hook(root, 'cost-gas-body');
  const operationBody = hook(root, 'cost-operations-body');
  const gasTotal = hook(root, 'cost-gas-total');
  const operationsTotal = hook(root, 'cost-operations-total');
  if (!status || !tables || !total || !gasBody || !operationBody) return;

  if (!cost || cost.configured === false) {
    status.textContent = cost ? NOT_CONFIGURED : NO_PLAN;
    setVisible(status, true);
    setVisible(tables, false);
    setVisible(total, false);
    return;
  }

  const gasHeading = hook(root, 'cost-gas-volume-heading');
  if (gasHeading) gasHeading.textContent = `Volume (${unitLabel('volumeL', units)})`;
  setVisible(status, false);
  setVisible(tables, true);
  setVisible(total, true);

  const gasRows = cost.gasLines.map(line => gasRow(line, currencySymbol, units));
  gasBody.replaceChildren(...(gasRows.length ? gasRows : [messageRow('No gas transferred.')]));

  const operationRows = cost.operationLines.map(line => operationRow(line, currencySymbol));
  operationBody.replaceChildren(...(operationRows.length ? operationRows : [messageRow('No operations.')]));

  if (gasTotal) gasTotal.textContent = formatMoney(cost.gasTotal, currencySymbol, 2);
  if (operationsTotal) operationsTotal.textContent = formatMoney(cost.operationTotal, currencySymbol, 2);
  total.textContent = totalText(cost, currencySymbol);
}

// `gas` limits which pure price can explain a missing value; null accepts any pure gas.
function savingText(value, missing, gas, symbol) {
  if (value !== null && value !== undefined) return formatMoney(value, symbol, 2);
  const priceMissing = missing.find(entry => entry.code === 'pure-price' && (!gas || entry.gas === gas));
  if (priceMissing) return `Price pure ${priceMissing.gas} in Inventory`;
  const unavailable = missing.find(entry => entry.code === 'recipe-unavailable');
  if (unavailable) return `Unavailable for ${unavailable.name}`;
  return '—';
}

/**
 * Render the Total cost of fill, Saved cost and Salvaged saving items of the Blending summary banner.
 * `cost` is the derived fill cost (null without a feasible blend); `savings` is the `computeSavings` result.
 */
export function renderCostBanner(cost, savings, { root, currencySymbol = '' } = {}) {
  const fillTotal = hook(root, 'cost-fill-total');
  const saved = hook(root, 'cost-saved');
  const salvaged = hook(root, 'cost-salvaged');
  if (!fillTotal || !saved || !salvaged) return;

  const missing = savings?.missing ?? [];
  fillTotal.textContent = cost && cost.configured !== false
    ? `${formatMoney(cost.total, currencySymbol, 2)}${cost.incomplete ? ' (incomplete)' : ''}`
    : '—';
  saved.textContent = savings ? savingText(savings.savedCost, missing, 'helium', currencySymbol) : '—';
  salvaged.textContent = savings ? savingText(savings.salvagedSaving, missing, null, currencySymbol) : '—';
}
