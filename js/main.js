import { optimizeBlend } from './optimizer.js';
import { parseNumericInput, splitGasInput } from './gas-input.js';
import { validateCalculatorInputs, validateSupplyBankInput } from './input-validation.js';
import {
  applyGasPresetToBank,
  copySettings,
  loadSettings,
  normalizePresetName,
  saveSettings,
  selectEquipmentPreset,
  validateSettings
} from './settings.js';
import { loadSupplyBanks, saveSupplyBanks } from './bank-storage.js';
import { loadTheme, saveTheme } from './theme.js';
import { renderResults } from './ui/results.js';
import { clearPresetImport, renderPresetImport, renderSettingsDialog, renderPresetOptions } from './ui/settings-dialog.js';
import { renderSupplyBanks } from './ui/supply-banks.js';
import { renderStorageWarning } from './ui/storage-warning.js';
import { renderThermalCharts } from './ui/thermal-charts.js';
import { clearTernaryDiagram, observeTernaryCanvas, renderTernaryDiagram } from './ui/ternary.js';
import {
  getImportEntries,
  mergeSelectedPresets,
  parsePresetDocument,
  selectPresetImportEntries
} from './preset-import.js';

const settingsStorage = {
  getItem: key => window.localStorage.getItem(key),
  setItem: (key, value) => window.localStorage.setItem(key, value)
};

let settingsLoadFailure = null;
const initialSettings = loadSettings(settingsStorage, error => {
  settingsLoadFailure = error;
});

let banksLoadFailure = null;
const initialBanks = loadSupplyBanks(settingsStorage, error => {
  banksLoadFailure = error;
});


const state = {
  banks: initialBanks,
  settings: initialSettings,
  settingsDraft: null,
  presetImportEntries: [],
  presetImportSelectedIndexes: new Set(),
  presetImportStatus: '',
  presetImportLoad: 0,
  settingsSession: 0,
  settingsCategory: 'model',
  theme: loadTheme(settingsStorage),
  settingsLoadFailure,
  banksLoadFailure,
  bankSaveFailure: null,
  bankInputFailure: null,
  activeTab: 'recipe',
  lastInput: null,
  lastResult: null
};


const DEFAULT_CYLINDER_PRESET_NAME = '12 L Steel 232 bar';

function selectedCylinderPreset() {
  const selectedName = byId('cylinder-preset')?.value;
  return state.settings.cylinderPresets.find(preset => preset.name === selectedName)
    ?? state.settings.cylinderPresets.find(preset => preset.name === DEFAULT_CYLINDER_PRESET_NAME)
    ?? state.settings.cylinderPresets[0];
}

function updateCylinderRatingHint(preset) {
  const hint = byId('cylinder-rating-hint');
  if (!hint || !preset) return;
  hint.textContent = `${preset.volumeL} L ${preset.material} cylinder, ${preset.massKg} kg empty assembly, rated to ${preset.workingPressureBar} bar.`;
}

function refreshPresetOptions(selectedCylinderName = null) {
  const requestedName = selectedCylinderName ?? (byId('cylinder-preset')?.value || undefined);
  renderPresetOptions(state.settings, requestedName);
  updateCylinderRatingHint(selectedCylinderPreset());
}


const byId = id => document.getElementById(id);
const numberValue = id => parseNumericInput(byId(id).value);


function displaySettingsErrors(messages) {
  const container = byId('settings-errors');
  container.replaceChildren(...messages.map(message => {
    const line = document.createElement('p');
    line.textContent = message;
    return line;
  }));
  container.classList.remove('hidden');
}

function clearSettingsErrors() {
  const container = byId('settings-errors');
  container.replaceChildren();
  container.classList.add('hidden');
}

function updateStorageWarning() {
  renderStorageWarning(byId('storage-warning'), state);
}

function clearBankInputFailure(bankId) {
  if (state.bankInputFailure?.bankId !== bankId) return;
  state.bankInputFailure = null;
  updateStorageWarning();
}


