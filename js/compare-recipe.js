import { isValidGasComposition } from './gas-input.js';
import { calcMolarDensity, calcPressure } from './physics.js';
import { calculateBoosterFillRate } from './thermodynamics.js';

export const COMPARE_ROW_TYPES = [
  { value: 'keep', label: 'Keep' },
  { value: 'add', label: 'Add gas' },
  { value: 'wait', label: 'Wait' }
];

// Retained until the Compare editor switches to automatic stage selection.
export const COMPARE_METHODS = [
  { value: 'decant', label: 'Decant' },
  { value: 'boost', label: 'Boost' },
  { value: 'compressor', label: 'Compressor' }
];

const MAX_PRESSURE_BAR = 350;
const MAX_WAIT_MINUTES = 1440;
const MIN_WAIT_TEMPERATURE_C = -100;
const MAX_WAIT_TEMPERATURE_C = 100;
const PRESSURE_TOLERANCE_BAR = 1e-7;
const STEP_COLORS = ['#06b6d4', '#f59e0b', '#10b981', '#a855f7', '#ec4899'];

export function createCompareRow(type = 'keep', id = `compare-${Date.now()}-${Math.random()}`) {
  if (type === 'add') {
    return {
      id,
      type,
      bankId: null,
      pressureAddedBar: 0,
      targetPressureBar: 0,
      pressureInputMode: 'added'
    };
  }
  if (type === 'wait') {
    return {
      id,
      type,
      waitMode: 'minutes',
      waitMinutes: 0,
      targetPressureBar: null,
      targetTemperatureC: null
    };
  }
  return { id, type: 'keep' };
}

export function normalizeComparePressureFields(row, receiverStartPressureBar) {
  if (row.pressureInputMode === 'target') {
    return {
      ...row,
      pressureAddedBar: row.targetPressureBar - receiverStartPressureBar
    };
  }
  return {
    ...row,
    targetPressureBar: receiverStartPressureBar + row.pressureAddedBar
  };
}

function cloneRow(row) {
  return { ...row };
}

function error(errors, rowId, field, message) {
  errors.push({ rowId, field, message });
}

function validPressure(value) {
  return Number.isFinite(value) && value >= 0 && value <= MAX_PRESSURE_BAR;
}

function receiverPressureCeiling(cylinder) {
  return Number.isFinite(cylinder?.workingPressureBar) && cylinder.workingPressureBar >= 0
    ? Math.min(MAX_PRESSURE_BAR, cylinder.workingPressureBar)
    : MAX_PRESSURE_BAR;
}

function validTemperature(value) {
  return Number.isFinite(value)
    && value >= MIN_WAIT_TEMPERATURE_C
    && value <= MAX_WAIT_TEMPERATURE_C;
}

function copiedBank(bank) {
  return {
    id: bank.id,
    name: bank.name,
    volumeL: bank.volumeL,
    pressureBar: bank.pressureBar,
    oxygenPercent: bank.oxygenPercent,
    heliumPercent: bank.heliumPercent,
    enabled: bank.enabled
  };
}

function indexedBanks(banks) {
  const byId = new Map();
  const duplicateIds = new Set();
  for (const bank of Array.isArray(banks) ? banks : []) {
    if (!bank || typeof bank.id !== 'string' || bank.id.length === 0) continue;
    if (byId.has(bank.id)) duplicateIds.add(bank.id);
    else byId.set(bank.id, bank);
  }
  return { byId, duplicateIds };
}

function isUsableBank(bank) {
  return bank?.enabled === true
    && typeof bank.name === 'string' && bank.name.trim().length > 0
    && Number.isFinite(bank.volumeL) && bank.volumeL > 0
    && validPressure(bank.pressureBar)
    && isValidGasComposition(bank.oxygenPercent, bank.heliumPercent);
}

