import { optimizeBlend, finalizeComposedPlan } from './optimizer.js';
import { COMPRESSOR_AIR_ID } from './compare-recipe.js';
import { GAS_CONSTANT, HELIUM_SALVAGE_MAX_PERCENT, calcMolarDensity, calcPressure } from './physics.js';
import { calculatePressureAtTemperature } from './thermodynamics.js';

// Plans a blend from the stored interim readings.
//
// The recipe is a pure function of the readings, taken in ascending step order.
// Each reading at logical step k re-plans from the measured state: the steps before
// k stay as planned, and the optimizer plans the steps from k onward from the state
// derived at k. The optimizer's own pre-schedule steps are merged and the whole
// recipe is scheduled and simulated once, with every reading applied at its logical
// step (see finalizeComposedPlan), so cards, charts and summaries come from one
// simulation.
//
// Readings are stored by logical step index. That index stays meaningful because
// only the latest reading can be changed or cleared (interimMeasurementLockMessage)
// and any recipe or settings change clears all readings.
//
// State at k. Pressure and temperature are measured; composition and bank
// inventories are not. The reading is attributed to the transfer immediately before
// k: its source gas is known, so the moles it added follow from
//
//   n(Pm, Tm, mix(x)) * V = n0 + x,   mix(x) = (n0 * mix0 + x * gas) / (n0 + x)
//
// where n0 is the tank inventory before that transfer.

const AIR = Object.freeze({ id: COMPRESSOR_AIR_ID, name: 'Compressor Air', oxygenPercent: 21, heliumPercent: 0 });
const SOLVE_ITERATIONS = 80;
const MAX_BRACKET_MOLES = 1e6;

function molesIn(pressureBar, mix, temperatureC, volumeL, useVdw) {
  return calcMolarDensity(pressureBar, mix.oxygenPercent, mix.heliumPercent, temperatureC, useVdw) * volumeL;
}

function initialMixOf(cylinder) {
  return { oxygenPercent: cylinder.initialOxygenPercent, heliumPercent: cylinder.initialHeliumPercent };
}

// Solves for the moles `gas` added to a tank holding n0 moles of `mix0` so that the
// tank reads (pressureBar, temperatureC). Returns null when the reading implies the
// tank holds no more gas than before the transfer.
function solveAddedMoles({ pressureBar, temperatureC, mix0, gas, n0, volumeL, useVdw }) {
  const mixAfter = added => ({
    oxygenPercent: (n0 * mix0.oxygenPercent + added * gas.oxygenPercent) / (n0 + added),
    heliumPercent: (n0 * mix0.heliumPercent + added * gas.heliumPercent) / (n0 + added)
  });
  const residual = added => molesIn(pressureBar, mixAfter(added), temperatureC, volumeL, useVdw) - (n0 + added);
  if (residual(0) <= 0) return null;
  let low = 0;
  let high = Math.max(1, n0);
  while (residual(high) > 0) {
    if (high > MAX_BRACKET_MOLES) return null;
    high *= 2;
  }
  for (let iteration = 0; iteration < SOLVE_ITERATIONS; iteration += 1) {
    const middle = (low + high) / 2;
    if (residual(middle) > 0) low = middle;
    else high = middle;
  }
  const addedMoles = (low + high) / 2;
  return { addedMoles, mix: mixAfter(addedMoles) };
}

function withReadings(input, interimMeasurements) {
  return { ...input, thermal: { ...input.thermal, interimMeasurements } };
}

function readingsUpTo(measurements, index) {
  const kept = [];
  for (let slot = 0; slot <= index; slot += 1) {
    if (measurements[slot]) kept[slot] = measurements[slot];
  }
  return kept;
}

function renumberStep(step, number) {
  const renumber = value => (typeof value === 'string' ? value.replace(/^Step[ ]+[0-9]+/i, `Step ${number}`) : value);
  return {
    ...step,
    title: renumber(step.title),
    description: renumber(step.description),
    recipeLabel: renumber(step.recipeLabel)
  };
}