function persistSupplyBanks() {
  try {
    saveSupplyBanks(state.banks, settingsStorage);
    state.banksLoadFailure = null;
    state.bankSaveFailure = null;
  } catch (error) {
    console.warn('Supply banks were not saved.', error);
    state.bankSaveFailure = error;
  }
  updateStorageWarning();
}

function applyTheme(theme) {
  const isLight = theme === 'light';
  document.documentElement.dataset.theme = theme;
  document.documentElement.classList.toggle('dark', !isLight);

  const button = byId('theme-toggle');
  const label = byId('theme-toggle-label');
  const sunIcon = byId('theme-icon-sun');
  const moonIcon = byId('theme-icon-moon');
  const nextTheme = isLight ? 'dark' : 'light';
  button.setAttribute('aria-label', `Switch to ${nextTheme} theme`);
  button.title = `Switch to ${nextTheme} theme`;
  button.setAttribute('aria-pressed', String(isLight));
  label.textContent = isLight ? 'Dark' : 'Light';
  sunIcon.classList.toggle('hidden', isLight);
  moonIcon.classList.toggle('hidden', !isLight);
}

function toggleTheme() {
  state.theme = state.theme === 'dark' ? 'light' : 'dark';
  applyTheme(state.theme);
  const status = byId('theme-save-status');
  try {
    saveTheme(state.theme, settingsStorage);
    status.textContent = '';
  } catch (error) {
    console.warn('Theme preference was not saved.', error);
    status.textContent = 'Theme changed for this session only; preference could not be saved.';
  }
  if (state.lastResult?.feasible) requestAnimationFrame(renderTernary);
}


function setSettingsCategory(category) {
  const categories = ['model', 'gas-presets', 'cylinder-presets', 'equipment'];
  if (!categories.includes(category)) return;
  state.settingsCategory = category;
  for (const candidate of categories) {
    const button = document.querySelector(`[data-settings-category="${candidate}"]`);
    const pane = byId(`settings-pane-${candidate}`);
    if (!button || !pane) continue;
    const selected = candidate === category;
    button.setAttribute('aria-selected', String(selected));
    button.classList.toggle('settings-category-selected', selected);
    pane.classList.toggle('hidden', !selected);
  }
}

function openSettings() {
  state.settingsSession += 1;
  state.settingsDraft = copySettings(state.settings);
  clearPresetImportState();
  byId('settings-preset-file').value = '';
  byId('settings-load-preset-url').disabled = false;
  renderSettingsDraft();
  setSettingsCategory(state.settingsCategory);
  clearSettingsErrors();
  if (state.settingsLoadFailure) {
    displaySettingsErrors(['Saved presets could not be loaded; built-in defaults are in use. Saving will replace the unreadable saved presets.']);
  }
  byId('settings-dialog').showModal();
}

function isActiveSettingsSession(session) {
  return session === state.settingsSession && state.settingsDraft !== null;
}

function isActivePresetImportLoad(session, load) {
  return isActiveSettingsSession(session) && load === state.presetImportLoad;
}

function clearPresetImportState() {
  state.presetImportEntries = [];
  state.presetImportSelectedIndexes = new Set();
  state.presetImportStatus = '';
}

function renderSettingsDraft() {
  renderSettingsDialog(state.settingsDraft);
  renderPresetImport(
    state.presetImportEntries,
    state.presetImportStatus,
    state.presetImportSelectedIndexes
  );
}

function setPresetImportStatus(message) {
  state.presetImportStatus = message;
  byId('settings-preset-import-status').textContent = message;
}

