import test from 'node:test';
import assert from 'node:assert/strict';
import { renderCostBanner, renderCostSummary } from '../js/ui/cost-summary.js';

class FakeNode {
  constructor(tagName) {
    this.tagName = tagName;
    this.children = [];
    this.attributes = {};
    this.hidden = false;
    this.className = '';
    this.colSpan = 1;
    this.text = '';
  }

  setAttribute(name, value) { this.attributes[name] = String(value); }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; }

  get textContent() {
    if (this.children.length === 0) return this.text;
    return this.children.map(child => typeof child === 'string' ? child : child.textContent).join('');
  }

  set textContent(value) {
    this.children = [];
    this.text = String(value);
  }

  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }

  querySelectorAll(selector) {
    const match = selector.match(/^\[([^=\]]+)="([^"]*)"\]$/);
    const found = [];
    const visit = node => {
      for (const child of node.children) {
        if (typeof child !== 'object') continue;
        if (match && child.attributes[match[1]] === match[2]) found.push(child);
        visit(child);
      }
    };
    if (match) visit(this);
    return found;
  }
}

function key(parent, name) {
  return parent.querySelector(`[data-result-key="${name}"]`);
}

function createHost() {
  const host = new FakeNode('div');
  const panel = new FakeNode('div');
  const section = new FakeNode('section');
  section.setAttribute('data-result-key', 'cost-summary');
  const status = new FakeNode('p');
  status.setAttribute('data-result-key', 'cost-status');
  const tables = new FakeNode('div');
  tables.setAttribute('data-result-key', 'cost-tables');
  const gasBody = new FakeNode('tbody');
  gasBody.setAttribute('data-result-key', 'cost-gas-body');
  const operationBody = new FakeNode('tbody');
  operationBody.setAttribute('data-result-key', 'cost-operations-body');
  const total = new FakeNode('p');
  total.setAttribute('data-result-key', 'cost-total');
  tables.append(gasBody, operationBody);
  section.append(status, tables, total);
  panel.append(section);
  host.append(panel);
  return { host, status, tables, gasBody, operationBody, total };
}

function withDocument(run) {
  const previous = globalThis.document;
  globalThis.document = { createElement: tagName => new FakeNode(tagName) };
  try {
    return run();
  } finally {
    globalThis.document = previous;
  }
}

function rowTexts(body) {
  return body.children.map(row => row.children.map(cell => cell.textContent));
}

const PRICED_COST = {
  gasLines: [{ sourceBankId: 'bank-o2', name: 'Oxygen bank', litres: 10, unitPrice: 0.025, cost: 0.25 }],
  operationLines: [{ operation: 'boost', count: 2, fee: 5, cost: 10 }],
  gasTotal: 0.25,
  operationTotal: 10,
  total: 10.25,
  unpricedSources: [],
  incomplete: false,
  configured: true
};

test('renders priced gas, operation and total lines with the currency prefix', () => {
  withDocument(() => {
    const { host, status, tables, gasBody, operationBody, total } = createHost();
    renderCostSummary(PRICED_COST, { root: host, units: 'metric', currencySymbol: '€' });

    assert.equal(status.hidden, true);
    assert.equal(tables.hidden, false);
    assert.equal(total.hidden, false);
    assert.deepEqual(rowTexts(gasBody), [['Oxygen bank', '10.0 L', '€0.025000 /L', '€0.25']]);
    assert.deepEqual(rowTexts(operationBody), [['Boost', '2', '€5.00', '€10.00']]);
    assert.equal(total.textContent, 'Total €10.25');
  });
});

test('uses a spaced prefix for alphanumeric currency symbols', () => {
  withDocument(() => {
    const { host, total } = createHost();
    renderCostSummary(PRICED_COST, { root: host, units: 'metric', currencySymbol: 'CHF' });
    assert.equal(total.textContent, 'Total CHF 10.25');
  });
});

