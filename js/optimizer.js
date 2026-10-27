import { GAS_CONSTANT, HELIUM_SALVAGE_MAX_PERCENT, calcMolarDensity, calcPressure, calcZFromDensity, getMixParams } from './physics.js';
import { solveTwoPhaseSimplex } from './simplex.js';
import { isValidGasComposition } from './gas-input.js';
import { validateCalculatorInputs, validateSupplyBankInput } from './input-validation.js';
import {
  DEFAULT_HOT_OVERFILL_PERCENT,
  isValidHotOverfillPercent
} from './preset-validation.js';
import { getCylinderPressureLimit } from './pressure-limits.js';
import {
  simulateThermalProtocol,
  calculatePressureAtTemperature,
  calculateCoolingTime,
  coolingTimeConstantMinutes
} from './thermodynamics.js';
import { leftoverAttractiveness, leftoverReachability } from './leftover-attractiveness.js';
import {
  applyDrawToBank,
  applyTransferToBank,
  isSalvageReceiver,
  rankReceivers,
  salvageTransferMoles,
  selectSalvageVariant
} from './salvage.js';
const THERMAL_SAFETY_TOLERANCE_BAR = 1e-9;
const MAX_AUTOMATIC_WAIT_MINUTES = 1440;


function pressureAtSample(sample, state, step, {
  thermal,
  physics,
  cylinder
}) {
  if (Number.isFinite(sample.projectedPressureBar)) return sample.projectedPressureBar;
  const oxygenPercent = sample.oxygenPercent
    ?? step.resultingMix?.oxygenPercent
    ?? state.receiverStartMix?.oxygenPercent
    ?? 21;
  const heliumPercent = sample.heliumPercent
    ?? step.resultingMix?.heliumPercent
    ?? state.receiverStartMix?.heliumPercent
    ?? 0;
  if (!Number.isFinite(sample.ambientPressureBar)) return sample.pressureBar;
  const fromTemperatureC = sample.pressureReferenceTemperatureC
    ?? thermal.ambientTemperatureC;
  return calculatePressureAtTemperature({
    pressureBar: sample.ambientPressureBar,
    oxygenPercent,
    heliumPercent,
    fromTemperatureC,
    toTemperatureC: sample.temperatureC,
    volumeL: cylinder.volumeL,
    useVdw: physics.model === 'vdw'
  });
}

function hotTransferEndpointPressure(state, step, {
  thermal,
  physics,
  cylinder
}) {
  if (Number.isFinite(state.pressureAtTransferEndHotBar)) {
    return state.pressureAtTransferEndHotBar;
  }
  return calculatePressureAtTemperature({
    pressureBar: state.pressureAtTransferEndReferenceBar
      ?? state.pressureAtTransferEndBar,
    oxygenPercent: step.resultingMix?.oxygenPercent
      ?? state.receiverStartMix?.oxygenPercent
      ?? 21,
    heliumPercent: step.resultingMix?.heliumPercent
      ?? state.receiverStartMix?.heliumPercent
      ?? 0,
    fromTemperatureC: state.pressureReferenceTemperatureC
      ?? thermal.ambientTemperatureC,
    toTemperatureC: state.temperatureAtTransferEndC,
    volumeL: cylinder.volumeL,
    useVdw: physics.model === 'vdw'
  });
}

function thermalEquipmentPressureLimit(state, settings) {
  const limits = [];
  const rateSource = state?.rateSource;
  const booster = settings?.booster ?? {};
  if (rateSource === 'compressor') {
    limits.push(Number.isFinite(booster.maxCompressorPressureBar)
      ? booster.maxCompressorPressureBar
      : 232);
  } else if (rateSource === 'booster') {
    limits.push(Number.isFinite(booster.maxBoosterOutputPressureBar)
      ? booster.maxBoosterOutputPressureBar
      : 200);
  }
  return limits.length > 0 ? Math.min(...limits) : Infinity;
}
function cylinderHotOverfillPercent(cylinder) {
  const value = cylinder?.hotOverfillPercent;
  if (value === undefined) return DEFAULT_HOT_OVERFILL_PERCENT;
  if (!isValidHotOverfillPercent(value)) {
    throw new RangeError('Cylinder hot overfill must be between 0 and 5% in 0.5% steps.');
  }
  return value;
}

function configuredCylinderPressureLimit(workingPressureBar, isTransientHot, context) {
  const workingPressure = Number(workingPressureBar);
  if (!Number.isFinite(workingPressure)) return Infinity;
  const cylinder = context.cylinder?.workingPressureBar === workingPressure
    ? context.cylinder
    : { ...(context.cylinder ?? {}), workingPressureBar: workingPressure };
  return getCylinderPressureLimit({ cylinder, isTransientHot })?.limitBar ?? Infinity;
}

function isAboveAmbientTemperature(temperatureC, ambientTemperatureC) {
  return Number.isFinite(temperatureC)
    && Number.isFinite(ambientTemperatureC)
    && temperatureC > ambientTemperatureC;
}

function cylinderPressureLimitAtTemperature(temperatureC, workingPressureBar, context, isTransientHot) {
  const transientHot = isTransientHot
    ?? isAboveAmbientTemperature(temperatureC, context.thermal?.ambientTemperatureC);
  const configuredLimit = configuredCylinderPressureLimit(
    workingPressureBar,
    transientHot,
    context
  );
  return context.settings?.pressureLimitMode === 'warning'
    ? Infinity
    : configuredLimit;
}

function pressureValuesForSafety(state, step, context) {
  const ambientTemperatureC = context.thermal?.ambientTemperatureC;
  const targetTemperatureWait = context.thermal?.waitMode === 'temperature';
  const waitEndMinutes = state.durationMinutes + state.waitMinutes;
  const isTargetWaitEndpoint = sample => targetTemperatureWait
    && Number.isFinite(sample.elapsedMinutes)
    && Number.isFinite(waitEndMinutes)
    && sample.elapsedMinutes >= waitEndMinutes - 1e-9;
  return [
    {
      pressureBar: state.pressureStartBar,
      temperatureC: state.temperatureStartC,
      isTransientHot: (!targetTemperatureWait || state.measurementApplied === true)
        && isAboveAmbientTemperature(state.temperatureStartC, ambientTemperatureC)
    },
    ...(state.measurementApplied === false ? [] : [{
      pressureBar: state.measuredStartPressureBar,
      temperatureC: state.measuredStartTemperatureC,
      isTransientHot: isAboveAmbientTemperature(
        state.measuredStartTemperatureC,
        ambientTemperatureC
      )
    }]),
    {
      pressureBar: state.pressureAtTransferEndAmbientBar,
      temperatureC: ambientTemperatureC,
      isTransientHot: false
    },
    {
      pressureBar: state.pressureAfterWaitBar,
      temperatureC: state.temperatureAfterWaitC,
      isTransientHot: !targetTemperatureWait
        && isAboveAmbientTemperature(state.temperatureAfterWaitC, ambientTemperatureC)
    },
    {
      pressureBar: hotTransferEndpointPressure(state, step, context),
      temperatureC: state.temperatureAtTransferEndC,
      isTransientHot: isAboveAmbientTemperature(
        state.temperatureAtTransferEndC,
        ambientTemperatureC
      )
    },
    ...(state.samples ?? []).flatMap(sample => [
      {
        pressureBar: sample.ambientPressureBar,
        temperatureC: ambientTemperatureC,
        isTransientHot: false
      },
      {
        pressureBar: pressureAtSample(sample, state, step, context),
        temperatureC: sample.temperatureC ?? sample.pressureReferenceTemperatureC,
        isTransientHot: !isTargetWaitEndpoint(sample)
          && isAboveAmbientTemperature(
            sample.temperatureC ?? sample.pressureReferenceTemperatureC,
            ambientTemperatureC
          )
      }
    ])
  ].filter(({ pressureBar }) => pressureBar !== undefined);
}

function exceedsThermalLimit(pressure, limit) {
  return !Number.isFinite(pressure)
    || pressure > limit + THERMAL_SAFETY_TOLERANCE_BAR;
}

function unsafeThermalStep(state, step, workingPressureBar, equipmentLimit, context) {
  return pressureValuesForSafety(state, step, context)
    .some(({ pressureBar, temperatureC, isTransientHot }) => {
      const cylinderLimit = cylinderPressureLimitAtTemperature(
        temperatureC,
        workingPressureBar,
        context,
        isTransientHot
      );
      return exceedsThermalLimit(pressureBar, Math.min(cylinderLimit, equipmentLimit));
    });
}


function firstUnsafeThermalIndex(simulation, workingPressureBar, context) {
  cylinderHotOverfillPercent(context.cylinder);
  const initialLimit = cylinderPressureLimitAtTemperature(
    context.thermal?.ambientTemperatureC,
    workingPressureBar,
    context
  );
  const initialPressureBar = context.cylinder?.initialPressureBar;
  if (exceedsThermalLimit(initialPressureBar, initialLimit)) {
    return -2;
  }
  for (const [index, step] of (simulation?.protocolSteps ?? []).entries()) {
    const state = step.thermal;
    const equipmentLimit = thermalEquipmentPressureLimit(state, context.settings);
    if (unsafeThermalStep(state, step, workingPressureBar, equipmentLimit, context)) return index;
  }
  return -1;
}