function renderLoadedPresetDocument(document, session, load) {
  if (!isActivePresetImportLoad(session, load)) return;
  const parsed = parsePresetDocument(document);
  if (!isActivePresetImportLoad(session, load)) return;
  state.presetImportEntries = getImportEntries(parsed, state.settingsDraft);
  state.presetImportSelectedIndexes = new Set(
    state.presetImportEntries.flatMap((entry, index) => entry.duplicate ? [] : [index])
  );
  const loaded = `Loaded ${state.presetImportEntries.length} preset${state.presetImportEntries.length === 1 ? '' : 's'}.`;
  state.presetImportStatus = parsed.errors.length > 0 ? `${loaded} ${parsed.errors.join(' ')}` : loaded;
  renderPresetImport(
    state.presetImportEntries,
    state.presetImportStatus,
    state.presetImportSelectedIndexes
  );
}

function reportPresetImportError(error, session, load) {
  if (isActivePresetImportLoad(session, load)) {
    setPresetImportStatus(`Unable to load presets: ${error.message}`);
  }
}

function startPresetImportLoad() {
  state.presetImportLoad += 1;
  return state.presetImportLoad;
}

async function loadPresetFile(input) {
  const session = state.settingsSession;
  const file = input.files?.[0];
  if (!file || !isActiveSettingsSession(session)) return;
  const load = startPresetImportLoad();
  byId('settings-load-preset-url').disabled = false;
  try {
    const text = await file.text();
    if (!isActivePresetImportLoad(session, load)) return;
    renderLoadedPresetDocument(JSON.parse(text), session, load);
  } catch (error) {
    reportPresetImportError(error, session, load);
  } finally {
    if (isActivePresetImportLoad(session, load)) input.value = '';
  }
}

async function loadPresetUrl() {
  const session = state.settingsSession;
  if (!isActiveSettingsSession(session)) return;
  const url = byId('settings-preset-url').value.trim();
  if (!url) {
    setPresetImportStatus('Enter a preset URL before loading.');
    return;
  }

  const load = startPresetImportLoad();
  byId('settings-preset-file').value = '';
  const button = byId('settings-load-preset-url');
  button.disabled = true;
  try {
    const response = await fetch(url);
    if (!isActivePresetImportLoad(session, load)) return;
    if (!response.ok) {
      throw new Error(`The server returned ${response.status}${response.statusText ? ` ${response.statusText}` : ''}.`);
    }
    const document = await response.json();
    if (!isActivePresetImportLoad(session, load)) return;
    renderLoadedPresetDocument(document, session, load);
  } catch (error) {
    reportPresetImportError(error, session, load);
  } finally {
    if (isActivePresetImportLoad(session, load)) button.disabled = false;
  }
}

function importSelectedPresets() {
  if (!state.settingsDraft) return;
  const selectedEntries = selectPresetImportEntries(
    state.presetImportEntries,
    state.presetImportSelectedIndexes
  );
  if (selectedEntries.length === 0) {
    setPresetImportStatus('Select at least one new preset to import.');
    return;
  }

  try {
    state.settingsDraft = mergeSelectedPresets(state.settingsDraft, selectedEntries);
  } catch (error) {
    setPresetImportStatus(`Unable to import presets: ${error.message}`);
    return;
  }

  clearPresetImportState();
  renderSettingsDraft();
  setPresetImportStatus(`Imported ${selectedEntries.length} preset${selectedEntries.length === 1 ? '' : 's'}. Save settings to keep the changes.`);
}

function selectCompressorPreset(select) {
  const settings = selectEquipmentPreset(state.settingsDraft, 'compressorPresets', select.value);
  if (!settings) return;
  state.settingsDraft = settings;
  renderSettingsDraft();
}

function selectBoosterPreset(select) {
  const settings = selectEquipmentPreset(state.settingsDraft, 'boosterPresets', select.value);
  if (!settings) return;
  state.settingsDraft = settings;
  renderSettingsDraft();
}

