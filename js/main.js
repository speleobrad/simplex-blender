import { calculatorInputSignature, signatureAfterClearingMeasurement } from './interim-measurements.js';
import { optimizeBlend } from './optimizer.js';
import { isValidGasComposition, parseNumericInput, splitGasInput } from './gas-input.js';
import { validateCalculatorInputs, validateSupplyBankInput } from './input-validation.js';
import { DEFAULT_HOT_OVERFILL_PERCENT } from './preset-validation.js';
import { buildCompareProtocol, createCompareRow, normalizeComparePressureFields, validateCompareRecipe } from './compare-recipe.js';
import { simulateCompareProtocol } from './thermodynamics.js';
import { calcMolarDensity } from './physics.js';
import {
  collectCylinderPressureWarnings,
  collectThermalPressureWarningObservations,
  pressureWarningStepIdentifier
} from './pressure-limits.js';
import {
  addEquipmentPresetToDraft,
  applyGasPresetToBank,
  copySettings,
  loadSettings,
  matchesPressureWarningUnlockPhrase,
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
import { renderCompareRecipe } from './ui/compare-recipe.js';
import { renderPressureLimitWarnings, renderResults } from './ui/results.js';
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
  lastResult: null,
  mode: 'optimize',
  compareRows: [createCompareRow('drain', 'compare-row-1')],
  compareErrors: [],
  lastCompareInput: null,
  lastCompareResult: null,
  compareHasRun: false
};
let nextCompareRowNumber = 2;
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
    ['target-temperature', 'temperatureC'],
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
  for (const [id, label] of [['init-p', 'Start pressure'], ['target-p', 'Target pressure']]) {
    const input = byId(id);
    if (input) input.setAttribute('aria-label', `${label} in ${unitLabel('pressureBar', toUnits)}`);
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
  const categories = ['general', 'gas-presets', 'cylinder-presets', 'equipment', 'preset-management'];
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

function clearPressureWarningConfirmation() {
  const confirmation = byId('settings-pressure-limit-confirmation');
  if (confirmation) confirmation.value = '';
}

function openSettings() {
  if (state.activeScreen !== 'settings') state.settingsReturnScreen = state.activeScreen;
  state.settingsSession += 1;
  state.settingsDraft = copySettings(state.settings);
  clearPressureWarningConfirmation();
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
  clearPressureWarningConfirmation();
  invalidateCompareResult();

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
function selectInventoryEquipmentPreset(select, collection) {
  const settings = selectEquipmentPreset(state.settings, collection, select.value);
  if (!settings) return;
  try {
    saveSettings(settings, settingsStorage);
  } catch (error) {
    console.warn('Inventory equipment selection was not saved.', error);
    return;
  }
  state.settings = settings;
  state.settingsLoadFailure = null;
  refreshPresetOptions();
  recalculate();
}

function updateSettingsDraft(input) {
  if (!state.settingsDraft) return;
  const collection = input.dataset.settingsCollection;
  const index = Number(input.dataset.settingsIndex);
  const field = input.dataset.settingsField;
  const quantity = { volumeL: 'volumeL', massKg: 'massKg', workingPressureBar: 'pressureBar' }[field];
  const value = collection === 'physics' || collection === 'general' || collection === 'units' || field === 'name' || field === 'material'
    ? input.value
    : quantity
      ? convertFromDisplay(Number.parseFloat(input.value), quantity, state.settingsDraft.units)
      : Number.parseFloat(input.value);
  if (collection === 'physics') state.settingsDraft.physics[field] = value;
  else if (field === 'pressureLimitMode') {
    state.settingsDraft.pressureLimitMode = value;
    byId('settings-pressure-warning-notice')?.classList.toggle('hidden', value !== 'warning');
  }
  else if (collection === 'units') state.settingsDraft.units = value;
  else if (collection === 'cylinderPresets') state.settingsDraft.cylinderPresets[index][field] = value;
  else if (collection === 'booster') state.settingsDraft.booster[field] = value;
  else state.settingsDraft.gasPresets[index][field] = value;
}

function unlockPressureWarning() {
  if (!state.settingsDraft || state.settingsDraft.pressureWarningUnlocked === true) return;
  const confirmation = byId('settings-pressure-limit-confirmation');
  if (!matchesPressureWarningUnlockPhrase(confirmation?.value)) return;
  state.settingsDraft.pressureWarningUnlocked = true;
  clearPressureWarningConfirmation();
  renderSettingsDraft();
  setSettingsCategory('general');
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
    workingPressureBar: 232,
    hotOverfillPercent: DEFAULT_HOT_OVERFILL_PERCENT
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
  clearPressureWarningConfirmation();
  const pressureLimitModeChanged = state.settings.pressureLimitMode !== state.settingsDraft.pressureLimitMode;

  const previousUnits = state.settings.units;
  state.settings = copySettings(state.settingsDraft);
  if (pressureLimitModeChanged) invalidateCompareResult();
  convertDisplayedInputs(previousUnits, state.settings.units);
  updateStorageWarning();
  state.settingsDraft = null;
  refreshPresetOptions(selectedCylinderName);
  recalculate();
  selectScreen(state.settingsReturnScreen);
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
  clearPressureWarningConfirmation();
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
      hotOverfillPercent: cylinderPreset.hotOverfillPercent,
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
      targetInWaterTemperatureC: canonicalNumberValue('target-temperature', 'temperatureC'),
      targetMediumTemperatureC: canonicalNumberValue('wait-target-temperature', 'temperatureC'),
      inletTemperatureC: canonicalNumberValue('inlet-gas-temperature', 'temperatureC'),
      waitMode: byId('wait-mode').value,
      waitMinutes: numberValue('wait-minutes'),
      interimMeasurements: state.interimMeasurements,
      targetTemperatureC: canonicalNumberValue('wait-target-temperature', 'temperatureC'),
    },
    banks: state.banks
  };
}