function validateAddRow(row, rowId, currentPressure, pressureCeilingBar, bankIndex, errors) {
  if (!['added', 'target'].includes(row.pressureInputMode)) {
    error(errors, rowId, 'pressureInputMode', 'Choose whether pressure added or receiver target is being edited.');
    return currentPressure;
  }

  const bank = bankIndex.byId.get(row.bankId);
  if (!bank || bankIndex.duplicateIds.has(row.bankId) || !isUsableBank(bank)) {
    error(errors, rowId, 'bankId', 'Select an enabled supply bank with valid finite inventory.');
  } else {
    row.sourceBank = copiedBank(bank);
  }

  const activePressure = row.pressureInputMode === 'target'
    ? row.targetPressureBar
    : row.pressureAddedBar;
  const activeField = row.pressureInputMode === 'target'
    ? 'targetPressureBar'
    : 'pressureAddedBar';
  if (!validPressure(activePressure)) {
    error(errors, rowId, activeField, `${activeField === 'targetPressureBar' ? 'Receiver target pressure' : 'Pressure added'} must be between 0 and 350 bar.`);
    return currentPressure;
  }
  if (!Number.isFinite(currentPressure)) return currentPressure;

  const normalized = normalizeComparePressureFields(row, currentPressure);
  if (!validPressure(normalized.targetPressureBar)) {
    error(errors, rowId, 'targetPressureBar', 'Add target pressure must be between 0 and 350 bar.');
    return currentPressure;
  }
  if (normalized.targetPressureBar > pressureCeilingBar) {
    error(errors, rowId, 'targetPressureBar', `Add target pressure cannot exceed the cylinder working pressure of ${pressureCeilingBar} bar.`);
    return currentPressure;
  }
  if (normalized.pressureAddedBar < 0 || normalized.targetPressureBar < currentPressure) {
    error(errors, rowId, activeField, 'Add target pressure cannot be below the current pressure.');
    return currentPressure;
  }

  Object.assign(row, normalized);
  return row.targetPressureBar;
}

