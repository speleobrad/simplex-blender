import { GAS_CONSTANT, calcMolarDensity, calcPressure, calcZFromDensity, getMixParams } from './physics.js';
import { solveTwoPhaseSimplex } from './simplex.js';
import { isValidGasComposition } from './gas-input.js';
import { validateCalculatorInputs, validateSupplyBankInput } from './input-validation.js';
import { simulateThermalProtocol } from './thermodynamics.js';

const NORMAL_RETAINED_GAS_COST = -5;
const SAFETY_SOURCE_COST_RANGE = 10_101;

function retainedGasCost(targetMoles, prioritizeTransferSafety) {
  if (!prioritizeTransferSafety) return NORMAL_RETAINED_GAS_COST;
  // The total-moles equality bounds every source allocation by targetMoles.
  // This makes safety source-selection costs strictly secondary to retaining gas.
  return -(targetMoles * SAFETY_SOURCE_COST_RANGE + 1);
}

function bankVariableNames(activeBanks) {
  return activeBanks.map((bank, index) => `x_b${index + 1}_${bank.name.split(' ')[0]}`);
}

function solveLinearProgram(decisionVariableNames, slackVariableNames, constraints, decisionCosts) {
  const numDecisionVars = decisionVariableNames.length;
  const numConstraints = constraints.length;
  const numSlackVars = numConstraints;
  const totalVars = numDecisionVars + numSlackVars + 3;
  const rhsColumn = totalVars;
  const artificialColumnOffset = numDecisionVars + numSlackVars;
  const variableNames = [
    ...decisionVariableNames,
    's_eq1',
    's_eq2',
    's_eq3',
    ...slackVariableNames,
    'a_tot',
    'a_o2',
    'a_he'
  ];
  const tableau = Array.from({ length: numConstraints + 2 }, () => Array(totalVars + 1).fill(0));

  for (let i = 0; i < numConstraints; i++) {
    const { coefficients, rhs } = constraints[i];
    for (let j = 0; j < numDecisionVars; j++) tableau[i][j] = coefficients[j] ?? 0;
    tableau[i][rhsColumn] = rhs;
    if (i < 3) tableau[i][artificialColumnOffset + i] = 1;
    else tableau[i][numDecisionVars + i] = 1;
  }

  const costVector = Array(totalVars).fill(0);
  decisionCosts.forEach((cost, index) => {
    costVector[index] = cost;
  });
  const phase1ObjectiveRow = numConstraints;
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j <= rhsColumn; j++) tableau[phase1ObjectiveRow][j] -= tableau[i][j];
  }
  for (let i = 0; i < 3; i++) tableau[phase1ObjectiveRow][artificialColumnOffset + i] = 0;

  const solverResult = solveTwoPhaseSimplex(
    tableau,
    numDecisionVars,
    numConstraints,
    variableNames,
    costVector
  );
  if (solverResult.feasible) {
    for (let i = 0; i < numConstraints; i++) {
      const { coefficients, rhs } = constraints[i];
      let lhs = 0;
      let scale = Math.abs(rhs);
      for (let j = 0; j < numDecisionVars; j++) {
        const term = (coefficients[j] ?? 0)
          * (solverResult.solution[decisionVariableNames[j]] ?? 0);
        lhs += term;
        scale += Math.abs(term);
      }
      const tolerance = Math.max(1e-12, scale * 1e-9);
      const violation = i < 3 ? Math.abs(lhs - rhs) : lhs - rhs;
      if (!Number.isFinite(lhs) || !Number.isFinite(scale) || violation > tolerance) {
        return {
          feasible: false,
          error: 'Solver returned a solution outside the original LP constraints.',
          steps: solverResult.steps,
          variableNames
        };
      }
    }
  }

  return { ...solverResult, variableNames };
}

function solveTargetBlendAtMoles({
  initialMoles,
  targetMoles,
  initialOxygenPercent,
  initialHeliumPercent,
  targetOxygenPercent,
  targetHeliumPercent,
  activeBanks,
  bankMaxMoles,
  prioritizeTransferSafety = false,
  preferredBankId = null,
  excludedBankId = null
}) {
  const bankNames = bankVariableNames(activeBanks);
  const decisionVariableNames = ['x_cyl', ...bankNames];
  const sourceCount = decisionVariableNames.length;
  const constraints = [
    { coefficients: [1, ...activeBanks.map(() => 1)], rhs: targetMoles },
    {
      coefficients: [
        initialOxygenPercent / 100,
        ...activeBanks.map(bank => bank.oxygenPercent / 100)
      ],
      rhs: (targetOxygenPercent / 100) * targetMoles
    },
    {
      coefficients: [
        initialHeliumPercent / 100,
        ...activeBanks.map(bank => bank.heliumPercent / 100)
      ],
      rhs: (targetHeliumPercent / 100) * targetMoles
    },
    { coefficients: [1, ...activeBanks.map(() => 0)], rhs: initialMoles },
    ...activeBanks.map((bank, index) => {
      const coefficients = Array(sourceCount).fill(0);
      coefficients[index + 1] = 1;
      return {
        coefficients,
        rhs: bank.id === excludedBankId ? 0 : bankMaxMoles[index]
      };
    })
  ];
  const decisionCosts = [
    retainedGasCost(targetMoles, prioritizeTransferSafety),
    ...activeBanks.map(bank => {
      const oxygenFraction = bank.oxygenPercent / 100;
      const heliumFraction = bank.heliumPercent / 100;
      if (prioritizeTransferSafety) {
        if (bank.oxygenPercent <= 25) {
          return heliumFraction * heliumFraction * 100 + oxygenFraction * 0.4 + 1;
        }
        if (bank.id === preferredBankId) return -10_000;
        return -bank.pressureBar + 1 / bank.volumeL;
      }
      return heliumFraction * heliumFraction * 100 + oxygenFraction * 0.4 + 1;
    })
  ];

  return solveLinearProgram(
    decisionVariableNames,
    ['s_cyl', ...activeBanks.map((_, index) => `s_b${index + 1}`)],
    constraints,
    decisionCosts
  );
}

function solveMaximumTargetMix({
  initialMoles,
  initialOxygenPercent,
  initialHeliumPercent,
  targetOxygenPercent,
  targetHeliumPercent,
  activeBanks,
  bankMaxMoles
}) {
  const bankNames = bankVariableNames(activeBanks);
  const sourceCount = bankNames.length + 1;
  const decisionVariableNames = ['x_cyl', ...bankNames, 'n_total'];
  const totalMolesIndex = decisionVariableNames.length - 1;
  const constraints = [
    { coefficients: [...Array(sourceCount).fill(1), -1], rhs: 0 },
    {
      coefficients: [
        (initialOxygenPercent - targetOxygenPercent) / 100,
        ...activeBanks.map(bank => (bank.oxygenPercent - targetOxygenPercent) / 100),
        0
      ],
      rhs: 0
    },
    {
      coefficients: [
        (initialHeliumPercent - targetHeliumPercent) / 100,
        ...activeBanks.map(bank => (bank.heliumPercent - targetHeliumPercent) / 100),
        0
      ],
      rhs: 0
    },
    { coefficients: [1, ...Array(sourceCount - 1).fill(0), 0], rhs: initialMoles },
    ...activeBanks.map((_, index) => {
      const coefficients = Array(decisionVariableNames.length).fill(0);
      coefficients[index + 1] = 1;
      return { coefficients, rhs: bankMaxMoles[index] };
    })
  ];
  const decisionCosts = Array(decisionVariableNames.length).fill(0);
  decisionCosts[totalMolesIndex] = -1;

  return solveLinearProgram(
    decisionVariableNames,
    ['s_cyl', ...activeBanks.map((_, index) => `s_b${index + 1}`)],
    constraints,
    decisionCosts
  );
}


function boostPriority(bank) {
  if (bank.heliumPercent > 0 && bank.oxygenPercent > 0) return 1;
  if (bank.heliumPercent === 100) return 2;
  if (bank.oxygenPercent === 100) return 3;
  if (bank.oxygenPercent === 21 && bank.heliumPercent === 0) return 4;
  return 2;
}
const COMPRESSOR_AIR_ID = 'compressor-air';

function compressorAirBank(maxPressureBar) {
  return {
    id: COMPRESSOR_AIR_ID,
    name: 'Compressor Air',
    volumeL: 1,
    pressureBar: maxPressureBar,
    oxygenPercent: 21,
    heliumPercent: 0,
    enabled: true,
    isCompressor: true
  };
}

function isAirBank(bank) {
  return bank?.isCompressor === true;
}
function isCompressorAir(bank) {
  return bank?.isCompressor === true;
}

