import {
  calculatorInputSignature,
  interimMeasurementLockMessage,
  signatureAfterClearingMeasurement
} from './interim-measurements.js';
import { verifyInterimMeasurement } from './interim-check.js';
import { planWithReadings } from './plan-with-readings.js';
import { isValidGasComposition, parseNumericInput, splitGasInput } from './gas-input.js';
import { validateCalculatorInputs, validateSupplyBankInput } from './input-validation.js';
import { DEFAULT_HOT_OVERFILL_PERCENT } from './preset-validation.js';
import { buildCompareProtocol, createCompareRow, normalizeComparePressureFields, validateCompareRecipe } from './compare-recipe.js';
import {
  applyWhatIfStartPatch,
  buildWhatIfInput,
  createWhatIfScenario,
  expandWhatIfRows,
  projectWhatIfInWater,
  snapshotWhatIfFromBlending,
  whatIfSharedInputSignature
} from './what-if-scenario.js';
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
import { convertFromDisplay, convertToDisplay, formatInputValue, materialLabel, METRIC_UNITS, unitLabel } from './units.js';
import { resetApplicationState } from './factory-reset.js';
import { analyzePresetSource, mergeSelectedPresets, PRESET_IMPORT_DEFAULT_URLS } from './preset-import.js';
import { loadSupplyBanks, saveSupplyBanks } from './bank-storage.js';
import { priceBankByRecipe } from './bank-pricing.js';
import { loadTheme, saveTheme } from './theme.js';
import { setPrimaryScreen } from './navigation.js';
import { setResultTab } from './result-tabs.js';
import { loadOnboardingState } from './onboarding.js';
import { loadAnalytics } from './analytics.js';
import { createOnboardingController } from './ui/onboarding.js';
import { renderCompareRecipe } from './ui/compare-recipe.js';
import { renderPressureLimitWarnings, renderResults } from './ui/results.js';
import { renderSettingsDialog, renderPresetOptions, costFieldToStored, setCostField } from './ui/settings-dialog.js';
import { renderEquipmentSummary } from './ui/equipment-summary.js';
import { formatBankPrice, formatSuggestionNote, renderSupplyBanks } from './ui/supply-banks.js';
import { renderStorageWarning } from './ui/storage-warning.js';
import { renderThermalCharts } from './ui/thermal-charts.js';
import { changeTernaryZoom, clearTernaryDiagram, observeTernaryCanvas, renderTernaryDiagram } from './ui/ternary.js';
import { renderWhatIfScenarioEditor } from './ui/what-if-scenario.js';
import { getResultTabs } from './ui/result-panel.js';
import { computeFillCost } from './cost.js';
import { renderCostSummary } from './ui/cost-summary.js';

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
  settingsBeforeDraftCylinderName: null,
  settingsBeforeDraft: null,
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
  bankSuggestions: {},
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
  blendingCostSource: 'optimize',
  compareHasRun: false,
  whatIfScenario: createWhatIfScenario(),
  whatIfErrors: [],
  whatIfHasRun: false
};
let nextCompareRowNumber = 2;
let onboardingSettingsOpen = false;



const DEFAULT_CYLINDER_PRESET_NAME = 'Catalina S80';
const LITRES_PER_CU_FT_AT_ONE_BAR = 28.316846592 * 1.01325;

function selectedCylinderPreset() {
  const selectedName = byId('cylinder-preset')?.value;
  return state.settings.cylinderPresets.find(preset => preset.name === selectedName)
    ?? state.settings.cylinderPresets.find(preset => preset.name === DEFAULT_CYLINDER_PRESET_NAME)
    ?? state.settings.cylinderPresets[0];
}

function updateCylinderRatingHint(preset, units = state.settings.units) {
  const hint = byId('cylinder-rating-hint');
  if (!hint || !preset) return;
  const equipmentValue = (value, quantity) => units === METRIC_UNITS
    ? `${value.toFixed(2)} ${unitLabel(quantity, units)}`
    : `${convertToDisplay(value, quantity, units).toFixed(2)} ${unitLabel(quantity, units)}`;
  const displayVolume = units === 'imperial'
    ? preset.volumeL * preset.workingPressureBar / LITRES_PER_CU_FT_AT_ONE_BAR
    : preset.volumeL;
  const volumeText = `${displayVolume.toFixed(2)} ${unitLabel('volumeL', units)}`;
  hint.textContent = `${volumeText} ${materialLabel(preset.material, units).toLowerCase()} cylinder, ${equipmentValue(preset.massKg, 'massKg')} empty assembly, rated to ${equipmentValue(preset.workingPressureBar, 'pressureBar')}.`;
}

function refreshPresetOptions(selectedCylinderName = null) {
  const requestedName = selectedCylinderName ?? (byId('cylinder-preset')?.value || undefined);
  renderPresetOptions(state.settings, requestedName, state.settings.units);
  updateCylinderRatingHint(selectedCylinderPreset());
}


const byId = id => document.getElementById(id);

function updateWorkingTankUnitLabels(units) {
  const workingTank = byId('working-tank-section');
  if (!workingTank) return;
  for (const label of workingTank.querySelectorAll('[data-unit-quantity]')) {
    label.textContent = unitLabel(label.dataset.unitQuantity, units);
  }
}
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
  updateWorkingTankUnitLabels(toUnits);
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

function currentPhysicsForBanks() {
  return {
    model: state.settings.physics.model,
    temperatureC: canonicalNumberValue('ambient-temperature', 'temperatureC')
  };
}

function bankPricingSignature(bank) {
  return JSON.stringify({
    volumeL: bank.volumeL,
    pressureBar: bank.pressureBar,
    oxygenPercent: bank.oxygenPercent,
    heliumPercent: bank.heliumPercent,
    costs: state.settings.costs,
    booster: state.settings.booster,
    pressureLimitMode: state.settings.pressureLimitMode,
    physics: currentPhysicsForBanks()
  });
}

function bankSuggestionFor(bank) {
  const suggestion = state.bankSuggestions[bank.id];
  if (!suggestion) return null;
  if (suggestion.signature === bankPricingSignature(bank)) return suggestion;
  delete state.bankSuggestions[bank.id];
  return null;
}

/** Bank whose Calculate or Apply control must regain focus once the table is rebuilt. */
let pendingBankFocus = null;

function announceBankPrice(message) {
  byId('bank-price-status').textContent = message;
}

