import { convertToDisplay, unitLabel } from '../units.js';
import { formatMoney } from '../currency-format.js';

const OPERATION_LABELS = Object.freeze({
  boost: 'Boost',
  decant: 'Decant',
  topUp: 'Top-up'
});

export const NOT_CONFIGURED = 'No prices apply to this fill. Set bank prices in Inventory and fees in Settings → Costs.';
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

function numberText(value, digits) {
  const text = value.toFixed(digits);
  return /^-0(\.0*)?$/.test(text) ? text.slice(1) : text;
}

function unitWord(quantity, units) {
  return unitLabel(quantity, units).replace(/^\//, '');
}

function litresText(litres, units) {
  return numberText(convertToDisplay(litres, 'volumeL', units), 1);
}

function perVolumeText(pricePerLitre, units) {
  return numberText(convertToDisplay(pricePerLitre, 'pricePerVolumeL', units), 6);
}

// Headers carry the currency and unit so that table cells hold numbers only.
// Spaces inside a unit line are non-breaking so "cu ft" and "per L" never split.
const NBSP = '\u00A0';

function keepTogether(text) {
  return text.replace(/ /g, NBSP);
}

function currencyHeading(label, symbol) {
  return symbol ? `${label} (${symbol})` : label;
}

// The Price header is two deliberate lines: "Price", then the unit "(EUR/L)" kept whole.
function priceHeading(symbol, units) {
  const unit = unitWord('pricePerVolumeL', units);
  return { label: 'Price', detail: symbol ? `(${symbol}/${unit})` : `(per ${unit})` };
}

function setHeading(root, key, text) {
  const element = hook(root, key);
  if (element) element.textContent = text;
}

function setPriceHeading(root, key, { label, detail }) {
  const element = hook(root, key);
  if (!element) return;
  const top = document.createElement('span');
  top.className = 'block';
  top.textContent = label;
  const bottom = document.createElement('span');
  bottom.className = 'block whitespace-nowrap';
  bottom.textContent = keepTogether(detail);
  element.replaceChildren(top, ' ', bottom);
}

function gasRow(line, units) {
  const row = document.createElement('tr');
  const priced = line.unitPrice !== null && line.unitPrice !== undefined;
  row.append(
    labelCell(line.name),
    cell(litresText(line.litres, units)),
    cell(priced ? perVolumeText(line.unitPrice, units) : '—'),
    cell(priced ? numberText(line.cost, 2) : '—')
  );
  return row;
}

// Operation table is count × fee; there is no per-litre column.
function operationRow(line) {
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
    cell(numberText(line.fee, 2)),
    cell(numberText(line.cost, 2))
  );
  return row;
}

function totalText(cost) {
  const text = numberText(cost.total, 2);
  if (!cost.incomplete) return text;
  const names = (cost.unpricedSources ?? []).map(source => source.name).join(', ');
  return `${text} (incomplete: ${names} unpriced)`;
}

function setVisible(element, visible) {
  if (element) element.hidden = !visible;
}

/**
 * Render the Costs section of one Tanks and costs host from a derived cost object.
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

  setHeading(root, 'cost-gas-volume-heading', `Volume (${unitLabel('volumeL', units)})`);
  setPriceHeading(root, 'cost-gas-price-heading', priceHeading(currencySymbol, units));
  setHeading(root, 'cost-gas-cost-heading', currencyHeading('Cost', currencySymbol));
  setHeading(root, 'cost-operation-fee-heading', currencyHeading('Fee', currencySymbol));
  setHeading(root, 'cost-operation-cost-heading', currencyHeading('Cost', currencySymbol));
  setVisible(status, false);
  setVisible(tables, true);
  setVisible(total, true);

  const gasRows = cost.gasLines.map(line => gasRow(line, units));
  gasBody.replaceChildren(...(gasRows.length ? gasRows : [messageRow('No gas transferred.')]));

  const operationRows = cost.operationLines.map(line => operationRow(line));
  operationBody.replaceChildren(...(operationRows.length ? operationRows : [messageRow('No operations.')]));

  if (gasTotal) gasTotal.textContent = numberText(cost.gasTotal, 2);
  if (operationsTotal) operationsTotal.textContent = numberText(cost.operationTotal, 2);
  total.textContent = totalText(cost);
}

// Reuse value can only be missing for helium, and only the untagged pure-price gap explains it.
function savedText(value, missing, symbol) {
  if (value !== null && value !== undefined) return formatMoney(value, symbol, 2);
  const gap = missing.find(entry => entry.code === 'pure-price' && entry.gas === 'helium' && entry.bankId === undefined);
  return gap ? 'Price pure helium in Inventory' : '—';
}

// Salvaged saving is explained only by gaps raised for a used bank.
function salvagedText(value, missing, symbol) {
  if (value !== null && value !== undefined) return formatMoney(value, symbol, 2);
  const gap = missing.find(entry => entry.code === 'pure-price' && entry.bankId !== undefined);
  if (gap) return `Price pure ${gap.gas} in Inventory`;
  const unavailable = missing.find(entry => entry.code === 'recipe-unavailable');
  if (unavailable) return `Unavailable for ${unavailable.name}`;
  return '—';
}

/**
 * Render the Total cost of fill, Reuse value and Salvaged saving items of the Blending summary banner.
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
  saved.textContent = savings ? savedText(savings.savedCost, missing, currencySymbol) : '—';
  salvaged.textContent = savings ? salvagedText(savings.salvagedSaving, missing, currencySymbol) : '—';
}