function activeBoostsFor(solverResult, activeBanks, { airFirst = false } = {}) {
  const boosts = [];
  activeBanks.forEach((bank, index) => {
    const variableName = solverResult.variableNames[index + 1];
    const addedMoles = solverResult.solution[variableName] || 0;
    if (addedMoles <= 1e-9) return;

    boosts.push({ bank, addedMoles, priority: boostPriority(bank) });
  });
  boosts.sort((a, b) => (airFirst
    ? Number(isAirBank(b.bank)) - Number(isAirBank(a.bank))
    : Number(isAirBank(a.bank)) - Number(isAirBank(b.bank)))
    || b.bank.oxygenPercent - a.bank.oxygenPercent
    || a.priority - b.priority
    || b.addedMoles - a.addedMoles);
  return boosts;
}

function protocolOperation(stage, bank) {
  if (isAirBank(bank)) return 'Top-up';
  const tolerance = Math.max(
    1e-9,
    stage.sourceStartPressureBar,
    stage.receiverStartPressureBar,
    stage.sourceEndPressureBar,
    stage.receiverEndPressureBar
  ) * 1e-9;
  const startsHigher = stage.sourceStartPressureBar > stage.receiverStartPressureBar + tolerance;
  const endsEqual = Math.abs(stage.sourceEndPressureBar - stage.receiverEndPressureBar) <= tolerance;
  if (startsHigher && endsEqual) return 'Equalize';
  if (stage.sourceStartPressureBar >= stage.receiverStartPressureBar - tolerance
    && stage.sourceEndPressureBar >= stage.receiverEndPressureBar - tolerance) {
    return 'Decant';
  }
  return 'Boost';
}

function sourceResidualPressureAfterTransfer(bank, addedMoles, bankDensityByBankId, temperatureC, useVdw) {
  if (bank.isCompressor) return bank.pressureBar;
  const residualDensity = Math.max(
    0,
    bankDensityByBankId.get(bank.id) - addedMoles / bank.volumeL
  );
  return calcPressure(
    residualDensity,
    bank.oxygenPercent,
    bank.heliumPercent,
    temperatureC,
    useVdw
  );
}

function receiverPressureAfterTransfer({
  cumulativeMoles,
  cumulativeOxygenMoles,
  cumulativeHeliumMoles,
  addedMoles,
  bank,
  fraction,
  volumeL,
  temperatureC,
  useVdw
}) {
  const transferredMoles = addedMoles * fraction;
  const totalMoles = cumulativeMoles + transferredMoles;
  if (totalMoles <= 1e-12) return 0;
  return calcPressure(
    totalMoles / volumeL,
    ((cumulativeOxygenMoles + transferredMoles * (bank.oxygenPercent / 100)) / totalMoles) * 100,
    ((cumulativeHeliumMoles + transferredMoles * (bank.heliumPercent / 100)) / totalMoles) * 100,
    temperatureC,
    useVdw
  );
}

function pressureTransferStages({
  cumulativeMoles,
  cumulativeOxygenMoles,
  cumulativeHeliumMoles,
  addedMoles,
  bank,
  bankDensityByBankId,
  volumeL,
  temperatureC,
  useVdw,
  airTopUp = false
}) {
  const pressureAt = fraction => ({
    sourcePressure: sourceResidualPressureAfterTransfer(
      bank,
      addedMoles * fraction,
      bankDensityByBankId,
      temperatureC,
      useVdw
    ),
    receiverPressure: receiverPressureAfterTransfer({
      cumulativeMoles,
      cumulativeOxygenMoles,
      cumulativeHeliumMoles,
      addedMoles,
      bank,
      fraction,
      volumeL,
      temperatureC,
      useVdw
    })
  });
  if (airTopUp) {
    const start = pressureAt(0);
    const end = pressureAt(1);
    return [{
      type: 'boost',
      startFraction: 0,
      endFraction: 1,
      sourceStartPressureBar: start.sourcePressure,
      sourceEndPressureBar: end.sourcePressure,
      receiverStartPressureBar: start.receiverPressure,
      receiverEndPressureBar: end.receiverPressure
    }];
  }
  const start = pressureAt(0);
  const end = pressureAt(1);
  const pressureTolerance = Math.max(1e-9, Math.max(start.sourcePressure, start.receiverPressure, end.sourcePressure, end.receiverPressure) * 1e-9);
  const sourcePressureDifferenceAtStart = start.sourcePressure - start.receiverPressure;
  const sourceNotLowerAtStart = sourcePressureDifferenceAtStart >= -pressureTolerance;
  const sourceHigherAtStart = sourcePressureDifferenceAtStart > pressureTolerance;
  const sourceLowerAtEnd = end.sourcePressure - end.receiverPressure < -pressureTolerance;

  if (!sourceHigherAtStart || !sourceLowerAtEnd) {
    return [{
      type: sourceNotLowerAtStart ? 'decant' : 'boost',
      startFraction: 0,
      endFraction: 1,
      sourceStartPressureBar: start.sourcePressure,
      sourceEndPressureBar: end.sourcePressure,
      receiverStartPressureBar: start.receiverPressure,
      receiverEndPressureBar: end.receiverPressure
    }];
  }

  let lowerFraction = 0;
  let upperFraction = 1;
  for (let iteration = 0; iteration < 60; iteration++) {
    const middleFraction = (lowerFraction + upperFraction) / 2;
    const middle = pressureAt(middleFraction);
    if (middle.sourcePressure > middle.receiverPressure) lowerFraction = middleFraction;
    else upperFraction = middleFraction;
  }
  const equilibriumFraction = (lowerFraction + upperFraction) / 2;
  const equilibrium = pressureAt(equilibriumFraction);
  return [
    {
      type: 'decant',
      startFraction: 0,
      endFraction: equilibriumFraction,
      sourceStartPressureBar: start.sourcePressure,
      sourceEndPressureBar: equilibrium.sourcePressure,
      receiverStartPressureBar: start.receiverPressure,
      receiverEndPressureBar: equilibrium.receiverPressure
    },
    {
      type: 'boost',
      startFraction: equilibriumFraction,
      endFraction: 1,
      sourceStartPressureBar: equilibrium.sourcePressure,
      sourceEndPressureBar: end.sourcePressure,
      receiverStartPressureBar: equilibrium.receiverPressure,
      receiverEndPressureBar: end.receiverPressure
    }
  ];
}

function transferSafety({
  solverResult,
  activeBanks,
  bankDensityByBankId,
  initialOxygenPercent,
  initialHeliumPercent,
  volumeL,
  temperatureC,
  useVdw,
  targetPressureBar,
  maxCompressorPressureBar
}) {
  let cumulativeMoles = solverResult.solution.x_cyl || 0;
  let cumulativeOxygenMoles = cumulativeMoles * (initialOxygenPercent / 100);
  let cumulativeHeliumMoles = cumulativeMoles * (initialHeliumPercent / 100);
  const airFirst = targetPressureBar > maxCompressorPressureBar;
  let worstMargin = Infinity;
  let worstError = null;

  for (const { bank, addedMoles } of activeBoostsFor(solverResult, activeBanks, { airFirst })) {
    cumulativeMoles += addedMoles;
    cumulativeOxygenMoles += addedMoles * (bank.oxygenPercent / 100);
    cumulativeHeliumMoles += addedMoles * (bank.heliumPercent / 100);
    if (bank.oxygenPercent <= 25) continue;

    const receiverPressure = calcPressure(
      cumulativeMoles / volumeL,
      (cumulativeOxygenMoles / cumulativeMoles) * 100,
      (cumulativeHeliumMoles / cumulativeMoles) * 100,
      temperatureC,
      useVdw
    );
    const sourceResidualPressure = sourceResidualPressureAfterTransfer(
      bank,
      addedMoles,
      bankDensityByBankId,
      temperatureC,
      useVdw
    );
    const margin = sourceResidualPressure * 4 - receiverPressure;
    if (margin < worstMargin) {
      worstMargin = margin;
      worstError = `Unsafe ${bank.oxygenPercent}% O₂ transfer from ${bank.name}: receiving cylinder would reach ${receiverPressure.toFixed(1)} bar while the source bank would fall to ${sourceResidualPressure.toFixed(1)} bar, exceeding the 4:1 limit.`;
    }
  }

  return {
    margin: worstMargin,
    error: worstMargin < -1e-9 ? worstError : null
  };
}
function equipmentSafety({
  solverResult,
  activeBanks,
  bankDensityByBankId,
  initialOxygenPercent,
  initialHeliumPercent,
  volumeL,
  temperatureC,
  useVdw,
  targetPressureBar,
  maxCompressorPressureBar,
  maxBoosterOutputPressureBar
}) {
  let cumulativeMoles = solverResult.solution.x_cyl || 0;
  let cumulativeOxygenMoles = cumulativeMoles * (initialOxygenPercent / 100);
  let cumulativeHeliumMoles = cumulativeMoles * (initialHeliumPercent / 100);
  const airFirst = targetPressureBar > maxCompressorPressureBar;
  let worstMargin = Infinity;
  let worstError = null;

  for (const { bank, addedMoles } of activeBoostsFor(solverResult, activeBanks, { airFirst })) {
    const stages = pressureTransferStages({
      cumulativeMoles,
      cumulativeOxygenMoles,
      cumulativeHeliumMoles,
      addedMoles,
      bank,
      bankDensityByBankId,
      volumeL,
      temperatureC,
      useVdw,
      airTopUp: isCompressorAir(bank)
    });

    for (const stage of stages) {
      const stageAddedMoles = addedMoles * (stage.endFraction - stage.startFraction);
      const receiverEndPressureBar = stage.receiverEndPressureBar;
      if (isCompressorAir(bank)) {
        const margin = maxCompressorPressureBar - receiverEndPressureBar;
        if (margin < worstMargin) {
          worstMargin = margin;
          worstError = `Compressor Air cannot top up above ${maxCompressorPressureBar.toFixed(1)} bar.`;
        }
      } else if (stage.type === 'boost') {
        const margin = maxBoosterOutputPressureBar - receiverEndPressureBar;
        if (margin < worstMargin) {
          worstMargin = margin;
          worstError = `Booster output cannot exceed ${maxBoosterOutputPressureBar.toFixed(1)} bar.`;
        }
      }
      cumulativeMoles += stageAddedMoles;
      cumulativeOxygenMoles += stageAddedMoles * (bank.oxygenPercent / 100);
      cumulativeHeliumMoles += stageAddedMoles * (bank.heliumPercent / 100);
    }
  }

  return {
    margin: worstMargin,
    error: worstMargin < -1e-9 ? worstError : null
  };
}

