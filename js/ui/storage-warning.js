export function getStorageWarningMessages(state) {
  const messages = [];
  if (state.settingsLoadFailure) messages.push('Saved presets could not be loaded; built-in defaults are active.');
  if (state.banksLoadFailure) messages.push('Saved supply banks could not be loaded; default banks are active.');
  if (state.bankSaveFailure) messages.push('Supply bank changes could not be saved to browser storage.');
  if (state.bankInputFailure) messages.push(`Supply bank edit rejected: ${state.bankInputFailure.message}`);
  return messages;
}

export function renderStorageWarning(warning, state) {
  const messages = getStorageWarningMessages(state);
  warning.textContent = messages.join(' ');
  warning.classList.toggle('hidden', messages.length === 0);
}
