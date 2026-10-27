import { validateSupplyBankInput } from './input-validation.js';

const STORAGE_KEY = 'simplex-gas-remixer-banks';

export const DEFAULT_BANKS = Object.freeze([
  Object.freeze({ id: 'bank-helium', name: 'Helium', volumeL: 40, pressureBar: 150, maxPressureBar: 200, oxygenPercent: 0, heliumPercent: 100, enabled: true }),
  Object.freeze({ id: 'bank-oxygen', name: 'Oxygen', volumeL: 50, pressureBar: 200, maxPressureBar: 200, oxygenPercent: 100, heliumPercent: 0, enabled: true }),
  Object.freeze({ id: 'bank-sample-scrap', name: 'Sample scrap', volumeL: 12, pressureBar: 45, maxPressureBar: 200, oxygenPercent: 19, heliumPercent: 40, enabled: true, gasPresetName: null })
]);

const LEGACY_DEFAULT_BANKS = Object.freeze([
  Object.freeze({ id: 'bank-he', name: 'Pure Helium', volumeL: 50, pressureBar: 200, oxygenPercent: 0, heliumPercent: 100, enabled: true }),
  Object.freeze({ id: 'bank-1845', name: 'Tx 18/45 Bank', volumeL: 50, pressureBar: 200, oxygenPercent: 18, heliumPercent: 45, enabled: true }),
  Object.freeze({ id: 'bank-o2', name: 'Pure Oxygen', volumeL: 40, pressureBar: 180, oxygenPercent: 100, heliumPercent: 0, enabled: true })
]);

const LEGACY_BANK_FIELDS = ['id', 'name', 'volumeL', 'pressureBar', 'oxygenPercent', 'heliumPercent', 'enabled'];
const BANK_FIELDS = [...LEGACY_BANK_FIELDS, 'pricePerLitre'];

function isLegacyDefaultBanks(banks) {
  return Array.isArray(banks)
    && banks.length === LEGACY_DEFAULT_BANKS.length
    && banks.every((bank, index) => (
      Object.keys(bank).length === LEGACY_BANK_FIELDS.length
      && BANK_FIELDS.every(field => bank[field] === LEGACY_DEFAULT_BANKS[index][field])
    ));
}

function isLegacyAirBank(bank) {
  return bank?.oxygenPercent === 21 && bank?.heliumPercent === 0;
}

function migrateMaxPressureBar(bank) {
  if (!bank || typeof bank !== 'object' || bank.maxPressureBar !== undefined) return bank;
  if (!Number.isFinite(bank.pressureBar)) return bank;
  return { ...bank, maxPressureBar: Math.max(200, bank.pressureBar) };
}

function copyBanks(banks) {
  return banks.map(bank => {
    const copy = {
      id: bank.id,
      name: bank.name,
      volumeL: bank.volumeL,
      pressureBar: bank.pressureBar,
      maxPressureBar: bank.maxPressureBar,
      oxygenPercent: bank.oxygenPercent,
      heliumPercent: bank.heliumPercent,
      enabled: bank.enabled
    };
    if (bank.gasPresetName !== undefined) copy.gasPresetName = bank.gasPresetName;
    if (bank.pricePerLitre !== undefined) copy.pricePerLitre = bank.pricePerLitre;
    return copy;
  });
}



function validateBanks(banks) {
  if (!Array.isArray(banks)) return ['Supply banks must be a list.'];

  const ids = new Set();
  for (const bank of banks) {
    const errors = validateSupplyBankInput(bank);
    if (errors.length > 0) return errors;
    if (ids.has(bank.id)) return ['Supply banks must have unique IDs.'];
    ids.add(bank.id);
  }
  return [];
}

export function loadSupplyBanks(storage, onFallback = () => {}) {
  let serialized;
  try {
    serialized = storage.getItem(STORAGE_KEY);
  } catch (error) {
    onFallback(error);
    return copyBanks(DEFAULT_BANKS);
  }
  if (serialized === null) return copyBanks(DEFAULT_BANKS);

  let banks;
  try {
    banks = JSON.parse(serialized);
  } catch (error) {
    onFallback(error);
    return copyBanks(DEFAULT_BANKS);
  }

  let normalizedBanks = Array.isArray(banks)
    ? banks.filter(bank => !isLegacyAirBank(bank))
    : banks;
  if (isLegacyDefaultBanks(normalizedBanks)) normalizedBanks = DEFAULT_BANKS;
  else if (Array.isArray(normalizedBanks)) normalizedBanks = normalizedBanks.map(migrateMaxPressureBar);
  const errors = validateBanks(normalizedBanks);
  if (errors.length > 0) {
    onFallback(new RangeError(errors.join(' ')));
    return copyBanks(DEFAULT_BANKS);
  }
  return copyBanks(normalizedBanks);
}

export function saveSupplyBanks(banks, storage) {
  const errors = validateBanks(banks);
  if (errors.length > 0) throw new RangeError(errors.join(' '));
  storage.setItem(STORAGE_KEY, JSON.stringify(copyBanks(banks)));
}