function feasibleOxygenShareRanges(totalOxygenMoles, requiredPairOxygenMoles, firstBankOxygenMoles, secondBankOxygenMoles) {
  if (totalOxygenMoles <= 1e-9 || requiredPairOxygenMoles <= 1e-9) return [[0, 1]];

  const oxygenAvailableAtShare = share => (
    Math.min(firstBankOxygenMoles, totalOxygenMoles * share)
    + Math.min(secondBankOxygenMoles, totalOxygenMoles * (1 - share))
  );
  const breakpoints = [...new Set([
    0,
    1,
    Math.max(0, Math.min(1, firstBankOxygenMoles / totalOxygenMoles)),
    Math.max(0, Math.min(1, 1 - secondBankOxygenMoles / totalOxygenMoles))
  ])].sort((a, b) => a - b);
  const ranges = [];

  for (let index = 0; index < breakpoints.length - 1; index++) {
    const start = breakpoints[index];
    const end = breakpoints[index + 1];
    const startOxygen = oxygenAvailableAtShare(start);
    const endOxygen = oxygenAvailableAtShare(end);
    const startFeasible = startOxygen + 1e-9 >= requiredPairOxygenMoles;
    const endFeasible = endOxygen + 1e-9 >= requiredPairOxygenMoles;

    if (startFeasible && endFeasible) {
      ranges.push([start, end]);
    } else if (startFeasible || endFeasible) {
      const boundary = start + (
        (requiredPairOxygenMoles - startOxygen)
        / (endOxygen - startOxygen)
      ) * (end - start);
      ranges.push(startFeasible ? [start, boundary] : [boundary, end]);
    }
  }

  return ranges.reduce((merged, range) => {
    const previous = merged.at(-1);
    if (previous && range[0] <= previous[1] + 1e-9) previous[1] = Math.max(previous[1], range[1]);
    else merged.push(range);
    return merged;
  }, []);
}

function maximumOutsideOxygenMoles({
  initialMoles,
  initialOxygenPercent,
  initialHeliumPercent,
  targetMoles,
  targetOxygenPercent,
  targetHeliumPercent,
  activeBanks,
  bankMaxMoles,
  excludedBankIds
}) {
  const outsideBanks = activeBanks.filter(bank => !excludedBankIds.has(bank.id));
  const bankNames = bankVariableNames(outsideBanks);
  const sources = [
    {
      variableName: 'x_cyl',
      maximumMoles: initialMoles,
      oxygenFraction: initialOxygenPercent / 100,
      heliumFraction: initialHeliumPercent / 100,
      nitrogenFraction: Math.max(0, 100 - initialOxygenPercent - initialHeliumPercent) / 100
    },
    ...outsideBanks.map((bank, index) => ({
      variableName: bankNames[index],
      maximumMoles: bankMaxMoles[activeBanks.indexOf(bank)],
      oxygenFraction: bank.oxygenPercent / 100,
      heliumFraction: bank.heliumPercent / 100,
      nitrogenFraction: Math.max(0, 100 - bank.oxygenPercent - bank.heliumPercent) / 100
    }))
  ];
  const sourceCount = sources.length;
  const decisionVariableNames = [
    ...sources.map(source => source.variableName),
    's_he_budget',
    's_n2_budget',
    's_total_budget'
  ];
  const constraints = [
    {
      coefficients: [
        ...sources.map(source => source.heliumFraction),
        1,
        0,
        0
      ],
      rhs: targetMoles * (targetHeliumPercent / 100)
    },
    {
      coefficients: [
        ...sources.map(source => source.nitrogenFraction),
        0,
        1,
        0
      ],
      rhs: targetMoles * (Math.max(0, 100 - targetOxygenPercent - targetHeliumPercent) / 100)
    },
    {
      coefficients: [...sources.map(() => 1), 0, 0, 1],
      rhs: targetMoles
    },
    ...sources.map((source, index) => {
      const coefficients = Array(decisionVariableNames.length).fill(0);
      coefficients[index] = 1;
      return { coefficients, rhs: source.maximumMoles };
    })
  ];
  const decisionCosts = [
    ...sources.map(source => -source.oxygenFraction),
    0,
    0,
    0
  ];
  const result = solveLinearProgram(
    decisionVariableNames,
    ['s_cyl', ...outsideBanks.map((_, index) => `s_b${index + 1}`)],
    constraints,
    decisionCosts
  );
  if (!result.feasible) return 0;

  return sources.reduce(
    (oxygenMoles, source) => oxygenMoles + source.oxygenFraction * result.solution[source.variableName],
    0
  );
}

function maximumPressureResult(pressureBar, solverResult, blend, protocolSteps, trajectory) {
  return {
    pressureBar,
    solution: solverResult.solution,
    tableauSteps: solverResult.steps,
    blend,
    protocolSteps,
    trajectory
  };
}

function failedResult(error, gas, tableauSteps, maximumPressure = null, diagnostics = null) {
  return {
    feasible: false,
    error,
    gas,
    solution: null,
    tableauSteps,
    blend: null,
    protocolSteps: [],
    trajectory: [],
    maximumPressure,
    diagnostics
  };
}

function componentShortfallsFor({
  initialMoles,
  initialOxygenPercent,
  initialHeliumPercent,
  targetMoles,
  targetOxygenPercent,
  targetHeliumPercent,
  activeBanks,
  bankMaxMoles
}) {
  const sourceFractions = [
    {
      moles: initialMoles,
      oxygen: initialOxygenPercent / 100,
      helium: initialHeliumPercent / 100,
      nitrogen: Math.max(0, 100 - initialOxygenPercent - initialHeliumPercent) / 100
    },
    ...activeBanks.map((bank, index) => ({
      moles: bankMaxMoles[index],
      oxygen: bank.oxygenPercent / 100,
      helium: bank.heliumPercent / 100,
      nitrogen: Math.max(0, 100 - bank.oxygenPercent - bank.heliumPercent) / 100
    }))
  ];
  const targetFractions = [
    ['Oxygen', targetOxygenPercent / 100],
    ['Helium', targetHeliumPercent / 100],
    ['Nitrogen', Math.max(0, 100 - targetOxygenPercent - targetHeliumPercent) / 100]
  ];

  return targetFractions.flatMap(([component, fraction]) => {
    const availableMoles = sourceFractions.reduce(
      (available, source) => available + source.moles * source[component.toLowerCase()],
      0
    );
    const requiredMoles = targetMoles * fraction;
    const deficitMoles = requiredMoles - availableMoles;
    if (deficitMoles <= Math.max(1e-6, requiredMoles * 1e-6)) return [];
    return [{ component, requiredMoles, availableMoles, deficitMoles, sourceBank: null }];
  });
}