export function validateCompareRecipe(rows, { cylinder, banks = [], physics, settings, waitStates = {} } = {}) {
  const errors = [];
  if (!Array.isArray(rows) || rows.length === 0) {
    error(errors, null, 'recipe', 'Add at least one recipe row.');
    return { valid: false, errors, normalizedRows: [] };
  }

  const normalizedRows = rows.map(cloneRow);
  const bankIndex = indexedBanks(banks);
  const pressureCeilingBar = receiverPressureCeiling(cylinder);
  let currentPressure = cylinder?.initialPressureBar;
  if (!validPressure(currentPressure)) currentPressure = null;

  for (const row of normalizedRows) {
    const { id: rowId, type } = row;
    if (!['keep', 'add', 'wait'].includes(type)) {
      error(errors, rowId, 'type', 'Select a valid recipe row type.');
      continue;
    }
    if (type === 'add') {
      currentPressure = validateAddRow(row, rowId, currentPressure, pressureCeilingBar, bankIndex, errors);
      continue;
    }
    if (type === 'wait') {
      if (!['minutes', 'target'].includes(row.waitMode)) {
        error(errors, rowId, 'waitMode', 'Choose a valid wait mode.');
      } else if (row.waitMode === 'minutes') {
        if (!Number.isFinite(row.waitMinutes) || row.waitMinutes < 0 || row.waitMinutes > MAX_WAIT_MINUTES) {
          error(errors, rowId, 'waitMinutes', 'Wait duration must be between 0 and 1440 minutes.');
        }
      } else {
        if (!validPressure(row.targetPressureBar)) {
          error(errors, rowId, 'targetPressureBar', 'Target wait pressure must be between 0 and 350 bar.');
        }
        if (!validTemperature(row.targetTemperatureC)) {
          error(errors, rowId, 'targetTemperatureC', 'Target wait temperature must be between -100 and 100 °C.');
        }
      }
      const waitPressureBar = waitStates[rowId]?.pressureBar;
      if (Number.isFinite(waitPressureBar)) currentPressure = waitPressureBar;
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

function receiverAfterAddedMoles(receiver, addedMoles, sourceBank, volumeL, temperatureC, useVdw) {
  const receiverTemperatureC = Number.isFinite(receiver.temperatureC)
    ? receiver.temperatureC
    : temperatureC;
  const totalMoles = receiver.totalMoles + addedMoles;
  const oxygenMoles = receiver.oxygenMoles + addedMoles * (sourceBank.oxygenPercent / 100);
  const heliumMoles = receiver.heliumMoles + addedMoles * (sourceBank.heliumPercent / 100);
  const mix = mixFromMoles(totalMoles, oxygenMoles, heliumMoles);
  return {
    totalMoles,
    oxygenMoles,
    heliumMoles,
    mix,
    temperatureC: receiverTemperatureC,
    pressureBar: calcPressure(
      totalMoles / volumeL,
      mix.oxygenPercent,
      mix.heliumPercent,
      receiverTemperatureC,
      useVdw
    )
  };
}

function pressureForSourceMoles(moles, bank, temperatureC, useVdw) {
  return calcPressure(
    Math.max(0, moles) / bank.volumeL,
    bank.oxygenPercent,
    bank.heliumPercent,
    temperatureC,
    useVdw
  );
}

function solveAddedMoles(receiver, targetPressureBar, sourceBank, volumeL, temperatureC, useVdw) {
  if (targetPressureBar <= receiver.pressureBar + PRESSURE_TOLERANCE_BAR) return 0;
  const receiverTemperatureC = Number.isFinite(receiver.temperatureC)
    ? receiver.temperatureC
    : temperatureC;

  let high = Math.max(
    1,
    calcMolarDensity(
      targetPressureBar,
      sourceBank.oxygenPercent,
      sourceBank.heliumPercent,
      receiverTemperatureC,
      useVdw
    ) * volumeL
  );
  let highState = receiverAfterAddedMoles(receiver, high, sourceBank, volumeL, temperatureC, useVdw);
  while (highState.pressureBar < targetPressureBar && high < 1e9) {
    high *= 2;
    highState = receiverAfterAddedMoles(receiver, high, sourceBank, volumeL, temperatureC, useVdw);
  }
  if (highState.pressureBar < targetPressureBar) {
    throw new RangeError('Supply bank transfer cannot reach the requested receiver pressure.');
  }

  let low = 0;
  for (let iteration = 0; iteration < 80; iteration++) {
    const middle = (low + high) / 2;
    const pressureBar = receiverAfterAddedMoles(
      receiver,
      middle,
      sourceBank,
      volumeL,
      temperatureC,
      useVdw
    ).pressureBar;
    if (pressureBar < targetPressureBar) low = middle;
    else high = middle;
  }
  return (low + high) / 2;
}

function solveEqualizationMoles(receiver, sourceMoles, requiredMoles, sourceBank, volumeL, temperatureC, useVdw) {
  let low = 0;
  let high = requiredMoles;
  for (let iteration = 0; iteration < 80; iteration++) {
    const middle = (low + high) / 2;
    const receiverPressureBar = receiverAfterAddedMoles(
      receiver,
      middle,
      sourceBank,
      volumeL,
      temperatureC,
      useVdw
    ).pressureBar;
    const sourcePressureBar = pressureForSourceMoles(
      sourceMoles - middle,
      sourceBank,
      temperatureC,
      useVdw
    );
    if (sourcePressureBar > receiverPressureBar) low = middle;
    else high = middle;
  }
  return (low + high) / 2;
}

function sourceState(bank, moles, temperatureC, useVdw) {
  return {
    bankId: bank.id,
    name: bank.name,
    volumeL: bank.volumeL,
    pressureBar: pressureForSourceMoles(moles, bank, temperatureC, useVdw),
    moles,
    oxygenPercent: bank.oxygenPercent,
    heliumPercent: bank.heliumPercent
  };
}

function transferRate(type, sourceStart, sourceEnd, receiverStart, receiverEnd, limits, receiverVolumeL, temperatureC, useVdw) {
  const pressureIncreaseBar = Math.max(0, receiverEnd.pressureBar - receiverStart.pressureBar);
  if (type === 'decant' || type === 'equalize') {
    const rateBarPerMin = sourceStart.oxygenPercent >= 40
      ? limits.oxygenDecantRateBarPerMin
      : limits.otherDecantRateBarPerMin;
    return {
      source: 'decant',
      rateBarPerMin,
      estimatedDurationMinutes: pressureIncreaseBar / rateBarPerMin
    };
  }

  const boosterBpm = sourceStart.oxygenPercent >= 40
    ? limits.oxygenBoostBpm
    : limits.otherBoostBpm;
  const rateBarPerMin = calculateBoosterFillRate({
    cylinderVolumeCm3: limits.cylinderVolumeCm3,
    bpm: boosterBpm,
    sourcePressureBar: (sourceStart.pressureBar + sourceEnd.pressureBar) / 2,
    receiverPressureBar: (receiverStart.pressureBar + receiverEnd.pressureBar) / 2,
    sourceOxygenPercent: sourceStart.oxygenPercent,
    sourceHeliumPercent: sourceStart.heliumPercent,
    receiverOxygenPercent: receiverEnd.mix.oxygenPercent,
    receiverHeliumPercent: receiverEnd.mix.heliumPercent,
    receiverVolumeL,
    temperatureC,
    useVdw
  }).fillRateBarPerMin;
  return {
    source: 'booster',
    boosterBpm,
    boosterCylinderVolumeCm3: limits.cylinderVolumeCm3,
    rateBarPerMin,
    estimatedDurationMinutes: pressureIncreaseBar / rateBarPerMin
  };
}

function plannedTransferStep(type, row, sourceStart, sourceEnd, receiverStart, receiverEnd, limits, receiverVolumeL, temperatureC, useVdw) {
  const operation = type[0].toUpperCase() + type.slice(1);
  return {
    type,
    compareRowId: row.id,
    sourceBankId: row.sourceBank.id,
    sourceBankName: row.sourceBank.name,
    sourceComposition: {
      oxygenPercent: row.sourceBank.oxygenPercent,
      heliumPercent: row.sourceBank.heliumPercent
    },
    sourceOxygenPercent: row.sourceBank.oxygenPercent,
    sourceHeliumPercent: row.sourceBank.heliumPercent,
    sourceStartPressureBar: sourceStart.pressureBar,
    sourceEndPressureBar: sourceEnd.pressureBar,
    sourceState: sourceEnd,
    sourceMolesAfter: sourceEnd.moles,
    receiverStartPressureBar: receiverStart.pressureBar,
    receiverEndPressureBar: receiverEnd.pressureBar,
    resultingPressureBar: receiverEnd.pressureBar,
    resultingMix: { ...receiverEnd.mix },
    transferRate: transferRate(
      type,
      sourceStart,
      sourceEnd,
      receiverStart,
      receiverEnd,
      limits,
      receiverVolumeL,
      temperatureC,
      useVdw
    ),
    operation,
    recipeAction: operation,
    recipeGas: row.sourceBank.name,
    title: operation,
    recipeLabel: operation
  };
}

function passiveStep(row, receiver) {
  const operation = row.type === 'wait' ? 'Wait' : 'Keep';
  return {
    ...row,
    type: row.type,
    compareRowId: row.id,
    sourceBankId: null,
    sourceStartPressureBar: null,
    sourceEndPressureBar: null,
    sourceState: null,
    receiverStartPressureBar: receiver.pressureBar,
    receiverEndPressureBar: receiver.pressureBar,
    resultingPressureBar: receiver.pressureBar,
    resultingMix: { ...receiver.mix },
    operation,
    recipeAction: operation,
    recipeGas: null,
    title: operation,
    recipeLabel: operation
  };
}

function equipmentLimits(settings) {
  const booster = settings?.booster ?? {};
  return {
    minimumSourcePressureBar: Number.isFinite(booster.minimumSourcePressureBar)
      ? booster.minimumSourcePressureBar
      : 0,
    maxBoosterOutputPressureBar: Number.isFinite(booster.maxBoosterOutputPressureBar)
      ? booster.maxBoosterOutputPressureBar
      : MAX_PRESSURE_BAR,
    oxygenDecantRateBarPerMin: Number.isFinite(booster.oxygenDecantRateBarPerMin)
      ? booster.oxygenDecantRateBarPerMin
      : 5,
    otherDecantRateBarPerMin: Number.isFinite(booster.otherDecantRateBarPerMin)
      ? booster.otherDecantRateBarPerMin
      : 10,
    cylinderVolumeCm3: Number.isFinite(booster.cylinderVolumeCm3)
      ? booster.cylinderVolumeCm3
      : 9,
    oxygenBoostBpm: Number.isFinite(booster.oxygenBoostBpm)
      ? booster.oxygenBoostBpm
      : 35,
    otherBoostBpm: Number.isFinite(booster.otherBoostBpm)
      ? booster.otherBoostBpm
      : 50
  };
}

function addTrajectoryPoint(trajectory, step, currentStep) {
  if (step.type === 'keep') return currentStep;
  const trajectoryStep = currentStep + 1;
  trajectory.push(trajectoryPoint(
    trajectoryStep,
    `Step ${trajectoryStep}`,
    step.resultingMix,
    step.resultingPressureBar,
    step.resultingPressureBar - step.receiverStartPressureBar,
    STEP_COLORS[(trajectoryStep - 1) % STEP_COLORS.length]
  ));
  return trajectoryStep;
}

export function buildCompareProtocol(rows, { cylinder, physics, banks = [], settings, waitStates = {} } = {}) {
  const validation = validateCompareRecipe(rows, { cylinder, banks, physics, settings, waitStates });
  if (!validation.valid) {
    throw new Error(`Invalid compare recipe: ${validation.errors.map(({ message }) => message).join(' ')}`);
  }
  if (!Number.isFinite(cylinder?.volumeL) || cylinder.volumeL <= 0 || !validPressure(cylinder.initialPressureBar)) {
    throw new RangeError('Compare protocol requires a finite cylinder volume and initial pressure.');
  }
  if (!Number.isFinite(physics?.temperatureC)) {
    throw new RangeError('Compare protocol requires a finite gas temperature.');
  }

  const { volumeL, initialPressureBar, initialOxygenPercent, initialHeliumPercent } = cylinder;
  const { temperatureC, model } = physics;
  const useVdw = model !== 'ideal';
  const receiverPressureCeilingBar = receiverPressureCeiling(cylinder);
  if (initialPressureBar > receiverPressureCeilingBar + PRESSURE_TOLERANCE_BAR) {
    throw new RangeError(`Compare protocol initial pressure cannot exceed the cylinder working pressure of ${receiverPressureCeilingBar} bar.`);
  }
  const limits = equipmentLimits(settings);
  const bankIndex = indexedBanks(banks);
  const bankStates = new Map();
  for (const bank of bankIndex.byId.values()) {
    bankStates.set(bank.id, {
      bank: copiedBank(bank),
      moles: calcMolarDensity(
        bank.pressureBar,
        bank.oxygenPercent,
        bank.heliumPercent,
        temperatureC,
        useVdw
      ) * bank.volumeL
    });
  }

  const initialMix = {
    oxygenPercent: initialOxygenPercent,
    heliumPercent: initialHeliumPercent
  };
  const initialMoles = calcMolarDensity(
    initialPressureBar,
    initialMix.oxygenPercent,
    initialMix.heliumPercent,
    temperatureC,
    useVdw
  ) * volumeL;
  let receiver = {
    totalMoles: initialMoles,
    oxygenMoles: initialMoles * (initialMix.oxygenPercent / 100),
    heliumMoles: initialMoles * (initialMix.heliumPercent / 100),
    mix: initialMix,
    pressureBar: initialPressureBar
  };
  const protocolSteps = [];
  const trajectory = [trajectoryPoint(0, 'Start Mix', receiver.mix, receiver.pressureBar, 0, '#f43f5e')];
  let trajectoryStep = 0;

  for (const row of validation.normalizedRows) {
    if (row.type !== 'add') {
      const step = passiveStep(row, receiver);
      const waitState = row.type === 'wait' ? waitStates[row.id] : null;
      if (Number.isFinite(waitState?.pressureBar)) {
        const hasMoles = [waitState.totalMoles, waitState.oxygenMoles, waitState.heliumMoles].every(Number.isFinite);
        receiver = hasMoles
          ? {
            totalMoles: waitState.totalMoles,
            oxygenMoles: waitState.oxygenMoles,
            heliumMoles: waitState.heliumMoles,
            mix: waitState.mix ?? receiver.mix,
            pressureBar: waitState.pressureBar,
            temperatureC: Number.isFinite(waitState.temperatureC)
              ? waitState.temperatureC
              : (receiver.temperatureC ?? temperatureC)
          }
          : { ...receiver, pressureBar: waitState.pressureBar };
        step.receiverEndPressureBar = waitState.pressureBar;
        step.resultingPressureBar = waitState.pressureBar;
        step.resultingMix = { ...receiver.mix };
      }
      protocolSteps.push(step);
      trajectoryStep = addTrajectoryPoint(trajectory, step, trajectoryStep);
      continue;
    }

    const targetRow = normalizeComparePressureFields(row, receiver.pressureBar);
    const targetPressureBar = targetRow.targetPressureBar;
    if (targetPressureBar > receiverPressureCeilingBar + PRESSURE_TOLERANCE_BAR) {
      throw new RangeError(`Compare protocol target pressure cannot exceed the cylinder working pressure of ${receiverPressureCeilingBar} bar.`);
    }
    const source = bankStates.get(row.sourceBank.id);
    const sourceBank = source.bank;
    const requiredMoles = solveAddedMoles(
      receiver,
      targetPressureBar,
      sourceBank,
      volumeL,
      temperatureC,
      useVdw
    );
    const sourceMinimumMoles = calcMolarDensity(
      limits.minimumSourcePressureBar,
      sourceBank.oxygenPercent,
      sourceBank.heliumPercent,
      temperatureC,
      useVdw
    ) * sourceBank.volumeL;
    if (source.moles - requiredMoles < sourceMinimumMoles - 1e-9) {
      throw new RangeError(`Supply bank ${sourceBank.name} cannot retain its ${limits.minimumSourcePressureBar} bar minimum pressure for this transfer.`);
    }

    const receiverStart = receiver;
    const sourceStart = sourceState(sourceBank, source.moles, temperatureC, useVdw);
    const receiverFinal = receiverAfterAddedMoles(
      receiver,
      requiredMoles,
      sourceBank,
      volumeL,
      temperatureC,
      useVdw
    );
    receiverFinal.pressureBar = targetPressureBar;
    const sourceFinal = sourceState(sourceBank, source.moles - requiredMoles, temperatureC, useVdw);

    if (sourceFinal.pressureBar >= targetPressureBar - PRESSURE_TOLERANCE_BAR) {
      const step = plannedTransferStep(
        'decant',
        row,
        sourceStart,
        sourceFinal,
        receiverStart,
        receiverFinal,
        limits,
        volumeL,
        temperatureC,
        useVdw
      );
      protocolSteps.push(step);
      trajectoryStep = addTrajectoryPoint(trajectory, step, trajectoryStep);
    } else {
      if (targetPressureBar > limits.maxBoosterOutputPressureBar + PRESSURE_TOLERANCE_BAR) {
        throw new RangeError(`Supply bank transfer requires boosting above the ${limits.maxBoosterOutputPressureBar} bar booster output limit.`);
      }
      const sourceStartsAboveReceiver = sourceStart.pressureBar > receiverStart.pressureBar + PRESSURE_TOLERANCE_BAR;
      const equalizationMoles = sourceStartsAboveReceiver
        ? solveEqualizationMoles(
          receiver,
          source.moles,
          requiredMoles,
          sourceBank,
          volumeL,
          temperatureC,
          useVdw
        )
        : 0;
      if (equalizationMoles > PRESSURE_TOLERANCE_BAR) {
        const receiverEqualized = receiverAfterAddedMoles(
          receiver,
          equalizationMoles,
          sourceBank,
          volumeL,
          temperatureC,
          useVdw
        );
        const sourceEqualized = sourceState(
          sourceBank,
          source.moles - equalizationMoles,
          temperatureC,
          useVdw
        );
        receiverEqualized.pressureBar = sourceEqualized.pressureBar;
        const equalizeStep = plannedTransferStep(
          'equalize',
          row,
          sourceStart,
          sourceEqualized,
          receiverStart,
          receiverEqualized,
          limits,
          volumeL,
          temperatureC,
          useVdw
        );
        protocolSteps.push(equalizeStep);
        trajectoryStep = addTrajectoryPoint(trajectory, equalizeStep, trajectoryStep);
        const boostStep = plannedTransferStep(
          'boost',
          row,
          sourceEqualized,
          sourceFinal,
          receiverEqualized,
          receiverFinal,
          limits,
          volumeL,
          temperatureC,
          useVdw
        );
        protocolSteps.push(boostStep);
        trajectoryStep = addTrajectoryPoint(trajectory, boostStep, trajectoryStep);
      } else {
        const boostStep = plannedTransferStep(
          'boost',
          row,
          sourceStart,
          sourceFinal,
          receiverStart,
          receiverFinal,
          limits,
          volumeL,
          temperatureC,
          useVdw
        );
        protocolSteps.push(boostStep);
        trajectoryStep = addTrajectoryPoint(trajectory, boostStep, trajectoryStep);
      }
    }

    source.moles -= requiredMoles;
    receiver = receiverFinal;
  }

  return { protocolSteps, trajectory, initialMix };
}