export function isSafeSimulation(simulation, workingPressureBar, {
  thermal,
  physics,
  cylinder,
  settings
} = {}) {
  cylinderHotOverfillPercent(cylinder);
  if (!thermal || !physics || !cylinder) {
    const limit = cylinderPressureLimitAtTemperature(
      thermal?.ambientTemperatureC,
      workingPressureBar,
      { thermal, cylinder, settings }
    ) + THERMAL_SAFETY_TOLERANCE_BAR;
    return Number(cylinder?.initialPressureBar ?? 0) <= limit
      && (simulation?.protocolSteps ?? []).every(step => {
        const state = step.thermal;
        if (!state) return true;
        const pressures = [
          state.pressureStartBar,
          state.pressureAtTransferEndReferenceBar,
          state.pressureAtTransferEndAmbientBar,
          state.pressureAtTransferEndBar,
          state.pressureAtTransferEndHotBar,
          state.pressureAfterWaitBar,
          ...(state.samples ?? []).flatMap(sample => [
            sample.ambientPressureBar,
            sample.projectedPressureBar ?? sample.pressureBar
          ])
        ].filter(pressure => pressure !== undefined);
        return pressures.every(pressure => Number.isFinite(pressure) && pressure <= limit);
      });
  }
  return firstUnsafeThermalIndex(simulation, workingPressureBar, {
    thermal,
    physics,
    cylinder,
    settings
  }) === -1;
}

function totalWaitMinutes(simulation) {
  return (simulation?.protocolSteps ?? []).reduce(
    (total, step) => total + (Number.isFinite(step.thermal?.waitMinutes)
      ? step.thermal.waitMinutes
      : 0),
    0
  );
}

function automaticWaitMetadata(simulation) {
  return (simulation?.protocolSteps ?? []).flatMap((step, stepIndex) => {
    const state = step.thermal;
    if (!state || !(state.automaticWaitMinutes > THERMAL_SAFETY_TOLERANCE_BAR)) return [];
    return [{
      stepIndex,
      stepIdentifier: step.title ?? step.id ?? stepIndex,
      configuredWaitMinutes: state.configuredWaitMinutes,
      actualWaitMinutes: state.waitMinutes,
      addedWaitMinutes: state.automaticWaitMinutes,
      warning: '!'
    }];
  });
}

function simulated(steps, options) {
  return simulateThermalProtocol({
    protocolSteps: steps,
    cylinder: options.cylinder,
    physics: options.physics,
    thermal: options.thermal,
    settings: options.settings
  });
}

function mixForStep(step, state, fallback = { oxygenPercent: 21, heliumPercent: 0 }) {
  return {
    oxygenPercent: state?.receiverStartMix?.oxygenPercent
      ?? step.receiverStartMix?.oxygenPercent
      ?? fallback.oxygenPercent,
    heliumPercent: state?.receiverStartMix?.heliumPercent
      ?? step.receiverStartMix?.heliumPercent
      ?? fallback.heliumPercent
  };
}

function pressureFromMoles(moles, volumeL, oxygenPercent, heliumPercent, temperatureC, useVdw) {
  return calcPressure(
    moles / volumeL,
    oxygenPercent,
    heliumPercent,
    temperatureC,
    useVdw
  );
}

function inventoryPressure(moles, volumeL, oxygenMoles, heliumMoles, temperatureC, useVdw) {
  return pressureFromMoles(
    moles,
    volumeL,
    moles > 0 ? oxygenMoles / moles * 100 : 0,
    moles > 0 ? heliumMoles / moles * 100 : 0,
    temperatureC,
    useVdw
  );
}