// The segment that owns logical step `index`: the last one starting at or before it.
function segmentFor(readingPlan, index) {
  let owner = readingPlan.segments[0];
  for (const segment of readingPlan.segments) {
    if (segment.fromIndex <= index) owner = segment;
  }
  return owner;
}

function mixBefore(plan, index) {
  const segment = segmentFor(plan.readingPlan, index);
  if (index === segment.fromIndex) return segment.startMix;
  return plan.logicalPlan.protocolSteps[index - 1].resultingMix;
}

// Moles left in each bank before logical step `index`, from the owning segment's
// starting banks and that segment's own source end pressures.
function bankMolesBefore(plan, index, input) {
  const segment = segmentFor(plan.readingPlan, index);
  const referenceC = input.physics.temperatureC;
  const useVdw = input.physics.model !== 'ideal';
  const moles = new Map(segment.banks.map(bank => [bank.id, molesIn(bank.pressureBar, bank, referenceC, bank.volumeL, useVdw)]));
  const steps = plan.logicalPlan.protocolSteps;
  for (let position = segment.fromIndex; position < index; position += 1) {
    const step = steps[position];
    if (!step?.sourceBankId || step.sourceBankId === COMPRESSOR_AIR_ID) continue;
    const bank = segment.banks.find(candidate => candidate.id === step.sourceBankId);
    if (!bank || !Number.isFinite(step.sourceEndPressureBar)) continue;
    const stepReferenceC = Number.isFinite(step.pressureReferenceTemperatureC) ? step.pressureReferenceTemperatureC : referenceC;
    moles.set(bank.id, molesIn(step.sourceEndPressureBar, bank, stepReferenceC, bank.volumeL, useVdw));
  }
  return moles;
}

function simulatedStep(plan, index) {
  return plan.protocolSteps.find(step => step._measurementIndex === index);
}

// Helium moles from supply gas with helium below the salvage limit. Each transfer
// step pairs, in order, with the trajectory point after the start point; the moles it
// added are on that point unless a reading replaced them with the derived amount.
function suppliedSalvagedHeliumMoles(steps, trajectory) {
  const points = trajectory.slice(1);
  let cursor = 0;
  let total = 0;
  for (const step of steps) {
    if (!step?.sourceBankId) continue;
    const point = points[cursor];
    cursor += 1;
    const moles = Number.isFinite(step.sourceConsumedMoles) ? step.sourceConsumedMoles : Number(point?.addedMoles) || 0;
    if (step.sourceHeliumPercent < HELIUM_SALVAGE_MAX_PERCENT) total += moles * (step.sourceHeliumPercent / 100);
  }
  return total;
}

function blendFromLedger({ input, template, steps, trajectory, retainedFraction, ventedMoles }) {
  const { cylinder, physics } = input;
  const temperatureC = physics.temperatureC;
  const useVdw = physics.model !== 'ideal';
  const initialMix = initialMixOf(cylinder);
  const initialMoles = molesIn(cylinder.initialPressureBar, initialMix, temperatureC, cylinder.volumeL, useVdw);
  const retainedMoles = initialMoles * retainedFraction;
  const retainedPressureBar = calcPressure(retainedMoles / cylinder.volumeL, initialMix.oxygenPercent, initialMix.heliumPercent, temperatureC, useVdw);
  const retainedHeliumMoles = cylinder.initialHeliumPercent < HELIUM_SALVAGE_MAX_PERCENT
    ? retainedMoles * (cylinder.initialHeliumPercent / 100)
    : 0;
  const litresPerMole = GAS_CONSTANT * (temperatureC + 273.15);
  return {
    ...template.blend,
    retainedPressureBar,
    retainedPercent: retainedFraction * 100,
    ventedPressureBar: Math.max(0, cylinder.initialPressureBar - retainedPressureBar),
    ventedMoles,
    ventedGasLitres: ventedMoles * litresPerMole,
    heliumVentedLitres: ventedMoles * (cylinder.initialHeliumPercent / 100) * litresPerMole,
    heliumSalvagedLitres: (retainedHeliumMoles + suppliedSalvagedHeliumMoles(steps, trajectory)) * litresPerMole
  };
}