function updateSettingsDraft(input) {
  if (!state.settingsDraft) return;
  const collection = input.dataset.settingsCollection;
  const index = Number(input.dataset.settingsIndex);
  const field = input.dataset.settingsField;
  const value = collection === 'physics' || field === 'name' || field === 'material'
    ? input.value
    : Number.parseFloat(input.value);
  if (collection === 'physics') state.settingsDraft.physics[field] = value;
  else if (collection === 'cylinderPresets') state.settingsDraft.cylinderPresets[index][field] = value;
  else if (collection === 'booster') state.settingsDraft.booster[field] = value;
  else state.settingsDraft.gasPresets[index][field] = value;
}

function addGasPreset() {
  const names = new Set(state.settingsDraft.gasPresets.map(preset => normalizePresetName(preset.name)));
  let name = 'New gas';
  let suffix = 2;
  while (names.has(normalizePresetName(name))) name = `New gas ${suffix++}`;
  state.settingsDraft.gasPresets.push({ name, oxygenPercent: 21, heliumPercent: 0 });
  renderSettingsDraft();
  setSettingsCategory(state.settingsCategory);
}

function addCylinderPreset() {
  const names = new Set(state.settingsDraft.cylinderPresets.map(preset => normalizePresetName(preset.name)));
  let name = 'New cylinder';
  let suffix = 2;
  while (names.has(normalizePresetName(name))) name = `New cylinder ${suffix++}`;
  state.settingsDraft.cylinderPresets.push({
    name,
    volumeL: 12,
    material: 'steel',
    massKg: 14,
    workingPressureBar: 232
  });
  renderSettingsDraft();
  setSettingsCategory(state.settingsCategory);
}

function removeSettingsPreset(collection, index) {
  state.settingsDraft[collection].splice(index, 1);
  renderSettingsDraft();
  setSettingsCategory(state.settingsCategory);
}

function saveSettingsDraft() {
  const errors = validateSettings(state.settingsDraft);
  if (errors.length > 0) {
    displaySettingsErrors(errors);
    return;
  }

  const selectedCylinderName = byId('cylinder-preset')?.value || DEFAULT_CYLINDER_PRESET_NAME;
  try {
    saveSettings(state.settingsDraft, settingsStorage);
  } catch (error) {
    console.warn('Simplex blender settings were not saved.', error);
    displaySettingsErrors(['Settings were not saved. Check that browser storage is enabled and has space, then try again.']);
    return;
  }

  state.settings = copySettings(state.settingsDraft);
  state.settingsLoadFailure = null;
  updateStorageWarning();
  state.settingsDraft = null;
  byId('settings-dialog').close();
  refreshPresetOptions(selectedCylinderName);
  recalculate();
}

function applyCylinderGasPreset(select) {
  if (!select.value.startsWith('gas:')) return;
  const presetName = select.value.slice(4);
  const preset = state.settings.gasPresets.find(candidate => candidate.name === presetName);
  if (!preset) return;
  const prefix = select.dataset.mix === 'initial' ? 'init' : 'target';
  byId(`${prefix}-o2`).value = String(preset.oxygenPercent);
  byId(`${prefix}-he`).value = String(preset.heliumPercent);
  recalculate();
}

function selectCylinderPreset(select) {
  const preset = state.settings.cylinderPresets.find(candidate => candidate.name === select.value);
  updateCylinderRatingHint(preset);
  recalculate();
}

function handleGasShortcut(event) {
  if (event.key !== '/' || event.target.dataset.gasInput !== 'oxygen') return;
  event.preventDefault();
  const pairedInput = byId(event.target.dataset.gasPair);
  pairedInput.focus();
  pairedInput.select();
}

function handleGasPaste(event) {
  const input = event.target;
  if (input.dataset.gasInput !== 'oxygen') return;
  const text = event.clipboardData?.getData('text/plain') ?? '';
  const pair = splitGasInput(text);
  if (!pair) return;
  event.preventDefault();
  input.value = pair.oxygenText;
  const pairedInput = byId(input.dataset.gasPair);
  if (pair.heliumText) pairedInput.value = pair.heliumText;
  const prefix = input.dataset.mix === 'initial' ? 'init' : 'target';
  byId(`${prefix}-gas-preset`).value = 'custom';
  pairedInput.focus();
  recalculate();
}