function splitTransferAtSafeHotEndpoint({
  steps,
  unsafeIndex,
  simulation,
  options
}) {
  const transferStep = steps[unsafeIndex];
  if (!transferStep || transferStep.type === 'wait' || transferStep.type === 'keep'
    || transferStep._thermalSplit) return null;
  const state = simulation.protocolSteps[unsafeIndex]?.thermal;
  if (!state) return null;
  const useVdw = options.physics.model === 'vdw';
  const ambientTemperatureC = options.thermal.ambientTemperatureC;
  const receiverStartMix = mixForStep(transferStep, state);
  const receiverEndMix = {
    oxygenPercent: transferStep.resultingMix?.oxygenPercent ?? receiverStartMix.oxygenPercent,
    heliumPercent: transferStep.resultingMix?.heliumPercent ?? receiverStartMix.heliumPercent
  };
  const receiverStartAmbientPressureBar = calculatePressureAtTemperature({
    pressureBar: state.pressureStartBar,
    oxygenPercent: receiverStartMix.oxygenPercent,
    heliumPercent: receiverStartMix.heliumPercent,
    fromTemperatureC: state.temperatureStartC,
    toTemperatureC: ambientTemperatureC,
    volumeL: options.cylinder.volumeL,
    useVdw
  });
  const receiverStartMoles = calcMolarDensity(
    receiverStartAmbientPressureBar,
    receiverStartMix.oxygenPercent,
    receiverStartMix.heliumPercent,
    ambientTemperatureC,
    useVdw
  ) * options.cylinder.volumeL;
  const receiverEndReferencePressureBar = Number(
    transferStep.receiverEndPressureBar ?? transferStep.resultingPressureBar
  );
  if (!Number.isFinite(receiverEndReferencePressureBar)) return null;
  const pressureReferenceTemperatureC = Number.isFinite(transferStep.pressureReferenceTemperatureC)
    ? transferStep.pressureReferenceTemperatureC
    : options.physics.temperatureC;
  const receiverEndPressureBar = calculatePressureAtTemperature({
    pressureBar: receiverEndReferencePressureBar,
    oxygenPercent: receiverEndMix.oxygenPercent,
    heliumPercent: receiverEndMix.heliumPercent,
    fromTemperatureC: pressureReferenceTemperatureC,
    toTemperatureC: ambientTemperatureC,
    volumeL: options.cylinder.volumeL,
    useVdw
  });
  const receiverEndMoles = calcMolarDensity(
    receiverEndPressureBar,
    receiverEndMix.oxygenPercent,
    receiverEndMix.heliumPercent,
    ambientTemperatureC,
    useVdw
  ) * options.cylinder.volumeL;
  const totalReceiverMoles = receiverEndMoles - receiverStartMoles;
  if (!(totalReceiverMoles > 1e-10)) return null;

  const sourceUnlimited = transferStep.sourceInventory === 'unlimited'
    || transferStep.recipeGas === 'Compressor Air'
    || transferStep.method === 'compressor';
  const sourceOxygenPercent = transferStep.sourceOxygenPercent ?? receiverEndMix.oxygenPercent;
  const sourceHeliumPercent = transferStep.sourceHeliumPercent ?? receiverEndMix.heliumPercent;
  const sourceVolumeL = sourceUnlimited ? NaN : Number(transferStep.sourceVolumeL);
  const sourceStartReferencePressureBar = Number(transferStep.sourceStartPressureBar);
  const sourceStartInventoryPressureBar = Number.isFinite(sourceStartReferencePressureBar)
    ? calculatePressureAtTemperature({
      pressureBar: sourceStartReferencePressureBar,
      oxygenPercent: sourceOxygenPercent,
      heliumPercent: sourceHeliumPercent,
      fromTemperatureC: pressureReferenceTemperatureC,
      toTemperatureC: ambientTemperatureC,
      volumeL: sourceVolumeL,
      useVdw
    })
    : NaN;
  const derivedSourceStartMoles = Number.isFinite(sourceVolumeL) && sourceVolumeL > 0
    && Number.isFinite(sourceStartInventoryPressureBar)
    ? calcMolarDensity(
      sourceStartInventoryPressureBar,
      sourceOxygenPercent,
      sourceHeliumPercent,
      ambientTemperatureC,
      useVdw
    ) * sourceVolumeL
    : null;
  const sourceStartMoles = sourceUnlimited
    ? null
    : Number.isFinite(transferStep.sourceStartMoles)
      ? transferStep.sourceStartMoles
      : derivedSourceStartMoles;
  const sourceEndMoles = Number.isFinite(sourceStartMoles)
    ? sourceStartMoles - totalReceiverMoles
    : null;
  if (Number.isFinite(sourceEndMoles) && sourceEndMoles < -1e-8) return null;

  const receiverMixAt = fraction => {
    const transferredMoles = totalReceiverMoles * fraction;
    const totalMoles = receiverStartMoles + transferredMoles;
    const oxygenMoles = receiverStartMoles * receiverStartMix.oxygenPercent / 100
      + transferredMoles * sourceOxygenPercent / 100;
    const heliumMoles = receiverStartMoles * receiverStartMix.heliumPercent / 100
      + transferredMoles * sourceHeliumPercent / 100;
    return {
      moles: totalMoles,
      oxygenMoles,
      heliumMoles,
      oxygenPercent: oxygenMoles / totalMoles * 100,
      heliumPercent: heliumMoles / totalMoles * 100
    };
  };
  const sourcePressureAt = moles => Number.isFinite(sourceVolumeL) && Number.isFinite(moles)
    ? inventoryPressure(
      moles,
      sourceVolumeL,
      moles * sourceOxygenPercent / 100,
      moles * sourceHeliumPercent / 100,
      ambientTemperatureC,
      useVdw
    )
    : null;

  const stagesAt = fraction => {
    const stage1 = receiverMixAt(fraction);
    const firstConsumedMoles = totalReceiverMoles * fraction;
    const firstSourceMoles = Number.isFinite(sourceStartMoles)
      ? sourceStartMoles - firstConsumedMoles
      : null;
    const firstReceiverPressureBar = inventoryPressure(
      stage1.moles,
      options.cylinder.volumeL,
      stage1.oxygenMoles,
      stage1.heliumMoles,
      ambientTemperatureC,
      useVdw
    );
    const first = {
      ...transferStep,
      _thermalSplit: true,
      pressureReferenceTemperatureC: ambientTemperatureC,
      pressureAtTransferEndReferenceBar: firstReceiverPressureBar,
      receiverStartPressureBar: receiverStartAmbientPressureBar,
      receiverEndPressureBar: firstReceiverPressureBar,
      resultingPressureBar: firstReceiverPressureBar,
      resultingMix: {
        oxygenPercent: stage1.oxygenPercent,
        heliumPercent: stage1.heliumPercent
      },
      receiverStartMix,
      receiverStartMoles,
      receiverEndMoles: stage1.moles,
      sourceInventory: sourceUnlimited ? 'unlimited' : transferStep.sourceInventory,
      sourceVolumeL: sourceUnlimited ? null : transferStep.sourceVolumeL,
      sourceStartMoles,
      sourceEndMoles: firstSourceMoles,
      sourceConsumedMoles: firstConsumedMoles,
      sourceStartPressureBar: Number.isFinite(sourceStartMoles)
        ? sourcePressureAt(sourceStartMoles)
        : transferStep.sourceStartPressureBar,
      sourceEndPressureBar: Number.isFinite(firstSourceMoles)
        ? sourcePressureAt(firstSourceMoles)
        : transferStep.sourceEndPressureBar,
      title: `${transferStep.title} (safe stage 1)`
    };
    const second = {
      ...transferStep,
      _thermalSplit: true,
      _measurementIndex: null,
      pressureReferenceTemperatureC: ambientTemperatureC,
      pressureAtTransferEndReferenceBar: receiverEndPressureBar,
      receiverStartPressureBar: firstReceiverPressureBar,
      receiverEndPressureBar,
      resultingPressureBar: receiverEndPressureBar,
      receiverStartMix: first.resultingMix,
      receiverStartMoles: stage1.moles,
      receiverEndMoles,
      sourceInventory: sourceUnlimited ? 'unlimited' : transferStep.sourceInventory,
      sourceVolumeL: sourceUnlimited ? null : transferStep.sourceVolumeL,
      sourceStartMoles: firstSourceMoles,
      sourceEndMoles,
      sourceConsumedMoles: totalReceiverMoles - firstConsumedMoles,
      sourceStartPressureBar: Number.isFinite(firstSourceMoles)
        ? sourcePressureAt(firstSourceMoles)
        : transferStep.sourceStartPressureBar,
      sourceEndPressureBar: Number.isFinite(sourceEndMoles)
        ? sourcePressureAt(sourceEndMoles)
        : transferStep.sourceEndPressureBar,
      title: `${transferStep.title} (safe stage 2)`
    };
    const wait = {
      type: 'wait',
      _measurementIndex: null,
      _safetyWaitOnly: true,
      title: 'Automatic wait between safe transfer stages',
      recipeLabel: 'Automatic safety wait',
      pressureReferenceTemperatureC: ambientTemperatureC,
      pressureAtTransferEndReferenceBar: firstReceiverPressureBar,
      receiverStartPressureBar: firstReceiverPressureBar,
      receiverEndPressureBar: firstReceiverPressureBar,
      resultingPressureBar: firstReceiverPressureBar,
      resultingMix: first.resultingMix,
      receiverStartMix: first.resultingMix,
      waitMinutes: 0,
      configuredWaitMinutes: 0,
      automaticWaitMinutes: 0
    };
    return { first, wait, second };
  };

  const prefix = steps.slice(0, unsafeIndex);
  const firstStageSimulationAt = fraction => simulated(
    prefix.concat(stagesAt(fraction).first),
    options
  );
  const hotEndpointAt = fraction => {
    const candidate = stagesAt(fraction).first;
    const candidateSimulation = firstStageSimulationAt(fraction);
    const candidateState = candidateSimulation.protocolSteps.at(-1)?.thermal;
    return candidateState
      ? hotTransferEndpointPressure(candidateState, candidate, options)
      : NaN;
  };
  let previousHotEndpoint = -Infinity;
  for (const fraction of [0, 0.25, 0.5, 0.75, 1]) {
    const hotEndpoint = hotEndpointAt(fraction);
    if (!Number.isFinite(hotEndpoint)
      || hotEndpoint + THERMAL_SAFETY_TOLERANCE_BAR < previousHotEndpoint) {
      return null;
    }
    previousHotEndpoint = hotEndpoint;
  }
  const firstStageSafeAt = fraction => {
    const candidateSimulation = firstStageSimulationAt(fraction);
    return firstUnsafeThermalIndex(candidateSimulation, options.cylinder.workingPressureBar, options) === -1;
  };
  if (!firstStageSafeAt(0)) {
    return null;
  }
  let low = 0;
  let high = 1;
  if (firstStageSafeAt(1)) low = 1;
  else {
    for (let iteration = 0; iteration < 50; iteration++) {
      const middle = (low + high) / 2;
      if (firstStageSafeAt(middle)) low = middle;
      else high = middle;
    }
  }
  if (!(low > 1e-9)) {
    return null;
  }
  const split = stagesAt(low);
  const firstStageState = firstStageSimulationAt(low).protocolSteps.at(-1)?.thermal;
  if (firstStageState) {
    const hotEndpointBar = firstStageState.pressureAtTransferEndHotBar;
    const ambientTemperatureC = options.thermal.ambientTemperatureC;
    const targetTemperatureC = options.thermal.targetMediumTemperatureC
      ?? options.thermal.targetTemperatureC
      ?? ambientTemperatureC;
    const tauMinutes = coolingTimeConstantMinutes(
      options.thermal.tankMaterial,
      options.thermal.coolingMedium,
      options.thermal.waterSubmersionPercent
    );
    const splitWaitMinutes = Math.abs(targetTemperatureC - ambientTemperatureC) < 1e-9
      ? 4.6 * tauMinutes
      : calculateCoolingTime({
        transferEndTemperatureC: firstStageState.temperatureAtTransferEndC,
        ambientTemperatureC,
        targetTemperatureC,
        tauMinutes
      });
    split.wait.automaticWaitMinutes = Number.isFinite(splitWaitMinutes)
      ? Math.max(0, splitWaitMinutes)
      : 0;
    split.wait.pressureReferenceTemperatureC = firstStageState.pressureReferenceTemperatureC;
    split.wait.pressureAtTransferEndReferenceBar = firstStageState.pressureAtTransferEndReferenceBar;
    split.wait.pressureAtTransferEndBar = hotEndpointBar;
    split.wait.receiverStartPressureBar = hotEndpointBar;
    split.wait.receiverEndPressureBar = hotEndpointBar;
    split.wait.resultingPressureBar = hotEndpointBar;
  }
  return split;
}

// A rest sits before the step at `index`: a keep, or the salvage that now stands in for it.
// Once salvage takes the whole surplus no keep is emitted, so the recipe step follows salvage.
function isRestBefore(steps, index) {
  if (steps[index - 1]?.type === 'keep') return true;
  return steps[index - 1]?.type === 'salvage'
    && steps[index]?.type !== 'salvage' && steps[index]?.type !== 'drain';
}