function restoreBankPriceFocus() {
  if (!pendingBankFocus) return;
  const status = byId('bank-price-status');
  const calculate = [...document.querySelectorAll('#tanks-tbody [data-action="calculate-bank-price"]')]
    .find(button => button.dataset.bankId === pendingBankFocus);
  const active = document.activeElement;
  if (!calculate || (active && active !== document.body && active !== status && active !== calculate)) {
    pendingBankFocus = null;
    return;
  }
  if (calculate.disabled) {
    status.focus();
    return;
  }
  calculate.focus();
}

function renderBankTable() {
  const suggestions = {};
  for (const bank of state.banks) {
    const suggestion = bankSuggestionFor(bank);
    if (suggestion) suggestions[bank.id] = suggestion;
  }
  for (const bankId of Object.keys(state.bankSuggestions)) {
    if (!state.banks.some(bank => bank.id === bankId)) delete state.bankSuggestions[bankId];
  }
  renderSupplyBanks(state.banks, state.settings.gasPresets, state.settings.units, {
    suggestions,
    currencySymbol: state.settings.costs.currencySymbol,
    leftoverDiscountPercent: state.settings.costs.leftoverDiscountPercent
  });
  restoreBankPriceFocus();
}

function rejectBankEdit(bank, message) {
  state.bankInputFailure = { bankId: bank.id, message: `${bank.name}: ${message}` };
  updateStorageWarning();
}

function commitBankUpdate(bank, updatedBank) {
  if (updatedBank.oxygenPercent === 21 && updatedBank.heliumPercent === 0) {
    return 'Air is supplied by the compressor and cannot be a finite supply bank.';
  }
  const errors = validateSupplyBankInput(updatedBank);
  if (errors.length > 0) return errors[0];
  clearBankInputFailure(bank.id);
  Object.assign(bank, updatedBank);
  delete state.bankSuggestions[bank.id];
  persistSupplyBanks();
  recalculate();
  return null;
}

function calculateBankPrice(bankId) {
  const bank = state.banks.find(candidate => candidate.id === bankId);
  if (!bank) return;
  pendingBankFocus = bank.id;
  state.bankSuggestions[bank.id] = { status: 'calculating', signature: bankPricingSignature(bank) };
  announceBankPrice(`Calculating price for ${bank.name}…`);
  renderBankTable();
  setTimeout(() => finishBankPriceCalculation(bank.id), 0);
}

function finishBankPriceCalculation(bankId) {
  const pending = state.bankSuggestions[bankId];
  const bank = state.banks.find(candidate => candidate.id === bankId);
  if (!bank || pending?.status !== 'calculating') {
    pendingBankFocus = null;
    return;
  }
  const signature = bankPricingSignature(bank);
  if (pending.signature !== signature) {
    delete state.bankSuggestions[bankId];
    announceBankPrice(`Price calculation for ${bank.name} was discarded.`);
    renderBankTable();
    pendingBankFocus = null;
    return;
  }
  let result;
  try {
    result = priceBankByRecipe({
      bank,
      costs: state.settings.costs,
      settings: state.settings,
      physics: currentPhysicsForBanks()
    });
  } catch (error) {
    delete state.bankSuggestions[bankId];
    announceBankPrice(`Price calculation for ${bank.name} failed.`);
    renderBankTable();
    pendingBankFocus = null;
    throw error;
  }
  state.bankSuggestions[bankId] = result.ok
    ? { status: 'ok', pricePerLitre: result.pricePerLitre, recipeCost: result.recipeCost, litres: result.litres, signature }
    : { status: 'failed', reason: result.reason, signature };
  announceBankPrice(`${bank.name}: ${formatSuggestionNote(bank, state.bankSuggestions[bankId], state.settings.units, state.settings.costs.currencySymbol, state.settings.costs.leftoverDiscountPercent)}`);
  renderBankTable();
  pendingBankFocus = null;
}

function applyBankPrice(bankId) {
  const bank = state.banks.find(candidate => candidate.id === bankId);
  if (!bank) return;
  pendingBankFocus = bank.id;
  const suggestion = bankSuggestionFor(bank);
  if (suggestion?.status !== 'ok') {
    renderBankTable();
    pendingBankFocus = null;
    return;
  }
  const error = commitBankUpdate(bank, { ...bank, pricePerLitre: suggestion.pricePerLitre });
  pendingBankFocus = null;
  if (error) rejectBankEdit(bank, error);
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
  if (ternaryData()) requestAnimationFrame(renderTernary);
}


function setSettingsCategory(category) {
  const categories = ['general', 'gas-presets', 'cylinder-presets', 'equipment', 'costs', 'preset-management'];
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
  state.settingsBeforeDraftCylinderName = byId('cylinder-preset')?.value ?? null;
  state.settingsBeforeDraft = copySettings(state.settings);
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
  state.whatIfScenario = createWhatIfScenario();
  state.whatIfErrors = [];
  state.whatIfHasRun = false;

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
  persistSettingsDraft();
  renderSettingsDraft();
}