function markGasPresetCustom(input) {
  if (!input.dataset.gasInput) return;
  const prefix = input.dataset.mix === 'initial' ? 'init' : 'target';
  byId(`${prefix}-gas-preset`).value = 'custom';
}

function handleSettingsClosed() {
  state.settingsSession += 1;
  state.settingsDraft = null;
  clearPresetImportState();
  clearPresetImport();
  clearSettingsErrors();
}


function updateWaitModeFields() {
  const isMinutesMode = byId('wait-mode').value === 'minutes';
  byId('wait-minutes-field').hidden = !isMinutesMode;
  byId('wait-target-temperature-field').hidden = isMinutesMode;
}


function readInput() {
  const cylinderPreset = selectedCylinderPreset();
  return {
    cylinder: {
      presetName: cylinderPreset.name,
      volumeL: cylinderPreset.volumeL,
      workingPressureBar: cylinderPreset.workingPressureBar,
      initialPressureBar: numberValue('init-p'),
      initialOxygenPercent: numberValue('init-o2'),
      initialHeliumPercent: numberValue('init-he'),
      targetPressureBar: numberValue('target-p'),
      targetOxygenPercent: numberValue('target-o2'),
      targetHeliumPercent: numberValue('target-he')
    },
    physics: {
      model: state.settings.physics.model,
      temperatureC: numberValue('ambient-temperature')
    },
    thermal: {
      tankMaterial: cylinderPreset.material,
      tankMassKg: cylinderPreset.massKg,
      coolingMedium: byId('cooling-medium').value,
      ambientTemperatureC: numberValue('ambient-temperature'),
      inletTemperatureC: numberValue('inlet-gas-temperature'),
      waitMode: byId('wait-mode').value,
      waitMinutes: numberValue('wait-minutes'),
      targetTemperatureC: numberValue('wait-target-temperature')
    },
    banks: state.banks
  };
}

function ternaryData() {
  if (!state.lastInput || !state.lastResult?.feasible) return null;
  const cylinder = state.lastInput.cylinder;
  return {
    banks: state.banks,
    initialMix: {
      oxygenPercent: cylinder.initialOxygenPercent,
      heliumPercent: cylinder.initialHeliumPercent,
      nitrogenPercent: Math.max(0, 100 - cylinder.initialOxygenPercent - cylinder.initialHeliumPercent)
    },
    targetMix: {
      oxygenPercent: cylinder.targetOxygenPercent,
      heliumPercent: cylinder.targetHeliumPercent,
      nitrogenPercent: Math.max(0, 100 - cylinder.targetOxygenPercent - cylinder.targetHeliumPercent)
    },
    trajectory: state.lastResult.trajectory
  };
}



function renderTernary() {
  const data = ternaryData();
  if (data) renderTernaryDiagram(byId('ternary-canvas'), data);
}

function invalidInputResult(errors) {
  return {
    feasible: false,
    error: `Invalid input: ${errors.join(' ')}`,
    gas: null,
    solution: null,
    tableauSteps: [],
    blend: null,
    protocolSteps: [],
    trajectory: [],
    maximumPressure: null,
    diagnostics: null
  };
}

function recalculate() {
  const input = { ...readInput(), settings: state.settings };
  const inputErrors = validateCalculatorInputs(input.cylinder, input.physics, input.thermal);
  const result = inputErrors.length > 0 ? invalidInputResult(inputErrors) : optimizeBlend(input);
  state.lastInput = input;
  state.lastResult = result;

  renderSupplyBanks(state.banks, state.settings.gasPresets);
  renderResults(result, input);
  renderThermalCharts(result, input);
  if (result.feasible) renderTernary();
  else clearTernaryDiagram(byId('ternary-canvas'));
}