export function scheduleSafeThermalProtocol({
  protocolSteps,
  thermal,
  cylinder,
  physics,
  settings
}) {
  cylinderHotOverfillPercent(cylinder);
  const options = { thermal, cylinder, physics, settings };
  const steps = protocolSteps.map((step, index) => ({
    ...step,
    _measurementIndex: index
  }));
  const maxWait = MAX_AUTOMATIC_WAIT_MINUTES;
  const finish = (simulation, unsafe = false) => {
    const automaticWaits = automaticWaitMetadata(simulation);
    const metadataByIndex = new Map(
      automaticWaits.map(metadata => [metadata.stepIndex, metadata])
    );
    const protocol = simulation.protocolSteps.map((step, index) => {
      const metadata = metadataByIndex.get(index);
      const {
        automaticWaitMetadata: _staleMetadata,
        _scheduledMeasuredStartPressureBar: _scheduledPressure,
        _scheduledMeasuredStartTemperatureC: _scheduledTemperature,
        _applyInterimMeasurement: _applyMeasurement,
        ...cleanStep
      } = step;
      return metadata ? { ...cleanStep, automaticWaitMetadata: metadata } : cleanStep;
    });
    const normalizedSimulation = { ...simulation, protocolSteps: protocol };
    return {
      protocolSteps: protocol,
      automaticWaits,
      simulation: normalizedSimulation,
      unsafe
    };
  };
  for (let pass = 0; pass < Math.max(16, steps.length * 8 + 8); pass++) {
    const simulation = simulated(steps, options);
    const unsafeIndex = firstUnsafeThermalIndex(
      simulation,
      cylinder.workingPressureBar,
      options
    );
    const overWaitLimit = totalWaitMinutes(simulation) > maxWait + THERMAL_SAFETY_TOLERANCE_BAR;
    if (unsafeIndex === -1 && !overWaitLimit) return finish(simulation);
    if (unsafeIndex === -2) return finish(simulation, true);

    const targetIndex = unsafeIndex < 0 ? steps.length - 1 : unsafeIndex;
    const targetState = simulation.protocolSteps[targetIndex]?.thermal;
    if (targetState && steps[targetIndex]) {
      const measurementIndex = steps[targetIndex]._measurementIndex;
      const measuredStart = measurementIndex === null
        ? null
        : options.thermal.interimMeasurements?.[measurementIndex];
      const hasMeasurement = Number.isFinite(measuredStart?.pressureBar)
        || Number.isFinite(measuredStart?.temperatureC);
      const receiverStartPressureBar = steps[targetIndex].receiverStartPressureBar;
      steps[targetIndex] = {
        ...steps[targetIndex],
        _scheduledMeasuredStartPressureBar: hasMeasurement
          ? steps[targetIndex]._scheduledMeasuredStartPressureBar
            ?? (Number.isFinite(receiverStartPressureBar)
              ? receiverStartPressureBar
              : targetState.pressureStartBar)
          : null,
        _scheduledMeasuredStartTemperatureC: hasMeasurement
          ? steps[targetIndex]._scheduledMeasuredStartTemperatureC
            ?? (isRestBefore(steps, targetIndex)
              ? targetState.temperatureStartC
              : options.thermal.ambientTemperatureC ?? targetState.temperatureStartC)
          : null
      };
    }
    const detachInitialMeasurement = () => {
      const affectedStep = steps[targetIndex];
      if (!affectedStep || affectedStep.type === 'keep'
        || affectedStep._measurementIndex !== 0) return;
      steps[targetIndex] = {
        ...affectedStep,
        _applyInterimMeasurement: false,
        _scheduledMeasuredStartPressureBar: null,
        _scheduledMeasuredStartTemperatureC: null
      };
    };
    let waitIndex = targetIndex - 1;
    detachInitialMeasurement();
    if (waitIndex < 0 || isRestBefore(steps, targetIndex)) {
      if (steps[targetIndex] && steps[targetIndex].type !== 'keep') {
        steps[targetIndex] = {
          ...steps[targetIndex],
          _applyInterimMeasurement: false
        };
      }
      const state = simulation.protocolSteps[targetIndex]?.thermal;
      const pressureBar = state?.pressureStartBar
        ?? cylinder.initialPressureBar
        ?? 0;
      const resultingMix = state?.receiverStartMix
        ?? steps[targetIndex]?.receiverStartMix
        ?? steps[targetIndex]?.resultingMix
        ?? { oxygenPercent: cylinder.initialOxygenPercent ?? 21, heliumPercent: cylinder.initialHeliumPercent ?? 0 };
      steps.splice(targetIndex, 0, {
        type: 'wait',
        _measurementIndex: null,
        _safetyWaitOnly: true,
        recipeLabel: 'Automatic safety wait',
        receiverStartPressureBar: pressureBar,
        receiverEndPressureBar: pressureBar,
        resultingPressureBar: pressureBar,
        resultingMix,
        receiverStartMix: resultingMix,
        waitMinutes: 0,
        configuredWaitMinutes: 0,
        automaticWaitMinutes: 0
      });
      continue;
    }

    const existingAdded = Number(steps[waitIndex].automaticWaitMinutes) || 0;
    if (steps[waitIndex]._safetyWaitOnly || existingAdded > 0) {
      steps[targetIndex] = {
        ...steps[targetIndex],
        _applyInterimMeasurement: false
      };
    }
    const baselineTotal = totalWaitMinutes(simulation);
    const baselineWithoutExisting = baselineTotal - existingAdded;
    const availableAdded = Math.max(0, maxWait - baselineWithoutExisting);
    const safeThroughTarget = candidateSimulation => {
      const candidateUnsafeIndex = firstUnsafeThermalIndex(
        candidateSimulation,
        cylinder.workingPressureBar,
        options
      );
      return candidateUnsafeIndex === -1 || candidateUnsafeIndex > targetIndex;
    };
    const safeAt = added => {
      steps[waitIndex].automaticWaitMinutes = added;
      return safeThroughTarget(simulated(steps, options));
    };
    if (availableAdded > existingAdded && safeAt(availableAdded)) {
      let low = existingAdded;
      let high = availableAdded;
      for (let iteration = 0; iteration < 50; iteration++) {
        const middle = (low + high) / 2;
        if (safeAt(middle)) high = middle;
        else low = middle;
      }
      steps[waitIndex].automaticWaitMinutes = high;
      continue;
    }
    steps[waitIndex].automaticWaitMinutes = existingAdded;

    const split = unsafeIndex >= 0
      ? splitTransferAtSafeHotEndpoint({ steps, unsafeIndex, simulation, options })
      : null;
    if (split) {
      steps.splice(unsafeIndex, 1, split.first, split.wait, split.second);
      continue;
    }
    return finish(simulation, true);
  }
  const simulation = simulated(steps, options);
  return finish(simulation, true);
}

const INTERNAL_THERMAL_TARGET = Symbol('internal thermal target');
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


function inferInfeasibilityReason(error, componentShortfalls = []) {
  const message = String(error ?? '');
  if (/4:1|oxygen (?:boost|compression) ratio/i.test(message)) {
    return 'oxygen-boost-ratio';
  }
  if (/working pressure|cylinder pressure|1440-minute wait limit/i.test(message)) {
    return 'working-pressure';
  }
  if (/booster output|compressor air cannot top up|compressor pressure|pressure limit/i.test(message)) {
    return 'equipment-pressure-limit';
  }
  if (
    componentShortfalls.some(shortfall =>
      Number.isFinite(shortfall?.deficitMoles) && shortfall.deficitMoles > 1e-9
    )
    || /insufficient source|not enough|current cylinder and enabled gas banks|current gas banks/i.test(message)
  ) {
    return 'insufficient-source-gas';
  }
  return null;
}

function failedResult(
  error,
  gas,
  tableauSteps,
  maximumPressure = null,
  diagnostics = null,
  reasonCode = inferInfeasibilityReason(error, diagnostics?.componentShortfalls)
) {
  return {
    feasible: false,
    error,
    reasonCode,
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
  heliumVentedLitres,
  heliumSalvagedLitres,
  heliumRetainedLitres,
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
    heliumVentedLitres,
    heliumSalvagedLitres,
    heliumRetainedLitres,
    finalPressureBar,
    finalOxygenPercent: targetOxygenPercent,
    finalHeliumPercent: targetHeliumPercent
  };
}



function validateBlendInput(input) {
  if (!input || typeof input !== 'object') return ['Blend input is missing.'];
  const { cylinder, physics, banks } = input;
  if (!cylinder || typeof cylinder !== 'object') return ['Cylinder input is missing.'];

  const validationCylinder = input[INTERNAL_THERMAL_TARGET]
    ? { ...cylinder, targetPressureBar: Math.min(350, Math.max(10, cylinder.targetPressureBar)) }
    : cylinder;
  const errors = validateCalculatorInputs(
    validationCylinder,
    physics,
    input.thermal,
    { pressureLimitMode: input.settings?.pressureLimitMode }
  );
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


function solveBlendWithoutSalvage(input) {
  const inputErrors = validateBlendInput(input);
  if (inputErrors.length > 0) {
    return failedResult(`Invalid blend input: ${inputErrors.join(' ')}`, null, []);
  }
  const { cylinder, physics, banks, settings } = input;
  const salvagePlan = input._salvagePlan ?? null;
  const maxCompressorPressureBar = Number.isFinite(settings?.booster?.maxCompressorPressureBar)
    ? settings.booster.maxCompressorPressureBar
    : 232;
  const maxBoosterOutputPressureBar = boosterOutputLimitBar(settings);
  const minimumSourcePressureFor = bank => minimumSourcePressureBarFor(settings, bank);

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
  const salvagedMoles = salvagePlan?.movedMoles ?? 0;
  const ventedMoles = Math.max(0, initialMoles - retainedMoles - salvagedMoles);
  const retainedDensity = retainedMoles / volumeL;
  const retainedPressure = calcPressure(
    retainedDensity,
    initialOxygenPercent,
    initialHeliumPercent,
    temperatureC,
    useVdw
  );
  const postSalvagePressure = salvagedMoles > 0
    ? pressureFromMoles(initialMoles - salvagedMoles, volumeL, initialOxygenPercent, initialHeliumPercent, temperatureC, useVdw)
    : initialPressureBar;
  const drainPressure = Math.max(0, postSalvagePressure - retainedPressure);
  const recipeBoosts = activeBoostsFor(recipeSolverResult, activeBanks, {
    airFirst: recipeTargetPressureBar > maxCompressorPressureBar
  });
  const retainedHeliumMoles = initialHeliumPercent < HELIUM_SALVAGE_MAX_PERCENT
    ? retainedMoles * (initialHeliumPercent / 100)
    : 0;
  const salvagedSupplyHeliumMoles = recipeBoosts
    .filter(({ bank }) => bank.heliumPercent < HELIUM_SALVAGE_MAX_PERCENT)
    .reduce((total, { bank, addedMoles }) => total + addedMoles * (bank.heliumPercent / 100), 0);
  const heliumSalvagedLitres = (retainedHeliumMoles + salvagedSupplyHeliumMoles)
    * (GAS_CONSTANT * (temperatureC + 273.15));
  const heliumRetainedLitres = retainedMoles * (initialHeliumPercent / 100) * (GAS_CONSTANT * (temperatureC + 273.15));
  const ventedGasLitres = ventedMoles * (GAS_CONSTANT * (temperatureC + 273.15));
  const heliumVentedLitres = ventedGasLitres * (initialHeliumPercent / 100);

  const protocolSteps = [...(salvagePlan?.steps ?? [])];
  const trajectory = [{
    step: 0,
    label: 'Start Mix',
    oxygenPercent: initialOxygenPercent,
    heliumPercent: initialHeliumPercent,
    nitrogenPercent: Math.max(0, 100 - initialOxygenPercent - initialHeliumPercent),
    pressureBar: initialPressureBar,
    color: '#f43f5e'
  }];

  let currentPressure = postSalvagePressure;
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
      description: `Bleed cylinder from ${postSalvagePressure.toFixed(drainPrecision)} bar down to ${retainedPressure.toFixed(drainPrecision)} bar (-${drainPressure.toFixed(drainPrecision)} bar vented). Retains ${((retainedMoles / (initialMoles || 1)) * 100).toFixed(0)}% of the original mix.`,
      pressureReferenceTemperatureC: temperatureC,
      resultingPressureBar: currentPressure,
      resultingMix: { oxygenPercent: initialOxygenPercent, heliumPercent: initialHeliumPercent },
      oxygenCompressionRatio: null,
      badgeClass: 'bg-rose-500/20 text-rose-300 border-rose-500/40'
    });
  } else if (salvagedMoles <= 0) {
    protocolSteps.push({
      type: 'keep',
      title: 'Preserve 100% of Cylinder Gas',
      recipeLabel: 'Preserve 100% of Cylinder Gas',
      pressureReferenceTemperatureC: temperatureC,
      resultingPressureBar: currentPressure,
      resultingMix: { oxygenPercent: initialOxygenPercent, heliumPercent: initialHeliumPercent },
      oxygenCompressionRatio: null,
      badgeClass: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40'
    });
  }

  const stepColors = ['#06b6d4', '#f59e0b', '#10b981', '#a855f7', '#ec4899'];

  let stepNumber = 0;
  let costOperationCounter = 0;
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
      const costOperationId = `op-${++costOperationCounter}`;
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
        sourceBankId: bank.id,
        sourceConsumedMoles: stageAddedMoles,
        costOperation: isCompressorAir(bank) ? 'topUp' : (stage.type === 'decant' ? 'decant' : 'boost'),
        costOperationId,
        description: descriptionParts.join(' '),
        pressureDeltaBar: pressureDelta,
        pressureReferenceTemperatureC: temperatureC,
        pressureAtTransferEndReferenceBar: currentPressure,
        resultingPressureBar: currentPressure,
        resultingMix: { oxygenPercent, heliumPercent },
        sourceStartPressureBar: stage.sourceStartPressureBar,
        sourceEndPressureBar: stage.sourceEndPressureBar,
        sourceVolumeL: bank.volumeL,
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
    heliumVentedLitres,
    heliumSalvagedLitres,
    heliumRetainedLitres,
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
    maximumPressure: null,
    ...(salvagePlan ? {
      salvageTransfers: salvagePlan.transfers,
      salvageBanks: salvagePlan.banks,
      lpCost: recipeSolverResult.cost ?? null
    } : {})
  };
}