test('labels the total incomplete with unpriced source names and marks the gas row unpriced', () => {
  withDocument(() => {
    const { host, gasBody, total } = createHost();
    const cost = {
      gasLines: [
        { sourceBankId: 'bank-o2', name: 'Oxygen bank', litres: 10, unitPrice: 0.025, cost: 0.25 },
        { sourceBankId: 'bank-he', name: 'Helium bank', litres: 5, unitPrice: null, cost: 0 }
      ],
      operationLines: [],
      gasTotal: 0.25,
      operationTotal: 0,
      total: 0.25,
      unpricedSources: [{ sourceBankId: 'bank-he', name: 'Helium bank' }],
      incomplete: true,
      configured: true
    };
    renderCostSummary(cost, { root: host, units: 'metric', currencySymbol: '€' });

    assert.deepEqual(rowTexts(gasBody)[1], ['Helium bank', '5.0 L', 'no price set', '—']);
    assert.equal(total.textContent, 'Total €0.25 (incomplete: Helium bank unpriced)');
  });
});

test('shows top-up as count, fee and cost with compressor air as information only', () => {
  withDocument(() => {
    const { host, gasBody, operationBody, total } = createHost();
    const cost = {
      gasLines: [{ sourceBankId: 'bank-o2', name: 'Oxygen bank', litres: 10, unitPrice: 0.025, cost: 0.25 }],
      operationLines: [{ operation: 'topUp', count: 1, fee: 5, cost: 5 }],
      gasTotal: 0.25,
      operationTotal: 5,
      total: 5.25,
      unpricedSources: [],
      incomplete: false,
      configured: true
    };
    renderCostSummary(cost, { root: host, units: 'metric', currencySymbol: '€' });

    assert.equal(gasBody.children.length, 1);
    const [topUpRow] = rowTexts(operationBody);
    assert.equal(topUpRow[0], 'Top-up includes compressor air');
    assert.equal(topUpRow[1], '1');
    assert.equal(topUpRow[2], '€5.00');
    assert.equal(topUpRow[3], '€5.00');
    assert.equal(total.textContent, 'Total €5.25');
  });
});

test('prompts for Settings when nothing is configured and hides the tables', () => {
  withDocument(() => {
    const { host, status, tables, total } = createHost();
    renderCostSummary({ ...PRICED_COST, configured: false }, { root: host, units: 'metric', currencySymbol: '€' });

    assert.equal(status.textContent, 'Set prices in Settings → Costs.');
    assert.equal(status.hidden, false);
    assert.equal(tables.hidden, true);
    assert.equal(total.hidden, true);
  });
});

test('shows the empty state when no feasible plan has a cost', () => {
  withDocument(() => {
    const { host, status, tables, total } = createHost();
    renderCostSummary(null, { root: host, units: 'metric', currencySymbol: '€' });

    assert.equal(status.textContent, 'Costs appear when a feasible blend is available.');
    assert.equal(tables.hidden, true);
    assert.equal(total.hidden, true);
  });
});

test('converts litres and prices to imperial units', () => {
  withDocument(() => {
    const { host, gasBody } = createHost();
    renderCostSummary(PRICED_COST, { root: host, units: 'imperial', currencySymbol: '€' });

    const [[, litres, price]] = rowTexts(gasBody);
    assert.match(litres, /cu ft$/);
    assert.match(price, /^€\d+\.\d{6} \/cu ft$/);
  });
});

test('does nothing when the host has no Costs section', () => {
  withDocument(() => {
    const host = new FakeNode('div');
    assert.doesNotThrow(() => renderCostSummary(PRICED_COST, { root: host, units: 'metric', currencySymbol: '€' }));
  });
});

test('labels the gas volume column with the active volume unit', () => {
  withDocument(() => {
    const { host } = createHost();
    const gasHeading = new FakeNode('th');
    gasHeading.setAttribute('data-result-key', 'cost-gas-volume-heading');
    host.children[0].children[0].append(gasHeading);
    renderCostSummary(PRICED_COST, { root: host, units: 'imperial', currencySymbol: '€' });
    assert.equal(gasHeading.textContent, 'Volume (cu ft)');
  });
});