function componentFraction(component, bank) {
  if (component === 'Oxygen') return bank.oxygenPercent / 100;
  if (component === 'Helium') return bank.heliumPercent / 100;
  return Math.max(0, 100 - bank.oxygenPercent - bank.heliumPercent) / 100;
}

function sourceBankPressureNeed(bank, component, deficitMoles, temperatureC, useVdw, minimumSourcePressureBar) {
  const requiredBankMoles = deficitMoles / componentFraction(component, bank);
  const currentDensity = calcMolarDensity(
    bank.pressureBar,
    bank.oxygenPercent,
    bank.heliumPercent,
    temperatureC,
    useVdw
  );
  const requiredDensity = currentDensity + requiredBankMoles / bank.volumeL;
  const requiredPressureOutOfRange = useVdw
    && requiredDensity >= 0.96 / getMixParams(bank.oxygenPercent, bank.heliumPercent).b;
  const requiredPressureBar = requiredPressureOutOfRange
    ? null
    : calcPressure(
      requiredDensity,
      bank.oxygenPercent,
      bank.heliumPercent,
      temperatureC,
      useVdw
    );
  return {
    id: bank.id,
    name: bank.name,
    volumeL: bank.volumeL,
    currentPressureBar: bank.pressureBar,
    minimumSourcePressureBar,
    pressureModel: useVdw ? 'real-gas' : 'ideal-gas',
    pressureEstimateOutOfRange: requiredPressureOutOfRange,
    requiredPressureBar,
    pressureIncreaseBar: requiredPressureOutOfRange
      ? null
      : Math.max(0, requiredPressureBar - bank.pressureBar)
  };
}

function createBlendDiagnostics(
  componentShortfalls,
  solverResult,
  activeBanks,
  bankMaxMoles,
  temperatureC,
  useVdw,
  minimumSourcePressureFor
) {
  const exhaustedBanks = [];
  if (solverResult?.solution && solverResult.variableNames) {
    activeBanks.forEach((bank, index) => {
      if (bank.isCompressor) return;
      const availableMoles = bankMaxMoles[index];
      if (availableMoles <= 1e-9) return;
      const variableName = solverResult.variableNames[index + 1];
      const drawnMoles = solverResult.solution[variableName] || 0;
      if (drawnMoles <= 1e-9) return;
      const exhaustionTolerance = Math.min(1e-3, availableMoles * 1e-5);
      if (availableMoles - drawnMoles > exhaustionTolerance) return;
      exhaustedBanks.push({
        id: bank.id,
        name: bank.name,
        availableMoles,
        drawnMoles,
        currentPressureBar: bank.pressureBar,
        minimumSourcePressureBar: minimumSourcePressureFor(bank)
      });
    });
  }

  const diagnosedShortfalls = componentShortfalls.map(shortfall => {
    let sourceBank = null;
    let greatestDrawnComponentMoles = 0;
    activeBanks.forEach((bank, index) => {
      if (bank.isCompressor) return;
      const fraction = componentFraction(shortfall.component, bank);
      if (fraction <= 1e-9 || bank.volumeL <= 0) return;
      const variableName = solverResult?.variableNames?.[index + 1];
      const drawnMoles = solverResult?.solution?.[variableName] || 0;
      const drawnComponentMoles = drawnMoles * fraction;
      if (drawnComponentMoles > greatestDrawnComponentMoles) {
        greatestDrawnComponentMoles = drawnComponentMoles;
        sourceBank = bank;
      }
    });

    if (!sourceBank) {
      let greatestAvailableComponentMoles = 0;
      activeBanks.forEach((bank, index) => {
        if (bank.isCompressor) return;
        const fraction = componentFraction(shortfall.component, bank);
        if (fraction <= 1e-9 || bank.volumeL <= 0) return;
        const availableComponentMoles = bankMaxMoles[index] * fraction;
        if (availableComponentMoles > greatestAvailableComponentMoles) {
          greatestAvailableComponentMoles = availableComponentMoles;
          sourceBank = bank;
        }
      });
    }

    return {
      ...shortfall,
      sourceBank: sourceBank
        ? sourceBankPressureNeed(
          sourceBank,
          shortfall.component,
          shortfall.deficitMoles,
          temperatureC,
          useVdw,
          minimumSourcePressureFor(sourceBank)
        )
        : null
    };
  });

  return { componentShortfalls: diagnosedShortfalls, exhaustedBanks };
}

function blendSummary({
  retainedPressure,
  retainedMoles,
  initialMoles,
  drainPressure,
  ventedMoles,
  ventedGasLitres,
  heliumSalvagedLitres,
  finalPressureBar,
  targetOxygenPercent,
  targetHeliumPercent
}) {
  return {
    retainedPressureBar: retainedPressure,
    retainedPercent: (retainedMoles / (initialMoles || 1)) * 100,
    ventedPressureBar: drainPressure,
    ventedMoles,
    ventedGasLitres,
    heliumSalvagedLitres,
    finalPressureBar,
    finalOxygenPercent: targetOxygenPercent,
    finalHeliumPercent: targetHeliumPercent
  };
}



function validateBlendInput(input) {
  if (!input || typeof input !== 'object') return ['Blend input is missing.'];
  const { cylinder, physics, banks } = input;
  if (!cylinder || typeof cylinder !== 'object') return ['Cylinder input is missing.'];

  const errors = validateCalculatorInputs(cylinder, physics, input.thermal);
  if (!isValidGasComposition(cylinder.initialOxygenPercent, cylinder.initialHeliumPercent)) {
    errors.push('Initial gas composition must total at most 100% O₂ and He.');
  }
  if (!isValidGasComposition(cylinder.targetOxygenPercent, cylinder.targetHeliumPercent)) {
    errors.push('Target gas composition must total at most 100% O₂ and He.');
  }
  if (!physics || !['ideal', 'vdw'].includes(physics.model)) {
    errors.push('Gas model must be either ideal or vdw.');
  }
  if (!Array.isArray(banks)) {
    errors.push('Supply banks must be a list.');
  } else {
    const ids = new Set();
    banks.forEach(bank => {
      const bankErrors = validateSupplyBankInput(bank);
      errors.push(...bankErrors);
      if (bank && typeof bank.id === 'string' && bank.id) {
        if (ids.has(bank.id)) errors.push('Supply bank IDs must be unique.');
        ids.add(bank.id);
      }
    });
  }
  return errors;
}