const SALVAGE_MOLE_TOLERANCE = 1e-9;
const SALVAGE_BADGE_CLASS = 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40';

function minimumSourcePressureBarFor(settings, bank) {
  const configured = settings?.booster?.minimumSourcePressureBar;
  if (Number.isFinite(configured)) return configured;
  return Number.isFinite(bank.minimumPressureBar) ? bank.minimumPressureBar : 20;
}

function boosterOutputLimitBar(settings) {
  return Number.isFinite(settings?.booster?.maxBoosterOutputPressureBar)
    ? settings.booster.maxBoosterOutputPressureBar
    : 200;
}

// Moves the working tank's surplus into receivers in order. Each receiver yields one
// `salvage` step per stage (decant, then boost when both apply) that lowers the tank.
function runSalvageCascade({
  input,
  initialMoles,
  receiverIds,
  surplusMoles,
  retainedMoles,
  minimumSourcePressureBar,
  maxBoosterOutputPressureBar
}) {
  const { cylinder, physics } = input;
  const useVdw = physics.model === 'vdw';
  const { temperatureC } = physics;
  const tankMix = {
    oxygenPercent: cylinder.initialOxygenPercent,
    heliumPercent: cylinder.initialHeliumPercent
  };
  const litresPerMole = GAS_CONSTANT * (temperatureC + 273.15);
  const tankAt = pressureBar => ({ volumeL: cylinder.volumeL, pressureBar, ...tankMix });
  let banks = input.banks;
  let tankMoles = initialMoles;
  let tankPressureBar = cylinder.initialPressureBar;
  let remainingMoles = surplusMoles;
  let movedMoles = 0;
  const steps = [];

  for (const receiverId of receiverIds) {
    let receiver = banks.find(bank => bank.id === receiverId);
    const probe = salvageTransferMoles({
      bank: receiver,
      tank: tankAt(tankPressureBar),
      surplusMoles: remainingMoles,
      physics,
      minimumSourcePressureBar,
      maxBoosterOutputPressureBar,
      retainedMoles
    });
    if (probe.movedMoles <= SALVAGE_MOLE_TOLERANCE) continue;
    const boosterLimits = probe.stage === 'decant+boost'
      ? [undefined, maxBoosterOutputPressureBar]
      : [maxBoosterOutputPressureBar];

    for (const boosterLimit of boosterLimits) {
      const sized = salvageTransferMoles({
        bank: receiver,
        tank: tankAt(tankPressureBar),
        surplusMoles: remainingMoles,
        physics,
        minimumSourcePressureBar,
        maxBoosterOutputPressureBar: boosterLimit,
        retainedMoles
      });
      if (sized.movedMoles <= SALVAGE_MOLE_TOLERANCE) continue;

      const stage = sized.stage === 'boost' ? 'boost' : 'decant';
      const receiverStart = receiver;
      const receiverEnd = applyTransferToBank(receiverStart, tankMix, sized.movedMoles, physics);
      tankMoles -= sized.movedMoles;
      tankPressureBar = pressureFromMoles(
        tankMoles,
        cylinder.volumeL,
        tankMix.oxygenPercent,
        tankMix.heliumPercent,
        temperatureC,
        useVdw
      );
      const movedHeliumLitres = sized.movedMoles * (tankMix.heliumPercent / 100) * litresPerMole;
      const verb = stage === 'boost' ? 'Boosts' : 'Decants';
      steps.push({
        type: 'salvage',
        stage,
        receiverBankId: receiverStart.id,
        receiverBankName: receiverStart.name,
        movedMoles: sized.movedMoles,
        movedHeliumLitres,
        receiverStartPressureBar: receiverStart.pressureBar,
        receiverEndPressureBar: receiverEnd.pressureBar,
        receiverStartMix: { oxygenPercent: receiverStart.oxygenPercent, heliumPercent: receiverStart.heliumPercent },
        receiverEndMix: { oxygenPercent: receiverEnd.oxygenPercent, heliumPercent: receiverEnd.heliumPercent },
        receiverVolumeL: receiverStart.volumeL,
        title: `Salvage: ${stage} into ${receiverStart.name} to ${receiverEnd.pressureBar.toFixed(1)} bar`,
        recipeLabel: `Salvage into ${receiverStart.name}`,
        description: `${verb} ${(sized.movedMoles * litresPerMole).toFixed(0)} L of cylinder gas into ${receiverStart.name}, from ${receiverStart.pressureBar.toFixed(1)} to ${receiverEnd.pressureBar.toFixed(1)} bar. Cylinder falls to ${tankPressureBar.toFixed(1)} bar and ${movedHeliumLitres.toFixed(0)} L of helium is recovered.`,
        pressureReferenceTemperatureC: temperatureC,
        resultingPressureBar: tankPressureBar,
        resultingMix: { ...tankMix },
        sourceOxygenPercent: tankMix.oxygenPercent,
        sourceHeliumPercent: tankMix.heliumPercent,
        badgeClass: SALVAGE_BADGE_CLASS
      });
      banks = banks.map(bank => (bank.id === receiverStart.id ? receiverEnd : bank));
      receiver = receiverEnd;
      remainingMoles -= sized.movedMoles;
      movedMoles += sized.movedMoles;
    }
  }

  return { steps, movedMoles, banks };
}

function salvageTransferRecord(step) {
  return {
    type: step.type,
    stage: step.stage,
    receiverBankId: step.receiverBankId,
    receiverBankName: step.receiverBankName,
    movedMoles: step.movedMoles,
    movedHeliumLitres: step.movedHeliumLitres,
    receiverStartPressureBar: step.receiverStartPressureBar,
    receiverEndPressureBar: step.receiverEndPressureBar,
    receiverStartMix: step.receiverStartMix,
    receiverEndMix: step.receiverEndMix,
    receiverVolumeL: step.receiverVolumeL,
    resultingPressureBar: step.resultingPressureBar,
    resultingMix: step.resultingMix
  };
}

// Salvage context for a solved vent-only baseline: the surplus, the retained cylinder,
// the source floor and the bank scoring used by the selector. Null when nothing is vented.
function salvageContext(input, baseline) {
  const surplusMoles = baseline.blend.ventedMoles;
  if (!(surplusMoles > SALVAGE_MOLE_TOLERANCE)) return null;
  const { cylinder, physics, banks, settings } = input;
  const { temperatureC } = physics;
  const tankMix = {
    oxygenPercent: cylinder.initialOxygenPercent,
    heliumPercent: cylinder.initialHeliumPercent
  };
  return {
    banks,
    physics,
    surplusMoles,
    tankMix,
    tankAtStart: { volumeL: cylinder.volumeL, pressureBar: cylinder.initialPressureBar, ...tankMix },
    retainedMoles: baseline.solution.x_cyl || 0,
    initialMoles: baseline.gas.initialMoles,
    // The tank is the salvage source: its floor is the configured source minimum, not a bank's.
    minimumSourcePressureBar: minimumSourcePressureBarFor(settings, {}),
    maxBoosterOutputPressureBar: boosterOutputLimitBar(settings),
    bankReachOf: bank => leftoverReachability({
      oxygenPercent: bank.oxygenPercent,
      heliumPercent: bank.heliumPercent,
      pressureBar: bank.pressureBar,
      maxPressureBar: bank.maxPressureBar
    }),
    bankScoresOf: bank => leftoverAttractiveness({
      oxygenPercent: bank.oxygenPercent,
      heliumPercent: bank.heliumPercent,
      pressureBar: bank.pressureBar,
      volumeL: bank.volumeL,
      maxPressureBar: bank.maxPressureBar,
      temperatureC,
      physics
    })
  };
}

