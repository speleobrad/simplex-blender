import { createCompareRow } from './compare-recipe.js';
import { calculatePressureAtTemperature } from './thermodynamics.js';

const START_FIELDS = ['pressureBar', 'oxygenPercent', 'heliumPercent', 'ambientTemperatureC', 'cylinderPresetName', 'coolingMedium', 'inWaterTemperatureC'];
const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

export function createWhatIfScenario() {
  return { initialized: false, start: null, rows: [createCompareRow('drain', 'compare-row-1')], result: null, draftRevision: 0, resultRevision: -1, sharedInputSignature: null };
}

export function snapshotWhatIfFromBlending(input) {
  const { cylinder = {}, thermal = {} } = input ?? {};
  return {
    pressureBar: cylinder.initialPressureBar,
    oxygenPercent: cylinder.initialOxygenPercent,
    heliumPercent: cylinder.initialHeliumPercent,
    ambientTemperatureC: thermal.ambientTemperatureC,
    cylinderPresetName: cylinder.presetName,
    coolingMedium: thermal.coolingMedium,
    inWaterTemperatureC: thermal.targetInWaterTemperatureC
  };
}

export function applyWhatIfStartPatch(scenario, patch) {
  const start = { ...(scenario.start ?? {}), ...clone(patch) };
  return { ...scenario, start, rows: clone(scenario.rows ?? []), draftRevision: (scenario.draftRevision ?? 0) + 1 };
}

export function whatIfDraftSignature(scenario) {
  const start = Object.fromEntries(START_FIELDS.map(field => [field, scenario.start?.[field]]));
  return stable({ start, rows: scenario.rows ?? [] });
}

export function whatIfSharedInputSignature({ settings, banks, cylinderPresetName }) {
  const physics = settings?.physics ?? {};
  const preset = settings?.cylinderPresets?.find(item => item.name === cylinderPresetName) ?? null;
  return stable({
    physics: { model: physics.model, temperatureC: physics.temperatureC },
    cylinderPreset: preset,
    booster: settings?.booster ?? {},
    pressureLimitMode: settings?.pressureLimitMode ?? 'hard-stop',
    banks: banks ?? []
  });
}

export function buildWhatIfInput(scenario, { settings, banks }) {
  const start = scenario.start ?? {};
  const preset = settings?.cylinderPresets?.find(item => item.name === start.cylinderPresetName) ?? {};
  const cylinder = { ...clone(preset), presetName: start.cylinderPresetName, initialPressureBar: start.pressureBar, initialOxygenPercent: start.oxygenPercent, initialHeliumPercent: start.heliumPercent };
  const sharedPhysics = settings?.physics ?? {};
  return {
    cylinder,
    physics: { model: sharedPhysics.model ?? 'ideal', temperatureC: start.ambientTemperatureC },
    thermal: { tankMaterial: preset.material, tankMassKg: preset.massKg, coolingMedium: start.coolingMedium, ambientTemperatureC: start.ambientTemperatureC, inletTemperatureC: start.ambientTemperatureC, inWaterTemperatureC: start.inWaterTemperatureC },
    banks: clone(banks ?? []),
    settings: clone(settings)
  };
}

export function projectWhatIfInWater(finalState, { inWaterTemperatureC, volumeL, useVdw }) {
  return {
    pressureBar: calculatePressureAtTemperature({ pressureBar: finalState.pressureBar, oxygenPercent: finalState.oxygenPercent, heliumPercent: finalState.heliumPercent, fromTemperatureC: finalState.temperatureC, toTemperatureC: inWaterTemperatureC, volumeL, useVdw }),
    temperatureC: inWaterTemperatureC,
    oxygenPercent: finalState.oxygenPercent,
    heliumPercent: finalState.heliumPercent
  };
}