function optimizeBlendWithoutThermal(input) {
  const inputErrors = validateBlendInput(input);
  if (inputErrors.length > 0) {
    return failedResult(`Invalid blend input: ${inputErrors.join(' ')}`, null, []);
  }
  const { cylinder, physics, banks, settings } = input;
  const configuredMinimumSourcePressureBar = settings?.booster?.minimumSourcePressureBar;
  const maxCompressorPressureBar = Number.isFinite(settings?.booster?.maxCompressorPressureBar)
    ? settings.booster.maxCompressorPressureBar
    : 232;
  const maxBoosterOutputPressureBar = Number.isFinite(settings?.booster?.maxBoosterOutputPressureBar)
    ? settings.booster.maxBoosterOutputPressureBar
    : 200;
  const minimumSourcePressureFor = bank => Number.isFinite(configuredMinimumSourcePressureBar)
    ? configuredMinimumSourcePressureBar
    : (Number.isFinite(bank.minimumPressureBar) ? bank.minimumPressureBar : 20);

  const useVdw = physics.model === 'vdw';
  const { temperatureC } = physics;
  const {
    volumeL,
    initialPressureBar,
    initialOxygenPercent,
    initialHeliumPercent,
    targetPressureBar,
    targetOxygenPercent,
    targetHeliumPercent
  } = cylinder;

  const initialDensity = calcMolarDensity(initialPressureBar, initialOxygenPercent, initialHeliumPercent, temperatureC, useVdw);
  const initialMoles = initialDensity * volumeL;
  const initialZ = calcZFromDensity(initialPressureBar, initialDensity, temperatureC, useVdw);
  const targetDensity = calcMolarDensity(targetPressureBar, targetOxygenPercent, targetHeliumPercent, temperatureC, useVdw);
  const targetMoles = targetDensity * volumeL;
  const targetZ = calcZFromDensity(targetPressureBar, targetDensity, temperatureC, useVdw);
  const gas = { initialPressureBar, initialMoles, initialZ, targetPressureBar, targetMoles, targetZ };

  const solverBanks = [...banks, compressorAirBank(maxCompressorPressureBar)];
  const availableMolesByBankId = new Map();
  const bankDensityByBankId = new Map();
  for (const bank of solverBanks) {
    if (bank.isCompressor) {
      bankDensityByBankId.set(
        bank.id,
        calcMolarDensity(bank.pressureBar, bank.oxygenPercent, bank.heliumPercent, temperatureC, useVdw)
      );
      availableMolesByBankId.set(bank.id, targetMoles);
      continue;
    }
    const minimumSourcePressureBar = minimumSourcePressureFor(bank);
    const hasAvailableGas = bank.enabled && bank.pressureBar > minimumSourcePressureBar;
    const currentDensity = hasAvailableGas
      ? calcMolarDensity(bank.pressureBar, bank.oxygenPercent, bank.heliumPercent, temperatureC, useVdw)
      : 0;
    bankDensityByBankId.set(bank.id, currentDensity);
    const availableMoles = hasAvailableGas
      ? Math.max(0, (currentDensity - calcMolarDensity(
        minimumSourcePressureBar,
        bank.oxygenPercent,
        bank.heliumPercent,
        temperatureC,
        useVdw
      )) * bank.volumeL)
      : 0;
    availableMolesByBankId.set(bank.id, availableMoles);
  }
  const activeBanks = solverBanks.filter(bank => bank.enabled);
  const bankMaxMoles = activeBanks.map(bank => availableMolesByBankId.get(bank.id));

  const componentShortfalls = componentShortfallsFor({
    initialMoles,
    initialOxygenPercent,
    initialHeliumPercent,
    targetMoles,
    targetOxygenPercent,
    targetHeliumPercent,
    activeBanks,
    bankMaxMoles
  });
  const solveAtPressure = (pressureBar, {
    prioritizeTransferSafety = false,
    preferredBankId = null,
    excludedBankId = null,
    bankMaxMoles: candidateBankMaxMoles = bankMaxMoles
  } = {}) => {
    const targetMolesAtPressure = pressureBar === targetPressureBar
      ? targetMoles
      : calcMolarDensity(pressureBar, targetOxygenPercent, targetHeliumPercent, temperatureC, useVdw) * volumeL;
    return solveTargetBlendAtMoles({
      initialMoles,
      targetMoles: targetMolesAtPressure,
      initialOxygenPercent,
      initialHeliumPercent,
      targetOxygenPercent,
      targetHeliumPercent,
      activeBanks,
      bankMaxMoles: candidateBankMaxMoles,
      prioritizeTransferSafety,
      preferredBankId,
      excludedBankId
    });
  };
  const safetyFor = (result, pressureBar = targetPressureBar) => {
    const transferResult = transferSafety({
      solverResult: result,
      activeBanks,
      bankDensityByBankId,
      initialOxygenPercent,
      initialHeliumPercent,
      volumeL,
      temperatureC,
      useVdw,
      targetPressureBar: pressureBar,
      maxCompressorPressureBar
    });
    if (transferResult.error) return transferResult;
    return equipmentSafety({
      solverResult: result,
      activeBanks,
      bankDensityByBankId,
      initialOxygenPercent,
      initialHeliumPercent,
      volumeL,
      temperatureC,
      useVdw,
      targetPressureBar: pressureBar,
      maxCompressorPressureBar,
      maxBoosterOutputPressureBar
    });
  };
  const isUnsafe = (result, pressureBar = targetPressureBar) => safetyFor(result, pressureBar).error;
  const safeAtPressure = (pressureBar, seedResult = null) => {
    const oxygenRichBanks = activeBanks.filter((bank, index) => bank.oxygenPercent > 25 && bankMaxMoles[index] > 1e-9);
    let feasibleSeedResult = seedResult?.feasible ? seedResult : null;
    let candidate = solveAtPressure(pressureBar, { prioritizeTransferSafety: true });
    if (candidate.feasible) {
      feasibleSeedResult ??= candidate;
      if (!isUnsafe(candidate, pressureBar)) return candidate;
    }

    for (const bank of oxygenRichBanks) {
      candidate = solveAtPressure(pressureBar, {
        prioritizeTransferSafety: true,
        preferredBankId: bank.id
      });
      if (candidate.feasible) {
        feasibleSeedResult ??= candidate;
        if (!isUnsafe(candidate, pressureBar)) return candidate;
      }
    }

    for (const bank of oxygenRichBanks) {
      candidate = solveAtPressure(pressureBar, {
        prioritizeTransferSafety: true,
        excludedBankId: bank.id
      });
      if (candidate.feasible) {
        feasibleSeedResult ??= candidate;
        if (!isUnsafe(candidate, pressureBar)) return candidate;
      }
    }

    if (oxygenRichBanks.length < 2) return null;

    const targetMolesAtPressure = pressureBar === targetPressureBar
      ? targetMoles
      : calcMolarDensity(pressureBar, targetOxygenPercent, targetHeliumPercent, temperatureC, useVdw) * volumeL;
    const targetOxygenMoles = targetMolesAtPressure * (targetOxygenPercent / 100);
    const oxygenMolesPerBank = targetOxygenMoles / oxygenRichBanks.length;
    const splitCaps = activeBanks.map((bank, index) => bank.oxygenPercent > 25
      ? Math.min(bankMaxMoles[index], oxygenMolesPerBank / (bank.oxygenPercent / 100))
      : bankMaxMoles[index]);
    candidate = solveAtPressure(pressureBar, {
      prioritizeTransferSafety: true,
      bankMaxMoles: splitCaps
    });
    if (candidate.feasible) {
      feasibleSeedResult ??= candidate;
      if (!isUnsafe(candidate, pressureBar)) return candidate;
    }

    const oxygenShares = [0.5, 0.4, 0.6, 0.3, 0.7, 0.2, 0.8, 0.1, 0.9];
    const tryPairShare = (firstBank, firstBankIndex, secondBank, secondBankIndex, firstShare) => {
      const pairCaps = bankMaxMoles.slice();
      pairCaps[firstBankIndex] = Math.min(
        pairCaps[firstBankIndex],
        (targetOxygenMoles * firstShare) / (firstBank.oxygenPercent / 100)
      );
      pairCaps[secondBankIndex] = Math.min(
        pairCaps[secondBankIndex],
        (targetOxygenMoles * (1 - firstShare)) / (secondBank.oxygenPercent / 100)
      );
      const result = solveAtPressure(pressureBar, {
        prioritizeTransferSafety: true,
        bankMaxMoles: pairCaps
      });
      return {
        result,
        margin: result.feasible ? safetyFor(result, pressureBar).margin : -Infinity
      };
    };

    for (let firstIndex = 0; firstIndex < oxygenRichBanks.length; firstIndex++) {
      const firstBank = oxygenRichBanks[firstIndex];
      const firstBankIndex = activeBanks.indexOf(firstBank);
      for (let secondIndex = firstIndex + 1; secondIndex < oxygenRichBanks.length; secondIndex++) {
        const secondBank = oxygenRichBanks[secondIndex];
        const secondBankIndex = activeBanks.indexOf(secondBank);
        const outsideOxygenMoles = maximumOutsideOxygenMoles({
          initialMoles,
          initialOxygenPercent,
          initialHeliumPercent,
          targetMoles: targetMolesAtPressure,
          targetOxygenPercent,
          targetHeliumPercent,
          activeBanks,
          bankMaxMoles,
          excludedBankIds: new Set([firstBank.id, secondBank.id])
        });
        const requiredPairOxygenMoles = Math.max(0, targetOxygenMoles - outsideOxygenMoles);
        const feasibleShareRanges = feasibleOxygenShareRanges(
          targetOxygenMoles,
          requiredPairOxygenMoles,
          bankMaxMoles[firstBankIndex] * (firstBank.oxygenPercent / 100),
          bankMaxMoles[secondBankIndex] * (secondBank.oxygenPercent / 100)
        );

        for (const [minimumShare, maximumShare] of feasibleShareRanges) {
        let feasibleShareSeed = null;
        if (feasibleSeedResult && targetOxygenMoles > 1e-9) {
          const firstVariable = feasibleSeedResult.variableNames[firstBankIndex + 1];
          const secondVariable = feasibleSeedResult.variableNames[secondBankIndex + 1];
          const firstOxygenMoles = (feasibleSeedResult.solution[firstVariable] || 0) * (firstBank.oxygenPercent / 100);
          const secondOxygenMoles = (feasibleSeedResult.solution[secondVariable] || 0) * (secondBank.oxygenPercent / 100);
          const lowerSeed = firstOxygenMoles / targetOxygenMoles;
          const upperSeed = 1 - secondOxygenMoles / targetOxygenMoles;
          const seedShare = Math.max(
            minimumShare,
            Math.min(maximumShare, (lowerSeed + upperSeed) / 2)
          );
          const seedAttempt = tryPairShare(firstBank, firstBankIndex, secondBank, secondBankIndex, seedShare);
          if (seedAttempt.result.feasible) {
            feasibleShareSeed = seedShare;
            if (seedAttempt.margin >= -1e-9) return seedAttempt.result;
          }
        }

        const shareSamples = new Set([
          ...oxygenShares.filter(share => share >= minimumShare && share <= maximumShare),
          minimumShare,
          (minimumShare + maximumShare) / 2,
          maximumShare
        ]);
        for (const firstShare of shareSamples) {
          const attempt = tryPairShare(firstBank, firstBankIndex, secondBank, secondBankIndex, firstShare);
          if (attempt.result.feasible) {
            feasibleShareSeed ??= firstShare;
            if (attempt.margin >= -1e-9) return attempt.result;
          }
        }
        if (feasibleShareSeed === null) continue;

        let feasibleMinimum = feasibleShareSeed;
        let minimumAttempt = tryPairShare(firstBank, firstBankIndex, secondBank, secondBankIndex, minimumShare);
        if (minimumAttempt.result.feasible) {
          feasibleMinimum = minimumShare;
          if (minimumAttempt.margin >= -1e-9) return minimumAttempt.result;
        } else {
          let infeasibleShare = minimumShare;
          let feasibleShare = feasibleShareSeed;
          for (let iteration = 0; iteration < 32; iteration++) {
            const share = (infeasibleShare + feasibleShare) / 2;
            const attempt = tryPairShare(firstBank, firstBankIndex, secondBank, secondBankIndex, share);
            if (attempt.result.feasible) {
              feasibleShare = share;
              if (attempt.margin >= -1e-9) return attempt.result;
            } else {
              infeasibleShare = share;
            }
          }
          feasibleMinimum = feasibleShare;
        }

        let feasibleMaximum = feasibleShareSeed;
        let maximumAttempt = tryPairShare(firstBank, firstBankIndex, secondBank, secondBankIndex, maximumShare);
        if (maximumAttempt.result.feasible) {
          feasibleMaximum = maximumShare;
          if (maximumAttempt.margin >= -1e-9) return maximumAttempt.result;
        } else {
          let feasibleShare = feasibleShareSeed;
          let infeasibleShare = maximumShare;
          for (let iteration = 0; iteration < 32; iteration++) {
            const share = (feasibleShare + infeasibleShare) / 2;
            const attempt = tryPairShare(firstBank, firstBankIndex, secondBank, secondBankIndex, share);
            if (attempt.result.feasible) {
              feasibleShare = share;
              if (attempt.margin >= -1e-9) return attempt.result;
            } else {
              infeasibleShare = share;
            }
          }
          feasibleMaximum = feasibleShare;
        }

        const samePriority = boostPriority(firstBank) === boostPriority(secondBank);
        const orderBoundary = samePriority
          ? firstBank.oxygenPercent / (firstBank.oxygenPercent + secondBank.oxygenPercent)
          : null;
        const intervals = orderBoundary !== null
          && orderBoundary > feasibleMinimum
          && orderBoundary < feasibleMaximum
          ? [[feasibleMinimum, orderBoundary], [orderBoundary, feasibleMaximum]]
          : [[feasibleMinimum, feasibleMaximum]];
          for (const [initialLeft, initialRight] of intervals) {
            let left = initialLeft;
            let right = initialRight;
            for (let iteration = 0; iteration < 32; iteration++) {
              const leftProbe = left + (right - left) / 3;
              const rightProbe = right - (right - left) / 3;
              const leftResult = tryPairShare(
                firstBank,
                firstBankIndex,
                secondBank,
                secondBankIndex,
                leftProbe
              );
              if (leftResult.result.feasible && leftResult.margin >= -1e-9) return leftResult.result;
              const rightResult = tryPairShare(
                firstBank,
                firstBankIndex,
                secondBank,
                secondBankIndex,
                rightProbe
              );
              if (rightResult.result.feasible && rightResult.margin >= -1e-9) return rightResult.result;
              if (leftResult.margin > rightResult.margin) right = rightProbe;
              else left = leftProbe;
            }
            const refined = tryPairShare(
              firstBank,
              firstBankIndex,
              secondBank,
              secondBankIndex,
              (left + right) / 2
            );
            if (refined.result.feasible && refined.margin >= -1e-9) return refined.result;
          }
        }
      }
    }

    return null;
  };

  let solverResult = solveAtPressure(targetPressureBar);
  let requestedSafetyError = solverResult.feasible ? isUnsafe(solverResult) : null;
  if (solverResult.feasible && requestedSafetyError) {
    const safetyResult = safeAtPressure(targetPressureBar, solverResult);
    if (safetyResult) {
      solverResult = safetyResult;
      requestedSafetyError = null;
    }
  }

  const exactTargetFeasible = solverResult.feasible && !requestedSafetyError;
  let recipeSolverResult = solverResult;
  let recipeTargetPressureBar = targetPressureBar;

  if (!exactTargetFeasible) {
    const maximumResult = solveMaximumTargetMix({
      initialMoles,
      initialOxygenPercent,
      initialHeliumPercent,
      targetOxygenPercent,
      targetHeliumPercent,
      activeBanks,
      bankMaxMoles
    });
    const maximumMoles = maximumResult.feasible ? maximumResult.solution.n_total || 0 : 0;
    if (maximumMoles <= 1e-6) {
      return failedResult(
        requestedSafetyError || 'The exact target mix cannot be made from the current cylinder and enabled gas banks at any positive pressure.',
        gas,
        maximumResult.steps || solverResult.steps || [],
        null,
        createBlendDiagnostics(componentShortfalls, maximumResult, activeBanks, bankMaxMoles, temperatureC, useVdw, minimumSourcePressureFor)
      );
    }

    const inventoryMaximumPressure = calcPressure(
      maximumMoles / volumeL,
      targetOxygenPercent,
      targetHeliumPercent,
      temperatureC,
      useVdw
    );
    const maximumRecipeError = isUnsafe(maximumResult, inventoryMaximumPressure);
    let safeSolverResult = null;
    if (inventoryMaximumPressure <= targetPressureBar) {
      safeSolverResult = maximumRecipeError
        ? safeAtPressure(inventoryMaximumPressure, maximumResult)
        : maximumResult;
    }

    if (safeSolverResult) {
      recipeSolverResult = safeSolverResult;
      recipeTargetPressureBar = inventoryMaximumPressure;
    } else {
      let safePressureBar = 0;
      let unsafePressureBar = Math.min(inventoryMaximumPressure, targetPressureBar);
      for (let iteration = 0; iteration < 40; iteration++) {
        const candidatePressureBar = (safePressureBar + unsafePressureBar) / 2;
        const candidate = safeAtPressure(candidatePressureBar);
        if (candidate) {
          safePressureBar = candidatePressureBar;
          safeSolverResult = candidate;
        } else {
          unsafePressureBar = candidatePressureBar;
        }
      }
      if (!safeSolverResult || safePressureBar <= 1e-6) {
        return failedResult(
          requestedSafetyError || maximumRecipeError || 'The exact target mix cannot be made safely at any positive pressure with the current gas banks.',
          gas,
          maximumResult.steps || [],
          null,
          createBlendDiagnostics(componentShortfalls, maximumResult, activeBanks, bankMaxMoles, temperatureC, useVdw, minimumSourcePressureFor)
        );
      }
      recipeSolverResult = safeSolverResult;
      recipeTargetPressureBar = safePressureBar;
      requestedSafetyError ??= maximumRecipeError;
    }
  }


  const retainedMoles = recipeSolverResult.solution.x_cyl || 0;
  const ventedMoles = Math.max(0, initialMoles - retainedMoles);
  const retainedDensity = retainedMoles / volumeL;
  const retainedPressure = calcPressure(
    retainedDensity,
    initialOxygenPercent,
    initialHeliumPercent,
    temperatureC,
    useVdw
  );
  const drainPressure = Math.max(0, initialPressureBar - retainedPressure);
  const recipeBoosts = activeBoostsFor(recipeSolverResult, activeBanks, {
    airFirst: recipeTargetPressureBar > maxCompressorPressureBar
  });
  const retainedHeliumMoles = retainedMoles * (initialHeliumPercent / 100);
  const salvagedSupplyHeliumMoles = recipeBoosts
    .filter(({ bank }) => bank.heliumPercent < 100)
    .reduce((total, { bank, addedMoles }) => total + addedMoles * (bank.heliumPercent / 100), 0);
  const heliumSalvagedLitres = (retainedHeliumMoles + salvagedSupplyHeliumMoles)
    * (GAS_CONSTANT * (temperatureC + 273.15));
  const ventedGasLitres = ventedMoles * (GAS_CONSTANT * (temperatureC + 273.15));

  const protocolSteps = [];
  const trajectory = [{
    step: 0,
    label: 'Start Mix',
    oxygenPercent: initialOxygenPercent,
    heliumPercent: initialHeliumPercent,
    nitrogenPercent: Math.max(0, 100 - initialOxygenPercent - initialHeliumPercent),
    pressureBar: initialPressureBar,
    color: '#f43f5e'
  }];

  let currentPressure = initialPressureBar;
  let cumulativeMoles = retainedMoles;
  let cumulativeOxygenMoles = retainedMoles * (initialOxygenPercent / 100);
  let cumulativeHeliumMoles = retainedMoles * (initialHeliumPercent / 100);

  const pressureScale = Math.max(1, initialPressureBar, retainedPressure);
  const pressureTolerance = Number.EPSILON * pressureScale * 32;
  const shouldDrain = drainPressure > pressureTolerance;
  const drainPrecision = drainPressure > 0 && drainPressure < 0.5
    ? Math.max(2, Math.ceil(-Math.log10(drainPressure)) + 1)
    : 1;
  if (shouldDrain) {
    currentPressure = retainedPressure;
    protocolSteps.push({
      type: 'drain',
      title: 'Drain / Vent Cylinder Gas',
      recipeLabel: 'Drain / Vent Cylinder Gas',
      description: `Bleed cylinder from ${initialPressureBar.toFixed(drainPrecision)} bar down to ${retainedPressure.toFixed(drainPrecision)} bar (-${drainPressure.toFixed(drainPrecision)} bar vented). Retains ${((retainedMoles / (initialMoles || 1)) * 100).toFixed(0)}% of the original mix.`,
      resultingPressureBar: currentPressure,
      resultingMix: { oxygenPercent: initialOxygenPercent, heliumPercent: initialHeliumPercent },
      oxygenCompressionRatio: null,
      badgeClass: 'bg-rose-500/20 text-rose-300 border-rose-500/40'
    });
  } else {
    protocolSteps.push({
      type: 'keep',
      title: 'Preserve 100% of Cylinder Gas',
      recipeLabel: 'Preserve 100% of Cylinder Gas',
      description: `Retain all ${initialPressureBar.toFixed(0)} bar of original mix. Zero gas vented!`,
      resultingPressureBar: currentPressure,
      resultingMix: { oxygenPercent: initialOxygenPercent, heliumPercent: initialHeliumPercent },
      oxygenCompressionRatio: null,
      badgeClass: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40'
    });
  }

  const stepColors = ['#06b6d4', '#f59e0b', '#10b981', '#a855f7', '#ec4899'];

  let stepNumber = 0;
  for (const { bank, addedMoles } of recipeBoosts) {
    const transferStages = pressureTransferStages({
      cumulativeMoles,
      cumulativeOxygenMoles,
      cumulativeHeliumMoles,
      addedMoles,
      bank,
      bankDensityByBankId,
      volumeL,
      temperatureC,
      useVdw,
      airTopUp: isCompressorAir(bank)
    });

    for (const stage of transferStages) {
      const stageAddedMoles = addedMoles * (stage.endFraction - stage.startFraction);
      cumulativeMoles += stageAddedMoles;
      cumulativeOxygenMoles += stageAddedMoles * (bank.oxygenPercent / 100);
      cumulativeHeliumMoles += stageAddedMoles * (bank.heliumPercent / 100);

      const oxygenPercent = (cumulativeOxygenMoles / cumulativeMoles) * 100;
      const heliumPercent = (cumulativeHeliumMoles / cumulativeMoles) * 100;
      const nitrogenPercent = Math.max(0, 100 - oxygenPercent - heliumPercent);
      const nextPressure = stage.receiverEndPressureBar;
      const pressureDelta = nextPressure - currentPressure;
      currentPressure = nextPressure;
      const oxygenCompressionRatio = stage.type === 'boost' && bank.oxygenPercent > 40 && stage.sourceEndPressureBar > 0
        ? currentPressure / stage.sourceEndPressureBar
        : null;
      stepNumber++;
      const minimumSourcePressureBar = isCompressorAir(bank) ? null : minimumSourcePressureFor(bank);
      const sourcePressureTolerance = minimumSourcePressureBar === null
        ? 0
        : Math.max(1e-9, Math.max(Math.abs(stage.sourceEndPressureBar), Math.abs(minimumSourcePressureBar)) * 1e-9);
      const sourceExhausted = minimumSourcePressureBar !== null
        && Math.abs(stage.sourceEndPressureBar - minimumSourcePressureBar) <= sourcePressureTolerance;
      const color = stepColors[(stepNumber - 1) % stepColors.length];

      trajectory.push({
        step: stepNumber,
        label: `Step ${stepNumber}`,
        bankId: bank.id,
        bankName: bank.name,
        oxygenPercent,
        heliumPercent,
        nitrogenPercent,
        pressureBar: currentPressure,
        pressureDeltaBar: pressureDelta,
        sourceStartPressureBar: stage.sourceStartPressureBar,
        sourceEndPressureBar: stage.sourceEndPressureBar,
        addedMoles: stageAddedMoles,
        color
      });

      const pressureAmount = Math.abs(stage.receiverEndPressureBar - stage.receiverStartPressureBar);
      const operation = protocolOperation(stage, bank);
      const targetPressure = stage.receiverEndPressureBar.toFixed(1);
      const leftoverPressure = stage.sourceEndPressureBar.toFixed(1);
      const descriptionParts = [
        `${operation} ${pressureAmount.toFixed(1)} bar from ${bank.name} to ${targetPressure} bar.`,
        sourceExhausted
          ? `This empties ${bank.name} and leaves only ${minimumSourcePressureBar.toFixed(1)} bar of gas.`
          : `This will leave ${leftoverPressure} bar of ${bank.name}.`,
        `Interim mix is ${oxygenPercent.toFixed(1)}/${heliumPercent.toFixed(1)}.`
      ];
      if (Number.isFinite(oxygenCompressionRatio)) {
        descriptionParts.push(
          `O2 compression ratio is ${oxygenCompressionRatio.toFixed(2)}:1 (source ${stage.sourceEndPressureBar.toFixed(1)} bar to receiver ${stage.receiverEndPressureBar.toFixed(1)} bar).`
        );
      }
      protocolSteps.push({
        type: stage.type,
        operation,
        title: `Step ${stepNumber}: ${operation} ${bank.name} to ${targetPressure} bar`,
        recipeLabel: `${operation} ${bank.name}`,
        recipeAction: operation,
        recipeGas: bank.name,
        description: descriptionParts.join(' '),
        pressureDeltaBar: pressureDelta,
        resultingPressureBar: currentPressure,
        resultingMix: { oxygenPercent, heliumPercent },
        sourceStartPressureBar: stage.sourceStartPressureBar,
        sourceEndPressureBar: stage.sourceEndPressureBar,
        receiverStartPressureBar: stage.receiverStartPressureBar,
        receiverEndPressureBar: stage.receiverEndPressureBar,
        ...(input.thermal ? {
          sourceOxygenPercent: bank.oxygenPercent,
          sourceHeliumPercent: bank.heliumPercent
        } : {}),
        minimumSourcePressureBar,
        sourceExhausted,
        oxygenCompressionRatio,
        badgeClass: bank.heliumPercent > 0
          ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
          : 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
      });
    }
  }

  const blend = blendSummary({
    retainedPressure,
    retainedMoles,
    initialMoles,
    drainPressure,
    ventedMoles,
    ventedGasLitres,
    heliumSalvagedLitres,
    finalPressureBar: recipeTargetPressureBar,
    targetOxygenPercent,
    targetHeliumPercent
  });

  if (!exactTargetFeasible) {
    const message = requestedSafetyError
      ? `${requestedSafetyError} Maximum safe pressure for the exact target mix is ${recipeTargetPressureBar.toFixed(1)} bar (requested ${targetPressureBar.toFixed(1)} bar).`
      : `Requested pressure ${targetPressureBar.toFixed(1)} bar is unavailable for the exact target mix; maximum safely achievable pressure is ${recipeTargetPressureBar.toFixed(1)} bar.`;
    return failedResult(
      message,
      gas,
      recipeSolverResult.steps,
      maximumPressureResult(recipeTargetPressureBar, recipeSolverResult, blend, protocolSteps, trajectory),
      createBlendDiagnostics(componentShortfalls, recipeSolverResult, activeBanks, bankMaxMoles, temperatureC, useVdw, minimumSourcePressureFor)
    );
  }

  return {
    feasible: true,
    error: null,
    gas,
    solution: recipeSolverResult.solution,
    tableauSteps: recipeSolverResult.steps,
    blend,
    protocolSteps,
    trajectory,
    maximumPressure: null
  };
}