// Receiver ids that accept some salvage, best first (see rankReceivers).
function rankSalvageReceivers(context) {
  const { banks, physics, tankMix, tankAtStart, surplusMoles, retainedMoles } = context;
  const candidates = [];
  for (const receiver of banks.filter(isSalvageReceiver)) {
    const probe = salvageTransferMoles({
      bank: receiver,
      tank: tankAtStart,
      surplusMoles,
      physics,
      minimumSourcePressureBar: context.minimumSourcePressureBar,
      maxBoosterOutputPressureBar: context.maxBoosterOutputPressureBar,
      retainedMoles
    });
    if (probe.movedMoles <= SALVAGE_MOLE_TOLERANCE) continue;
    candidates.push({
      receiver,
      transferredReceiver: applyTransferToBank(receiver, tankMix, probe.movedMoles, physics)
    });
  }
  return rankReceivers(candidates, context.bankScoresOf, context.bankReachOf).map(candidate => candidate.receiver.id);
}

// One salvage variant that moves gas into the given receiver prefix, re-solved for the
// recipe. Null when nothing moves or the re-solve is infeasible.
function buildSalvageVariant(input, context, receiverIds) {
  const cascade = runSalvageCascade({
    input,
    initialMoles: context.initialMoles,
    receiverIds,
    surplusMoles: context.surplusMoles,
    retainedMoles: context.retainedMoles,
    minimumSourcePressureBar: context.minimumSourcePressureBar,
    maxBoosterOutputPressureBar: context.maxBoosterOutputPressureBar
  });
  if (cascade.movedMoles <= SALVAGE_MOLE_TOLERANCE) return null;
  const plan = {
    steps: cascade.steps,
    movedMoles: cascade.movedMoles,
    banks: cascade.banks,
    transfers: cascade.steps.map(salvageTransferRecord)
  };
  const result = solveBlendWithoutSalvage({ ...input, banks: cascade.banks, _salvagePlan: plan });
  if (!result.feasible) return null;
  return {
    result,
    receiverIds,
    finalBanks: bankStatesAfterRecipe(result, cascade.banks, context.physics),
    salvagedMoles: cascade.movedMoles,
    resolvedSurplusMoles: context.initialMoles - (result.solution.x_cyl || 0),
    retainedMoles: result.solution.x_cyl || 0,
    lpCost: result.lpCost ?? null
  };
}

function salvageBaseline(baseline, context) {
  return {
    retainedMoles: context.retainedMoles,
    finalBanks: bankStatesAfterRecipe(baseline, context.banks, context.physics)
  };
}

// The requested-target candidate of a thermal input: the same target the thermal search
// starts from, with the internal thermal-target flag that thermal candidates carry.
function requestedSalvageCandidate(input) {
  if (!input.thermal) return input;
  return {
    ...input,
    [INTERNAL_THERMAL_TARGET]: true,
    cylinder: { ...input.cylinder, targetPressureBar: normalizeInWaterTarget(input) }
  };
}

// Picks the salvage receiver prefix once, on the requested target: the N+1 prefix search
// with the selector's gates. Returns the winning receiver ids, or null for vent-only or invalid input.
export function searchSalvageVariant(input) {
  if (validateBlendInput(input).length > 0) return null;
  const candidate = requestedSalvageCandidate(input);
  const baseline = solveBlendWithoutSalvage(candidate);
  if (!baseline.feasible) return null;
  const context = salvageContext(candidate, baseline);
  if (!context) return null;

  const rankedReceiverIds = rankSalvageReceivers(context);
  const variants = [];
  for (let count = 1; count <= rankedReceiverIds.length; count++) {
    const variant = buildSalvageVariant(candidate, context, rankedReceiverIds.slice(0, count));
    if (variant) variants.push(variant);
  }
  // A receiver ranked first can fail a gate that another receiver alone would pass, so every
  // other receiver is also tried on its own.
  for (const receiverId of rankedReceiverIds.slice(1)) {
    const variant = buildSalvageVariant(candidate, context, [receiverId]);
    if (variant) variants.push(variant);
  }
  const selected = selectSalvageVariant({
    baseline: salvageBaseline(baseline, context),
    variants,
    bankScoresOf: context.bankScoresOf,
    bankReachOf: context.bankReachOf,
    physics: candidate.physics
  });
  return selected?.receiverIds ?? null;
}

// Static blend with salvage. The receiver prefix comes from `searchSalvageVariant` (run
// once per optimize). It is replayed here on this input's own vent-only solve, and the
// variant is kept only if the selector's gates still pass. Otherwise vent-only.
export function optimizeBlendWithoutThermal(input) {
  const baseline = solveBlendWithoutSalvage(input);
  if (input._salvage === false || !baseline.feasible || !input._salvageReceiverIds) return baseline;
  const context = salvageContext(input, baseline);
  if (!context) return baseline;
  const variant = buildSalvageVariant(input, context, input._salvageReceiverIds);
  if (!variant) return baseline;
  const selected = selectSalvageVariant({
    baseline: salvageBaseline(baseline, context),
    variants: [variant],
    bankScoresOf: context.bankScoresOf,
    bankReachOf: context.bankReachOf,
    physics: input.physics
  });
  if (!selected) return baseline;
  const output = { ...selected.result };
  delete output.lpCost;
  return output;
}

// Bank states once the recipe has drawn its gas. Draws are keyed by the enabled-bank
// index that `solveBlendWithoutSalvage` uses for its variable names; the compressor
// bank is appended after the real banks, so it never shifts these names.
function bankStatesAfterRecipe(result, banks, physics) {
  const names = bankVariableNames(banks.filter(bank => bank.enabled));
  let enabledIndex = 0;
  return banks.map(bank => {
    if (!bank.enabled) return bank;
    const drawnMoles = result.solution?.[names[enabledIndex++]] || 0;
    return applyDrawToBank(bank, drawnMoles, physics);
  });
}

const THERMAL_TARGET_TOLERANCE_BAR = 1e-5;
const MINIMUM_TARGET_PRESSURE_BAR = 10;
const MAXIMUM_TARGET_PRESSURE_BAR = 350;

function normalizeInWaterTarget(input) {
  const thermal = input.thermal;
  const requestedInWaterPressureBar = input.cylinder.targetPressureBar;
  const requestedInWaterTemperatureC = thermal.targetInWaterTemperatureC
    ?? thermal.ambientTemperatureC;
  return calculatePressureAtTemperature({
    pressureBar: requestedInWaterPressureBar,
    oxygenPercent: input.cylinder.targetOxygenPercent,
    heliumPercent: input.cylinder.targetHeliumPercent,
    fromTemperatureC: requestedInWaterTemperatureC,
    toTemperatureC: thermal.ambientTemperatureC,
    volumeL: input.cylinder.volumeL,
    useVdw: input.physics.model === 'vdw'
  });
}

function trajectoryWithThermalEndpoints(trajectory, simulation) {
  if (!Array.isArray(trajectory) || !simulation?.final) return trajectory;
  const transferSteps = (simulation.protocolSteps ?? [])
    .filter(step => step.type !== 'drain' && step.type !== 'salvage'
      && step.thermal?.rateSource
      && step.thermal.rateSource !== 'none')
    .map(step => ({ step, state: step.thermal }));
  const mappedTrajectory = [];
  let transferCursor = 0;
  let trajectoryStep = 0;
  for (const point of trajectory) {
    if (!point.bankId) {
      mappedTrajectory.push(point);
      trajectoryStep = Math.max(trajectoryStep, Number(point.step) || 0);
      continue;
    }
    const firstTransfer = transferSteps[transferCursor];
    if (!firstTransfer) {
      mappedTrajectory.push(point);
      trajectoryStep++;
      continue;
    }
    const stages = [firstTransfer];
    transferCursor++;
    if (firstTransfer.step._thermalSplit) {
      while (transferSteps[transferCursor]?.step._thermalSplit
        && transferSteps[transferCursor].step._measurementIndex === null) {
        stages.push(transferSteps[transferCursor]);
        transferCursor++;
      }
    }
    stages.forEach(({ step, state }, stageIndex) => {
      const resultingMix = step.resultingMix ?? point;
      const pressureBar = Number.isFinite(step.resultingPressureBar)
        ? step.resultingPressureBar
        : state.pressureAtTransferEndReferenceBar ?? point.pressureBar;
      const receiverStartPressureBar = Number.isFinite(step.receiverStartPressureBar)
        ? step.receiverStartPressureBar
        : point.pressureBar - (point.pressureDeltaBar ?? 0);
      const pressureDeltaBar = pressureBar - receiverStartPressureBar;
      const splitLabel = firstTransfer.step._thermalSplit
        ? ` (safe stage ${stageIndex + 1})`
        : '';
      trajectoryStep++;
      mappedTrajectory.push({
        ...point,
        step: trajectoryStep,
        label: `${point.label ?? step.title ?? `Step ${trajectoryStep}`}${splitLabel}`,
        oxygenPercent: resultingMix.oxygenPercent ?? point.oxygenPercent,
        heliumPercent: resultingMix.heliumPercent ?? point.heliumPercent,
        nitrogenPercent: resultingMix.nitrogenPercent
          ?? Math.max(0, 100 - (resultingMix.oxygenPercent ?? point.oxygenPercent)
            - (resultingMix.heliumPercent ?? point.heliumPercent)),
        pressureBar,
        pressureDeltaBar,
        sourceStartPressureBar: Number.isFinite(step.sourceStartPressureBar)
          ? step.sourceStartPressureBar
          : point.sourceStartPressureBar,
        sourceEndPressureBar: Number.isFinite(step.sourceEndPressureBar)
          ? step.sourceEndPressureBar
          : point.sourceEndPressureBar,
        addedMoles: Number.isFinite(step.sourceConsumedMoles)
          ? step.sourceConsumedMoles
          : point.addedMoles,
        pressureAtTransferEndReferenceBar: state.pressureAtTransferEndReferenceBar,
        pressureAtTransferEndAmbientBar: state.pressureAtTransferEndAmbientBar,
        pressureAtTransferEndHotBar: state.pressureAtTransferEndHotBar,
        ambientPressureBar: state.pressureAtTransferEndAmbientBar,
        hotPressureBar: state.pressureAtTransferEndHotBar
      });
    });
  }
  return mappedTrajectory;
}

