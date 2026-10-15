import { calculatorInputSignature, signatureAfterClearingMeasurement } from './interim-measurements.js';
import { optimizeBlend } from './optimizer.js';
import { isValidGasComposition, parseNumericInput, splitGasInput } from './gas-input.js';
import { validateCalculatorInputs, validateSupplyBankInput } from './input-validation.js';
import { buildCompareProtocol, createCompareRow, normalizeComparePressureFields, validateCompareRecipe } from './compare-recipe.js';
import { simulateCompareProtocol } from './thermodynamics.js';
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
import { resetApplicationState } from './factory-reset.js';
import { analyzePresetSource, mergeSelectedPresets, PRESET_IMPORT_DEFAULT_URLS } from './preset-import.js';
import { loadSupplyBanks, saveSupplyBanks } from './bank-storage.js';
import { loadTheme, saveTheme } from './theme.js';
import { loadOnboardingState } from './onboarding.js';
import { loadAnalytics } from './analytics.js';
import { createOnboardingController } from './ui/onboarding.js';
import { renderCompareRecipe } from './ui/compare-recipe.js';
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
  settingsCategory: 'model',
  settingsImport: createPresetImportState(),
  theme: loadTheme(settingsStorage),
  onboarding: null,
  onboardingController: null,
  onboardingLoadFailure: null,
  settingsLoadFailure,
  banksLoadFailure,
  bankSaveFailure: null,
  bankInputFailure: null,
  activeTab: 'recipe',
  interimMeasurements: [],
  interimMeasurementSignature: null,
  lastInput: null,
  lastResult: null,
  mode: 'optimize',
  compareRows: [createCompareRow('keep', 'compare-row-1')],
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

state.onboarding = loadOnboardingState(settingsStorage, error => {
  state.onboardingLoadFailure = error;
});
state.onboardingController = createOnboardingController({
  document,
  storage: settingsStorage,
  initialState: state.onboarding,
  onNavigate: destination => {
    const settingsDialog = byId('settings-dialog');
    const settingsCategory = destination?.settingsCategory ?? null;
    if (settingsCategory) {
      if (!settingsDialog.open) openSettings();
      setSettingsCategory(settingsCategory);
      onboardingSettingsOpen = true;
    } else {
      if (onboardingSettingsOpen && settingsDialog.open) settingsDialog.close();
      onboardingSettingsOpen = false;
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
  const categories = ['model', 'gas-presets', 'cylinder-presets', 'equipment', 'preset-management'];
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
  state.settingsSession += 1;
  state.settingsDraft = copySettings(state.settings);
  resetPresetImportState();
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
      targetTemperatureC: numberValue('wait-target-temperature'),
      interimMeasurements: state.interimMeasurements
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
  const errors = validateCalculatorInputs({ ...input.cylinder, targetPressureBar }, input.physics, input.thermal);
  if (!isValidGasComposition(input.cylinder.initialOxygenPercent, input.cylinder.initialHeliumPercent)) {
    errors.push('Initial oxygen and helium percentages must total no more than 100%.');
  }
  if (!['ideal', 'vdw'].includes(input.physics.model)) {
    errors.push('Physics model must be ideal or vdw.');
  }
  return errors;
}

function comparePressureStarts(initialPressureBar = compareInput().cylinder.initialPressureBar) {
  const starts = {};
  let currentPressure = initialPressureBar;
  for (const row of state.compareRows) {
    if (row.type !== 'add') continue;
    starts[row.id] = currentPressure;
    const normalized = normalizeComparePressureFields(row, currentPressure);
    if (Number.isFinite(normalized.targetPressureBar)) currentPressure = normalized.targetPressureBar;
  }
  return starts;
}

function renderCompareEditor() {
  renderCompareRecipe(byId('compare-recipe-editor'), {
    rows: state.compareRows,
    banks: state.banks,
    errors: state.compareErrors,
    pressureStarts: comparePressureStarts()
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

function ternaryData() {
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

function renderCompareResult() {
  const compare = state.lastCompareResult?.compare;
  if (!compare) {
    clearTernaryDiagram(byId('ternary-canvas'));
    return;
  }
  renderResults(state.lastCompareResult, state.lastCompareInput);
  renderThermalCharts(state.lastCompareResult, state.lastCompareInput);
  renderTernary();
}

function runCompare() {
  const input = compareInput();
  const sharedErrors = compareSharedInputErrors(input);
  const validation = validateCompareRecipe(state.compareRows, {
    cylinder: input.cylinder,
    banks: input.banks,
    physics: input.physics,
    settings: input.settings
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
      settings: input.settings
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
      compare: { ...protocol, ...simulation }
    };
    state.compareHasRun = true;
    state.compareErrors = [];
    renderCompareErrors();
    renderCompareEditor();
    updateCompareStatus('Comparison run.');
    renderCompareResult();
    setTab('recipe');
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
  if (state.mode === 'compare') {
    renderCompareResult();
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
  const inputErrors = validateCalculatorInputs(input.cylinder, input.physics, input.thermal);
  const result = inputErrors.length > 0 ? invalidInputResult(inputErrors) : optimizeBlend(input);
  state.lastInput = input;
  state.lastResult = result;

  renderResults(result, input);
  renderThermalCharts(result, input);
  if (result.feasible) renderTernary();
  else clearTernaryDiagram(byId('ternary-canvas'));
}
function setMode(mode) {
  if (!['optimize', 'compare'].includes(mode)) return;
  state.mode = mode;
  for (const control of document.querySelectorAll('[data-action="select-mode"]')) {
    const selected = control.dataset.mode === mode;
    control.setAttribute('aria-pressed', String(selected));
    control.className = selected
      ? 'rounded-lg border border-cyan-500/40 bg-cyan-500/20 px-3 py-1.5 text-xs font-semibold text-cyan-300'
      : 'rounded-lg px-3 py-1.5 text-xs font-semibold text-slate-400';
  }
  byId('target-state-section').hidden = mode === 'compare';
  byId('supply-banks-section').hidden = mode === 'compare';
  byId('compare-recipe-section').hidden = mode !== 'compare';
  if (mode === 'compare') {
    renderCompareErrors();
    renderCompareEditor();
    renderCompareResult();
  } else if (state.lastResult) {
    renderResults(state.lastResult, state.lastInput);
    renderThermalCharts(state.lastResult, state.lastInput);
    if (state.lastResult.feasible) renderTernary();
    else clearTernaryDiagram(byId('ternary-canvas'));
  }
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

function updateCompareRow(input, rerender) {
  const index = state.compareRows.findIndex(row => row.id === input.dataset.rowId);
  if (index < 0) return;
  const row = state.compareRows[index];
  const field = input.dataset.compareField;
  let value = input.value;
  if (['pressureAddedBar', 'targetPressureBar', 'waitMinutes', 'targetTemperatureC'].includes(field)) {
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
    case 'select-mode':
      setMode(actionElement.dataset.mode);
      break;
    case 'add-compare-row':
      state.compareRows.push(createCompareRow('keep', `compare-row-${nextCompareRowNumber++}`));
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
    case 'open-wizard':
      state.onboardingController.open();
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
  document.addEventListener('paste', handleGasPaste);
  byId('settings-dialog').addEventListener('close', handleSettingsClosed);
  applyTheme(state.theme);
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