// Attaches the bookkeeping a later reading needs to a plan built without readings.
function startingPlan(base, input) {
  return {
    ...base,
    readingPlan: {
      segments: [{ fromIndex: 0, banks: base.salvageBanks ?? input.banks ?? [], startMix: initialMixOf(input.cylinder) }],
      retainedFraction: base.blend.retainedPercent / 100,
      ventedMoles: base.blend.ventedMoles ?? 0
    }
  };
}

function fail(error) {
  return { error };
}

// Applies the reading at logical step `index` to `plan` (which already includes the
// earlier readings). `readingsInput` holds the readings up to and including `index`.
function applyReading(plan, input, readingsInput, index, reading) {
  const { cylinder, physics } = input;
  const volumeL = cylinder.volumeL;
  const referenceC = physics.temperatureC;
  const useVdw = physics.model !== 'ideal';
  const logical = plan.logicalPlan.protocolSteps;
  const step = logical[index];
  if (!step || step.type === 'keep') return fail('This reading does not match a step of the recipe.');

  const bankMoles = bankMolesBefore(plan, index, input);
  const previousIndex = index - 1;
  const previous = logical[previousIndex];
  const banks = segmentFor(plan.readingPlan, previousIndex >= 0 ? previousIndex : 0).banks;
  const sourceBank = previous?.sourceBankId === COMPRESSOR_AIR_ID
    ? AIR
    : banks.find(bank => bank.id === previous?.sourceBankId);
  const prefix = logical.slice(0, index);
  let mix = { ...mixBefore(plan, index) };
  if (sourceBank && previous) {
    const previousThermal = simulatedStep(plan, previousIndex)?.thermal;
    if (!previousThermal) return fail('This reading cannot be checked because the previous step has no simulated state.');
    const mix0 = mixBefore(plan, previousIndex);
    const n0 = molesIn(previousThermal.pressureStartBar, mix0, previousThermal.temperatureStartC, volumeL, useVdw);
    const solved = solveAddedMoles({
      pressureBar: reading.pressureBar,
      temperatureC: reading.temperatureC,
      mix0,
      gas: sourceBank,
      n0,
      volumeL,
      useVdw
    });
    if (!solved) {
      return fail(`The measured ${reading.pressureBar} bar at ${reading.temperatureC} °C implies the tank holds no more gas than before the previous step, so the amount it added cannot be derived. Recheck the reading.`);
    }
    mix = solved.mix;
    prefix[previousIndex] = { ...previous, sourceConsumedMoles: solved.addedMoles };
    if (sourceBank.id !== COMPRESSOR_AIR_ID) {
      const before = bankMolesBefore(plan, previousIndex, input).get(sourceBank.id);
      bankMoles.set(sourceBank.id, Math.max(0, before - solved.addedMoles));
    }
  }

  const allBanks = segmentFor(plan.readingPlan, index).banks;
  const remainingBanks = allBanks.map(bank => {
    const pressureBar = calcPressure(Math.max(0, bankMoles.get(bank.id)) / bank.volumeL, bank.oxygenPercent, bank.heliumPercent, referenceC, useVdw);
    // Derived state is a model estimate; the rating must not sit below it.
    return { ...bank, pressureBar, maxPressureBar: Math.max(bank.maxPressureBar, pressureBar) };
  });
  const pressureAtReferenceBar = calculatePressureAtTemperature({
    pressureBar: reading.pressureBar,
    oxygenPercent: mix.oxygenPercent,
    heliumPercent: mix.heliumPercent,
    fromTemperatureC: reading.temperatureC,
    toTemperatureC: referenceC,
    volumeL,
    useVdw
  });
  const suffixInput = {
    ...input,
    _salvage: false,
    cylinder: {
      ...cylinder,
      initialPressureBar: pressureAtReferenceBar,
      initialOxygenPercent: mix.oxygenPercent,
      initialHeliumPercent: mix.heliumPercent
    },
    banks: remainingBanks,
    thermal: { ...input.thermal, interimMeasurements: [] }
  };
  const probe = optimizeBlend(suffixInput);
  if (probe.feasible === false || !probe.logicalPlan) {
    return fail(probe.error ?? 'No plan reaches the target from this reading.');
  }
  const firstIndex = probe.logicalPlan.protocolSteps[0]?.type === 'keep' ? 1 : 0;
  const suffix = optimizeBlend({
    ...suffixInput,
    thermal: { ...input.thermal, interimMeasurements: Object.assign([], { [firstIndex]: reading }) }
  });
  if (suffix.feasible === false || !suffix.logicalPlan) {
    return fail(suffix.error ?? 'No plan reaches the target from this reading.');
  }
  const suffixSteps = suffix.logicalPlan.protocolSteps.slice(firstIndex)
    .map((candidate, offset) => renumberStep(candidate, index + offset));
  if (suffixSteps.length === 0) return fail('No steps remain to plan from this reading.');
  const mergedSteps = [...prefix, ...suffixSteps];

  const mergedTrajectory = [
    ...plan.logicalPlan.trajectory.slice(0, index),
    ...suffix.logicalPlan.trajectory.slice(1).map((point, offset) => {
      const step = index + offset + 1 - firstIndex;
      return {
        ...point,
        step,
        label: /^Step \d+$/i.test(point.label ?? '') ? `Step ${step}` : point.label
      };
    })
  ];

  const retainedFraction = plan.readingPlan.retainedFraction * (suffix.blend.retainedPercent / 100);
  const ventedMoles = plan.readingPlan.ventedMoles + (suffix.blend.ventedMoles ?? 0);
  const blend = blendFromLedger({ input, template: suffix, steps: mergedSteps, trajectory: mergedTrajectory, retainedFraction, ventedMoles });
  const finalized = finalizeComposedPlan({
    input: readingsInput,
    template: { ...suffix, blend },
    protocolSteps: mergedSteps,
    trajectory: mergedTrajectory,
    targetPressureBar: suffix.logicalPlan.targetPressureBar
  });
  if (!finalized) return fail('The re-planned recipe cannot stay within the cylinder pressure limits.');
  return {
    plan: {
      ...finalized,
      readingPlan: {
        segments: [
          ...plan.readingPlan.segments.filter(segment => segment.fromIndex < index),
          { fromIndex: index, banks: remainingBanks, startMix: mix }
        ],
        retainedFraction,
        ventedMoles
      }
    }
  };
}

// Returns an optimizeBlend-shaped result. `interimReadings` reports how many readings
// were applied and, when the recipe could not be re-planned, why the original recipe
// (with the readings applied thermally only) is shown instead.
export function planWithReadings(input) {
  const measurements = input?.thermal?.interimMeasurements ?? [];
  const indices = [];
  measurements.forEach((measurement, index) => {
    if (measurement) indices.push(index);
  });
  const base = optimizeBlend(withReadings(input, []));
  if (indices.length === 0) return base;

  const fallback = error => ({
    ...optimizeBlend(input),
    interimReadings: { count: indices.length, error }
  });
  if (base.feasible === false || !base.logicalPlan || !base.blend) return optimizeBlend(input);

  let plan = startingPlan(base, input);
  for (const index of indices) {
    const applied = applyReading(plan, input, withReadings(input, readingsUpTo(measurements, index)), index, measurements[index]);
    if (applied.error) return fallback(applied.error);
    plan = applied.plan;
  }
  return { ...plan, interimReadings: { count: indices.length, error: null } };
}