function thermalState(candidate, requestedInWaterPressureBar, requestedInWaterTemperatureC, ambientSettledTargetPressureBar) {
  const final = candidate.simulation.final;
  const finalInWaterPressureBar = calculatePressureAtTemperature({
    pressureBar: final.finalAmbientPressureBar,
    oxygenPercent: candidate.candidateInput.cylinder.targetOxygenPercent,
    heliumPercent: candidate.candidateInput.cylinder.targetHeliumPercent,
    fromTemperatureC: final.finalAmbientTemperatureC,
    toTemperatureC: requestedInWaterTemperatureC,
    volumeL: candidate.candidateInput.cylinder.volumeL,
    useVdw: candidate.candidateInput.physics.model === 'vdw'
  });
  return {
    ...final,
    finalInWaterPressureBar,
    finalInWaterTemperatureC: requestedInWaterTemperatureC,
    requestedInWaterPressureBar,
    requestedInWaterTemperatureC,
    ambientSettledTargetPressureBar,
    requestedSettledTargetPressureBar: ambientSettledTargetPressureBar
  };

}
function evaluateThermalCandidate(input, optimizeStatic, targetPressureBar) {
  const candidateInput = {
    ...input,
    [INTERNAL_THERMAL_TARGET]: true,
    cylinder: {
      ...input.cylinder,
      targetPressureBar
    }
  };
  const result = optimizeStatic(candidateInput);
  if (!result.feasible) return { candidateInput, result, simulation: null };

  const scheduled = scheduleSafeThermalProtocol({
    protocolSteps: result.protocolSteps,
    cylinder: candidateInput.cylinder,
    physics: candidateInput.physics,
    thermal: candidateInput.thermal,
    settings: candidateInput.settings
  });
  if (scheduled.unsafe) {
    return {
      candidateInput,
      result: {
        ...result,
        feasible: false,
        error: 'Thermal protocol cannot remain within cylinder pressure limits within the 1440-minute wait limit.'
      },
      simulation: null
    };
  }
  const simulation = scheduled.simulation ?? simulateThermalProtocol({
    protocolSteps: scheduled.protocolSteps ?? result.protocolSteps,
    cylinder: candidateInput.cylinder,
    physics: candidateInput.physics,
    thermal: candidateInput.thermal,
    settings: candidateInput.settings
  });
  return { candidateInput, result, simulation };
}

function thermalResult(candidate, requestedInWaterPressureBar = candidate.candidateInput._requestedInWaterPressureBar ?? candidate.candidateInput.cylinder.targetPressureBar, requestedInWaterTemperatureC = candidate.candidateInput.thermal.targetInWaterTemperatureC ?? candidate.candidateInput.thermal.ambientTemperatureC, ambientSettledTargetPressureBar = candidate.candidateInput._ambientSettledTargetPressureBar ?? candidate.candidateInput.cylinder.targetPressureBar) {
  const thermal = thermalState(candidate, requestedInWaterPressureBar, requestedInWaterTemperatureC, ambientSettledTargetPressureBar);
  return {
    ...candidate.result,
    gas: candidate.result.gas && { ...candidate.result.gas, targetPressureBar: requestedInWaterPressureBar },
    logicalPlan: candidate.result.logicalPlan ?? {
      protocolSteps: candidate.result.protocolSteps,
      trajectory: candidate.result.trajectory,
      targetPressureBar: candidate.candidateInput.cylinder.targetPressureBar
    },
    protocolSteps: candidate.simulation.protocolSteps,
    trajectory: trajectoryWithThermalEndpoints(
      candidate.result.trajectory,
      candidate.simulation
    ),
    thermal
  };
}

// Finalizes a plan whose logical steps were composed from several optimizer runs
// (see plan-with-readings.js): one safety schedule and one thermal simulation run
// over the merged steps, with every stored reading applied at its logical step.
// `template` supplies the non-thermal result fields; returns null when the merged
// protocol cannot be scheduled within the cylinder limits.
export function finalizeComposedPlan({ input, template, protocolSteps, trajectory, targetPressureBar }) {
  const candidateInput = {
    ...input,
    [INTERNAL_THERMAL_TARGET]: true,
    _requestedInWaterPressureBar: input.cylinder.targetPressureBar,
    _ambientSettledTargetPressureBar: normalizeInWaterTarget(input),
    cylinder: { ...input.cylinder, targetPressureBar }
  };
  const scheduled = scheduleSafeThermalProtocol({
    protocolSteps,
    cylinder: candidateInput.cylinder,
    physics: candidateInput.physics,
    thermal: candidateInput.thermal,
    settings: candidateInput.settings
  });
  if (scheduled.unsafe) return null;
  return thermalResult({
    candidateInput,
    result: {
      ...template,
      protocolSteps,
      trajectory,
      logicalPlan: { protocolSteps, trajectory, targetPressureBar }
    },
    simulation: scheduled.simulation
  });
}

function thermalizedMaximumResult(candidate, requestedInWaterPressureBar, requestedInWaterTemperatureC, ambientSettledTargetPressureBar) {
  const maximum = candidate.result.maximumPressure;
  if (!maximum) {
    return {
      ...candidate.result,
      gas: candidate.result.gas && { ...candidate.result.gas, targetPressureBar: requestedInWaterPressureBar },
      thermal: {
        finalTransferEndPressureBar: null,
        finalTransferEndTemperatureC: null,
        finalAmbientPressureBar: null,
        finalAmbientTemperatureC: null,
        finalInWaterPressureBar: null,
        finalInWaterTemperatureC: null,
        requestedInWaterPressureBar,
        requestedInWaterTemperatureC,
        ambientSettledTargetPressureBar
      }
    };
  }
  const scheduled = scheduleSafeThermalProtocol({
    protocolSteps: maximum.protocolSteps,
    cylinder: candidate.candidateInput.cylinder,
    physics: candidate.candidateInput.physics,
    thermal: candidate.candidateInput.thermal,
    settings: candidate.candidateInput.settings
  });
  if (scheduled.unsafe) {
    return {
      ...candidate.result,
      gas: candidate.result.gas && { ...candidate.result.gas, targetPressureBar: requestedInWaterPressureBar },
      maximumPressure: null,
      thermal: {
        finalTransferEndPressureBar: null,
        finalTransferEndTemperatureC: null,
        finalAmbientPressureBar: null,
        finalAmbientTemperatureC: null,
        finalInWaterPressureBar: null,
        finalInWaterTemperatureC: null,
        requestedInWaterPressureBar,
        requestedInWaterTemperatureC,
        ambientSettledTargetPressureBar
      }
    };
  }
  const simulation = scheduled.simulation;
  const maximumCandidate = { ...candidate, simulation };
  const thermal = thermalState(maximumCandidate, requestedInWaterPressureBar, requestedInWaterTemperatureC, ambientSettledTargetPressureBar);
  const trajectory = trajectoryWithThermalEndpoints(
    maximum.trajectory,
    simulation
  );
  return {
    ...candidate.result,
    gas: candidate.result.gas && { ...candidate.result.gas, targetPressureBar: requestedInWaterPressureBar },
    trajectory,
    maximumPressure: {
      ...maximum,
      protocolSteps: simulation.protocolSteps,
      trajectory,
      thermal
    },
    thermal
  };
}

