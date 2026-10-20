import { calculatorInputSignature, signatureAfterClearingMeasurement } from './interim-measurements.js';
import { optimizeBlend } from './optimizer.js';
import { parseNumericInput, splitGasInput } from './gas-input.js';
import { validateCalculatorInputs, validateSupplyBankInput } from './input-validation.js';
import {
  addEquipmentPresetToDraft,
  applyGasPresetToBank,
  copySettings,
  loadSettings,
  normalizePresetName,
  saveSettings,
  selectEquipmentPreset,
  validateSettings
} from './settings.js';
import { convertFromDisplay, convertToDisplay, formatInputValue, METRIC_UNITS, unitLabel } from './units.js';
import { resetApplicationState } from './factory-reset.js';
import { analyzePresetSource, mergeSelectedPresets, PRESET_IMPORT_DEFAULT_URLS } from './preset-import.js';
import { loadSupplyBanks, saveSupplyBanks } from './bank-storage.js';
import { loadTheme, saveTheme } from './theme.js';
import { setPrimaryScreen } from './navigation.js';
import { RESULT_TABS, setResultTab } from './result-tabs.js';
import { loadOnboardingState } from './onboarding.js';
import { loadAnalytics } from './analytics.js';
import { createOnboardingController } from './ui/onboarding.js';
import { renderResults } from './ui/results.js';
import { renderSettingsDialog, renderPresetOptions } from './ui/settings-dialog.js';
import { renderEquipmentSummary } from './ui/equipment-summary.js';
import { renderSupplyBanks } from './ui/supply-banks.js';
import { renderStorageWarning } from './ui/storage-warning.js';
import { renderThermalCharts } from './ui/thermal-charts.js';
import { changeTernaryZoom, clearTernaryDiagram, observeTernaryCanvas, renderTernaryDiagram } from './ui/ternary.js';

const settingsStorage = {
  getItem: key => window.localStorage.getItem(key),
  setItem: (key, value) => window.localStorage.setItem(key, value),
  clear: () => window.localStorage.clear()
};

let settingsLoadFailure = null;
const initialSettings = loadSettings(settingsStorage, error => {
  settingsLoadFailure = error;
});

let banksLoadFailure = null;
const initialBanks = loadSupplyBanks(settingsStorage, error => {
  banksLoadFailure = error;
});


function createPresetImportState(category = 'gas') {
  return {
    category,
    url: PRESET_IMPORT_DEFAULT_URLS[category],
    urlTouched: false,
    candidates: [],
    selectedIds: [],
    status: '',
    error: false,
    loading: false,
    requestId: 0
  };
}

function resetPresetImportState(category = 'gas') {
  state.settingsImport = createPresetImportState(category);
}

const state = {
  banks: initialBanks,
  settings: initialSettings,
  settingsDraft: null,
  settingsSession: 0,
  settingsCategory: 'general',
  settingsImport: createPresetImportState(),
  settingsReturnScreen: 'blending',
  theme: loadTheme(settingsStorage),
  onboarding: null,
  onboardingController: null,
  onboardingLoadFailure: null,
  settingsLoadFailure,
  banksLoadFailure,
  bankSaveFailure: null,
  bankInputFailure: null,
  activeScreen: 'blending',
  activeTab: 'recipe',
  interimMeasurements: [],
  interimMeasurementSignature: null,
  lastInput: null,
  lastResult: null
};
let onboardingSettingsOpen = false;



const DEFAULT_CYLINDER_PRESET_NAME = 'Catalina S80';

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
const canonicalNumberValue = (id, quantity) => convertFromDisplay(numberValue(id), quantity, state.settings.units);

