export function getStorageWarningMessages(state) {
  const messages = [];
  if (state.settingsLoadFailure) messages.push('Saved presets could not be loaded; built-in defaults are active.');
  if (state.banksLoadFailure) messages.push('Saved Inventory could not be loaded; default inventory is active.');
  if (state.bankSaveFailure) messages.push('Inventory changes could not be saved to browser storage.');
  if (state.onboardingLoadFailure) messages.push('Saved guided-tour preference could not be loaded; consent will be requested again.');
  if (state.bankInputFailure) messages.push(`Inventory edit rejected: ${state.bankInputFailure.message}`);
  return messages;
}

export function renderStorageWarning(warning, state) {
  const messages = getStorageWarningMessages(state);
  warning.textContent = messages.join(' ');
  warning.classList.toggle('hidden', messages.length === 0);
}
