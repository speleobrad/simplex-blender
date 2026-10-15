import { isValidGasComposition } from './gas-input.js';
import { calcMolarDensity, calcPressure } from './physics.js';

export const COMPARE_ROW_TYPES = [
  { value: 'keep', label: 'Keep' },
  { value: 'drain', label: 'Drain' },
  { value: 'add', label: 'Add gas' },
  { value: 'wait', label: 'Wait' }
];

export const COMPARE_METHODS = [
  { value: 'decant', label: 'Decant' },
  { value: 'boost', label: 'Boost' },
  { value: 'compressor', label: 'Compressor' }
];

const MAX_PRESSURE_BAR = 350;
const MAX_WAIT_MINUTES = 1440;
const STEP_COLORS = ['#06b6d4', '#f59e0b', '#10b981', '#a855f7', '#ec4899'];

export function createCompareRow(type = 'keep', id = `compare-${Date.now()}-${Math.random()}`) {
  if (type === 'drain') return { id, type, targetPressureBar: 0 };
  if (type === 'add') {
    return {
      id,
      type,
      gas: { presetName: null, name: 'Custom gas', oxygenPercent: 21, heliumPercent: 0 },
      targetPressureBar: 0,
      method: 'decant',
      sourcePressureBar: null
    };
  }
  if (type === 'wait') return { id, type, waitMinutes: 0 };
  return { id, type: 'keep' };
}

function cloneRow(row) {
  return { ...row, gas: row?.gas ? { ...row.gas } : row?.gas };
}

function error(errors, rowId, field, message) {
  errors.push({ rowId, field, message });
}

function validPressure(value) {
  return Number.isFinite(value) && value >= 0 && value <= MAX_PRESSURE_BAR;
}

function normalizeGas(gas, gasPresets, rowId, errors) {
  const normalized = { ...gas };
  if (normalized.presetName !== null && normalized.presetName !== undefined) {
    const preset = gasPresets.find(({ name }) => name === normalized.presetName);
    if (!preset) {
      error(errors, rowId, 'gas', 'Select a valid gas preset.');
    } else {
      normalized.name = preset.name;
      normalized.oxygenPercent = preset.oxygenPercent;
      normalized.heliumPercent = preset.heliumPercent;
    }
  }
  if (!isValidGasComposition(normalized.oxygenPercent, normalized.heliumPercent)) {
    error(errors, rowId, 'gas', 'Gas oxygen and helium percentages must total no more than 100%.');
  }
  return normalized;
}

export function validateCompareRecipe(rows, { cylinder, gasPresets = [] } = {}) {
  const errors = [];
  if (!Array.isArray(rows) || rows.length === 0) {
    error(errors, null, 'recipe', 'Add at least one recipe row.');
    return { valid: false, errors, normalizedRows: [] };
  }

  const normalizedRows = rows.map(cloneRow);
  let currentPressure = cylinder?.initialPressureBar;
  if (!validPressure(currentPressure)) currentPressure = null;

  for (const row of normalizedRows) {
    const { id: rowId, type } = row;
    if (!['keep', 'drain', 'add', 'wait'].includes(type)) {
      error(errors, rowId, 'type', 'Select a valid recipe row type.');
      continue;
    }
    if (type === 'drain') {
      if (!validPressure(row.targetPressureBar)) {
        error(errors, rowId, 'targetPressureBar', 'Drain target pressure must be between 0 and 350 bar.');
      } else if (currentPressure !== null && row.targetPressureBar > currentPressure) {
        error(errors, rowId, 'targetPressureBar', 'Drain target pressure cannot exceed the current pressure.');
      } else {
        currentPressure = row.targetPressureBar;
      }
    }
    if (type === 'add') {
      row.gas = normalizeGas(row.gas || {}, gasPresets, rowId, errors);
      if (!validPressure(row.targetPressureBar)) {
        error(errors, rowId, 'targetPressureBar', 'Add target pressure must be between 0 and 350 bar.');
      } else if (currentPressure !== null && row.targetPressureBar < currentPressure) {
        error(errors, rowId, 'targetPressureBar', 'Add target pressure cannot be below the current pressure.');
      } else {
        currentPressure = row.targetPressureBar;
      }
      if (!COMPARE_METHODS.some(({ value }) => value === row.method)) {
        error(errors, rowId, 'method', 'Select a valid transfer method.');
      } else if (row.method === 'boost'
        && (!validPressure(row.sourcePressureBar) || row.sourcePressureBar <= 0)) {
        error(errors, rowId, 'sourcePressureBar', 'Boost source pressure must be greater than 0 and at most 350 bar.');
      } else if (row.method === 'compressor'
        && (row.gas.oxygenPercent !== 21 || row.gas.heliumPercent !== 0)) {
        error(errors, rowId, 'gas', 'Compressor rows require Air (21% oxygen and 0% helium).');
      }
    }
    if (type === 'wait'
      && (!Number.isFinite(row.waitMinutes) || row.waitMinutes < 0 || row.waitMinutes > MAX_WAIT_MINUTES)) {
      error(errors, rowId, 'waitMinutes', 'Wait duration must be between 0 and 1440 minutes.');
    }
  }

  return { valid: errors.length === 0, errors, normalizedRows };
}