function convertDisplayedInputs(fromUnits, toUnits) {
  for (const [id, quantity] of [
    ['init-p', 'pressureBar'],
    ['target-p', 'pressureBar'],
    ['ambient-temperature', 'temperatureC'],
    ['inlet-gas-temperature', 'temperatureC'],
    ['wait-target-temperature', 'temperatureC']
  ]) {
    const input = byId(id);
    if (!input) continue;
    const canonical = convertFromDisplay(Number.parseFloat(input.value), quantity, fromUnits);
    input.value = quantity === 'pressureBar'
      ? formatInputValue(canonical, quantity, toUnits)
      : String(convertToDisplay(canonical, quantity, toUnits));
  }

  const pressureStep = toUnits === 'imperial' ? '0.1' : '1';
  for (const [id, minimumBar] of [['init-p', 0], ['target-p', 10]]) {
    const input = byId(id);
    if (!input) continue;
    input.min = formatInputValue(minimumBar, 'pressureBar', toUnits);
    input.max = formatInputValue(350, 'pressureBar', toUnits);
    input.step = pressureStep;
  }
}
state.onboarding = loadOnboardingState(settingsStorage, error => {
  state.onboardingLoadFailure = error;
});
state.onboardingController = createOnboardingController({
  document,
  storage: settingsStorage,
  onNavigate: destination => {
    const settingsCategory = destination?.settingsCategory ?? null;
    const screen = destination?.screen ?? 'blending';
    if (settingsCategory) {
      openSettings();
      setSettingsCategory(settingsCategory);
    } else {
      selectScreen(screen);
    }
    setTab(destination?.tab ?? 'recipe');
  },
  onConsentAccepted: onboarding => {
    state.onboarding = onboarding;
    state.onboardingLoadFailure = null;
    updateStorageWarning();
    loadAnalytics(document, window);
  },
  launchButton: byId('wizard-launch')
});



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
  const categories = ['general', 'units', 'gas-presets', 'cylinder-presets', 'equipment', 'preset-management'];
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
  document.querySelector(`[data-settings-category="${category}"]`)
    ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

function openSettings() {
  if (state.activeScreen !== 'settings') state.settingsReturnScreen = state.activeScreen;
  state.settingsSession += 1;
  state.settingsDraft = copySettings(state.settings);
  resetPresetImportState();
  renderSettingsDraft();
  setSettingsCategory(state.settingsCategory);
  clearSettingsErrors();
  if (state.settingsLoadFailure) {
    displaySettingsErrors(['Saved presets could not be loaded; built-in defaults are in use. Saving will replace the unreadable saved presets.']);
  }
  setPrimaryScreen(document, 'settings');
  state.activeScreen = 'settings';
}

function isActiveSettingsSession(session) {
  return session === state.settingsSession && state.settingsDraft !== null;
}

function renderSettingsDraft() {
  renderSettingsDialog(state.settingsDraft, state.settingsImport);
}

function presetImportStatus(message, error = false) {
  state.settingsImport = { ...state.settingsImport, status: message, error, loading: false };
  renderSettingsDraft();
  setSettingsCategory('preset-management');
}

function previewPresetImport(source) {
  const { category } = state.settingsImport;
  const analysis = analyzePresetSource(category, source, state.settings);
  const newCandidates = analysis.candidates.filter(candidate => candidate.status === 'new');
  const duplicateCount = analysis.candidates.filter(candidate => candidate.status === 'duplicate').length;
  const invalidCount = analysis.candidates.filter(candidate => candidate.status === 'invalid').length;
  const summary = [
    `Loaded ${analysis.candidates.length} entries.`,
    `${newCandidates.length} new`,
    `${duplicateCount} already present`,
    `${invalidCount} rejected`
  ].join(' ');
  state.settingsImport = {
    ...state.settingsImport,
    candidates: analysis.candidates,
    selectedIds: newCandidates.map(candidate => candidate.id),
    status: analysis.errors.length > 0 ? `${summary} ${analysis.errors.join(' ')}` : summary,
    error: analysis.errors.length > 0,
    loading: false
  };
  renderSettingsDraft();
  setSettingsCategory('preset-management');
}

async function loadPresetText(readText, sourceLabel) {
  const session = state.settingsSession;
  const requestId = state.settingsImport.requestId + 1;
  const isCurrentRequest = () => isActiveSettingsSession(session)
    && state.settingsImport.requestId === requestId;
  state.settingsImport = {
    ...state.settingsImport,
    requestId,
    candidates: [],
    selectedIds: [],
    status: `Loading ${sourceLabel}…`,
    error: false,
    loading: true
  };
  renderSettingsDraft();
  setSettingsCategory('preset-management');
  try {
    const text = await readText();
    if (!isCurrentRequest()) return;
    let source;
    try {
      source = JSON.parse(text);
    } catch {
      throw new SyntaxError('The selected preset file is not valid JSON.');
    }
    if (!isCurrentRequest()) return;
    previewPresetImport(source);
  } catch (error) {
    if (!isCurrentRequest()) return;
    presetImportStatus(`Could not load ${sourceLabel}: ${error.message}`, true);
  }
}

function loadPresetFile(input) {
  const file = input.files?.[0];
  if (!file) return;
  loadPresetText(() => file.text(), file.name);
}

