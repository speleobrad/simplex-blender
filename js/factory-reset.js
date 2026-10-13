import { loadSettings } from './settings.js';
import { loadSupplyBanks } from './bank-storage.js';
import { loadTheme } from './theme.js';

export function resetApplicationData(storage) {
  storage.clear();
  return {
    settings: loadSettings(storage),
    banks: loadSupplyBanks(storage),
    theme: loadTheme(storage)
  };
}

export function resetApplicationState(state, storage, confirmReset) {
  if (!confirmReset()) return false;
  const defaults = resetApplicationData(storage);
  state.settings = defaults.settings;
  state.banks = defaults.banks;
  state.theme = defaults.theme;
  return true;
}
