import { planWithReadings } from './plan-with-readings.js';
import { calculatePressureAtTemperature } from './thermodynamics.js';
import {
  gasCanBeBelowAmbient,
  interimPressureWithinTolerance,
  protocolStepNumber
} from './interim-measurements.js';
import { formatUnitValue } from './units.js';

function protocolStepsOf(result) {
  return result?.protocolSteps?.length
    ? result.protocolSteps
    : result?.maximumPressure?.protocolSteps ?? [];
}

// Checks a candidate reading for step `index` against the recipe that planWithReadings
// produces from the readings before it. Returns { ok: true } or { ok: false, error }.
export function verifyInterimMeasurement(input, index, measurement, { tolerancePercent, units = 'metric' }) {
  const priorMeasurements = (input.thermal.interimMeasurements ?? []).slice(0, index);
  const reference = planWithReadings({
    ...input,
    thermal: { ...input.thermal, interimMeasurements: priorMeasurements }
  });
  if (reference?.feasible === false) {
    return {
      ok: false,
      error: `This reading cannot be checked because the plan from the earlier readings is infeasible: ${reference.error ?? 'unknown error'}.`
    };
  }
  const protocolSteps = protocolStepsOf(reference);
  const stepIndex = protocolSteps.findIndex(step => step?._measurementIndex === index);
  const planned = protocolSteps[stepIndex]?.thermal;
  if (!planned) {
    return {
      ok: false,
      error: 'This reading cannot be checked because the plan has no matching step.'
    };
  }
  const stepNumber = protocolStepNumber(protocolSteps[stepIndex], index);

  const ambientC = input.thermal.ambientTemperatureC;
  if (measurement.temperatureC < ambientC && !gasCanBeBelowAmbient(protocolSteps, stepIndex)) {
    return {
      ok: false,
      error: `Measured temperature ${formatUnitValue(measurement.temperatureC, 'temperatureC', units)} is below ambient ${formatUnitValue(ambientC, 'temperatureC', units)}, but this gas state did not come from a pressure-lowering drain. Stop, recheck the starting cylinder, and retry from the actual measured state.`
    };
  }

  const expectedBar = calculatePressureAtTemperature({
    pressureBar: planned.pressureStartBar,
    oxygenPercent: planned.receiverStartMix.oxygenPercent,
    heliumPercent: planned.receiverStartMix.heliumPercent,
    fromTemperatureC: planned.temperatureStartC,
    toTemperatureC: measurement.temperatureC,
    volumeL: input.cylinder.volumeL,
    useVdw: input.physics.model === 'vdw'
  });
  if (!interimPressureWithinTolerance({
    measuredBar: measurement.pressureBar,
    plannedBar: expectedBar,
    tolerancePercent
  })) {
    return {
      ok: false,
      error: `Measured pressure ${formatUnitValue(measurement.pressureBar, 'pressureBar', units)} is outside ±${tolerancePercent}% of the planned ${formatUnitValue(expectedBar, 'pressureBar', units)} for step ${stepNumber} at ${formatUnitValue(measurement.temperatureC, 'temperatureC', units)}. Stop, recheck the starting cylinder, and retry from the actual measured state.`
    };
  }
  return { ok: true };
}