function compareInput() {
  const input = readInput();
  const { targetPressureBar, targetOxygenPercent, targetHeliumPercent, ...cylinder } = input.cylinder;
  return { ...input, cylinder, settings: state.settings };
}

function compareSharedInputErrors(input) {
  const targetPressureBar = Math.max(10, input.cylinder.initialPressureBar);
  const errors = validateCalculatorInputs(
    { ...input.cylinder, targetPressureBar },
    input.physics,
    input.thermal,
    { pressureLimitMode: state.settings.pressureLimitMode }
  );
  if (!isValidGasComposition(input.cylinder.initialOxygenPercent, input.cylinder.initialHeliumPercent)) {
    errors.push('Initial oxygen and helium percentages must total no more than 100%.');
  }
  if (!['ideal', 'vdw'].includes(input.physics.model)) {
    errors.push('Physics model must be ideal or vdw.');
  }
  return errors;
}

function compareWaitStates(input = compareInput()) {
  const waitStates = {};
  for (let index = 0; index < state.compareRows.length; index += 1) {
    const row = state.compareRows[index];
    if (row.type !== 'wait') continue;
    try {
      const protocol = buildCompareProtocol(state.compareRows.slice(0, index + 1), {
        cylinder: input.cylinder,
        physics: input.physics,
        banks: input.banks,
        settings: input.settings,
        waitStates
      });
      const simulation = simulateCompareProtocol({
        protocolSteps: protocol.protocolSteps,
        cylinder: input.cylinder,
        physics: input.physics,
        thermal: input.thermal,
        settings: input.settings
      });
      const recipeEnd = simulation.final.recipeEnd;
      const totalMoles = calcMolarDensity(
        recipeEnd.pressureBar,
        recipeEnd.oxygenPercent,
        recipeEnd.heliumPercent,
        recipeEnd.temperatureC,
        input.physics.model === 'vdw'
      ) * input.cylinder.volumeL;
      waitStates[row.id] = {
        pressureBar: recipeEnd.pressureBar,
        temperatureC: recipeEnd.temperatureC,
        oxygenPercent: recipeEnd.oxygenPercent,
        heliumPercent: recipeEnd.heliumPercent,
        totalMoles,
        oxygenMoles: totalMoles * (recipeEnd.oxygenPercent / 100),
        heliumMoles: totalMoles * (recipeEnd.heliumPercent / 100),
        mix: {
          oxygenPercent: recipeEnd.oxygenPercent,
          heliumPercent: recipeEnd.heliumPercent
        }
      };
    } catch {
      // Validation presents the underlying draft error; omit an unavailable modeled state.
    }
  }
  return waitStates;
}

function comparePressureStarts(input = compareInput()) {
  const starts = {};
  const waitStates = compareWaitStates(input);
  let currentPressure = input.cylinder.initialPressureBar;
  for (const row of state.compareRows) {
    if (row.type === 'add') {
      starts[row.id] = currentPressure;
      const normalized = normalizeComparePressureFields(row, currentPressure);
      if (Number.isFinite(normalized.targetPressureBar)) currentPressure = normalized.targetPressureBar;
    } else if (row.type === 'wait' && Number.isFinite(waitStates[row.id]?.pressureBar)) {
      currentPressure = waitStates[row.id].pressureBar;
    }
  }
  return starts;
}

