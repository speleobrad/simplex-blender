import { validateSupplyBankInput } from './input-validation.js';

const STORAGE_KEY = 'simplex-gas-remixer-banks';

export const DEFAULT_BANKS = Object.freeze([
  Object.freeze({ id: 'bank-he', name: 'Pure Helium', volumeL: 50, pressureBar: 200, oxygenPercent: 0, heliumPercent: 100, enabled: true }),
  Object.freeze({ id: 'bank-1845', name: 'Tx 18/45 Bank', volumeL: 50, pressureBar: 200, oxygenPercent: 18, heliumPercent: 45, enabled: true }),
  Object.freeze({ id: 'bank-o2', name: 'Pure Oxygen', volumeL: 40, pressureBar: 180, oxygenPercent: 100, heliumPercent: 0, enabled: true })
]);

function isLegacyAirBank(bank) {
  return bank?.oxygenPercent === 21 && bank?.heliumPercent === 0;
}

function copyBanks(banks) {
  return banks.map(bank => {
    const copy = {
      id: bank.id,
      name: bank.name,
      volumeL: bank.volumeL,
      pressureBar: bank.pressureBar,
      oxygenPercent: bank.oxygenPercent,
      heliumPercent: bank.heliumPercent,
      enabled: bank.enabled
    };
    if (bank.gasPresetName !== undefined) copy.gasPresetName = bank.gasPresetName;
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

  const normalizedBanks = Array.isArray(banks)
    ? banks.filter(bank => !isLegacyAirBank(bank))
    : banks;
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