function setTab(tabId) {
  if (!['recipe', 'ternary', 'thermal', 'summary', 'water-pressure'].includes(tabId)) return;
  state.activeTab = tabId;

  for (const paneName of ['recipe', 'ternary', 'thermal', 'summary', 'water-pressure']) {
    const pane = byId(`tab-pane-${paneName}`);
    const button = byId(`tab-btn-${paneName}`);
    if (!pane || !button) continue;

    const selected = paneName === tabId;
    pane.classList.toggle('hidden', !selected);
    button.className = selected
      ? 'px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-sm transition'
      : 'px-3.5 py-1.5 rounded-lg text-xs font-semibold text-slate-400 hover:text-slate-200 transition';
  }

  if (tabId === 'ternary') requestAnimationFrame(renderTernary);
}





function addBank() {
  const defaultGas = { oxygenPercent: 32, heliumPercent: 0 };
  state.banks.push({
    id: `bank-${Date.now()}`,
    name: 'New Mix',
    volumeL: 50,
    pressureBar: 200,
    oxygenPercent: defaultGas.oxygenPercent,
    heliumPercent: defaultGas.heliumPercent,
    enabled: true
  });
  persistSupplyBanks();
  recalculate();
}

function removeBank(bankId) {
  const index = state.banks.findIndex(bank => bank.id === bankId);
  if (index < 0) return;
  clearBankInputFailure(bankId);
  state.banks.splice(index, 1);
  persistSupplyBanks();
  recalculate();
}

function selectBankGasPreset(select) {
  const bank = state.banks.find(candidate => candidate.id === select.dataset.bankId);
  if (!bank) return;
  if (select.value === 'custom') {
    bank.gasPresetName = null;
    clearBankInputFailure(bank.id);
    persistSupplyBanks();
    return;
  }
  if (!select.value.startsWith('gas:')) {
    bank.gasPresetName = null;
    persistSupplyBanks();
    return;
  }
  const presetName = select.value.slice(4);
  const preset = state.settings.gasPresets.find(candidate => candidate.name === presetName);
  if (!preset) {
    bank.gasPresetName = null;
    persistSupplyBanks();
    return;
  }
  if (preset.oxygenPercent === 21 && preset.heliumPercent === 0) {
    select.value = 'custom';
    state.bankInputFailure = {
      bankId: bank.id,
      message: `${bank.name}: Air is supplied by the compressor and cannot be a finite supply bank.`
    };
    updateStorageWarning();
    return;
  }
  applyGasPresetToBank(bank, preset);
  bank.gasPresetName = preset.name;
  clearBankInputFailure(bank.id);
  persistSupplyBanks();
  recalculate();
}


function updateBankFromInput(input) {
  const bank = state.banks.find(candidate => candidate.id === input.dataset.bankId);
  if (!bank) return;

  const { bankField } = input.dataset;
  const updatedBank = { ...bank };
  if (bankField === 'name') {
    updatedBank.name = input.value;
  } else {
    const value = Number.parseFloat(input.value);
    if (!Number.isFinite(value)) {
      input.value = String(bank[bankField]);
      clearBankInputFailure(bank.id);
      return;
    }
    updatedBank[bankField] = value;
    if (bankField === 'oxygenPercent' || bankField === 'heliumPercent') updatedBank.gasPresetName = null;
  }

  if (updatedBank.oxygenPercent === 21 && updatedBank.heliumPercent === 0) {
    input.value = String(bank[bankField]);
    state.bankInputFailure = {
      bankId: bank.id,
      message: `${bank.name}: Air is supplied by the compressor and cannot be a finite supply bank.`
    };
    updateStorageWarning();
    return;
  }

  const errors = validateSupplyBankInput(updatedBank);
  if (errors.length > 0) {
    input.value = String(bank[bankField]);
    state.bankInputFailure = { bankId: bank.id, message: `${bank.name}: ${errors[0]}` };
    updateStorageWarning();
    return;
  }
  clearBankInputFailure(bank.id);
  Object.assign(bank, updatedBank);
  persistSupplyBanks();
  recalculate();
}

