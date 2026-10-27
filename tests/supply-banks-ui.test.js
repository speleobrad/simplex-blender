import test from 'node:test';
import assert from 'node:assert/strict';
import { formatBankPrice, renderSupplyBanks } from '../js/ui/supply-banks.js';

class FakeElement {
  constructor(tagName = 'div') {
    this.tagName = tagName;
    this.children = [];
    this.className = '';
    this.dataset = {};
    this.attributes = new Map();
    this.value = '';
    this.type = '';
    this.checked = false;
  }

  append(...children) {
    this.children.push(...children);
  }

  replaceChildren(...children) {
    this.children = children;
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  querySelectorAll(tagName) {
    const matches = [];
    const visit = element => {
      for (const child of element.children) {
        if (child.tagName === tagName) matches.push(child);
        visit(child);
      }
    };
    visit(this);
    return matches;
  }
}

function createFixture() {
  const tbody = new FakeElement('tbody');
  const priceHeading = new FakeElement('th');
  const document = {
    createElement: tagName => new FakeElement(tagName),
    getElementById: id => ({ 'tanks-tbody': tbody, 'inventory-price-heading': priceHeading })[id] ?? null
  };
  return { document, tbody, priceHeading };
}

test('renders inventory bank values and main-screen-sized editable controls', () => {
  const previousDocument = globalThis.document;
  const { document, tbody } = createFixture();
  globalThis.document = document;

  try {
    renderSupplyBanks([
      {
        id: 'bank-helium',
        name: 'Helium',
        volumeL: 40,
        pressureBar: 150,
        oxygenPercent: 0,
        heliumPercent: 100,
        enabled: true
      }
    ], [
      { name: 'Helium', oxygenPercent: 0, heliumPercent: 100 }
    ]);

    const inputs = tbody.querySelectorAll('input').filter(input => input.type !== 'checkbox');
    assert.deepEqual(inputs.map(input => input.value), ['Helium', 40, 150, 0, 100, '']);
    assert.ok(inputs.slice(1, 3).every(input => input.className.includes('w-28')));
    assert.ok(inputs.slice(3, 5).every(input => input.className.includes('w-20')));
  } finally {
    globalThis.document = previousDocument;
  }
});

test('converts editable imperial supply-bank values and constraints', () => {
  const previousDocument = globalThis.document;
  const { document, tbody } = createFixture();
  globalThis.document = document;

  try {
    renderSupplyBanks([
      {
        id: 'bank-mix',
        name: 'Tx 18/45',
        volumeL: 12,
        pressureBar: 150,
        oxygenPercent: 18,
        heliumPercent: 45,
        enabled: true
      }
    ], [], 'imperial');

    const volume = tbody.querySelectorAll('input').find(input => input.dataset.bankField === 'volumeL');
    assert.ok(volume.className.includes('w-40'));
    assert.ok(Math.abs((volume.value - volume.min) / volume.step - 11) < 1e-9);
    assert.ok(Math.abs((volume.max - volume.min) / volume.step - 199) < 1e-9);
    const pressure = tbody.querySelectorAll('input').find(input => input.dataset.bankField === 'pressureBar');
    assert.ok(Math.abs(pressure.value - 2175.56607) < 1e-8);
    assert.ok(Math.abs(pressure.min - 14.5037738) < 1e-10);
    assert.ok(Math.abs(pressure.max - 5076.32083) < 1e-7);
    assert.ok(Math.abs(pressure.step - 72.518869) < 1e-8);
  } finally {
    globalThis.document = previousDocument;
  }
});

test('formats stored prices for the inventory input in the display unit to 6 decimals', () => {
  assert.equal(formatBankPrice(undefined, 'metric'), '');
  assert.equal(formatBankPrice(null, 'metric'), '');
  assert.equal(formatBankPrice(0.02, 'metric'), '0.020000');
  assert.equal(formatBankPrice(0.0123456789, 'metric'), '0.012346');
  assert.equal(formatBankPrice(0.02, 'imperial'), '0.566337');
});

const priceBank = (overrides = {}) => ({
  id: 'bank-mix',
  name: 'Tx 18/45',
  volumeL: 12,
  pressureBar: 150,
  oxygenPercent: 18,
  heliumPercent: 45,
  enabled: true,
  ...overrides
});

function renderOne(bank, options = {}, units = 'metric') {
  const previousDocument = globalThis.document;
  const { document, tbody, priceHeading } = createFixture();
  globalThis.document = document;
  try {
    renderSupplyBanks([bank], [], units, options);
  } finally {
    globalThis.document = previousDocument;
  }
  return { tbody, priceHeading };
}

function priceInputOf(tbody) {
  return tbody.querySelectorAll('input').find(input => input.dataset.bankField === 'pricePerLitre');
}

function buttonWithAction(tbody, action) {
  return tbody.querySelectorAll('button').find(button => button.dataset.action === action);
}

function noteOf(tbody, bankId) {
  return tbody.querySelectorAll('p').find(paragraph => paragraph.dataset.bankNote === bankId);
}

function basisSelectOf(tbody, bankId) {
  return tbody.querySelectorAll('select').find(select => select.dataset.action === 'select-bank-price-basis' && select.dataset.bankId === bankId);
}

const OK_SUGGESTION = { status: 'ok', pricePerLitre: 0.023, recipeCost: 12.4, litres: 540, signature: 'current' };

test('renders an empty price input and a Calculate button for an unpriced bank', () => {
  const { tbody } = renderOne(priceBank());
  const input = priceInputOf(tbody);
  assert.equal(input.value, '');
  assert.equal(input.placeholder, 'Not set');
  assert.equal(buttonWithAction(tbody, 'calculate-bank-price').dataset.bankId, 'bank-mix');
  assert.equal(buttonWithAction(tbody, 'apply-bank-price'), undefined);
  assert.equal(noteOf(tbody, 'bank-mix').textContent, '');
});

test('labels the price column and input in the display unit', () => {
  const metric = renderOne(priceBank({ pricePerLitre: 0.02 }));
  assert.equal(priceInputOf(metric.tbody).value, '0.020000');
  assert.equal(metric.priceHeading.textContent, 'Price (/L)');
  const imperial = renderOne(priceBank({ pricePerLitre: 0.02 }), {}, 'imperial');
  const input = priceInputOf(imperial.tbody);
  assert.equal(input.value, '0.566337');
  assert.match(input.attributes.get('aria-label'), /\/cu ft$/);
  assert.equal(imperial.priceHeading.textContent, 'Price (/cu ft)');
});

test('shows an indicative price with Apply for an unpriced bank', () => {
  const { tbody } = renderOne(priceBank(), { suggestions: { 'bank-mix': OK_SUGGESTION }, currencySymbol: '€' });
  assert.equal(noteOf(tbody, 'bank-mix').textContent, 'Indicative price €0.0230 per L (recipe cost €12.40 for 540 L).');
  const apply = buttonWithAction(tbody, 'apply-bank-price');
  assert.equal(apply.textContent, 'Apply');
  assert.equal(apply.dataset.bankId, 'bank-mix');
});

test('offers Replace beside the current price for a priced bank', () => {
  const { tbody } = renderOne(priceBank({ pricePerLitre: 0.03 }), { suggestions: { 'bank-mix': OK_SUGGESTION }, currencySymbol: '€' });
  assert.equal(noteOf(tbody, 'bank-mix').textContent, 'Indicative price €0.0230 per L (recipe cost €12.40 for 540 L). Current price €0.0300 per L.');
  assert.equal(buttonWithAction(tbody, 'apply-bank-price').textContent, 'Replace');
});

test('separates word currency symbols from the amount', () => {
  const { tbody } = renderOne(priceBank(), { suggestions: { 'bank-mix': OK_SUGGESTION }, currencySymbol: 'USD' });
  assert.match(noteOf(tbody, 'bank-mix').textContent, /^Indicative price USD 0\.0230 per L/);
});

test('disables Calculate and shows progress while a calculation runs', () => {
  const { tbody } = renderOne(priceBank(), { suggestions: { 'bank-mix': { status: 'calculating', signature: 'current' } } });
  assert.equal(buttonWithAction(tbody, 'calculate-bank-price').disabled, true);
  assert.equal(noteOf(tbody, 'bank-mix').textContent, 'Calculating…');
  assert.equal(buttonWithAction(tbody, 'apply-bank-price'), undefined);
});

test('shows the pricer reason for a failed calculation without Apply', () => {
  const reason = 'No prices are configured in Settings → Costs.';
  const { tbody } = renderOne(priceBank(), { suggestions: { 'bank-mix': { status: 'failed', reason, signature: 'current' } } });
  assert.equal(noteOf(tbody, 'bank-mix').textContent, reason);
  assert.equal(buttonWithAction(tbody, 'apply-bank-price'), undefined);
  assert.equal(buttonWithAction(tbody, 'calculate-bank-price').disabled, false);
});

test('ignores suggestions that belong to other banks', () => {
  const { tbody } = renderOne(priceBank(), { suggestions: { 'bank-other': OK_SUGGESTION }, currencySymbol: '€' });
  assert.equal(noteOf(tbody, 'bank-mix').textContent, '');
  assert.equal(buttonWithAction(tbody, 'apply-bank-price'), undefined);
});

test('notes the leftover discount when one is configured', () => {
  const { tbody } = renderOne(priceBank(), { suggestions: { 'bank-mix': OK_SUGGESTION }, currencySymbol: '€', leftoverDiscountPercent: 10 });
  assert.equal(noteOf(tbody, 'bank-mix').textContent, 'Indicative price €0.0230 per L after 10% leftover discount (recipe cost €12.40 for 540 L).');
});

test('pure oxygen and helium banks have no Calculate control or note, enabled or not', () => {
  for (const composition of [{ oxygenPercent: 100, heliumPercent: 0 }, { oxygenPercent: 0, heliumPercent: 100 }]) {
    for (const enabled of [true, false]) {
      const { tbody } = renderOne(priceBank({ ...composition, enabled }), { suggestions: { 'bank-mix': OK_SUGGESTION }, currencySymbol: '€' });
      assert.equal(buttonWithAction(tbody, 'calculate-bank-price'), undefined);
      assert.equal(buttonWithAction(tbody, 'apply-bank-price'), undefined);
      assert.equal(noteOf(tbody, 'bank-mix'), undefined);
      assert.ok(priceInputOf(tbody), 'the price input stays for hand entry');
    }
  }
});

test('offers a per-volume or full-tank price basis for every bank', () => {
  const mix = renderOne(priceBank()).tbody;
  const select = basisSelectOf(mix, 'bank-mix');
  assert.deepEqual(select.children.map(option => option.value), ['per-volume', 'full-tank']);
  assert.equal(select.value, 'per-volume');
  assert.equal(select.attributes.get('aria-label'), 'Price basis for Tx 18/45');
  const pure = renderOne(priceBank({ oxygenPercent: 100, heliumPercent: 0 })).tbody;
  assert.equal(basisSelectOf(pure, 'bank-mix').value, 'per-volume');
});

test('full-tank basis shows an empty input for the tank price', () => {
  const { tbody } = renderOne(priceBank({ pricePerLitre: 0.03 }), { priceBasis: { 'bank-mix': 'full-tank' } });
  assert.equal(basisSelectOf(tbody, 'bank-mix').value, 'full-tank');
  const input = priceInputOf(tbody);
  assert.equal(input.value, '');
  assert.equal(input.placeholder, 'Full tank price');
  assert.equal(input.attributes.get('aria-label'), 'Tx 18/45 full tank price');
});
