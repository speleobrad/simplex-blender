export function calculatorInputSignature(input) {
  const thermal = input?.thermal
    ? { ...input.thermal, interimMeasurements: undefined }
    : input?.thermal;
  return JSON.stringify({ ...input, thermal });
}

export function signatureAfterClearingMeasurement(input, index) {
  const measurements = input?.thermal?.interimMeasurements;
  if (!Array.isArray(measurements)) return null;
  const hasRemainingMeasurement = measurements.some(
    (measurement, measurementIndex) => measurementIndex !== index && Boolean(measurement)
  );
  return hasRemainingMeasurement ? calculatorInputSignature(input) : null;
}

export function latestInterimMeasurementIndex(measurements) {
  if (!Array.isArray(measurements)) return -1;
  for (let index = measurements.length - 1; index >= 0; index -= 1) {
    if (measurements[index]) return index;
  }
  return -1;
}

// Earlier readings are locked. Only the latest reading may be replaced or cleared,
// and a new reading may only be recorded at or after the latest one.
export function interimMeasurementLockMessage(measurements, index, action) {
  const latest = latestInterimMeasurementIndex(measurements);
  const allowed = action === 'clear' ? index === latest : index >= latest;
  if (allowed) return null;
  return `Step ${index + 1} is locked. Only the latest reading (step ${latest + 1}) can be changed or cleared.`;
}

// The "Step N" number shown for a protocol step: the number in its plan title, else
// the fallback index + 1. Shared so the results panel and the reading check agree.
export function protocolStepNumber(step, fallbackIndex) {
  const match = String(step?.title ?? '').match(/^Step[ ]+([0-9]+)/i);
  return match ? Number(match[1]) : fallbackIndex + 1;
}

export function interimPressureWithinTolerance({ measuredBar, plannedBar, tolerancePercent }) {
  return Math.abs(measuredBar - plannedBar) <= (tolerancePercent / 100) * plannedBar;
}

// Gas can only sit below ambient after a pressure-lowering transfer out of the working
// tank: a drain, or a salvage decant or booster. Waits and keeps carry that state
// forward; any other step (boost, decant, top-up, equalize) clears it.
const COOLING_RATE_SOURCES = new Set(['draining-rate', 'salvage-decant', 'salvage-booster']);
export function gasCanBeBelowAmbient(protocolSteps, stepIndex) {
  let belowAmbient = false;
  for (const step of protocolSteps.slice(0, stepIndex)) {
    const rateSource = step?.thermal?.rateSource;
    if (COOLING_RATE_SOURCES.has(rateSource)) {
      belowAmbient = true;
    } else if (step?.type === 'wait' || step?.type === 'keep' || (step?.type === 'drain' && rateSource === 'none')) {
      continue;
    } else {
      belowAmbient = false;
    }
  }
  return belowAmbient;
}