function renderCompareEditor() {
  renderCompareRecipe(byId('compare-recipe-editor'), {
    rows: state.compareRows,
    banks: state.banks,
    errors: state.compareErrors,
    pressureStarts: comparePressureStarts(),
    units: state.settings.units
  });
}

function renderCompareErrors() {
  const container = byId('compare-recipe-errors');
  container.replaceChildren(...state.compareErrors
    .filter(({ rowId }) => rowId === null)
    .map(({ message }) => {
      const line = document.createElement('p');
      line.className = 'text-xs text-rose-300';
      line.textContent = message;
      return line;
    }));
}

function updateCompareStatus(message = '') {
  byId('compare-run-status').textContent = message;
}

function invalidateCompareResult() {
  state.lastCompareInput = null;
  state.lastCompareResult = null;
  state.compareErrors = [];
  state.compareHasRun = false;
  updateCompareStatus();
}

function ternaryData() {
  if (state.activeScreen === 'what-if' || state.mode === 'compare') {
    const compare = state.lastCompareResult?.compare;
    if (!compare || !state.lastCompareInput) return null;
    const finalMix = compare.final.recipeEnd;
    return {
      mode: 'compare',
      banks: [],
      initialMix: compare.initialMix,
      targetMix: {
        oxygenPercent: finalMix.oxygenPercent,
        heliumPercent: finalMix.heliumPercent,
        nitrogenPercent: Math.max(0, 100 - finalMix.oxygenPercent - finalMix.heliumPercent)
      },
      trajectory: compare.trajectory
    };
  }
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
  if (data) {
    renderTernaryDiagram(byId('ternary-canvas'), data);
  }
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

function addPressureWarningObservation(observations, pressureBar, {
  source,
  stepIdentifier = null,
  isTransientHot = false
} = {}) {
  if (!Number.isFinite(pressureBar)) return;
  observations.push({ pressureBar, source, stepIdentifier, isTransientHot });
}

function addTemperaturePressureWarningObservation(observations, pressureBar, temperatureC, ambientTemperatureC, {
  source,
  stepIdentifier = null
} = {}) {
  addPressureWarningObservation(observations, pressureBar, {
    source,
    stepIdentifier,
    isTransientHot: Number.isFinite(temperatureC)
      && Number.isFinite(ambientTemperatureC)
      && temperatureC > ambientTemperatureC
  });
}

function pressureWarningObservationsForOptimize(input, result) {
  const observations = [];
  const protocolSteps = result?.protocolSteps?.length
    ? result.protocolSteps
    : result?.maximumPressure?.protocolSteps ?? [];
  const ambientTemperatureC = input?.thermal?.ambientTemperatureC;
  addPressureWarningObservation(observations, input?.cylinder?.initialPressureBar, {
    source: 'initial'
  });
  addPressureWarningObservation(observations, input?.cylinder?.targetPressureBar, {
    source: 'target'
  });
  for (const [index, measurement] of (input?.thermal?.interimMeasurements ?? []).entries()) {
    if (!measurement) continue;
    addTemperaturePressureWarningObservation(
      observations,
      measurement.pressureBar,
      measurement.temperatureC,
      ambientTemperatureC,
      {
        source: 'interim',
        stepIdentifier: pressureWarningStepIdentifier(protocolSteps[index], index)
      }
    );
  }
  observations.push(...collectThermalPressureWarningObservations({
    protocolSteps,
    ambientTemperatureC,
    waitMode: input?.thermal?.waitMode
  }));
  const thermal = result?.thermal ?? result?.maximumPressure?.thermal;
  addPressureWarningObservation(observations, thermal?.finalInWaterPressureBar, {
    source: 'target',
    stepIdentifier: 'Target temperature'
  });
  return observations;
}

function pressureWarningObservationsForCompare(input, compare) {
  const observations = [];
  const ambientTemperatureC = input?.thermal?.ambientTemperatureC;
  addPressureWarningObservation(observations, input?.cylinder?.initialPressureBar, {
    source: 'initial'
  });
  observations.push(...collectThermalPressureWarningObservations({
    protocolSteps: compare?.protocolSteps,
    ambientTemperatureC
  }));
  addPressureWarningObservation(observations, compare?.final?.ambientSettled?.pressureBar, {
    source: 'settled',
    stepIdentifier: 'Settled result'
  });
  return observations;
}

function collectPressureWarnings(input, observations) {
  if (input?.settings?.pressureLimitMode !== 'warning') return [];
  return collectCylinderPressureWarnings({
    cylinder: input.cylinder,
    observations
  });
}

function renderCompareResult() {
  const compare = state.lastCompareResult?.compare;
  if (!compare) {
    clearTernaryDiagram(byId('ternary-canvas'));
    return;
  }
  renderResults(state.lastCompareResult, state.lastCompareInput);
  renderThermalCharts(state.lastCompareResult, state.lastCompareInput, state.settings.units);
  renderTernary();
}

function renderWhatIfResult() {
  const container = byId('what-if-result');
  if (!container) return;
  const compare = state.lastCompareResult?.compare;
  if (!compare) {
    container.replaceChildren(Object.assign(document.createElement('p'), {
      textContent: 'Run the sequence to see the modeled result.'
    }));
    return;
  }
  const stateText = value => {
    const temperature = Number.isFinite(value.temperatureC) ? ` at ${formatInputValue(value.temperatureC, 'temperatureC', state.settings.units)} ${unitLabel('temperatureC', state.settings.units)}` : '';
    return `${formatInputValue(value.pressureBar, 'pressureBar', state.settings.units)} ${unitLabel('pressureBar', state.settings.units)}${temperature} · Tx ${value.oxygenPercent.toFixed(1)}/${value.heliumPercent.toFixed(1)}`;
  };
  const summary = document.createElement('div');
  summary.className = 'rounded-xl border border-ocean-700 bg-ocean-950/60 p-3 space-y-1';
  summary.textContent = `Start: ${stateText({
    pressureBar: compare.trajectory?.[0]?.pressureBar ?? 0,
    ...compare.initialMix,
    temperatureC: state.lastCompareInput?.physics?.temperatureC
  })}`;
  const final = document.createElement('p');
  final.textContent = `Final: ${stateText(compare.final.recipeEnd)}`;
  summary.append(final);
  const settled = document.createElement('p');
  settled.textContent = `After settling: ${stateText(compare.final.ambientSettled)}`;
  summary.append(settled);
  const heading = document.createElement('h3');
  heading.className = 'font-semibold text-slate-200';
  heading.textContent = 'Steps';
  const steps = document.createElement('ol');
  steps.className = 'space-y-2';
  for (const [index, step] of compare.protocolSteps.entries()) {
    const item = document.createElement('li');
    item.className = 'rounded-lg border border-ocean-800 bg-ocean-950/40 p-2';
    const result = step.resultingMix
      ? ` → ${step.resultingPressureBar.toFixed(1)} bar · Tx ${step.resultingMix.oxygenPercent.toFixed(1)}/${step.resultingMix.heliumPercent.toFixed(1)}`
      : '';
    item.textContent = `${index + 1}. ${step.operation ?? step.title}${step.recipeGas ? ` · ${step.recipeGas}` : ''}${result}`;
    steps.append(item);
  }
  container.replaceChildren(
    summary,
    ...renderPressureLimitWarnings(
      state.lastCompareResult?.pressureLimitWarnings ?? [],
      state.lastCompareInput?.settings?.pressureLimitMode,
      state.settings.units
    ),
    heading,
    steps
  );
}

function runCompare() {
  const input = compareInput();
  const sharedErrors = compareSharedInputErrors(input);
  const waitStates = compareWaitStates(input);
  const validation = validateCompareRecipe(state.compareRows, {
    cylinder: input.cylinder,
    banks: input.banks,
    physics: input.physics,
    settings: input.settings,
    waitStates
  });
  state.compareErrors = [
    ...sharedErrors.map(message => ({ rowId: null, field: 'recipe', message })),
    ...validation.errors
  ];
  renderCompareErrors();
  renderCompareEditor();
  if (state.compareErrors.length > 0) {
    updateCompareStatus('Correct the highlighted recipe inputs before running a comparison.');
    return;
  }

  try {
    const protocol = buildCompareProtocol(validation.normalizedRows, {
      cylinder: input.cylinder,
      physics: input.physics,
      banks: input.banks,
      settings: input.settings,
      waitStates
    });
    const simulation = simulateCompareProtocol({
      protocolSteps: protocol.protocolSteps,
      cylinder: input.cylinder,
      physics: input.physics,
      thermal: input.thermal,
      settings: input.settings
    });
    state.lastCompareInput = input;
    state.lastCompareResult = {
      mode: 'compare',
      pressureLimitWarnings: collectPressureWarnings(
        input,
        pressureWarningObservationsForCompare(input, { ...protocol, ...simulation })
      ),
      compare: { ...protocol, ...simulation }
    };
    state.compareHasRun = true;
    state.compareErrors = [];
    renderCompareErrors();
    renderCompareEditor();
    updateCompareStatus('Comparison run.');
    renderCompareResult();
    renderWhatIfResult();
  } catch (error) {
    state.compareErrors = [{ rowId: null, field: 'recipe', message: error.message }];
    renderCompareErrors();
    renderCompareEditor();
    updateCompareStatus('Correct the highlighted recipe inputs before running a comparison.');
  }
}

function recalculate() {
  renderSupplyBanks(state.banks, state.settings.gasPresets);
  renderEquipmentSummary(state.settings);
  if (state.activeScreen === 'what-if') {
    renderCompareEditor();
    renderCompareErrors();
    renderWhatIfResult();
    return;
  }

  let input = { ...readInput(), settings: state.settings };
  const recipeSignature = calculatorInputSignature(input);
  if (state.interimMeasurements.some(Boolean)
    && state.interimMeasurementSignature !== recipeSignature) {
    state.interimMeasurements = [];
    state.interimMeasurementSignature = null;
    input = { ...readInput(), settings: state.settings };
  }
  const inputErrors = validateCalculatorInputs(
    input.cylinder,
    input.physics,
    input.thermal,
    { pressureLimitMode: state.settings.pressureLimitMode }
  );
  const result = inputErrors.length > 0 ? invalidInputResult(inputErrors) : optimizeBlend(input);
  const resultWithWarnings = {
    ...result,
    pressureLimitWarnings: collectPressureWarnings(
      input,
      pressureWarningObservationsForOptimize(input, result)
    )
  };
  state.lastInput = input;
  state.lastResult = resultWithWarnings;

  renderSupplyBanks(state.banks, state.settings.gasPresets, state.settings.units);
  renderEquipmentSummary(state.settings, state.settings.units);
  renderResults(resultWithWarnings, input);

  renderThermalCharts(resultWithWarnings, input, state.settings.units);
  if (resultWithWarnings.feasible) renderTernary();
  else clearTernaryDiagram(byId('ternary-canvas'));
}


function selectScreen(screenId) {
  if (screenId === 'settings' && state.settingsDraft === null) {
    openSettings();
    return;
  }
  if (!setPrimaryScreen(document, screenId)) return;
  state.activeScreen = screenId;
  if (screenId === 'what-if') {
    renderCompareEditor();
    renderCompareErrors();
    renderWhatIfResult();
  }

}
function setTab(tabId, focus = false) {
  if (!setResultTab(document, tabId)) return;
  state.activeTab = tabId;
  if (focus) byId(`tab-btn-${tabId}`)?.focus();
  if (tabId === 'ternary') {
    renderTernary();
    byId('ternary-coords-hover').textContent = 'Move over diagram for gas fractions';
  }
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


function restoreBankInputValue(input, bank) {
  const { bankField } = input.dataset;
  const quantity = bankField === 'volumeL' ? 'volumeL' : bankField === 'pressureBar' ? 'pressureBar' : null;
  const value = quantity
    ? convertToDisplay(bank[bankField], quantity, state.settings.units)
    : bank[bankField];
  input.value = String(value);
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
      restoreBankInputValue(input, bank);
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
    restoreBankInputValue(input, bank);
    state.bankInputFailure = {
      bankId: bank.id,
      message: `${bank.name}: Air is supplied by the compressor and cannot be a finite supply bank.`
    };
    updateStorageWarning();
    return;
  }

  const errors = validateSupplyBankInput(updatedBank);
  if (errors.length > 0) {
    restoreBankInputValue(input, bank);
    state.bankInputFailure = { bankId: bank.id, message: `${bank.name}: ${errors[0]}` };
    updateStorageWarning();
    return;
  }
  clearBankInputFailure(bank.id);
  Object.assign(bank, updatedBank);
  persistSupplyBanks();
  recalculate();
}

function updateCompareRow(input, rerender) {
  const index = state.compareRows.findIndex(row => row.id === input.dataset.rowId);
  if (index < 0) return;
  const row = state.compareRows[index];
  const field = input.dataset.compareField;
  let value = input.value;
  if (['pressureAddedBar', 'targetPressureBar'].includes(field)) {
    value = convertFromDisplay(Number.parseFloat(value), 'pressureBar', state.settings.units);
  } else if (field === 'targetTemperatureC') {
    value = convertFromDisplay(Number.parseFloat(value), 'temperatureC', state.settings.units);
  } else if (field === 'waitMinutes') {
    value = Number.parseFloat(value);
  }

  let updatedRow;
  if (field === 'type') {
    updatedRow = createCompareRow(value, row.id);
  } else if (field === 'bankId') {
    updatedRow = { ...row, bankId: value || null };
  } else if (field === 'pressureAddedBar' || (field === 'targetPressureBar' && row.type === 'add')) {
    const pressureInputMode = input.dataset.pressureInputMode;
    const pressureStart = comparePressureStarts()[row.id];
    updatedRow = normalizeComparePressureFields({
      ...row,
      [field]: value,
      pressureInputMode
    }, pressureStart);
  } else {
    updatedRow = { ...row, [field]: value };
  }
  state.compareRows.splice(index, 1, updatedRow);
  state.compareErrors = [];
  if (!rerender) return;
  renderCompareErrors();
  renderCompareEditor();
}

function handleInputOrChange(event) {
  const target = event.target;
  if (target.dataset.compareField && target.dataset.rowId) {
    updateCompareRow(target, event.type === 'change');
    return;
  }
  if (event.type === 'input' && target.dataset.settingsPresetImportUrl !== undefined) {
    state.settingsImport = { ...state.settingsImport, url: target.value, urlTouched: true };
    return;
  }
  if (event.type === 'input' && target.id === 'settings-pressure-limit-confirmation') {
    const unlock = document.querySelector('[data-action="unlock-pressure-warning"]');
    if (unlock) unlock.disabled = !matchesPressureWarningUnlockPhrase(target.value)
      || state.settingsDraft?.pressureWarningUnlocked === true;
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
  if (event.type === 'change' && target.dataset.action === 'select-inventory-compressor-preset') {
    selectInventoryEquipmentPreset(target, 'compressorPresets');
    return;
  }
  if (event.type === 'change' && target.dataset.action === 'select-inventory-booster-preset') {
    selectInventoryEquipmentPreset(target, 'boosterPresets');
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
    if (event.type === 'input' && ['init-p', 'target-p'].includes(target.id)) {
      const displayValue = Number.parseFloat(target.value);
      if (Number.isFinite(displayValue)) {
        const canonicalValue = convertFromDisplay(displayValue, 'pressureBar', state.settings.units);
        target.value = formatInputValue(canonicalValue, 'pressureBar', state.settings.units);
      }
    }
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
    pressureBar: convertFromDisplay(Number(pressureInput.value), 'pressureBar', state.settings.units),
    temperatureC: convertFromDisplay(Number(temperatureInput.value), 'temperatureC', state.settings.units)
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

function moveCompareRow(rowId, offset) {
  const index = state.compareRows.findIndex(row => row.id === rowId);
  const destination = index + offset;
  if (index < 0 || destination < 0 || destination >= state.compareRows.length) return;
  [state.compareRows[index], state.compareRows[destination]] = [
    state.compareRows[destination],
    state.compareRows[index]
  ];
  renderCompareEditor();
}

function handleClick(event) {
  const actionElement = event.target.closest('[data-action]');
  if (!actionElement || actionElement.disabled) return;

  switch (actionElement.dataset.action) {
    case 'add-compare-row':
      state.compareRows.push(createCompareRow('drain', `compare-row-${nextCompareRowNumber++}`));
      state.compareErrors = [];
      renderCompareErrors();
      renderCompareEditor();
      break;
    case 'remove-compare-row':
      state.compareRows = state.compareRows.filter(row => row.id !== actionElement.dataset.rowId);
      state.compareErrors = [];
      renderCompareErrors();
      renderCompareEditor();
      break;
    case 'move-compare-row-up':
      moveCompareRow(actionElement.dataset.rowId, -1);
      break;
    case 'move-compare-row-down':
      moveCompareRow(actionElement.dataset.rowId, 1);
      break;
    case 'run-compare':
      runCompare();
      break;
    case 'add-bank':
      addBank();
      break;
    case 'remove-bank':
      removeBank(actionElement.dataset.bankId);
      break;
    case 'open-settings':
      openSettings();
      break;
    case 'unlock-pressure-warning':
      unlockPressureWarning();
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