function mixFromMoles(totalMoles, oxygenMoles, heliumMoles) {
  if (totalMoles <= 0) return { oxygenPercent: 0, heliumPercent: 0 };
  return {
    oxygenPercent: (oxygenMoles / totalMoles) * 100,
    heliumPercent: (heliumMoles / totalMoles) * 100
  };
}

function trajectoryPoint(step, label, mix, pressureBar, pressureDeltaBar, color) {
  return {
    step,
    label,
    oxygenPercent: mix.oxygenPercent,
    heliumPercent: mix.heliumPercent,
    nitrogenPercent: Math.max(0, 100 - mix.oxygenPercent - mix.heliumPercent),
    pressureBar,
    pressureDeltaBar,
    color
  };
}

export function buildCompareProtocol(rows, { cylinder, physics, gasPresets = [] } = {}) {
  const validation = validateCompareRecipe(rows, { cylinder, gasPresets });
  if (!validation.valid) {
    throw new Error(`Invalid compare recipe: ${validation.errors.map(({ message }) => message).join(' ')}`);
  }

  const { volumeL, initialPressureBar, initialOxygenPercent, initialHeliumPercent } = cylinder;
  const { temperatureC, model } = physics;
  const useVdw = model !== 'ideal';
  let currentPressure = initialPressureBar;
  let currentMix = { oxygenPercent: initialOxygenPercent, heliumPercent: initialHeliumPercent };
  let totalMoles = calcMolarDensity(currentPressure, currentMix.oxygenPercent, currentMix.heliumPercent, temperatureC, useVdw) * volumeL;
  let oxygenMoles = totalMoles * (currentMix.oxygenPercent / 100);
  let heliumMoles = totalMoles * (currentMix.heliumPercent / 100);
  const initialMix = { ...currentMix };
  const protocolSteps = [];
  const trajectory = [trajectoryPoint(0, 'Start Mix', currentMix, currentPressure, 0, '#f43f5e')];
  let trajectoryStep = 0;

  for (const row of validation.normalizedRows) {
    const receiverStartPressureBar = currentPressure;
    let sourceOxygenPercent = null;
    let sourceHeliumPercent = null;
    let recipeGas = null;

    if (row.type === 'drain') {
      const targetMoles = calcMolarDensity(row.targetPressureBar, currentMix.oxygenPercent, currentMix.heliumPercent, temperatureC, useVdw) * volumeL;
      const ratio = totalMoles > 0 ? targetMoles / totalMoles : 0;
      totalMoles = targetMoles;
      oxygenMoles *= ratio;
      heliumMoles *= ratio;
      currentPressure = row.targetPressureBar;
      currentMix = mixFromMoles(totalMoles, oxygenMoles, heliumMoles);
    } else if (row.type === 'add') {
      const targetMoles = calcMolarDensity(row.targetPressureBar, row.gas.oxygenPercent, row.gas.heliumPercent, temperatureC, useVdw) * volumeL;
      const addedMoles = targetMoles - totalMoles;
      totalMoles += addedMoles;
      oxygenMoles += addedMoles * (row.gas.oxygenPercent / 100);
      heliumMoles += addedMoles * (row.gas.heliumPercent / 100);
      currentMix = mixFromMoles(totalMoles, oxygenMoles, heliumMoles);
      currentPressure = calcPressure(totalMoles / volumeL, currentMix.oxygenPercent, currentMix.heliumPercent, temperatureC, useVdw);
      sourceOxygenPercent = row.gas.oxygenPercent;
      sourceHeliumPercent = row.gas.heliumPercent;
      recipeGas = row.gas.name;
    }

    const receiverEndPressureBar = row.type === 'wait' || row.type === 'keep'
      ? currentPressure
      : row.targetPressureBar;
    const operation = row.type === 'add'
      ? COMPARE_METHODS.find(({ value }) => value === row.method).label
      : COMPARE_ROW_TYPES.find(({ value }) => value === row.type).label;
    const step = {
      ...row,
      operation,
      receiverStartPressureBar,
      receiverEndPressureBar,
      resultingPressureBar: currentPressure,
      resultingMix: { ...currentMix },
      sourceOxygenPercent,
      sourceHeliumPercent,
      sourcePressureBar: row.type === 'add' && row.method === 'boost' ? row.sourcePressureBar : null,
      sourceBankId: null,
      sourceStartPressureBar: null,
      sourceEndPressureBar: null,
      recipeAction: operation,
      recipeGas,
      title: operation,
      recipeLabel: operation
    };
    protocolSteps.push(step);

    if (row.type !== 'keep') {
      trajectoryStep++;
      trajectory.push(trajectoryPoint(
        trajectoryStep,
        `Step ${trajectoryStep}`,
        currentMix,
        currentPressure,
        currentPressure - receiverStartPressureBar,
        STEP_COLORS[(trajectoryStep - 1) % STEP_COLORS.length]
      ));
    }
  }

  return { protocolSteps, trajectory, initialMix };
}