function loadPresetUrl() {
  const input = byId('settings-preset-import-url');
  const url = input.value.trim();
  state.settingsImport = { ...state.settingsImport, url };
  if (!url) {
    presetImportStatus('Enter an online JSON URL before loading.');
    return;
  }
  loadPresetText(async () => {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`The server returned HTTP ${response.status}.`);
    return response.text();
  }, url);
}

function selectPresetImportCategory(select) {
  const category = select.value;
  if (!Object.hasOwn(PRESET_IMPORT_DEFAULT_URLS, category)) return;
  const url = state.settingsImport.urlTouched
    ? state.settingsImport.url
    : PRESET_IMPORT_DEFAULT_URLS[category];
  state.settingsImport = {
    ...state.settingsImport,
    category,
    url,
    candidates: [],
    selectedIds: [],
    status: '',
    error: false,
    loading: false,
    requestId: state.settingsImport.requestId + 1
  };
  renderSettingsDraft();
  setSettingsCategory('preset-management');
}

function togglePresetImport(checkbox) {
  const candidate = state.settingsImport.candidates.find(item => item.id === checkbox.dataset.presetImportId);
  if (!candidate?.selectable) return;
  const selectedIds = new Set(state.settingsImport.selectedIds);
  if (checkbox.checked) selectedIds.add(candidate.id);
  else selectedIds.delete(candidate.id);
  state.settingsImport = { ...state.settingsImport, selectedIds: [...selectedIds] };
  renderSettingsDraft();
  setSettingsCategory('preset-management');
}

function importSelectedPresets() {
  const selectedIds = state.settingsImport.selectedIds;
  if (selectedIds.length === 0) return;
  const baseSettings = state.settings;
  let merged;
  try {
    merged = mergeSelectedPresets(baseSettings, state.settingsImport.candidates, selectedIds);
    saveSettings(merged, settingsStorage);
  } catch (error) {
    presetImportStatus(`Presets were not imported: ${error.message}`, true);
    return;
  }
  state.settings = copySettings(merged);
  state.settingsDraft = copySettings(merged);
  state.settingsLoadFailure = null;
  state.settingsImport = {
    ...state.settingsImport,
    candidates: [],
    selectedIds: [],
    status: `Imported ${selectedIds.length} preset${selectedIds.length === 1 ? '' : 's'}.`,
    error: false,
    loading: false
  };
  updateStorageWarning();
  refreshPresetOptions();
  renderSettingsDraft();
  setSettingsCategory('preset-management');
  recalculate();
}

