import { getSelectedGasPreset, sortGasPresetEntries } from '../settings.js';

const COLUMN_CLASSES = {
  name: 'py-2 px-2 min-w-32',
  volumeL: 'py-2 px-1',
  pressureBar: 'py-2 px-1',
  oxygenPercent: 'py-2 px-1',
  heliumPercent: 'py-2 px-1'
};

const BANK_FIELDS = [
  { key: 'name', label: 'bank name', type: 'text', className: 'w-24 bg-transparent border-b border-transparent hover:border-ocean-700 focus:border-cyan-400 focus:bg-ocean-900 rounded px-1 text-slate-200' },
  { key: 'volumeL', label: 'volume in litres', type: 'number', min: 1, max: 200, step: 1, className: 'w-11 bg-ocean-950/60 border border-ocean-800 rounded px-1 py-0.5 text-center text-slate-300' },
  { key: 'pressureBar', label: 'pressure in bar', type: 'number', min: 1, max: 350, step: 5, className: 'w-12 bg-ocean-950/60 border border-ocean-800 rounded px-1 py-0.5 text-center text-slate-300' },
  { key: 'oxygenPercent', label: 'oxygen percentage', type: 'number', min: 0, max: 100, step: 1, className: 'w-10 bg-emerald-950/40 border border-emerald-900/60 rounded px-1 py-0.5 text-center text-emerald-400 font-bold' },
  { key: 'heliumPercent', label: 'helium percentage', type: 'number', min: 0, max: 100, step: 1, className: 'w-10 bg-amber-950/40 border border-amber-900/60 rounded px-1 py-0.5 text-center text-amber-400 font-bold' }
];

function makeCell(className, child) {
  const cell = document.createElement('td');
  cell.className = className;
  cell.append(child);
  return cell;
}

function makeBankInput(bank, field) {
  const input = document.createElement('input');
  input.type = field.type;
  input.value = bank[field.key];
  input.className = field.className;
  input.dataset.bankId = bank.id;
  input.dataset.bankField = field.key;
  if (field.min !== undefined) input.min = field.min;
  if (field.max !== undefined) input.max = field.max;
  if (field.step !== undefined) input.step = field.step;
  input.setAttribute('aria-label', `${bank.name} ${field.label}`);
  return input;
}

function makeGasPresetSelect(bank, gasPresets) {
  const select = document.createElement('select');
  select.className = 'w-28 rounded border border-ocean-800 bg-ocean-950 px-1 py-0.5 text-[10px] text-slate-400';
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

function makeBankNameControl(bank, gasPresets) {
  const control = document.createElement('div');
  control.className = 'flex min-w-28 flex-col gap-1';
  control.append(makeBankInput(bank, BANK_FIELDS[0]), makeGasPresetSelect(bank, gasPresets));
  return control;
}


export function renderSupplyBanks(banks, gasPresets) {
  const tbody = document.getElementById('tanks-tbody');
  if (!tbody) return;

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

    for (const field of BANK_FIELDS) {
      const child = field.key === 'name'
        ? makeBankNameControl(bank, gasPresets)
        : makeBankInput(bank, field);
      row.append(makeCell(COLUMN_CLASSES[field.key], child));
    }


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
