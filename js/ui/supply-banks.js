import { getSelectedGasPreset, sortGasPresetEntries } from '../settings.js';
import { convertToDisplay, unitLabel } from '../units.js';
import { formatMoney } from '../currency-format.js';
const COLUMN_CLASSES = {
  name: 'py-2 px-2 min-w-32',
  volumeL: 'py-2 px-1',
  pressureBar: 'py-2 px-1',
  oxygenPercent: 'py-2 px-1',
  heliumPercent: 'py-2 px-1',
  pricePerLitre: 'py-2 px-1 align-top'
};

export const BANK_FIELD_QUANTITIES = Object.freeze({
  volumeL: 'volumeL',
  pressureBar: 'pressureBar',
  pricePerLitre: 'pricePerVolumeL'
});

function bankFieldDefinition(key, units) {
  const definitions = {
    name: { key: 'name', label: 'bank name', type: 'text', className: 'w-full min-w-0 bg-transparent border-b border-transparent hover:border-ocean-700 focus:border-cyan-400 focus:bg-ocean-900 rounded px-1 text-slate-200' },
    volumeL: { key: 'volumeL', label: `volume in ${unitLabel('volumeL', units)}`, type: 'number', min: 1, max: 200, step: 1, className: `${units === 'imperial' ? 'w-40' : 'w-28'} min-w-0 bg-ocean-950/60 border border-ocean-800 rounded px-2 py-1 font-mono text-xs text-slate-100` },
    pressureBar: { key: 'pressureBar', label: `pressure in ${unitLabel('pressureBar', units)}`, type: 'number', min: 1, max: 350, step: 5, className: 'w-28 min-w-0 bg-ocean-950/60 border border-ocean-800 rounded px-2 py-1 font-mono text-xs text-slate-100' },
    oxygenPercent: { key: 'oxygenPercent', label: 'oxygen percentage', type: 'number', min: 0, max: 100, step: 1, className: 'w-20 bg-emerald-950/40 border border-emerald-900/60 rounded px-1 py-1 text-center text-emerald-400 font-bold' },
    heliumPercent: { key: 'heliumPercent', label: 'helium percentage', type: 'number', min: 0, max: 100, step: 1, className: 'w-20 bg-amber-950/40 border border-amber-900/60 rounded px-1 py-1 text-center text-amber-400 font-bold' },
    pricePerLitre: { key: 'pricePerLitre', label: `price per ${unitLabel('pricePerVolumeL', units)}`, type: 'number', min: 0, max: 1000000, step: 'any', className: 'w-24 min-w-0 bg-ocean-950/60 border border-ocean-800 rounded px-2 py-1 font-mono text-xs text-slate-100' }
  };
  return definitions[key];
}

function makeCell(className, child) {
  const cell = document.createElement('td');
  cell.className = className;
  cell.append(child);
  return cell;
}

function makeBankInput(bank, field, units) {
  const input = document.createElement('input');
  input.type = field.type;
  const quantity = BANK_FIELD_QUANTITIES[field.key] ?? null;
  const toDisplay = value => (quantity ? convertToDisplay(value, quantity, units) : value);
  if (field.key === 'pricePerLitre') {
    input.value = formatBankPrice(bank.pricePerLitre, units);
    input.placeholder = 'Not set';
  } else {
    input.value = toDisplay(bank[field.key]);
  }
  input.className = field.className;
  input.dataset.bankId = bank.id;
  input.dataset.bankField = field.key;
  if (field.min !== undefined) input.min = toDisplay(field.min);
  if (field.max !== undefined) input.max = toDisplay(field.max);
  if (field.step !== undefined) input.step = typeof field.step === 'number' ? toDisplay(field.step) : field.step;
  input.setAttribute('aria-label', `${bank.name} ${field.label}`);
  return input;
}

/** Stored per-litre price as the text shown in the inventory price input; empty when unpriced. */
export function formatBankPrice(pricePerLitre, units) {
  if (pricePerLitre === null || pricePerLitre === undefined) return '';
  return String(Number(convertToDisplay(pricePerLitre, 'pricePerVolumeL', units).toPrecision(6)));
}

function makeGasPresetSelect(bank, gasPresets) {
  const select = document.createElement('select');
  select.className = 'w-20 rounded border border-ocean-800 bg-ocean-950 px-1 py-0.5 text-[10px] text-slate-400';
  select.dataset.action = 'select-bank-gas';
  select.dataset.bankId = bank.id;
  select.setAttribute('aria-label', `Gas preset for ${bank.name}`);

  const custom = document.createElement('option');
  custom.value = 'custom';
  custom.textContent = 'Custom';
  select.append(custom);
  for (const { preset } of sortGasPresetEntries(gasPresets)) {
    const option = document.createElement('option');
    option.value = `gas:${preset.name}`;
    option.textContent = preset.name;
    select.append(option);
  }

  const selectedPreset = getSelectedGasPreset(bank, gasPresets);
  select.value = selectedPreset ? `gas:${selectedPreset.name}` : 'custom';
  return select;
}

function makeBankNameControl(bank, gasPresets, units) {
  const control = document.createElement('div');
  control.className = 'flex min-w-28 flex-col gap-1';
  control.append(makeBankInput(bank, bankFieldDefinition('name', units), units), makeGasPresetSelect(bank, gasPresets));
  return control;
}

