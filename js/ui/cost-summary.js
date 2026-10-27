import { convertToDisplay, unitLabel } from '../units.js';
import { formatMoney } from '../currency-format.js';

const OPERATION_LABELS = Object.freeze({
  boost: 'Boost',
  decant: 'Decant',
  equalize: 'Equalize',
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
  return `${formatMoney(convertToDisplay(pricePerLitre, 'pricePerVolumeL', units), symbol, 4)} ${unitLabel('pricePerVolumeL', units)}`;
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

function operationRow(line, symbol, units) {
  const row = document.createElement('tr');
  if (line.operation === 'topUp') {
    const label = document.createElement('span');
    label.textContent = 'includes compressor air';
    const litres = `${litresText(line.litres, units)} (information only)`;
    row.append(
      labelCell(OPERATION_LABELS.topUp, ' ', label),
      cell(litres),
      cell(`${line.count} × ${formatMoney(line.rate, symbol, 2)}`),
      cell(formatMoney(line.cost, symbol, 2))
    );
    return row;
  }
  row.append(
    labelCell(OPERATION_LABELS[line.operation] ?? line.operation),
    cell(litresText(line.litres, units)),
    cell(perVolumeText(line.rate, symbol, units)),
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
  if (!status || !tables || !total || !gasBody || !operationBody) return;

  if (!cost || cost.configured === false) {
    status.textContent = cost ? NOT_CONFIGURED : NO_PLAN;
    setVisible(status, true);
    setVisible(tables, false);
    setVisible(total, false);
    return;
  }

  const volumeHeading = `Volume (${unitLabel('volumeL', units)})`;
  for (const key of ['cost-gas-volume-heading', 'cost-operations-volume-heading']) {
    const heading = hook(root, key);
    if (heading) heading.textContent = volumeHeading;
  }
  setVisible(status, false);
  setVisible(tables, true);
  setVisible(total, true);

  const gasRows = cost.gasLines.map(line => gasRow(line, currencySymbol, units));
  gasBody.replaceChildren(...(gasRows.length ? gasRows : [messageRow('No gas transferred.')]));

  const operationRows = cost.operationLines.map(line => operationRow(line, currencySymbol, units));
  operationBody.replaceChildren(...(operationRows.length ? operationRows : [messageRow('No operations.')]));

  total.textContent = totalText(cost, currencySymbol);
}