test('shows Total gas cost and Operations cost rows with 2-decimal amounts', () => {
  withDocument(() => {
    const { host } = createHost();
    const gasTotal = new FakeNode('td');
    gasTotal.setAttribute('data-result-key', 'cost-gas-total');
    const operationsTotal = new FakeNode('td');
    operationsTotal.setAttribute('data-result-key', 'cost-operations-total');
    host.children[0].children[0].append(gasTotal, operationsTotal);
    renderCostSummary(PRICED_COST, { root: host, units: 'metric', currencySymbol: '€' });
    assert.equal(gasTotal.textContent, '€0.25');
    assert.equal(operationsTotal.textContent, '€10.00');
  });
});

const SAVINGS_HOOKS = ['cost-fill-total', 'cost-saved', 'cost-salvaged'];

function createBannerHost() {
  const host = new FakeNode('div');
  const hooks = {};
  for (const name of SAVINGS_HOOKS) {
    const element = new FakeNode('div');
    element.setAttribute('data-result-key', name);
    hooks[name] = element;
    host.append(element);
  }
  return { host, hooks };
}

test('banner shows total fill cost, saved cost and salvaged saving with 2 decimals', () => {
  withDocument(() => {
    const { host, hooks } = createBannerHost();
    renderCostBanner(PRICED_COST, { savedCost: 1.5, salvagedSaving: 0.333, missing: [] }, { root: host, currencySymbol: '€' });
    assert.equal(hooks['cost-fill-total'].textContent, '€10.25');
    assert.equal(hooks['cost-saved'].textContent, '€1.50');
    assert.equal(hooks['cost-salvaged'].textContent, '€0.33');
  });
});

test('banner marks the total incomplete when a used bank is unpriced', () => {
  withDocument(() => {
    const { host, hooks } = createBannerHost();
    renderCostBanner({ ...PRICED_COST, incomplete: true, unpricedSources: [{ sourceBankId: 'b', name: 'Helium bank' }] },
      { savedCost: 0, salvagedSaving: 0, missing: [] }, { root: host, currencySymbol: '€' });
    assert.equal(hooks['cost-fill-total'].textContent, '€10.25 (incomplete)');
  });
});

test('banner prompts for a missing pure price instead of a number', () => {
  withDocument(() => {
    const { host, hooks } = createBannerHost();
    renderCostBanner(PRICED_COST,
      { savedCost: null, salvagedSaving: null, missing: [{ code: 'pure-price', gas: 'helium' }] },
      { root: host, currencySymbol: '€' });
    assert.equal(hooks['cost-saved'].textContent, 'Price pure helium in Inventory');
    assert.equal(hooks['cost-salvaged'].textContent, 'Price pure helium in Inventory');
  });
});

test('banner names a bank whose recipe cannot be priced', () => {
  withDocument(() => {
    const { host, hooks } = createBannerHost();
    renderCostBanner(PRICED_COST,
      { savedCost: 0, salvagedSaving: null, missing: [{ code: 'recipe-unavailable', bankId: 'b1', name: 'Mix bank' }] },
      { root: host, currencySymbol: '€' });
    assert.equal(hooks['cost-saved'].textContent, '€0.00');
    assert.equal(hooks['cost-salvaged'].textContent, 'Unavailable for Mix bank');
  });
});

test('banner shows dashes without a feasible blend', () => {
  withDocument(() => {
    const { host, hooks } = createBannerHost();
    renderCostBanner(null, { savedCost: null, salvagedSaving: null, missing: [] }, { root: host, currencySymbol: '€' });
    for (const name of SAVINGS_HOOKS) assert.equal(hooks[name].textContent, '—');
  });
});