function formatAmount(value) {
  return String(Number(value.toPrecision(6)));
}

export function formatSuggestionNote(bank, suggestion, units, currencySymbol) {
  if (suggestion.status === 'calculating') return 'Calculating…';
  if (suggestion.status === 'failed') return suggestion.reason;
  const perVolume = unitLabel('volumeL', units);
  const money = (amount, digits) => formatMoney(amount, currencySymbol, digits);
  const price = pricePerLitre => `${money(convertToDisplay(pricePerLitre, 'pricePerVolumeL', units), 4)} per ${perVolume}`;
  const litres = formatAmount(convertToDisplay(suggestion.litres, 'volumeL', units));
  let text = `Indicative price ${price(suggestion.pricePerLitre)} (recipe cost ${money(suggestion.recipeCost, 2)} for ${litres} ${perVolume}).`;
  if (bank.pricePerLitre !== null && bank.pricePerLitre !== undefined) text += ` Current price ${price(bank.pricePerLitre)}.`;
  return text;
}

function makePriceControl(bank, units, suggestion, currencySymbol) {
  const control = document.createElement('div');
  control.className = 'flex min-w-32 flex-col items-start gap-1';

  const calculate = document.createElement('button');
  calculate.type = 'button';
  calculate.textContent = 'Calculate price';
  calculate.disabled = suggestion?.status === 'calculating';
  calculate.className = 'rounded border border-cyan-700 px-2 py-0.5 text-[11px] text-cyan-300 hover:border-cyan-400 disabled:cursor-wait disabled:opacity-50';
  calculate.dataset.action = 'calculate-bank-price';
  calculate.dataset.bankId = bank.id;
  calculate.setAttribute('aria-label', `Calculate price for ${bank.name}`);

  const note = document.createElement('p');
  note.className = 'text-[11px] text-slate-400';
  note.dataset.bankNote = bank.id;
  note.textContent = suggestion ? formatSuggestionNote(bank, suggestion, units, currencySymbol) : '';

  control.append(makeBankInput(bank, bankFieldDefinition('pricePerLitre', units), units), calculate, note);
  if (suggestion?.status === 'ok') {
    const priced = bank.pricePerLitre !== null && bank.pricePerLitre !== undefined;
    const apply = document.createElement('button');
    apply.type = 'button';
    apply.textContent = priced ? 'Replace' : 'Apply';
    apply.className = 'rounded border border-emerald-700 px-2 py-0.5 text-[11px] text-emerald-300 hover:border-emerald-400';
    apply.dataset.action = 'apply-bank-price';
    apply.dataset.bankId = bank.id;
    apply.setAttribute('aria-label', `${apply.textContent} suggested price for ${bank.name}`);
    control.append(apply);
  }
  return control;
}


export function renderSupplyBanks(banks, gasPresets, units = 'metric', { suggestions = {}, currencySymbol = '' } = {}) {
  const tbody = document.getElementById('tanks-tbody');
  if (!tbody) return;
  const volumeHeading = document.getElementById('inventory-volume-heading');
  const pressureHeading = document.getElementById('inventory-pressure-heading');
  if (volumeHeading) volumeHeading.textContent = `Volume (${unitLabel('volumeL', units)})`;
  if (pressureHeading) pressureHeading.textContent = `Pressure (${unitLabel('pressureBar', units)})`;
  const priceHeading = document.getElementById('inventory-price-heading');
  if (priceHeading) priceHeading.textContent = `Price (${unitLabel('pricePerVolumeL', units)})`;

  const rows = banks.map(bank => {
    const row = document.createElement('tr');
    row.className = `hover:bg-ocean-850/50 transition ${bank.enabled ? '' : 'opacity-40'}`;

    const enabled = document.createElement('input');
    enabled.type = 'checkbox';
    enabled.checked = bank.enabled;
    enabled.className = 'rounded bg-ocean-900 border-ocean-700 text-cyan-500 focus:ring-0';
    enabled.dataset.action = 'toggle-bank';
    enabled.dataset.bankId = bank.id;
    enabled.setAttribute('aria-label', `Use ${bank.name}`);
    row.append(makeCell('py-2 px-2', enabled));

    for (const key of ['name', 'volumeL', 'pressureBar', 'oxygenPercent', 'heliumPercent']) {
      const child = key === 'name'
        ? makeBankNameControl(bank, gasPresets, units)
        : makeBankInput(bank, bankFieldDefinition(key, units), units);
      row.append(makeCell(COLUMN_CLASSES[key], child));
    }
    row.append(makeCell(COLUMN_CLASSES.pricePerLitre, makePriceControl(bank, units, suggestions[bank.id], currencySymbol)));

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'text-rose-400 hover:text-rose-300 px-1 py-0.5';
    remove.textContent = '✕';
    remove.dataset.action = 'remove-bank';
    remove.dataset.bankId = bank.id;
    remove.setAttribute('aria-label', `Remove ${bank.name}`);
    row.append(makeCell('py-2 px-1 text-center', remove));
    return row;
  });
  tbody.replaceChildren(...rows);
}