function thermalLimitResult(input, requested, maximum) {
  const requestedInWaterPressureBar = input.cylinder.targetPressureBar;
  const requestedInWaterTemperatureC = input.thermal.targetInWaterTemperatureC ?? input.thermal.ambientTemperatureC;
  const ambientSettledTargetPressureBar = normalizeInWaterTarget(input);
  const maximumCandidate = {
    candidateInput: maximum.candidateInput,
    simulation: maximum.simulation
  };
  const thermal = thermalState(maximumCandidate, requestedInWaterPressureBar, requestedInWaterTemperatureC, ambientSettledTargetPressureBar);
  const trajectory = trajectoryWithThermalEndpoints(
    maximum.result.trajectory,
    maximum.simulation
  );
  const maximumPressure = {
    pressureBar: maximum.result.blend.finalPressureBar,
    solution: maximum.result.solution,
    tableauSteps: maximum.result.tableauSteps,
    blend: maximum.result.blend,
    protocolSteps: maximum.simulation.protocolSteps,
    trajectory,
    thermal
  };
  return {
    ...failedResult(
      `Requested in-water pressure ${requestedInWaterPressureBar.toFixed(1)} bar cannot be reached; maximum predicted ambient pressure is ${maximum.simulation.final.finalAmbientPressureBar.toFixed(1)} bar.`,
      { ...requested.result.gas, targetPressureBar: requestedInWaterPressureBar },
      maximum.result.tableauSteps,
      maximumPressure,
      requested.result.diagnostics ?? null,
      requested.result.reasonCode
    ),
    ...(maximum.result.salvageTransfers ? {
      salvageTransfers: maximum.result.salvageTransfers,
      salvageBanks: maximum.result.salvageBanks
    } : {}),
    thermal
  };
}

function highestSafeThermalCandidate(searchInput, optimizeStatic, upperPressureBar) {
  const floor = evaluateThermalCandidate(
    searchInput,
    optimizeStatic,
    MINIMUM_TARGET_PRESSURE_BAR
  );
  if (!floor.result.feasible) return null;

  let lowerPressureBar = MINIMUM_TARGET_PRESSURE_BAR;
  let upperPressure = upperPressureBar;
  let highestFeasible = floor;
  for (let iteration = 0; iteration < 40; iteration++) {
    const candidatePressureBar = (lowerPressureBar + upperPressure) / 2;
    const candidate = evaluateThermalCandidate(
      searchInput,
      optimizeStatic,
      candidatePressureBar
    );
    if (!candidate.result.feasible) {
      upperPressure = candidatePressureBar;
      continue;
    }
    lowerPressureBar = candidatePressureBar;
    highestFeasible = candidate;
  }
  return highestFeasible;
}

function optimizeThermalBlend(input, optimizeStatic) {
  const inputErrors = validateBlendInput(input);
  if (inputErrors.length > 0) {
    return failedResult(`Invalid blend input: ${inputErrors.join(' ')}`, null, []);
  }

  const requestedInWaterPressureBar = input.cylinder.targetPressureBar;
  const requestedInWaterTemperatureC = input.thermal.targetInWaterTemperatureC ?? input.thermal.ambientTemperatureC;
  const ambientSettledTargetPressureBar = normalizeInWaterTarget(input);
  const searchInput = {
    ...input,
    _requestedInWaterPressureBar: requestedInWaterPressureBar,
    _ambientSettledTargetPressureBar: ambientSettledTargetPressureBar,
    cylinder: { ...input.cylinder, targetPressureBar: ambientSettledTargetPressureBar }
  };
  const requestedPressureBar = ambientSettledTargetPressureBar;
  const requested = evaluateThermalCandidate(searchInput, optimizeStatic, requestedPressureBar);
  if (!requested.result.feasible) {
    const highestSafe = highestSafeThermalCandidate(
      searchInput,
      optimizeStatic,
      requestedPressureBar
    );
    if (highestSafe) return thermalLimitResult(input, requested, highestSafe);

    const infeasible = thermalizedMaximumResult(requested, requestedInWaterPressureBar, requestedInWaterTemperatureC, ambientSettledTargetPressureBar);
    const ambientDiagnostic = `Ambient-settled target: ${ambientSettledTargetPressureBar.toFixed(1)} bar.`;
    return { ...infeasible, error: `Requested in-water pressure ${requestedInWaterPressureBar.toFixed(1)} bar cannot be reached. ${infeasible.error ?? 'No safe thermal recipe is available.'} ${ambientDiagnostic}` };
  }

  const requestedPressureDifference = requested.simulation.final.finalAmbientPressureBar
    - requestedPressureBar;
  if (Math.abs(requestedPressureDifference) <= THERMAL_TARGET_TOLERANCE_BAR) {
    return thermalResult(requested);
  }
  if (requestedPressureDifference > 0) {
    const floor = evaluateThermalCandidate(
      searchInput,
      optimizeStatic,
      MINIMUM_TARGET_PRESSURE_BAR
    );
    if (!floor.result.feasible) {
      const fallback = thermalizedMaximumResult(
        floor,
        requestedInWaterPressureBar,
        requestedInWaterTemperatureC,
        ambientSettledTargetPressureBar
      );
      const ambientDiagnostic = `Ambient-settled target: ${ambientSettledTargetPressureBar.toFixed(1)} bar.`;
      return {
        ...fallback,
        error: `Requested in-water pressure ${requestedInWaterPressureBar.toFixed(1)} bar cannot be reached. ${fallback.error ?? 'No safe thermal recipe is available.'} ${ambientDiagnostic}`
      };
    }

    const floorPressureDifference = floor.simulation.final.finalAmbientPressureBar
      - requestedPressureBar;
    if (Math.abs(floorPressureDifference) <= THERMAL_TARGET_TOLERANCE_BAR) {
      return thermalResult(floor);
    }
    if (floorPressureDifference > 0) return thermalLimitResult(input, requested, requested);

    let lowerPressureBar = MINIMUM_TARGET_PRESSURE_BAR;
    let upperPressureBar = requestedPressureBar;
    let highestBelowTarget = floor;
    for (let iteration = 0; iteration < 40; iteration++) {
      const candidatePressureBar = (lowerPressureBar + upperPressureBar) / 2;
      const candidate = evaluateThermalCandidate(searchInput, optimizeStatic, candidatePressureBar);
      if (!candidate.result.feasible) {
        lowerPressureBar = candidatePressureBar;
        continue;
      }

      const pressureDifference = candidate.simulation.final.finalAmbientPressureBar
        - requestedPressureBar;
      if (Math.abs(pressureDifference) <= THERMAL_TARGET_TOLERANCE_BAR) {
        return thermalResult(candidate);
      }
      if (pressureDifference < 0) {
        lowerPressureBar = candidatePressureBar;
        highestBelowTarget = candidate;
      } else {
        upperPressureBar = candidatePressureBar;
      }
    }
    return thermalLimitResult(input, requested, highestBelowTarget);
  }

  const ceiling = evaluateThermalCandidate(searchInput, optimizeStatic, MAXIMUM_TARGET_PRESSURE_BAR);
  if (ceiling.result.feasible) {
    const ceilingPressureDifference = ceiling.simulation.final.finalAmbientPressureBar
      - requestedPressureBar;
    if (Math.abs(ceilingPressureDifference) <= THERMAL_TARGET_TOLERANCE_BAR) {
      return thermalResult(ceiling);
    }
    if (ceilingPressureDifference < 0) return thermalLimitResult(input, requested, ceiling);
  }

  let lowerPressureBar = requestedPressureBar;
  let upperPressureBar = MAXIMUM_TARGET_PRESSURE_BAR;
  let highestFeasible = requested;
  for (let iteration = 0; iteration < 40; iteration++) {
    const candidatePressureBar = (lowerPressureBar + upperPressureBar) / 2;
    const candidate = evaluateThermalCandidate(searchInput, optimizeStatic, candidatePressureBar);
    if (!candidate.result.feasible) {
      upperPressureBar = candidatePressureBar;
      continue;
    }

    const pressureDifference = candidate.simulation.final.finalAmbientPressureBar
      - requestedPressureBar;
    if (Math.abs(pressureDifference) <= THERMAL_TARGET_TOLERANCE_BAR) {
      return thermalResult(candidate);
    }
    if (pressureDifference < 0) {
      lowerPressureBar = candidatePressureBar;
      highestFeasible = candidate;
    } else {
      upperPressureBar = candidatePressureBar;
    }
  }

  if (!ceiling.result.feasible) {
    const maximum = thermalizedMaximumResult(ceiling, requestedInWaterPressureBar, requestedInWaterTemperatureC, ambientSettledTargetPressureBar);
    if (maximum.maximumPressure) {
      return {
        ...maximum,
        error: `Requested in-water pressure ${requestedInWaterPressureBar.toFixed(1)} bar cannot be reached. ${maximum.error}`
      };
    }
  }
  return thermalLimitResult(input, requested, highestFeasible);
}

export function optimizeBlend(input) {
  return solveThermalWithSalvageFallback(input, optimizeBlendWithoutThermal);
}

// Salvage is searched once, on the requested target (see searchSalvageVariant). The winning
// receiver prefix is then replayed on each thermal candidate. If that thermal plan is
// infeasible, the vent-only thermal search is used instead. `optimizeStatic` is the static
// solver and `searchSalvage` is injectable so tests can count searches.
export function solveThermalWithSalvageFallback(input, optimizeStatic, { searchSalvage = searchSalvageVariant } = {}) {
  const solve = candidate => (input?.thermal
    ? optimizeThermalBlend(candidate, optimizeStatic)
    : optimizeStatic(candidate));
  if (input?._salvage === false) return solve(input);
  const receiverIds = searchSalvage(input);
  if (!receiverIds) return solve({ ...input, _salvage: false });
  const withSalvage = solve({ ...input, _salvageReceiverIds: receiverIds });
  if (!input?.thermal || withSalvage.feasible) return withSalvage;
  const baselineResult = optimizeThermalBlend({ ...input, _salvage: false }, optimizeStatic);
  return baselineResult.feasible ? baselineResult : withSalvage;
}