const THERMAL_TARGET_TOLERANCE_BAR = 1e-5;
const MINIMUM_TARGET_PRESSURE_BAR = 10;
const MAXIMUM_TARGET_PRESSURE_BAR = 350;

function evaluateThermalCandidate(input, optimizeStatic, targetPressureBar) {
  const candidateInput = {
    ...input,
    cylinder: {
      ...input.cylinder,
      targetPressureBar
    }
  };
  const result = optimizeStatic(candidateInput);
  if (!result.feasible) return { candidateInput, result, simulation: null };

  const simulation = simulateThermalProtocol({
    protocolSteps: result.protocolSteps,
    cylinder: candidateInput.cylinder,
    physics: candidateInput.physics,
    thermal: candidateInput.thermal,
    settings: candidateInput.settings
  });
  return { candidateInput, result, simulation };
}

function thermalResult(candidate, requestedSettledTargetPressureBar) {
  return {
    ...candidate.result,
    gas: candidate.result.gas && {
      ...candidate.result.gas,
      targetPressureBar: requestedSettledTargetPressureBar
    },
    protocolSteps: candidate.simulation.protocolSteps,
    thermal: {
      ...candidate.simulation.final,
      requestedSettledTargetPressureBar
    }
  };
}

function thermalizedMaximumResult(candidate, requestedSettledTargetPressureBar) {
  const maximum = candidate.result.maximumPressure;
  if (!maximum) return { ...candidate.result, thermal: null };

  const simulation = simulateThermalProtocol({
    protocolSteps: maximum.protocolSteps,
    cylinder: candidate.candidateInput.cylinder,
    physics: candidate.candidateInput.physics,
    thermal: candidate.candidateInput.thermal,
    settings: candidate.candidateInput.settings
  });
  return {
    ...candidate.result,
    gas: candidate.result.gas && {
      ...candidate.result.gas,
      targetPressureBar: requestedSettledTargetPressureBar
    },
    maximumPressure: {
      ...maximum,
      protocolSteps: simulation.protocolSteps,
      thermal: {
        ...simulation.final,
        requestedSettledTargetPressureBar
      }
    },
    thermal: {
      ...simulation.final,
      requestedSettledTargetPressureBar
    }
  };
}

