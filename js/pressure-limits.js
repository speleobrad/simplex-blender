import {
  DEFAULT_HOT_OVERFILL_PERCENT,
  isValidHotOverfillPercent
} from './preset-validation.js';

const DEFAULT_TOLERANCE_BAR = 1e-9;

function hotOverfillPercent(cylinder) {
  const value = cylinder?.hotOverfillPercent;
  if (value === undefined) return DEFAULT_HOT_OVERFILL_PERCENT;
  if (!isValidHotOverfillPercent(value)) {
    throw new RangeError('Cylinder hot overfill must be between 0 and 5% in 0.5% steps.');
  }
  return value;
}

export function getCylinderPressureLimit({ cylinder, isTransientHot = false } = {}) {
  const workingPressureBar = cylinder?.workingPressureBar;
  if (!Number.isFinite(workingPressureBar)) return null;
  if (!isTransientHot) return { kind: 'working-pressure', limitBar: workingPressureBar };
  return {
    kind: 'hot-overfill',
    limitBar: workingPressureBar * (1 + hotOverfillPercent(cylinder) / 100)
  };
}

export function getCylinderPressureExceedance({
  pressureBar,
  cylinder,
  isTransientHot = false,
  toleranceBar = DEFAULT_TOLERANCE_BAR
} = {}) {
  const limit = getCylinderPressureLimit({ cylinder, isTransientHot });
  if (!limit || !Number.isFinite(pressureBar)
    || pressureBar <= limit.limitBar + toleranceBar) return null;
  return { ...limit, pressureBar };
}

export function collectCylinderPressureWarnings({
  cylinder,
  observations = [],
  toleranceBar = DEFAULT_TOLERANCE_BAR
} = {}) {
  const highest = new Map();
  for (const observation of observations) {
    const exceedance = getCylinderPressureExceedance({
      ...observation,
      cylinder,
      toleranceBar
    });
    if (!exceedance) continue;
    const source = observation?.source;
    const stepIdentifier = observation?.stepIdentifier;
    const key = JSON.stringify([source, stepIdentifier, exceedance.kind]);
    const warning = {
      ...exceedance,
      source,
      stepIdentifier
    };
    const previous = highest.get(key);
    if (!previous || warning.pressureBar > previous.pressureBar) highest.set(key, warning);
  }
  return [...highest.values()];
}

export function pressureWarningStepIdentifier(step, index) {
  const title = String(step?.title ?? step?.operation ?? '')
    .replace(/^Step[ ]+[0-9]+[ ]*:[ ]*/i, '')
    .trim();
  return title || `Step ${index + 1}`;
}

function isAboveAmbientTemperature(temperatureC, ambientTemperatureC) {
  return Number.isFinite(temperatureC)
    && Number.isFinite(ambientTemperatureC)
    && temperatureC > ambientTemperatureC;
}

export function collectThermalPressureWarningObservations({
  protocolSteps = [],
  ambientTemperatureC,
  waitMode = null
} = {}) {
  const observations = [];
  let previousStepEndsAtTargetWait = false;
  const addObservation = (pressureBar, source, stepIdentifier, isTransientHot = false) => {
    if (!Number.isFinite(pressureBar)) return;
    observations.push({ pressureBar, source, stepIdentifier, isTransientHot });
  };
  for (const [index, step] of protocolSteps.entries()) {
    const thermal = step?.thermal;
    if (!thermal) {
      previousStepEndsAtTargetWait = false;
      continue;
    }
    const isFinalStep = index === protocolSteps.length - 1;
    const skipsInitialKeepWait = !isFinalStep && index === 0 && step.type === 'keep';
    const endsAtTargetWait = step.waitMode === 'target'
      || (waitMode === 'temperature' && !isFinalStep && !skipsInitialKeepWait);
    const stepIdentifier = pressureWarningStepIdentifier(step, index);
    const waitEndMinutes = thermal.durationMinutes + thermal.waitMinutes;
    const isTargetWaitEndpoint = sample => endsAtTargetWait
      && Number.isFinite(sample.elapsedMinutes)
      && Number.isFinite(waitEndMinutes)
      && sample.elapsedMinutes >= waitEndMinutes - 1e-9;
    const startIsTransientHot = thermal.measurementApplied === true
      ? isAboveAmbientTemperature(thermal.temperatureStartC, ambientTemperatureC)
      : !previousStepEndsAtTargetWait
        && isAboveAmbientTemperature(thermal.temperatureStartC, ambientTemperatureC);

    addObservation(
      thermal.pressureStartBar,
      'start',
      stepIdentifier,
      startIsTransientHot
    );
    if (thermal.rateSource !== 'none') {
      addObservation(
        thermal.pressureAtTransferEndAmbientBar,
        'ambient',
        stepIdentifier
      );
    }
    addObservation(
      thermal.pressureAtTransferEndHotBar ?? thermal.pressureAtTransferEndBar,
      'transfer',
      stepIdentifier,
      isAboveAmbientTemperature(thermal.temperatureAtTransferEndC, ambientTemperatureC)
    );

    const waitIsTransientHot = !endsAtTargetWait
      && isAboveAmbientTemperature(thermal.temperatureAfterWaitC, ambientTemperatureC);
    addObservation(
      thermal.pressureAfterWaitBar,
      waitIsTransientHot ? 'cooling' : 'settled',
      stepIdentifier,
      waitIsTransientHot
    );

    for (const sample of thermal.samples ?? []) {
      const temperatureC = sample.temperatureC ?? sample.pressureReferenceTemperatureC;
      const isTargetWaitStart = previousStepEndsAtTargetWait
        && thermal.measurementApplied !== true
        && Number.isFinite(sample.elapsedMinutes)
        && sample.elapsedMinutes <= 1e-9;
      const sampleIsTransientHot = !isTargetWaitEndpoint(sample)
        && !isTargetWaitStart
        && isAboveAmbientTemperature(temperatureC, ambientTemperatureC);
      addObservation(
        sample.projectedPressureBar ?? sample.pressureBar,
        sampleIsTransientHot ? 'cooling' : 'settled',
        stepIdentifier,
        sampleIsTransientHot
      );
    }
    previousStepEndsAtTargetWait = endsAtTargetWait;
  }
  return observations;
}
