import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyInterimMeasurement } from '../js/interim-check.js';
import { optimizeBlend } from '../js/optimizer.js';

const bank = (id, name, oxygenPercent, heliumPercent) => ({
  id, name, enabled: true, volumeL: 50, pressureBar: 300, maxPressureBar: 350, oxygenPercent, heliumPercent
});

// Default-like recipe: 50 bar Air at 21 °C to 195 bar 18/45, settled at 10 °C in water.
const defaultScenario = {
  cylinder: {
    volumeL: 12, initialPressureBar: 50, targetPressureBar: 195,
    initialOxygenPercent: 21, initialHeliumPercent: 0,
    targetOxygenPercent: 18, targetHeliumPercent: 45,
    workingPressureBar: 232, hotOverfillPercent: 2
  },
  physics: { model: 'vdw', temperatureC: 21 },
  banks: [bank('oxygen', 'Oxygen', 100, 0), bank('helium', 'Helium', 0, 100)],
  thermal: {
    tankMaterial: 'steel', coolingMedium: 'air', ambientTemperatureC: 21, inletTemperatureC: 25,
    targetMediumTemperatureC: 21, targetInWaterTemperatureC: 10,
    waitMode: 'minutes', waitMinutes: 5, interimMeasurements: []
  },
  settings: { booster: {}, units: 'metric', pressureLimitMode: 'hard-stop' }
};

// Drain scenario: 150 bar cylinder drained to 100 bar; gas cools below ambient after the drain.
const drainScenario = {
  ...defaultScenario,
  cylinder: { ...defaultScenario.cylinder, initialPressureBar: 150, targetPressureBar: 100 },
  thermal: { ...defaultScenario.thermal, targetInWaterTemperatureC: 21 }
};

const tolerancePercent = 3;

test('a first reading at the planned state is accepted', () => {
  assert.deepEqual(verifyInterimMeasurement(
    defaultScenario, 0, { pressureBar: 50, temperatureC: 21 }, { tolerancePercent }
  ), { ok: true });
});

test('a reading below ambient is rejected when no drain produced it', () => {
  const result = verifyInterimMeasurement(
    defaultScenario, 0, { pressureBar: 30, temperatureC: 15 }, { tolerancePercent }
  );
  assert.equal(result.ok, false);
  assert.match(result.error, /below ambient 21\.0 °C.*pressure-lowering drain/);
});

test('a pressure outside the tolerance band for the measured temperature is rejected', () => {
  const result = verifyInterimMeasurement(
    defaultScenario, 0, { pressureBar: 52, temperatureC: 21 }, { tolerancePercent }
  );
  assert.equal(result.ok, false);
  assert.match(result.error, /outside ±3% of the planned 50\.0 bar for step 1 at 21\.0 °C/);
});

test('a pressure inside a widened tolerance band is accepted', () => {
  assert.deepEqual(verifyInterimMeasurement(
    defaultScenario, 0, { pressureBar: 52, temperatureC: 21 }, { tolerancePercent: 5 }
  ), { ok: true });
});

test('mismatch messages use the selected display units', () => {
  const result = verifyInterimMeasurement(
    defaultScenario, 0, { pressureBar: 52, temperatureC: 21 }, { tolerancePercent, units: 'imperial' }
  );
  assert.equal(result.ok, false);
  assert.match(result.error, /planned 725\.\d psi/);
  assert.match(result.error, /69\.8 °F/);
});

test('a reading below ambient after a drain is accepted at the drained state', () => {
  const result = verifyInterimMeasurement(
    drainScenario, 1, { pressureBar: 41.7, temperatureC: 11.8 }, { tolerancePercent }
  );
  assert.deepEqual(result, { ok: true });
});

test('a pressure mismatch after a drain is rejected with the step number the results panel shows', () => {
  const result = verifyInterimMeasurement(
    drainScenario, 1, { pressureBar: 30, temperatureC: 11.8 }, { tolerancePercent }
  );
  assert.equal(result.ok, false);
  const planTitle = optimizeBlend(drainScenario).protocolSteps
    .find(step => step._measurementIndex === 1).title;
  const shownNumber = planTitle.match(/^Step (\d+)/)[1];
  assert.match(result.error, new RegExp(`planned 41\\.\\d bar for step ${shownNumber} `));
});