function handleInputOrChange(event) {
  const target = event.target;
  if (event.type === 'change' && target.id === 'settings-preset-file') {
    void loadPresetFile(target);
    return;
  }
  if (event.type === 'change' && target.dataset.presetImportIndex !== undefined) {
    const index = Number(target.dataset.presetImportIndex);
    if (!target.disabled && target.checked) state.presetImportSelectedIndexes.add(index);
    else state.presetImportSelectedIndexes.delete(index);
    return;
  }
  if ((event.type === 'input' || event.type === 'change') && target.dataset.settingsCollection) {
    updateSettingsDraft(target);
    return;
  }

  if (event.type === 'change' && target.dataset.action === 'select-compressor-preset') {
    selectCompressorPreset(target);
    return;
  }
  if (event.type === 'change' && target.dataset.action === 'select-booster-preset') {
    selectBoosterPreset(target);
    return;
  }
  if (event.type === 'change' && target.dataset.action === 'select-cylinder-gas') {
    applyCylinderGasPreset(target);
    return;
  }
  if (event.type === 'change' && target.dataset.action === 'select-cylinder-preset') {
    selectCylinderPreset(target);
    return;
  }

  if (target.dataset.recalculate === event.type) {
    markGasPresetCustom(target);
    if (target.id === 'wait-mode') updateWaitModeFields();
    recalculate();
    return;
  }

  if (event.type !== 'change') return;
  if (target.dataset.action === 'select-bank-gas') {
    selectBankGasPreset(target);
    return;
  }
  if (target.dataset.action === 'toggle-bank') {
    const bank = state.banks.find(candidate => candidate.id === target.dataset.bankId);
    if (bank) {
      bank.enabled = target.checked;
      persistSupplyBanks();
      recalculate();
    }
    return;
  }
  if (target.matches('[data-bank-field]')) updateBankFromInput(target);
}

function handleClick(event) {
  const actionElement = event.target.closest('[data-action]');
  if (!actionElement || actionElement.disabled) return;

  switch (actionElement.dataset.action) {
    case 'add-bank':
      addBank();
      break;
    case 'remove-bank':
      removeBank(actionElement.dataset.bankId);
      break;
    case 'open-settings':
      openSettings();
      break;
    case 'toggle-theme':
      toggleTheme();
      break;
    case 'cancel-settings':
      byId('settings-dialog').close();
      break;
    case 'select-settings-category':
      setSettingsCategory(actionElement.dataset.settingsCategory);
      break;
    case 'add-gas-preset':
      addGasPreset();
      break;
    case 'remove-gas-preset':
      removeSettingsPreset('gasPresets', Number(actionElement.dataset.settingsIndex));
      break;
    case 'add-cylinder-preset':
      addCylinderPreset();
      break;
    case 'remove-cylinder-preset':
      removeSettingsPreset('cylinderPresets', Number(actionElement.dataset.settingsIndex));
      break;
    case 'load-preset-url':
      void loadPresetUrl();
      break;
    case 'import-selected-presets':
      importSelectedPresets();
      break;
    case 'save-settings':
      saveSettingsDraft();
      break;
    case 'select-tab':
      setTab(actionElement.dataset.tab);
      break;
  }
}

function initialize() {
  document.addEventListener('input', handleInputOrChange);
  document.addEventListener('change', handleInputOrChange);
  document.addEventListener('click', handleClick);
  document.addEventListener('keydown', handleGasShortcut);
  document.addEventListener('paste', handleGasPaste);
  byId('settings-dialog').addEventListener('close', handleSettingsClosed);
  applyTheme(state.theme);
  updateStorageWarning();
  refreshPresetOptions();
  updateWaitModeFields();
  observeTernaryCanvas(byId('ternary-canvas'), renderTernary);
  recalculate();
}


initialize();