function resetFactorySettings() {
  let didReset;
  try {
    didReset = resetApplicationState(
      state,
      settingsStorage,
      () => window.confirm('Reset all saved app data to factory settings? This cannot be undone.')
    );
  } catch (error) {
    displaySettingsErrors(['Factory reset failed. Saved data was not changed. Check that browser storage is enabled and try again.']);
    return;
  }
  if (!didReset) return;

  state.settingsSession += 1;
  state.onboardingController.reset(state.onboarding);
  state.settingsDraft = copySettings(state.settings);
  state.settingsLoadFailure = null;
  state.banksLoadFailure = null;
  state.bankSaveFailure = null;
  state.bankInputFailure = null;
  state.onboardingLoadFailure = null;
  state.settingsImport = {
    ...createPresetImportState(),
    status: 'Factory settings restored.',
    error: false
  };
  applyTheme(state.theme);
  clearSettingsErrors();
  updateStorageWarning();
  refreshPresetOptions();
  renderSettingsDraft();
  setSettingsCategory('preset-management');
  recalculate();
  state.onboardingController.open();
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
  const value = collection === 'physics' || collection === 'general' || collection === 'units' || field === 'name' || field === 'material'
    ? input.value
    : Number.parseFloat(input.value);
  if (collection === 'physics') state.settingsDraft.physics[field] = value;
  else if (collection === 'general' || collection === 'units') state.settingsDraft.units = value;
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

function addCompressorPreset() {
  addEquipmentPresetToDraft(state.settingsDraft, 'compressorPresets', 'New compressor');
  renderSettingsDraft();
  setSettingsCategory('equipment');
}

function addBoosterPreset() {
  addEquipmentPresetToDraft(state.settingsDraft, 'boosterPresets', 'New booster');
  renderSettingsDraft();
  setSettingsCategory('equipment');
}

function removeSettingsPreset(collection, index) {
  const presets = state.settingsDraft?.[collection];
  if (!Array.isArray(presets) || presets.length <= 1 || !Number.isInteger(index)
    || index < 0 || index >= presets.length) return;
  presets.splice(index, 1);
  renderSettingsDraft();
  setSettingsCategory(state.settingsCategory);
}

function removeSelectedEquipmentPreset(collection, selectId) {
  const selectedName = byId(selectId)?.value;
  const index = state.settingsDraft?.[collection]?.findIndex(preset => preset.name === selectedName);
  removeSettingsPreset(collection, index);
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

  const previousUnits = state.settings.units;
  state.settings = copySettings(state.settingsDraft);
  convertDisplayedInputs(previousUnits, state.settings.units);
  updateStorageWarning();
  state.settingsDraft = null;
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

function cancelSettings() {
  state.settingsSession += 1;
  state.settingsDraft = null;
  clearSettingsErrors();
  selectScreen(state.settingsReturnScreen);
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
      initialPressureBar: canonicalNumberValue('init-p', 'pressureBar'),
      initialOxygenPercent: numberValue('init-o2'),
      initialHeliumPercent: numberValue('init-he'),
      targetPressureBar: canonicalNumberValue('target-p', 'pressureBar'),
      targetOxygenPercent: numberValue('target-o2'),
      targetHeliumPercent: numberValue('target-he')
    },
    physics: {
      model: state.settings.physics.model,
      temperatureC: canonicalNumberValue('ambient-temperature', 'temperatureC')
    },
    thermal: {
      tankMaterial: cylinderPreset.material,
      tankMassKg: cylinderPreset.massKg,
      coolingMedium: byId('cooling-medium').value,
      ambientTemperatureC: canonicalNumberValue('ambient-temperature', 'temperatureC'),
      inletTemperatureC: canonicalNumberValue('inlet-gas-temperature', 'temperatureC'),
      waitMode: byId('wait-mode').value,
      waitMinutes: numberValue('wait-minutes'),
      targetTemperatureC: canonicalNumberValue('wait-target-temperature', 'temperatureC'),
      interimMeasurements: state.interimMeasurements
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
  let input = { ...readInput(), settings: state.settings };
  const recipeSignature = calculatorInputSignature(input);
  if (state.interimMeasurements.some(Boolean)
    && state.interimMeasurementSignature !== recipeSignature) {
    state.interimMeasurements = [];
    state.interimMeasurementSignature = null;
    input = { ...readInput(), settings: state.settings };
  }
  const inputErrors = validateCalculatorInputs(input.cylinder, input.physics, input.thermal);
  const result = inputErrors.length > 0 ? invalidInputResult(inputErrors) : optimizeBlend(input);
  state.lastInput = input;
  state.lastResult = result;

  renderSupplyBanks(state.banks, state.settings.gasPresets, state.settings.units);
  renderEquipmentSummary(state.settings, state.settings.units);
  renderResults(result, input);
  renderThermalCharts(result, input);
  if (result.feasible) renderTernary();
  else clearTernaryDiagram(byId('ternary-canvas'));
}

function selectScreen(screenId) {
  if (screenId === 'settings' && state.settingsDraft === null) {
    openSettings();
    return;
  }
  if (!setPrimaryScreen(document, screenId)) return;
  state.activeScreen = screenId;
}

function setTab(tabId, focus = false) {
  if (!setResultTab(document, tabId)) return;
  state.activeTab = tabId;
  if (focus) byId(`tab-btn-${tabId}`)?.focus();
  if (tabId === 'ternary') requestAnimationFrame(renderTernary);
}

function handleResultTabKeydown(event) {
  const button = event.target.closest?.('[role="tab"]');
  if (!button) return;
  const currentIndex = RESULT_TABS.indexOf(button.dataset.tab);
  if (currentIndex < 0) return;
  let nextIndex = currentIndex;
  if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % RESULT_TABS.length;
  else if (event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + RESULT_TABS.length) % RESULT_TABS.length;
  else if (event.key === 'Home') nextIndex = 0;
  else if (event.key === 'End') nextIndex = RESULT_TABS.length - 1;
  else return;
  event.preventDefault();
  setTab(RESULT_TABS[nextIndex], true);
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
    const quantity = bankField === 'volumeL' ? 'volumeL' : bankField === 'pressureBar' ? 'pressureBar' : null;
    updatedBank[bankField] = quantity
      ? convertFromDisplay(value, quantity, state.settings.units)
      : value;
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
  if (event.type === 'input' && target.dataset.settingsPresetImportUrl !== undefined) {
    state.settingsImport = { ...state.settingsImport, url: target.value, urlTouched: true };
    return;
  }
  if (event.type === 'change' && target.dataset.action === 'select-preset-import-category') {
    selectPresetImportCategory(target);
    return;
  }
  if (event.type === 'change' && target.dataset.action === 'load-preset-file') {
    loadPresetFile(target);
    return;
  }
  if (event.type === 'change' && target.dataset.action === 'toggle-preset-import') {
    togglePresetImport(target);
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

function applyInterimMeasurement(actionElement) {
  const index = Number(actionElement.dataset.measurementIndex);
  const form = actionElement.closest('form');
  if (!Number.isInteger(index) || !form) return;
  if (typeof form.reportValidity === 'function' && !form.reportValidity()) return;

  const pressureInput = form.querySelector('[name="pressureBar"]');
  const temperatureInput = form.querySelector('[name="temperatureC"]');
  const interimMeasurements = state.interimMeasurements.slice();
  interimMeasurements[index] = {
    pressureBar: Number(pressureInput.value),
    temperatureC: Number(temperatureInput.value)
  };
  state.interimMeasurementSignature = calculatorInputSignature({
    ...readInput(),
    settings: state.settings
  });
  state.interimMeasurements = interimMeasurements;
  recalculate();
}

function clearInterimMeasurement(actionElement) {
  const index = Number(actionElement.dataset.measurementIndex);
  if (!Number.isInteger(index)) return;
  const interimMeasurements = state.interimMeasurements.slice();
  interimMeasurements[index] = null;
  state.interimMeasurements = interimMeasurements;
  state.interimMeasurementSignature = signatureAfterClearingMeasurement({
    ...readInput(),
    settings: state.settings
  }, index);
  recalculate();
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
    case 'select-screen':
      selectScreen(actionElement.dataset.screen);
      break;
    case 'open-wizard':
      state.onboardingController.open();
      break;
    case 'toggle-theme':
      toggleTheme();
      break;
    case 'cancel-settings':
      cancelSettings();
      break;
    case 'select-settings-category':
      setSettingsCategory(actionElement.dataset.settingsCategory);
      break;
    case 'load-preset-url':
      loadPresetUrl();
      break;
    case 'import-selected-presets':
      importSelectedPresets();
      break;
    case 'reset-factory-settings':
      resetFactorySettings();
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
    case 'add-compressor-preset':
      addCompressorPreset();
      break;
    case 'remove-compressor-preset':
      removeSelectedEquipmentPreset('compressorPresets', 'settings-compressor-preset');
      break;
    case 'add-booster-preset':
      addBoosterPreset();
      break;
    case 'remove-booster-preset':
      removeSelectedEquipmentPreset('boosterPresets', 'settings-booster-preset');
      break;
    case 'remove-cylinder-preset':
      removeSettingsPreset('cylinderPresets', Number(actionElement.dataset.settingsIndex));
      break;
    case 'save-settings':
      saveSettingsDraft();
      break;
    case 'apply-interim-measurement':
      applyInterimMeasurement(actionElement);
      break;
    case 'clear-interim-measurement':
      clearInterimMeasurement(actionElement);
      break;
    case 'select-tab':
      setTab(actionElement.dataset.tab);
      break;
    case 'ternary-zoom-in':
      changeTernaryZoom(byId('ternary-canvas'), renderTernary, 1);
      break;
    case 'ternary-zoom-out':
      changeTernaryZoom(byId('ternary-canvas'), renderTernary, -1);
      break;
    case 'ternary-zoom-reset':
      changeTernaryZoom(byId('ternary-canvas'), renderTernary, 0);
      break;
  }
}

function initialize() {
  document.addEventListener('input', handleInputOrChange);
  document.addEventListener('change', handleInputOrChange);
  document.addEventListener('click', handleClick);
  document.addEventListener('keydown', handleGasShortcut);
  document.addEventListener('keydown', handleResultTabKeydown);
  document.addEventListener('paste', handleGasPaste);
  applyTheme(state.theme);
  convertDisplayedInputs(METRIC_UNITS, state.settings.units);
  setPrimaryScreen(document, state.activeScreen);
  updateStorageWarning();
  refreshPresetOptions();
  updateWaitModeFields();
  observeTernaryCanvas(byId('ternary-canvas'), renderTernary);
  recalculate();
  if (!state.onboarding.consentAccepted) {
    state.onboardingController.open({ requireConsent: true });
  } else {
    loadAnalytics(document, window);
    if (!state.onboarding.wizardSeen) state.onboardingController.open();
  }
}


initialize();
