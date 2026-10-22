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
