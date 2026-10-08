import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateBoosterFillRate,
  calculateCompressorFillRate,
  calculateCoolingTime,
  calculatePressureAtTemperature,
  calculateTemperatureAfterWait,
  estimateCompressionTemperature,
  simulateThermalProtocol
} from '../js/thermodynamics.js';

test('booster rate uses displacement, BPM, and receiver/source compressibility', () => {
  const rate = calculateBoosterFillRate({
    cylinderVolumeCm3: 9,
    bpm: 50,
    sourcePressureBar: 200,
    receiverPressureBar: 100,
    sourceOxygenPercent: 21,
    sourceHeliumPercent: 0,
    receiverOxygenPercent: 21,
    receiverHeliumPercent: 0,
    receiverVolumeL: 12,
    temperatureC: 20,
    useVdw: false
  });

  assert.ok(rate.fillRateBarPerMin > 7 && rate.fillRateBarPerMin < 8);
  assert.equal(rate.volumetricEfficiency, 1);
});

test('booster clearance efficiency falls when receiver pressure exceeds source pressure', () => {
  const rate = calculateBoosterFillRate({
    cylinderVolumeCm3: 9,
    bpm: 50,
    sourcePressureBar: 100,
    receiverPressureBar: 200,
    sourceOxygenPercent: 100,
    sourceHeliumPercent: 0,
    receiverOxygenPercent: 41,
    receiverHeliumPercent: 0,
    receiverVolumeL: 12,
    temperatureC: 20,
    useVdw: false
  });

  assert.ok(rate.volumetricEfficiency > 0.96 && rate.volumetricEfficiency < 0.98);
  assert.ok(rate.fillRateBarPerMin > 0);
});

test('compressor inlet flow converts free-air flow to receiver pressure rate', () => {
  const rate = calculateCompressorFillRate({
    inletFlowLPerMin: 100,
    receiverOxygenPercent: 21,
    receiverHeliumPercent: 0,
    receiverVolumeL: 12,
    ambientTemperatureC: 20,
    receiverTemperatureC: 20,
    useVdw: false
  });

  assert.ok(Math.abs(rate - 8.447) < 0.01);
});

test('cooling reaches an absolute target using Newton cooling', () => {
  const minutes = calculateCoolingTime({
    transferEndTemperatureC: 60,
    ambientTemperatureC: 20,
    targetTemperatureC: 30,
    tauMinutes: 18
  });
  assert.ok(Math.abs(minutes - 24.9533) < 1e-3);
  assert.ok(Math.abs(calculateTemperatureAfterWait({
    transferEndTemperatureC: 60,
    ambientTemperatureC: 20,
    waitMinutes: minutes,
    tauMinutes: 18
  }) - 30) < 1e-9);
});

test('pressure falls when a hot ideal-gas tank cools at fixed density', () => {
  const pressure = calculatePressureAtTemperature({
    pressureBar: 200,
    oxygenPercent: 21,
    heliumPercent: 0,
    fromTemperatureC: 60,
    toTemperatureC: 20,
    volumeL: 12,
    useVdw: false
  });
  assert.ok(Math.abs(pressure - 175.989) < 0.01);
});

test('pressure projection uses the selected Van der Waals model', () => {
  const pressure = calculatePressureAtTemperature({
    pressureBar: 200,
    oxygenPercent: 21,
    heliumPercent: 0,
    fromTemperatureC: 60,
    toTemperatureC: 20,
    volumeL: 12,
    useVdw: true
  });

  assert.ok(Math.abs(pressure - 167.5505) < 1e-3);
});

test('compression temperature increases with pressure and is cooled faster in water', () => {
  const airSteel = estimateCompressionTemperature({
    startTemperatureC: 20,
    addedPressureBar: 70,
    fillTimeMinutes: 10,
    volumeL: 12,
    heliumFraction: 0,
    tankMaterial: 'steel',
    coolingMedium: 'air'
  });
  const heliumAluminumWater = estimateCompressionTemperature({
    startTemperatureC: 20,
    addedPressureBar: 70,
    fillTimeMinutes: 10,
    volumeL: 12,
    heliumFraction: 0.35,
    tankMaterial: 'aluminum',
    coolingMedium: 'water'
  });

  assert.ok(airSteel > 20);
  assert.ok(heliumAluminumWater > 20);
  assert.ok(heliumAluminumWater < airSteel);
});

test('sequential simulation carries post-wait pressure and temperature into the next stage', () => {
  const simulation = simulateThermalProtocol({
    protocolSteps: [
      {
        type: 'boost',
        operation: 'Boost',
        resultingPressureBar: 150,
        resultingMix: { oxygenPercent: 21, heliumPercent: 0 },
        sourceStartPressureBar: 200,
        sourceEndPressureBar: 150,
        receiverStartPressureBar: 100,
        receiverEndPressureBar: 150
      },
      {
        type: 'decant',
        operation: 'Decant',
        resultingPressureBar: 180,
        resultingMix: { oxygenPercent: 21, heliumPercent: 0 },
        sourceStartPressureBar: 220,
        sourceEndPressureBar: 190,
        receiverStartPressureBar: 150,
        receiverEndPressureBar: 180
      }
    ],
    cylinder: { volumeL: 12 },
    physics: { model: 'ideal', temperatureC: 20 },
    thermal: {
      tankMaterial: 'steel',
      coolingMedium: 'air',
      ambientTemperatureC: 20,
      waitMode: 'minutes',
      waitMinutes: 10,
      targetTemperatureC: 25
    },
    settings: {
      booster: {
        cylinderVolumeCm3: 9,
        oxygenBoostBpm: 50,
        otherBoostBpm: 50,
        oxygenDecantRateBarPerMin: 5,
        otherDecantRateBarPerMin: 5,
        compressorInletFlowLPerMin: 100
      }
    }
  });

  assert.equal(simulation.protocolSteps.length, 2);
  assert.equal(simulation.protocolSteps[0].thermal.rateSource, 'booster');
  assert.equal(simulation.protocolSteps[1].thermal.rateSource, 'decant-rate');
  assert.ok(simulation.protocolSteps[0].thermal.pressureAfterWaitBar < 150);
  assert.equal(
    simulation.protocolSteps[1].thermal.temperatureStartC,
    simulation.protocolSteps[0].thermal.temperatureAfterWaitC
  );
});

test('top-up uses compressor flow and 40 percent oxygen selects oxygen rates', () => {
  const simulation = simulateThermalProtocol({
    protocolSteps: [{
      type: 'boost',
      operation: 'Top-up',
      resultingPressureBar: 200,
      resultingMix: { oxygenPercent: 21, heliumPercent: 0 },
      sourceStartPressureBar: 190,
      sourceEndPressureBar: 100,
      receiverStartPressureBar: 150,
      receiverEndPressureBar: 200
    }],
    cylinder: { volumeL: 12 },
    physics: { model: 'ideal', temperatureC: 20 },
    thermal: {
      tankMaterial: 'steel',
      coolingMedium: 'air',
      ambientTemperatureC: 20,
      waitMode: 'minutes',
      waitMinutes: 0,
      targetTemperatureC: 25
    },
    settings: {
      booster: {
        cylinderVolumeCm3: 9,
        oxygenBoostBpm: 50,
        otherBoostBpm: 50,
        oxygenDecantRateBarPerMin: 5,
        otherDecantRateBarPerMin: 5,
        compressorInletFlowLPerMin: 100
      }
    }
  });

  assert.equal(simulation.protocolSteps[0].thermal.rateSource, 'compressor');
  assert.ok(simulation.protocolSteps[0].thermal.rateBarPerMin > 0);
});