function selectBoosterPreset(select) {
  const settings = selectEquipmentPreset(state.settingsDraft, 'boosterPresets', select.value);
  if (!settings) return;
  state.settingsDraft = settings;
  persistSettingsDraft();
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


function persistSettingsDraft() {
  const errors = validateSettings(state.settingsDraft);
  if (errors.length > 0) {
    displaySettingsErrors(errors);
    return false;
  }
  const pressureLimitModeChanged = state.settings.pressureLimitMode !== state.settingsDraft.pressureLimitMode;
  const previousUnits = state.settings.units;
  state.settings = copySettings(state.settingsDraft);
  if (pressureLimitModeChanged) invalidateCompareResult();
  convertDisplayedInputs(previousUnits, state.settings.units);
  updateStorageWarning();
  refreshPresetOptions();
  recalculate();
  clearSettingsErrors();
  return true;
}
function updateSettingsDraft(input, eventType) {
  if (!state.settingsDraft) return;
  const collection = input.dataset.settingsCollection;
  const index = Number(input.dataset.settingsIndex);
  const field = input.dataset.settingsField;
  if (collection === 'costs') {
    setCostField(state.settingsDraft.costs, field, costFieldToStored(field, input.value, state.settingsDraft.units));
    persistSettingsDraft();
    return;
  }
  const quantity = {
    volumeL: 'volumeL',
    massKg: 'massKg',
    workingPressureBar: 'pressureBar',
    compressorInletFlowLPerMin: 'flowLPerMin',
    cylinderVolumeCm3: 'volumeCm3',
    minimumSourcePressureBar: 'pressureBar',
    oxygenDecantRateBarPerMin: 'pressureBarPerMin',
    otherDecantRateBarPerMin: 'pressureBarPerMin',
    drainingRateBarPerMin: 'pressureBarPerMin',
    maxCompressorPressureBar: 'pressureBar',
    maxBoosterOutputPressureBar: 'pressureBar',
    boosterTemperatureModifierC: 'temperatureDeltaC',
    compressorTemperatureModifierC: 'temperatureDeltaC'
  }[field];
  const numericValue = Number.parseFloat(input.value);
  const value = collection === 'physics' || collection === 'general' || collection === 'units' || field === 'name' || field === 'material'
    ? input.value
    : collection === 'cylinderPresets' && field === 'volumeL' && state.settingsDraft.units === 'imperial'
      ? numericValue * LITRES_PER_CU_FT_AT_ONE_BAR / state.settingsDraft.cylinderPresets[index].workingPressureBar
      : quantity
        ? convertFromDisplay(numericValue, quantity, state.settingsDraft.units)
        : numericValue;
  if (collection === 'physics') state.settingsDraft.physics[field] = value;
  else if (field === 'interimPressureTolerancePercent') state.settingsDraft.interimPressureTolerancePercent = numericValue;
  else if (field === 'pressureLimitMode') {
    state.settingsDraft.pressureLimitMode = value;
    byId('settings-pressure-warning-notice')?.classList.toggle('hidden', value !== 'warning');
  } else if (collection === 'units') state.settingsDraft.units = value;
  else if (collection === 'cylinderPresets') state.settingsDraft.cylinderPresets[index][field] = value;
  else if (collection === 'booster') state.settingsDraft.booster[field] = value;
  else state.settingsDraft.gasPresets[index][field] = value;
  persistSettingsDraft();
  if (collection === 'units') {
    renderSettingsDraft();
    setSettingsCategory(state.settingsCategory);
  }
  if (eventType === 'change' && collection === 'cylinderPresets'
    && ['workingPressureBar'].includes(field)
    && Number.isFinite(numericValue)) {
    input.value = numericValue.toFixed(2);
  }
  if (eventType === 'change' && collection === 'cylinderPresets' && field === 'workingPressureBar'
    && state.settingsDraft.units === 'imperial') {
    const preset = state.settingsDraft.cylinderPresets[index];
    if (preset) {
      const displayedVolume = preset.volumeL * preset.workingPressureBar / LITRES_PER_CU_FT_AT_ONE_BAR;
      for (const volumeInput of document.querySelectorAll(
        `[data-settings-collection="cylinderPresets"][data-settings-index="${index}"][data-settings-field="volumeL"]`
      )) {
        volumeInput.value = displayedVolume.toFixed(2);
      }
    }
  }
}

function unlockPressureWarning() {
  if (!state.settingsDraft || state.settingsDraft.pressureWarningUnlocked === true) return;
  const confirmation = byId('settings-pressure-limit-confirmation');
  if (!matchesPressureWarningUnlockPhrase(confirmation?.value)) return;
  state.settingsDraft.pressureWarningUnlocked = true;
  persistSettingsDraft();
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
  persistSettingsDraft();
  renderSettingsDraft();
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
  persistSettingsDraft();
  renderSettingsDraft();
  setSettingsCategory(state.settingsCategory);
}

function addCompressorPreset() {
  addEquipmentPresetToDraft(state.settingsDraft, 'compressorPresets', 'New compressor');
  persistSettingsDraft();
  renderSettingsDraft();
  setSettingsCategory('equipment');
}

function addBoosterPreset() {
  addEquipmentPresetToDraft(state.settingsDraft, 'boosterPresets', 'New booster');
  persistSettingsDraft();
  renderSettingsDraft();
  setSettingsCategory('equipment');
}

function removeSettingsPreset(collection, index) {
  const presets = state.settingsDraft?.[collection];
  if (!Array.isArray(presets) || presets.length <= 1 || !Number.isInteger(index)
    || index < 0 || index >= presets.length) return;
  presets.splice(index, 1);
  persistSettingsDraft();
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
  state.settingsBeforeDraftCylinderName = null;
  state.settingsBeforeDraft = null;
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

function applyWhatIfGasPreset(select) {
  if (!select.value.startsWith('gas:')) return;
  const preset = state.settings.gasPresets.find(candidate => candidate.name === select.value.slice(4));
  if (!preset) return;
  state.whatIfScenario = applyWhatIfStartPatch(state.whatIfScenario, {
    oxygenPercent: preset.oxygenPercent,
    heliumPercent: preset.heliumPercent
  });
  state.whatIfErrors = [];
  renderWhatIfEditor();
  renderWhatIfResult();
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
  const previousUnits = state.settings.units;
  const selectedCylinderName = state.settingsBeforeDraftCylinderName;
  const returnScreen = state.settingsReturnScreen;
  if (state.settingsBeforeDraft) {
    state.settings = copySettings(state.settingsBeforeDraft);
    try {
      saveSettings(state.settings, settingsStorage);
    } catch (error) {
      console.warn('Simplex blender settings could not restore the canceled draft.', error);
    }
    convertDisplayedInputs(previousUnits, state.settings.units);
    refreshPresetOptions(
      state.settings.cylinderPresets.some(preset => preset.name === selectedCylinderName)
        ? selectedCylinderName
        : null
    );
    updateWaitModeFields();
    updateWaterSubmersionField();
    recalculate();
  }
  state.settingsBeforeDraft = null;
  state.settingsBeforeDraftCylinderName = null;
  state.settingsDraft = null;
  clearSettingsErrors();
  selectScreen(returnScreen);
}


function updateWaitModeFields() {
  const isMinutesMode = byId('wait-mode').value === 'minutes';
  byId('wait-minutes-field').hidden = !isMinutesMode;
  byId('wait-target-temperature-field').hidden = isMinutesMode;
}

function updateWaterSubmersionField() {
  byId('water-submersion-field').hidden = byId('cooling-medium').value !== 'water';
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
      waterSubmersionPercent: Number.parseInt(byId('water-submersion').value, 10),
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

function compareWaitStates(input = compareInput(), rows = state.compareRows) {
  const waitStates = {};
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    if (row.type !== 'wait') continue;
    try {
      const protocol = buildCompareProtocol(rows.slice(0, index + 1), {
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
      // Validation reports the underlying row error; unavailable states are omitted.
    }
  }
  return waitStates;
}

function comparePressureStarts(input = compareInput(), rows = state.compareRows) {
  const starts = {};
  const waitStates = compareWaitStates(input, rows);
  let currentPressure = input.cylinder.initialPressureBar;
  for (const row of rows) {
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

function whatIfCurrentSharedSignature() {
  return whatIfSharedInputSignature({
    settings: state.settings,
    banks: state.banks,
    cylinderPresetName: state.whatIfScenario.start?.cylinderPresetName,
    inletTemperatureC: canonicalNumberValue('inlet-gas-temperature', 'temperatureC')
  });
}

function whatIfResultIsStale() {
  const scenario = state.whatIfScenario;
  return Boolean(scenario.result)
    && (scenario.resultRevision !== scenario.draftRevision
      || scenario.sharedInputSignature !== whatIfCurrentSharedSignature());
}

function scenarioInputForCurrentDraft() {
  return buildWhatIfInput(state.whatIfScenario, {
    settings: state.settings,
    banks: state.banks,
    inletTemperatureC: canonicalNumberValue('inlet-gas-temperature', 'temperatureC')
  });
}

function renderWhatIfEditor() {
  const container = byId('what-if-editor');
  if (!container) return;
  const input = scenarioInputForCurrentDraft();
  const pressureStarts = state.whatIfScenario.start
    ? comparePressureStarts(input, expandWhatIfRows(state.whatIfScenario.rows))
    : {};
  renderWhatIfScenarioEditor(container, {
    scenario: state.whatIfScenario,
    cylinderPresets: state.settings.cylinderPresets,
    gasPresets: state.settings.gasPresets,
    units: state.settings.units,
    sharedInputChanged: whatIfResultIsStale()
      && state.whatIfScenario.sharedInputSignature !== whatIfCurrentSharedSignature(),
    banks: state.banks,
    pressureStarts,
    rowsContainer: byId('compare-recipe-editor'),
    statusContainer: byId('what-if-scenario-status'),
  });
}

function renderWhatIfErrors() {
  const container = byId('compare-recipe-errors');
  if (!container) return;
  container.replaceChildren(...state.whatIfErrors.map(({ message }) => {
    const line = document.createElement('p');
    line.className = 'text-xs text-rose-300';
    line.textContent = message;
    return line;
  }));
}

function updateWhatIfStatus(message = '') {
  const status = byId('compare-run-status');
  if (status) status.textContent = message;
}

function initializeWhatIfScenario() {
  if (state.whatIfScenario.initialized) return;
  let input;
  try {
    input = readInput();
  } catch {
    return;
  }
  state.whatIfScenario = {
    ...createWhatIfScenario(),
    initialized: true,
    start: snapshotWhatIfFromBlending(input)
  };
}

function copyWhatIfFromBlending() {
  let input;
  try {
    input = readInput();
  } catch {
    return;
  }
  const scenario = state.whatIfScenario;
  const copied = applyWhatIfStartPatch(scenario, snapshotWhatIfFromBlending(input));
  state.whatIfScenario = {
    ...copied,
    initialized: true
  };
  state.whatIfErrors = [];
  state.whatIfHasRun = Boolean(copied.result);
  runWhatIf();
}

function renderCompareEditor() {
  if (state.activeScreen === 'what-if') {
    renderWhatIfEditor();
    return;
  }
  renderCompareRecipe(byId('compare-recipe-editor'), {
    rows: state.compareRows,
    banks: state.banks,
    errors: state.compareErrors,
    pressureStarts: comparePressureStarts(),
    units: state.settings.units,
    whatIf: false
  });
}

function renderCompareErrors() {
  if (state.activeScreen === 'what-if') {
    renderWhatIfErrors();
    return;
  }
  const container = byId('compare-recipe-errors');
  if (!container) return;
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

function ternaryData(screen = state.activeScreen) {
  if (screen === 'what-if') {
    const result = state.whatIfScenario.result;
    const compare = result?.compare;
    if (!compare || !result.input) return null;
    const finalMix = compare.final.recipeEnd;
    return {
      mode: 'what-if',
      banks: (compare.sourceBanks ?? []).map(source => ({
        id: source.id,
        name: source.name,
        enabled: true,
        pressureBar: source.initial?.pressureBar,
        endPressureBar: source.final?.pressureBar,
        oxygenPercent: source.initial?.oxygenPercent,
        heliumPercent: source.initial?.heliumPercent,
        volumeL: source.initial?.volumeL ?? 1
      })),
      initialMix: {
        ...compare.initialMix,
        nitrogenPercent: Math.max(0, 100 - compare.initialMix.oxygenPercent - compare.initialMix.heliumPercent)
      },
      targetMix: {
        oxygenPercent: finalMix.oxygenPercent,
        heliumPercent: finalMix.heliumPercent,
        nitrogenPercent: Math.max(0, 100 - finalMix.oxygenPercent - finalMix.heliumPercent)
      },
      trajectory: compare.trajectory
    };
  }
  if (state.mode === 'compare') {
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
  const result = state.lastResult;
  const recipe = result?.feasible ? result : result?.maximumPressure;
  if (!state.lastInput || !recipe) return null;
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
    trajectory: recipe.trajectory
  };
}



function renderTernary(screen = state.activeScreen) {
  const data = ternaryData(screen);
  const root = screen === 'what-if'
    ? byId('what-if-result-host')?.querySelector?.('[data-result-panel]')
    : document;
  const canvas = root?.querySelector?.('[data-result-key="ternary-canvas"]')
    ?? root?.querySelector?.('#ternary-canvas')
    ?? byId('ternary-canvas');
  if (data && canvas) renderTernaryDiagram(canvas, data, { root });
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
    const protocolIndex = protocolSteps.findIndex(step => step?._measurementIndex === index);
    const stepIndex = protocolIndex >= 0 ? protocolIndex : index;
    addTemperaturePressureWarningObservation(
      observations,
      measurement.pressureBar,
      measurement.temperatureC,
      ambientTemperatureC,
      {
        source: 'interim',
        stepIdentifier: pressureWarningStepIdentifier(protocolSteps[stepIndex], stepIndex)
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
function pressureWarningObservationsForWhatIf(input, compare) {
  const observations = pressureWarningObservationsForCompare(input, compare);
  addPressureWarningObservation(observations, compare?.final?.inWater?.pressureBar, {
    source: 'cooling',
    stepIdentifier: 'In-water projection'
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

function blendingCostSource() {
  if (state.blendingCostSource === 'compare') {
    const compare = state.lastCompareResult?.compare;
    if (!compare || !state.lastCompareInput) return null;
    return { steps: compare.protocolSteps, temperatureC: state.lastCompareInput.physics?.temperatureC };
  }
  if (!state.lastResult || !state.lastInput || state.lastResult.feasible === false) return null;
  return { steps: state.lastResult.protocolSteps, temperatureC: state.lastInput.physics?.temperatureC };
}

function whatIfCostSource() {
  const result = state.whatIfScenario.result;
  if (!result?.compare) return null;
  return { steps: result.compare.protocolSteps, temperatureC: result.input?.physics?.temperatureC };
}

function deriveFillCost(source) {
  if (!source || !Array.isArray(source.steps)) return null;
  return computeFillCost({
    steps: source.steps,
    banks: state.banks,
    costs: state.settings.costs,
    temperatureC: source.temperatureC
  });
}

/**
 * Re-derive the Costs section of every result host from its stored final steps, the current banks and
 * the current settings. Quantities come from the run; prices are never frozen into a result.
 */
function refreshCostSummaries() {
  const display = { units: state.settings.units, currencySymbol: state.settings.costs.currencySymbol };
  const blending = document.querySelector('[data-result-host="blending"]');
  if (blending) renderCostSummary(deriveFillCost(blendingCostSource()), { root: blending, ...display });
  const whatIf = byId('what-if-result-host');
  if (whatIf) renderCostSummary(deriveFillCost(whatIfCostSource()), { root: whatIf, ...display });
}

function renderCompareResult() {
  const compare = state.lastCompareResult?.compare;
  if (!compare) {
    clearTernaryDiagram(document.querySelector('[data-result-host="blending"] [data-result-key="ternary-canvas"]'));
    return;
  }
  state.blendingCostSource = 'compare';
  renderResults(state.lastCompareResult, state.lastCompareInput);
  renderThermalCharts(state.lastCompareResult, state.lastCompareInput, state.settings.units);
  renderTernary();
  refreshCostSummaries();
}

function renderWhatIfResult() {
  const root = byId('what-if-result-host')?.querySelector?.('[data-result-panel]')
    ?? byId('what-if-result-host');
  const result = state.whatIfScenario.result;
  if (!root) return;
  const staleStatus = root.querySelector?.('[data-result-key="what-if-stale-status"]');
  if (!result) {
    if (staleStatus) staleStatus.hidden = true;
    const summaryBanner = root.querySelector?.('[data-result-key="summary-banner"]');
    if (summaryBanner) summaryBanner.hidden = true;
    const compareSummary = root.querySelector?.('[data-result-key="compare-summary"]');
    if (compareSummary) compareSummary.hidden = true;
    const status = root.querySelector?.('[data-result-key="blend-status"]');
    if (status) {
      status.className = 'rounded-lg border border-ocean-700/50 bg-ocean-950/40 px-3 py-2 text-xs text-slate-400';
      status.textContent = 'Run the sequence to see the modeled result.';
    }
    for (const id of [
      'res-retained-p', 'res-retained-pct', 'res-vented-p', 'res-vented-litres',
      'res-he-salvaged', 'res-final-p', 'res-final-mix', 'res-fill-duration',
      'res-max-temperature', 'res-hot-pressure', 'res-hot-temperature',
      'res-ambient-pressure', 'res-ambient-temperature', 'res-in-water-pressure',
      'res-in-water-temperature'
    ]) {
      const element = root.querySelector?.(`[data-result-key="${id}"]`);
      if (element) element.textContent = '—';
    }
    const canvas = root.querySelector?.('[data-result-key="ternary-canvas"]')
      ?? root.querySelector?.('#ternary-canvas');
    clearTernaryDiagram(canvas, root);
    renderThermalCharts(null, {}, state.settings.units, { root });
    root.querySelector?.('[data-result-key="steps-container"]')?.replaceChildren();
    root.querySelector?.('[data-result-key="water-pressure-container"]')?.replaceChildren();
    root.querySelector?.('[data-result-key="scenario-summary-content"]')?.replaceChildren();
    refreshCostSummaries();
    return;
  }
  renderResults(result, result.input, { root, mode: 'what-if' });
  renderThermalCharts(result, result.input, state.settings.units, { root });
  renderTernary();
  const stale = whatIfResultIsStale();
  if (staleStatus) {
    staleStatus.hidden = !stale;
    staleStatus.textContent = stale
      ? (state.whatIfScenario.sharedInputSignature !== whatIfCurrentSharedSignature()
        ? 'Out of date — shared inputs changed. Update the scenario inputs.'
        : 'Out of date — scenario draft changed. Update the scenario inputs.')
      : '';
  }
  if (stale) {
    const status = root.querySelector?.('[data-result-key="blend-status"]');
    if (status) {
      status.className = 'rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200';
      status.textContent = 'Scenario result is out of date. Update the scenario inputs.';
    }
  }
  refreshCostSummaries();
}

function scenarioError(field, message, rowId = null) {
  return { rowId, field, message };
}

function scenarioSharedInputErrors(input) {
  const errors = [];
  const selectedPreset = state.settings.cylinderPresets
    ?.find(preset => preset.name === state.whatIfScenario.start?.cylinderPresetName);
  if (!selectedPreset) errors.push(scenarioError('cylinderPresetName', 'Select an available cylinder preset.'));
  const thermal = {
    ...input.thermal,
    targetMediumTemperatureC: input.thermal.ambientTemperatureC,
    targetInWaterTemperatureC: input.thermal.inWaterTemperatureC
  };
  const targetPressureBar = Math.max(10, input.cylinder.initialPressureBar);
  const validationMessages = validateCalculatorInputs(
    { ...input.cylinder, targetPressureBar },
    input.physics,
    thermal,
    { pressureLimitMode: state.settings.pressureLimitMode }
  );
  for (const message of validationMessages) {
    const field = message.startsWith('Initial pressure')
      || message.startsWith('Target pressure')
      || message.startsWith('Cylinder working pressure')
      ? 'pressureBar'
      : message.startsWith('Thermal ambient temperature')
        || message.startsWith('Thermal target-medium temperature')
        ? 'ambientTemperatureC'
        : message.startsWith('Thermal target in-water temperature')
          ? 'inWaterTemperatureC'
          : message.startsWith('Thermal cooling medium')
            ? 'coolingMedium'
            : message.startsWith('Thermal water submersion')
              ? 'waterSubmersionPercent'
            : null;
    if (field) errors.push(scenarioError(field, message));
    else errors.push(scenarioError('scenario', message));
  }
  if (!isValidGasComposition(input.cylinder.initialOxygenPercent, input.cylinder.initialHeliumPercent)) {
    const message = 'Initial oxygen and helium percentages must total no more than 100%.';
    errors.push(scenarioError('oxygenPercent', message), scenarioError('heliumPercent', message));
  }
  if (!['ideal', 'vdw'].includes(input.physics.model)) {
    errors.push(scenarioError('scenario', 'Physics model must be ideal or vdw.'));
  }
  return errors;
}

function scenarioSimulationError(error, rows) {
  if (error?.code === 'COMPARE_TARGET_STATE_UNREACHABLE') {
    const target = error.details?.targetTemperatureC;
    const row = rows.find(candidate => candidate.type === 'wait'
      && candidate.waitMode === 'target'
      && (!Number.isFinite(target) || candidate.targetTemperatureC === target));
    if (row) return scenarioError('targetTemperatureC', error.message, row.id);
  }
  return scenarioError('scenario', error?.message ?? 'Scenario simulation failed.');
}


function runWhatIf({ renderEditor = true } = {}) {
  const scenario = state.whatIfScenario;
  const input = scenarioInputForCurrentDraft();
  const rows = expandWhatIfRows(scenario.rows);
  const sharedErrors = scenarioSharedInputErrors(input);
  const waitStates = compareWaitStates(input, rows);
  const validation = validateCompareRecipe(rows, {
    cylinder: input.cylinder,
    banks: input.banks,
    physics: input.physics,
    settings: input.settings,
    waitStates
  });
  state.whatIfErrors = [
    ...sharedErrors,
    ...validation.errors
  ];
  renderWhatIfErrors();
  if (renderEditor) renderWhatIfEditor();
  if (state.whatIfErrors.length > 0) {
    state.whatIfHasRun = true;
    updateWhatIfStatus('Correct the highlighted scenario inputs before updating the scenario.');
    renderWhatIfResult();
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
    const inWater = projectWhatIfInWater(simulation.final.ambientSettled, {
      inWaterTemperatureC: input.thermal.inWaterTemperatureC,
      volumeL: input.cylinder.volumeL,
      useVdw: input.physics.model === 'vdw'
    });
    const compare = { ...protocol, ...simulation, final: { ...simulation.final, inWater } };
    const result = {
      mode: 'what-if',
      input,
      sharedInputSignature: whatIfCurrentSharedSignature(),
      pressureLimitWarnings: collectPressureWarnings(
        input,
        pressureWarningObservationsForWhatIf(input, compare)
      ),
      compare
    };
    state.whatIfScenario = {
      ...scenario,
      result,
      resultRevision: scenario.draftRevision,
      sharedInputSignature: result.sharedInputSignature
    };
    state.whatIfErrors = [];
    state.whatIfHasRun = true;
    renderWhatIfErrors();
    if (renderEditor) renderWhatIfEditor();
    updateWhatIfStatus('Scenario updated.');
    renderWhatIfResult();
  } catch (error) {
    state.whatIfErrors = [scenarioSimulationError(error, scenario.rows)];
    state.whatIfHasRun = true;
    renderWhatIfErrors();
    if (renderEditor) renderWhatIfEditor();
    updateWhatIfStatus('Correct the highlighted scenario inputs before updating the scenario.');
    renderWhatIfResult();
  }
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
  renderBankTable();
  renderEquipmentSummary(state.settings);
  if (state.activeScreen === 'what-if') {
    runWhatIf();
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
  const result = inputErrors.length > 0 ? invalidInputResult(inputErrors) : planWithReadings(input);
  const resultWithWarnings = {
    ...result,
    pressureLimitWarnings: collectPressureWarnings(
      input,
      pressureWarningObservationsForOptimize(input, result)
    )
  };
  state.lastInput = input;
  state.lastResult = resultWithWarnings;
  state.blendingCostSource = 'optimize';

  renderBankTable();
  renderEquipmentSummary(state.settings, state.settings.units);
  renderResults(resultWithWarnings, input);

  renderThermalCharts(resultWithWarnings, input, state.settings.units);
  if (ternaryData()) renderTernary();
  else clearTernaryDiagram(document.querySelector('[data-result-host="blending"] [data-result-key="ternary-canvas"]'));
  refreshCostSummaries();
}

function selectScreen(screenId) {
  if (screenId === 'settings' && state.settingsDraft === null) {
    openSettings();
    return;
  }
  if (!setPrimaryScreen(document, screenId)) return;
  state.activeScreen = screenId;
  if (screenId === 'what-if') {
    initializeWhatIfScenario();
    runWhatIf();
  }
}

function activeResultRoot() {
  const host = byId(state.activeScreen === 'what-if' ? 'what-if-result-host' : 'blending-result-host');
  return host?.querySelector?.('[data-result-panel]') ?? host ?? document;
}

function setTab(tabId, focus = false) {
  const root = activeResultRoot();
  const tabs = getResultTabs(state.activeScreen === 'what-if' ? 'what-if' : 'optimize');
  if (!setResultTab(root, tabId, tabs)) return;
  state.activeTab = tabId;
  if (focus) root.querySelector?.(`[data-result-key="tab-btn-${tabId}"]`)?.focus();
  if (tabId === 'ternary') {
    renderTernary();
    const hover = root.querySelector?.('[data-result-key="ternary-coords-hover"]');
    if (hover) hover.textContent = 'Move over diagram for gas fractions';
  }
}

function handleResultTabKeydown(event) {
  const button = event.target.closest?.('[role="tab"]');
  if (!button) return;
  const root = button.closest?.('[data-result-panel]') ?? document;
  const tabs = getResultTabs(root.dataset?.resultMode === 'what-if' ? 'what-if' : 'optimize');
  const currentIndex = tabs.indexOf(button.dataset.tab);
  if (currentIndex < 0) return;
  let nextIndex = currentIndex;
  if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % tabs.length;
  else if (event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
  else if (event.key === 'Home') nextIndex = 0;
  else if (event.key === 'End') nextIndex = tabs.length - 1;
  else return;
  event.preventDefault();
  setTab(tabs[nextIndex], true);
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
  delete state.bankSuggestions[bankId];
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
  delete state.bankSuggestions[bank.id];
  persistSupplyBanks();
  recalculate();
}


function restoreBankInputValue(input, bank) {
  const { bankField } = input.dataset;
  if (bankField === 'pricePerLitre') {
    input.value = formatBankPrice(bank.pricePerLitre, state.settings.units);
    return;
  }
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
  } else if (bankField === 'pricePerLitre') {
    if (input.validity?.badInput) {
      restoreBankInputValue(input, bank);
      clearBankInputFailure(bank.id);
      return;
    }
    if (input.value.trim() === '') {
      updatedBank.pricePerLitre = null;
    } else {
      const value = Number.parseFloat(input.value);
      if (!Number.isFinite(value)) {
        restoreBankInputValue(input, bank);
        clearBankInputFailure(bank.id);
        return;
      }
      updatedBank.pricePerLitre = convertFromDisplay(value, 'pricePerVolumeL', state.settings.units);
    }
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

  const error = commitBankUpdate(bank, updatedBank);
  if (error) {
    restoreBankInputValue(input, bank);
    rejectBankEdit(bank, error);
  }
}

function updateWhatIfField(input, rerender) {
  const field = input.dataset.whatIfField;
  if (!field) return;
  let value = input.value;
  if (['pressureBar', 'ambientTemperatureC', 'inWaterTemperatureC'].includes(field)) {
    value = convertFromDisplay(
      Number.parseFloat(value),
      field === 'pressureBar' ? 'pressureBar' : 'temperatureC',
      state.settings.units
    );
  } else if (['oxygenPercent', 'heliumPercent'].includes(field)) {
    value = Number.parseFloat(value);
  } else if (field === 'waterSubmersionPercent') {
    value = Number.parseInt(value, 10);
  }
  state.whatIfScenario = applyWhatIfStartPatch(state.whatIfScenario, { [field]: value });
  state.whatIfErrors = [];
  runWhatIf({ renderEditor: rerender });
}

function updateWhatIfRow(input, rerender) {
  const rowId = input.dataset.rowId;
  const field = input.dataset.compareField;
  let index = state.whatIfScenario.rows.findIndex(row => row.id === rowId);
  const isAutomaticWait = index < 0 && input.dataset.compareField === 'waitMinutes' && rowId.endsWith('-wait');
  if (isAutomaticWait) {
    index = state.whatIfScenario.rows.findIndex(row => `${row.id}-wait` === rowId);
  }
  if (index < 0) return;
  const row = state.whatIfScenario.rows[index];
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
    updatedRow = { ...createCompareRow(value, row.id), waitMinutes: row.waitMinutes ?? 0 };
  } else if (field === 'bankId') updatedRow = { ...row, bankId: value || null };
  else if (field === 'pressureAddedBar' || (field === 'targetPressureBar' && row.type === 'add')) {
    const inputState = scenarioInputForCurrentDraft();
    const pressureStart = comparePressureStarts(inputState, expandWhatIfRows(state.whatIfScenario.rows))[row.id];
    updatedRow = normalizeComparePressureFields({
      ...row,
      [field]: value,
      pressureInputMode: input.dataset.pressureInputMode
    }, pressureStart);
  } else updatedRow = { ...row, [field]: value };
  const rows = state.whatIfScenario.rows.slice();
  rows[index] = updatedRow;
  state.whatIfScenario = {
    ...state.whatIfScenario,
    rows,
    draftRevision: state.whatIfScenario.draftRevision + 1
  };
  state.whatIfErrors = [];
  runWhatIf({ renderEditor: rerender });
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
  if (target.dataset.whatIfField) {
    updateWhatIfField(target, event.type === 'change');
    return;
  }
  if (target.dataset.compareField && target.dataset.rowId) {
    if (state.activeScreen === 'what-if') updateWhatIfRow(target, event.type === 'change');
    else updateCompareRow(target, event.type === 'change');
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
    updateSettingsDraft(target, event.type);
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
  if (event.type === 'change' && target.dataset.action === 'select-what-if-gas') {
    applyWhatIfGasPreset(target);
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
    if (target.id === 'cooling-medium') updateWaterSubmersionField();
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
      delete state.bankSuggestions[bank.id];
      persistSupplyBanks();
      recalculate();
    }
    return;
  }
  if (target.matches('[data-bank-field]')) updateBankFromInput(target);
}

function showInterimError(form, message) {
  let alert = form.querySelector('[data-interim-error]');
  if (!alert) {
    alert = document.createElement('p');
    alert.className = 'text-[11px] font-semibold text-rose-300 sm:col-span-3';
    alert.setAttribute('role', 'alert');
    alert.setAttribute('data-interim-error', '');
    form.append(alert);
  }
  alert.textContent = message;
}

function applyInterimMeasurement(actionElement) {
  const index = Number(actionElement.dataset.measurementIndex);
  const form = actionElement.closest('form');
  if (!Number.isInteger(index) || !form) return;
  if (typeof form.reportValidity === 'function' && !form.reportValidity()) return;

  const lockMessage = interimMeasurementLockMessage(state.interimMeasurements, index, 'apply');
  if (lockMessage) {
    showInterimError(form, lockMessage);
    return;
  }

  const pressureInput = form.querySelector('[name="pressureBar"]');
  const temperatureInput = form.querySelector('[name="temperatureC"]');
  const measurement = {
    pressureBar: convertFromDisplay(Number(pressureInput.value), 'pressureBar', state.settings.units),
    temperatureC: convertFromDisplay(Number(temperatureInput.value), 'temperatureC', state.settings.units)
  };
  const input = { ...readInput(), settings: state.settings };
  const interimMeasurements = state.interimMeasurements.slice();
  interimMeasurements[index] = measurement;
  const candidateInput = { ...input, thermal: { ...input.thermal, interimMeasurements } };
  const inputErrors = validateCalculatorInputs(
    candidateInput.cylinder,
    candidateInput.physics,
    candidateInput.thermal,
    { pressureLimitMode: state.settings.pressureLimitMode }
  );
  if (inputErrors.length > 0) {
    showInterimError(form, inputErrors.join(' '));
    return;
  }
  const verdict = verifyInterimMeasurement(candidateInput, index, measurement, {
    tolerancePercent: state.settings.interimPressureTolerancePercent,
    units: state.settings.units
  });
  if (!verdict.ok) {
    showInterimError(form, verdict.error);
    return;
  }
  state.interimMeasurementSignature = calculatorInputSignature(input);
  state.interimMeasurements = interimMeasurements;
  recalculate();
}

function clearInterimMeasurement(actionElement) {
  const index = Number(actionElement.dataset.measurementIndex);
  const form = actionElement.closest('form');
  if (!Number.isInteger(index)) return;
  const lockMessage = interimMeasurementLockMessage(state.interimMeasurements, index, 'clear');
  if (lockMessage) {
    if (form) showInterimError(form, lockMessage);
    return;
  }
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

function updateWhatIfRows(rows) {
  state.whatIfScenario = {
    ...state.whatIfScenario,
    rows,
    draftRevision: state.whatIfScenario.draftRevision + 1
  };
  state.whatIfErrors = [];
  runWhatIf();
}

function moveWhatIfRow(rowId, offset) {
  const rows = state.whatIfScenario.rows.slice();
  const index = rows.findIndex(row => row.id === rowId);
  const destination = index + offset;
  if (index < 0 || destination < 0 || destination >= rows.length) return;
  [rows[index], rows[destination]] = [rows[destination], rows[index]];
  updateWhatIfRows(rows);
}

function handleDragStart(event) {
  const handle = event.target.closest?.('[data-action="drag-compare-row"]');
  if (!handle || state.activeScreen !== 'what-if' || !event.dataTransfer) return;
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData('text/plain', handle.dataset.rowId);
}

function handleDragOver(event) {
  if (state.activeScreen !== 'what-if' || !event.target.closest?.('#compare-recipe-editor fieldset[data-row-id]')) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
}

function handleDrop(event) {
  if (state.activeScreen !== 'what-if') return;
  const target = event.target.closest?.('#compare-recipe-editor fieldset[data-row-id]');
  if (!target || !event.dataTransfer) return;
  event.preventDefault();
  const sourceId = event.dataTransfer.getData('text/plain');
  const targetId = target.dataset.rowId;
  if (!sourceId || sourceId === targetId) return;
  const rows = state.whatIfScenario.rows.slice();
  const sourceIndex = rows.findIndex(row => row.id === sourceId);
  const targetIndex = rows.findIndex(row => row.id === targetId);
  if (sourceIndex < 0 || targetIndex < 0) return;
  const [row] = rows.splice(sourceIndex, 1);
  rows.splice(targetIndex, 0, row);
  updateWhatIfRows(rows);
}

function handleClick(event) {
  const actionElement = event.target.closest('[data-action]');
  if (!actionElement || actionElement.disabled) return;

  switch (actionElement.dataset.action) {
    case 'add-compare-row':
      if (state.activeScreen === 'what-if') {
        const row = createCompareRow('drain', `compare-row-${nextCompareRowNumber++}`);
        row.waitMinutes = 0;
        updateWhatIfRows([...state.whatIfScenario.rows, row]);
      } else {
        state.compareRows.push(createCompareRow('drain', `compare-row-${nextCompareRowNumber++}`));
        state.compareErrors = [];
        renderCompareErrors();
        renderCompareEditor();
      }
      break;
    case 'remove-compare-row':
      if (state.activeScreen === 'what-if') {
        updateWhatIfRows(state.whatIfScenario.rows.filter(row => row.id !== actionElement.dataset.rowId));
      } else {
        state.compareRows = state.compareRows.filter(row => row.id !== actionElement.dataset.rowId);
        state.compareErrors = [];
        renderCompareErrors();
        renderCompareEditor();
      }
      break;
    case 'move-compare-row-up':
      if (state.activeScreen === 'what-if') moveWhatIfRow(actionElement.dataset.rowId, -1);
      else moveCompareRow(actionElement.dataset.rowId, -1);
      break;
    case 'move-compare-row-down':
      if (state.activeScreen === 'what-if') moveWhatIfRow(actionElement.dataset.rowId, 1);
      else moveCompareRow(actionElement.dataset.rowId, 1);
      break;
    case 'run-compare':
      runCompare();
      break;
    case 'copy-what-if-from-blending':
      copyWhatIfFromBlending();
      break;
    case 'add-bank':
      addBank();
      break;
    case 'remove-bank':
      removeBank(actionElement.dataset.bankId);
      break;
    case 'calculate-bank-price':
      calculateBankPrice(actionElement.dataset.bankId);
      break;
    case 'apply-bank-price':
      applyBankPrice(actionElement.dataset.bankId);
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
      changeTernaryZoom(activeResultRoot().querySelector?.('[data-result-key="ternary-canvas"]'), renderTernary, 1);
      break;
    case 'ternary-zoom-out':
      changeTernaryZoom(activeResultRoot().querySelector?.('[data-result-key="ternary-canvas"]'), renderTernary, -1);
      break;
    case 'ternary-zoom-reset':
      changeTernaryZoom(activeResultRoot().querySelector?.('[data-result-key="ternary-canvas"]'), renderTernary, 0);
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
  document.addEventListener('dragstart', handleDragStart);
  document.addEventListener('dragover', handleDragOver);
  document.addEventListener('drop', handleDrop);
  applyTheme(state.theme);
  convertDisplayedInputs(METRIC_UNITS, state.settings.units);
  setPrimaryScreen(document, state.activeScreen);
  updateStorageWarning();
  refreshPresetOptions();
  updateWaitModeFields();
  updateWaterSubmersionField();
  observeTernaryCanvas(document.querySelector('[data-result-host="blending"] [data-result-key="ternary-canvas"]'), renderTernary);
  const whatIfResultRoot = byId('what-if-result-host')?.querySelector?.('[data-result-panel]')
    ?? byId('what-if-result-host');
  observeTernaryCanvas(
    whatIfResultRoot?.querySelector?.('[data-result-key="ternary-canvas"]')
      ?? whatIfResultRoot?.querySelector?.('#ternary-canvas'),
    () => renderTernary('what-if'),
    whatIfResultRoot
  );
  recalculate();
  if (!state.onboarding.consentAccepted) {
    state.onboardingController.open({ requireConsent: true });
  } else {
    loadAnalytics(document, window);
    if (!state.onboarding.wizardSeen) state.onboardingController.open();
  }
}


initialize();