function thermalLimitResult(input, requested, maximum) {
  const requestedSettledTargetPressureBar = input.cylinder.targetPressureBar;
  const thermal = {
    ...maximum.simulation.final,
    requestedSettledTargetPressureBar
  };
  const maximumPressure = {
    pressureBar: maximum.result.blend.finalPressureBar,
    solution: maximum.result.solution,
    tableauSteps: maximum.result.tableauSteps,
    blend: maximum.result.blend,
    protocolSteps: maximum.simulation.protocolSteps,
    trajectory: maximum.result.trajectory,
    thermal
  };
  return {
    ...failedResult(
      `Requested ambient-settled pressure ${requestedSettledTargetPressureBar.toFixed(1)} bar cannot be reached; maximum predicted ambient pressure is ${maximum.simulation.final.finalAmbientPressureBar.toFixed(1)} bar.`,
      {
        ...requested.result.gas,
        targetPressureBar: requestedSettledTargetPressureBar
      },
      maximum.result.tableauSteps,
      maximumPressure,
      requested.result.diagnostics ?? null
    ),
    thermal
  };
}

function optimizeThermalBlend(input, optimizeStatic) {
  const inputErrors = validateBlendInput(input);
  if (inputErrors.length > 0) {
    return failedResult(`Invalid blend input: ${inputErrors.join(' ')}`, null, []);
  }

  const requestedPressureBar = input.cylinder.targetPressureBar;
  const requested = evaluateThermalCandidate(input, optimizeStatic, requestedPressureBar);
  if (!requested.result.feasible) {
    return thermalizedMaximumResult(requested, requestedPressureBar);
  }

  const requestedPressureDifference = requested.simulation.final.finalAmbientPressureBar
    - requestedPressureBar;
  if (Math.abs(requestedPressureDifference) <= THERMAL_TARGET_TOLERANCE_BAR) {
    return thermalResult(requested, requestedPressureBar);
  }
  if (requestedPressureDifference > 0) {
    const floor = evaluateThermalCandidate(
      input,
      optimizeStatic,
      MINIMUM_TARGET_PRESSURE_BAR
    );
    if (!floor.result.feasible) {
      return thermalizedMaximumResult(floor, requestedPressureBar);
    }

    const floorPressureDifference = floor.simulation.final.finalAmbientPressureBar
      - requestedPressureBar;
    if (Math.abs(floorPressureDifference) <= THERMAL_TARGET_TOLERANCE_BAR) {
      return thermalResult(floor, requestedPressureBar);
    }
    if (floorPressureDifference > 0) return thermalLimitResult(input, requested, requested);

    let lowerPressureBar = MINIMUM_TARGET_PRESSURE_BAR;
    let upperPressureBar = requestedPressureBar;
    let ambientTargetCandidate = requested;
    for (let iteration = 0; iteration < 40; iteration++) {
      const candidatePressureBar = (lowerPressureBar + upperPressureBar) / 2;
      const candidate = evaluateThermalCandidate(input, optimizeStatic, candidatePressureBar);
      if (!candidate.result.feasible) {
        lowerPressureBar = candidatePressureBar;
        continue;
      }

      const pressureDifference = candidate.simulation.final.finalAmbientPressureBar
        - requestedPressureBar;
      if (Math.abs(pressureDifference) <= THERMAL_TARGET_TOLERANCE_BAR) {
        return thermalResult(candidate, requestedPressureBar);
      }
      if (pressureDifference < 0) {
        lowerPressureBar = candidatePressureBar;
      } else {
        upperPressureBar = candidatePressureBar;
        ambientTargetCandidate = candidate;
      }
    }
    return thermalResult(ambientTargetCandidate, requestedPressureBar);
  }

  const ceiling = evaluateThermalCandidate(input, optimizeStatic, MAXIMUM_TARGET_PRESSURE_BAR);
  if (ceiling.result.feasible) {
    const ceilingPressureDifference = ceiling.simulation.final.finalAmbientPressureBar
      - requestedPressureBar;
    if (Math.abs(ceilingPressureDifference) <= THERMAL_TARGET_TOLERANCE_BAR) {
      return thermalResult(ceiling, requestedPressureBar);
    }
    if (ceilingPressureDifference < 0) return thermalLimitResult(input, requested, ceiling);
  }

  let lowerPressureBar = requestedPressureBar;
  let upperPressureBar = MAXIMUM_TARGET_PRESSURE_BAR;
  let highestFeasible = requested;
  let ambientTargetCandidate = null;
  for (let iteration = 0; iteration < 40; iteration++) {
    const candidatePressureBar = (lowerPressureBar + upperPressureBar) / 2;
    const candidate = evaluateThermalCandidate(input, optimizeStatic, candidatePressureBar);
    if (!candidate.result.feasible) {
      upperPressureBar = candidatePressureBar;
      continue;
    }

    highestFeasible = candidate;
    const pressureDifference = candidate.simulation.final.finalAmbientPressureBar
      - requestedPressureBar;
    if (Math.abs(pressureDifference) <= THERMAL_TARGET_TOLERANCE_BAR) {
      return thermalResult(candidate, requestedPressureBar);
    }
    if (pressureDifference < 0) {
      lowerPressureBar = candidatePressureBar;
    } else {
      upperPressureBar = candidatePressureBar;
      ambientTargetCandidate = candidate;
    }
  }

  if (ambientTargetCandidate) return thermalResult(ambientTargetCandidate, requestedPressureBar);
  if (!ceiling.result.feasible) {
    const maximum = thermalizedMaximumResult(ceiling, requestedPressureBar);
    if (maximum.maximumPressure) {
      return {
        ...maximum,
        gas: requested.result.gas,
        error: `Requested ambient-settled pressure ${requestedPressureBar.toFixed(1)} bar cannot be reached. ${maximum.error}`
      };
    }
  }
  return thermalLimitResult(input, requested, highestFeasible);
}

export function optimizeBlend(input) {
  if (!input?.thermal) return optimizeBlendWithoutThermal(input);
  return optimizeThermalBlend(input, optimizeBlendWithoutThermal);
}
