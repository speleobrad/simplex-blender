import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyWhatIfStartPatch,
  buildWhatIfInput,
  createWhatIfScenario,
  projectWhatIfInWater,
  snapshotWhatIfFromBlending,
  whatIfDraftSignature,
  whatIfSharedInputSignature
} from '../js/what-if-scenario.js';

const blendingInput = {
  cylinder: { presetName: 'Catalina S80', volumeL: 11.1, workingPressureBar: 207, hotOverfillPercent: 2, initialPressureBar: 50, initialOxygenPercent: 21, initialHeliumPercent: 0, targetPressureBar: 200, targetOxygenPercent: 18, targetHeliumPercent: 45 },
  physics: { model: 'vdw', temperatureC: 25 },
  thermal: { tankMaterial: 'aluminum', tankMassKg: 14.3, coolingMedium: 'water', ambientTemperatureC: 25, targetInWaterTemperatureC: 10, inletTemperatureC: 25, waitMode: 'minutes', waitMinutes: 7 }
};

test('snapshots only What-if starting fields and omits all targets', () => {
  const start = snapshotWhatIfFromBlending(blendingInput);
  assert.deepEqual(start, { pressureBar: 50, oxygenPercent: 21, heliumPercent: 0, ambientTemperatureC: 25, cylinderPresetName: 'Catalina S80', coolingMedium: 'water', inWaterTemperatureC: 10 });
  assert.equal('targetPressureBar' in start, false);
  assert.equal('targetOxygenPercent' in start, false);
});
test('scenario patches are independent and advance the draft revision', () => {
  const first = createWhatIfScenario();
  const initialized = { ...first, initialized: true, start: snapshotWhatIfFromBlending(blendingInput) };
  const updated = applyWhatIfStartPatch(initialized, { pressureBar: 80 });
  assert.equal(updated.start.pressureBar, 80); assert.equal(initialized.start.pressureBar, 50); assert.equal(updated.draftRevision, initialized.draftRevision + 1); assert.notEqual(updated.rows, initialized.rows);
});
test('scenario input resolves the selected shared cylinder but retains independent start values', () => {
  const scenario = { ...createWhatIfScenario(), initialized: true, start: { ...snapshotWhatIfFromBlending(blendingInput), pressureBar: 80 } };
  const settings = { physics: { model: 'ideal' }, cylinderPresets: [{ name: 'Catalina S80', volumeL: 11.1, material: 'aluminum', massKg: 14.3, workingPressureBar: 207, hotOverfillPercent: 2 }] };
  const input = buildWhatIfInput(scenario, { settings, banks: [] });
  assert.equal(input.cylinder.initialPressureBar, 80); assert.equal(input.cylinder.targetPressureBar, undefined); assert.equal(input.thermal.targetInWaterTemperatureC, undefined); assert.equal(input.thermal.inWaterTemperatureC, 10); assert.equal(input.thermal.waitMinutes, undefined);
});
test('in-water projection uses the explicit scenario temperature', () => {
  const projection = projectWhatIfInWater({ pressureBar: 200, temperatureC: 25, oxygenPercent: 18, heliumPercent: 45 }, { inWaterTemperatureC: 10, volumeL: 11.1, useVdw: false });
  assert.equal(projection.temperatureC, 10); assert.ok(projection.pressureBar < 200); assert.equal(projection.oxygenPercent, 18); assert.equal(projection.heliumPercent, 45);
});
test('signatures track draft behavior and shared behavior only', () => {
  const scenario = { ...createWhatIfScenario(), initialized: true, start: snapshotWhatIfFromBlending(blendingInput) };
  const edited = applyWhatIfStartPatch(scenario, { pressureBar: 81 });
  assert.notEqual(whatIfDraftSignature(scenario), whatIfDraftSignature(edited));
  const reordered = { ...scenario, rows: [...scenario.rows].reverse().concat(scenario.rows[0]) };
  assert.notEqual(whatIfDraftSignature(scenario), whatIfDraftSignature(reordered));
  const shared = whatIfSharedInputSignature({ settings: { physics: { model: 'ideal' }, uiOnly: 1 }, banks: [], cylinderPresetName: 'Catalina S80' });
  assert.equal(shared, whatIfSharedInputSignature({ settings: { physics: { model: 'ideal' }, uiOnly: 2 }, banks: [], cylinderPresetName: 'Catalina S80' }));
  assert.notEqual(shared, whatIfSharedInputSignature({ settings: { physics: { model: 'ideal' }, uiOnly: 1 }, banks: [{ id: 'b' }], cylinderPresetName: 'Catalina S80' }));
});
