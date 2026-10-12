import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateBoosterFillRate,
  calculateCompressorFillRate,
  calculateCoolingTime,
  calculatePressureAtTemperature,
  calculateTemperatureAfterWait,
  estimateTransferTemperature,
  projectPressureAtTemperatures,
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
test('booster molar flow uses absolute source pressure', () => {
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

  const expectedMolesPerMin = (201 * 0.45) / (0.083144626 * 293.15);
  assert.ok(Math.abs(rate.molesPerMin - expectedMolesPerMin) < 1e-12);
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
    receiverPressureBar: 1.01325,
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

test('transfer temperature increases with pressure and is cooled faster in water', () => {
  const airSteel = estimateTransferTemperature({
    startTemperatureC: 20,
    addedPressureBar: 70,
    fillTimeMinutes: 10,
    volumeL: 12,
    heliumFraction: 0,
    tankMaterial: 'steel',
    coolingMedium: 'air'
  });
  const heliumAluminumWater = estimateTransferTemperature({
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

test('transfer heat loss uses the ambient gradient during filling', () => {
  const common = {
    startTemperatureC: 24,
    addedPressureBar: 100,
    fillTimeMinutes: 10,
    volumeL: 12,
    heliumFraction: 1,
    tankMaterial: 'steel',
    coolingMedium: 'air'
  };
  const matchedAmbient = estimateTransferTemperature({
    ...common,
    ambientTemperatureC: 24
  });
  const coolerAmbient = estimateTransferTemperature({
    ...common,
    ambientTemperatureC: 0
  });

  assert.ok(coolerAmbient < matchedAmbient - 1);
});

test('matches the corrected reference 12 L steel air-fill integration', () => {
  const temperatureC = estimateTransferTemperature({
    startTemperatureC: 28,
    startPressureBar: 80,
    addedPressureBar: 100,
    fillTimeMinutes: 20,
    volumeL: 12,
    heliumFraction: 0.35,
    tankMaterial: 'steel',
    coolingMedium: 'air',
    ambientTemperatureC: 28,
    inletTemperatureC: 28
  });

  assert.ok(Math.abs(temperatureC - 37.8424) < 0.01);
});

test('inlet gas temperature changes the transfer-end temperature', () => {
  const common = {
    startTemperatureC: 20,
    startPressureBar: 0,
    addedPressureBar: 210,
    fillTimeMinutes: 20,
    volumeL: 12,
    heliumFraction: 0,
    tankMaterial: 'steel',
    coolingMedium: 'air',
    ambientTemperatureC: 20
  };

  const chilledInletC = estimateTransferTemperature({ ...common, inletTemperatureC: 0 });
  const warmInletC = estimateTransferTemperature({ ...common, inletTemperatureC: 40 });

  assert.ok(warmInletC > chilledInletC + 5);
});
test('cylinder mass changes transfer-end temperature', () => {
  const common = {
    startTemperatureC: 20,
    startPressureBar: 0,
    addedPressureBar: 210,
    fillTimeMinutes: 20,
    volumeL: 12,
    heliumFraction: 0,
    tankMaterial: 'steel',
    coolingMedium: 'air',
    ambientTemperatureC: 20,
    inletTemperatureC: 20
  };

  const lightTank = estimateTransferTemperature({ ...common, tankMassKg: 10 });
  const heavyTank = estimateTransferTemperature({ ...common, tankMassKg: 20 });

  assert.ok(lightTank > heavyTank);
});

test('thermal simulation passes the selected cylinder mass to transfer heating', () => {
  const common = {
    protocolSteps: [{
      type: 'boost',
      operation: 'Boost',
      resultingPressureBar: 180,
      resultingMix: { oxygenPercent: 21, heliumPercent: 0 },
      receiverStartPressureBar: 0,
      receiverEndPressureBar: 180,
      sourceStartPressureBar: 200,
      sourceEndPressureBar: 20,
      sourceOxygenPercent: 21,
      sourceHeliumPercent: 0
    }],
    cylinder: { initialPressureBar: 0, volumeL: 12 },
    physics: { model: 'ideal', temperatureC: 20 },
    thermal: {
      tankMaterial: 'steel',
      coolingMedium: 'air',
      ambientTemperatureC: 20,
      inletTemperatureC: 20,
      waitMode: 'minutes',
      waitMinutes: 0,
      targetTemperatureC: 25
    },
    settings: {
      booster: {
        compressorInletFlowLPerMin: 100,
        oxygenBoostBpm: 50,
        otherBoostBpm: 50,
        oxygenDecantRateBarPerMin: 5,
        otherDecantRateBarPerMin: 5
      }
    }
  };

  const lightTank = simulateThermalProtocol({
    ...common,
    thermal: { ...common.thermal, tankMassKg: 10 }
  });
  const heavyTank = simulateThermalProtocol({
    ...common,
    thermal: { ...common.thermal, tankMassKg: 20 }
  });

  assert.ok(
    lightTank.protocolSteps[0].thermal.temperatureAtTransferEndC
      > heavyTank.protocolSteps[0].thermal.temperatureAtTransferEndC
  );
});

test('compressor temperature modifier is added to the configured inlet temperature', () => {
  const input = {
    protocolSteps: [{
      type: 'boost',
      operation: 'Top-up',
      resultingPressureBar: 150,
      resultingMix: { oxygenPercent: 21, heliumPercent: 0 },
      receiverStartPressureBar: 100,
      receiverEndPressureBar: 150
    }],
    cylinder: { initialPressureBar: 100, volumeL: 12 },
    physics: { model: 'ideal', temperatureC: 20 },
    thermal: {
      tankMaterial: 'steel',
      coolingMedium: 'air',
      ambientTemperatureC: 20,
      inletTemperatureC: 20,
      waitMode: 'minutes',
      waitMinutes: 0,
      targetTemperatureC: 25
    },
    settings: {
      booster: {
        compressorInletFlowLPerMin: 100,
        compressorTemperatureModifierC: 15
      }
    }
  };

  const simulation = simulateThermalProtocol(input);

  assert.equal(simulation.protocolSteps[0].thermal.inletTemperatureC, 35);
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
  assert.ok(
    simulation.protocolSteps[1].thermal.temperatureAtTransferEndC
      > simulation.protocolSteps[1].thermal.temperatureStartC
  );
  assert.equal(
    simulation.protocolSteps[1].thermal.temperatureStartC,
    simulation.protocolSteps[0].thermal.temperatureAfterWaitC
  );
});

test('top-up uses compressor flow before stage type', () => {
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

test('VDW top-up rate uses the receiver midpoint pressure', () => {
  const simulation = simulateThermalProtocol({
    protocolSteps: [{
      type: 'boost',
      operation: 'Top-up',
      resultingPressureBar: 300,
      resultingMix: { oxygenPercent: 21, heliumPercent: 0 },
      receiverStartPressureBar: 200,
      receiverEndPressureBar: 300
    }],
    cylinder: { initialPressureBar: 200, volumeL: 12 },
    physics: { model: 'vdw', temperatureC: 20 },
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

  assert.ok(simulation.protocolSteps[0].thermal.rateBarPerMin > 8.6);
});

test('40 percent source oxygen selects oxygen-rich rates while lower concentrations use regular rates', () => {
  const simulation = simulateThermalProtocol({
    protocolSteps: [
      {
        type: 'boost',
        operation: 'Boost',
        resultingPressureBar: 110,
        resultingMix: { oxygenPercent: 21, heliumPercent: 0 },
        sourceOxygenPercent: 40,
        sourceHeliumPercent: 0,
        sourceStartPressureBar: 200,
        sourceEndPressureBar: 190,
        receiverStartPressureBar: 100,
        receiverEndPressureBar: 110
      },
      {
        type: 'decant',
        operation: 'Decant',
        resultingPressureBar: 120,
        resultingMix: { oxygenPercent: 21, heliumPercent: 0 },
        sourceOxygenPercent: 40,
        sourceHeliumPercent: 0,
        sourceStartPressureBar: 220,
        sourceEndPressureBar: 210,
        receiverStartPressureBar: 110,
        receiverEndPressureBar: 120
      },
      {
        type: 'boost',
        operation: 'Boost',
        resultingPressureBar: 130,
        resultingMix: { oxygenPercent: 21, heliumPercent: 0 },
        sourceOxygenPercent: 39.9,
        sourceHeliumPercent: 0,
        sourceStartPressureBar: 200,
        sourceEndPressureBar: 190,
        receiverStartPressureBar: 120,
        receiverEndPressureBar: 130
      },
      {
        type: 'decant',
        operation: 'Decant',
        resultingPressureBar: 140,
        resultingMix: { oxygenPercent: 21, heliumPercent: 0 },
        sourceOxygenPercent: 39.9,
        sourceHeliumPercent: 0,
        sourceStartPressureBar: 220,
        sourceEndPressureBar: 210,
        receiverStartPressureBar: 130,
        receiverEndPressureBar: 140
      }
    ],
    cylinder: { initialPressureBar: 100, volumeL: 12 },
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
        oxygenBoostBpm: 100,
        otherBoostBpm: 1,
        oxygenDecantRateBarPerMin: 9,
        otherDecantRateBarPerMin: 3,
        compressorInletFlowLPerMin: 100
      }
    }
  });

  assert.equal(simulation.protocolSteps[0].thermal.rateSource, 'booster');
  assert.ok(
    simulation.protocolSteps[0].thermal.rateBarPerMin
      > simulation.protocolSteps[2].thermal.rateBarPerMin * 50
  );
  assert.equal(simulation.protocolSteps[1].thermal.rateBarPerMin, 9);
  assert.equal(simulation.protocolSteps[3].thermal.rateBarPerMin, 3);
});

test('draining uses the configured rate and cools the tank as pressure falls', () => {
  const simulation = simulateThermalProtocol({
    protocolSteps: [{
      type: 'drain',
      operation: 'Drain / Vent',
      resultingPressureBar: 50,
      resultingMix: { oxygenPercent: 21, heliumPercent: 0 },
      receiverStartPressureBar: 100,
      receiverEndPressureBar: 50
    }],
    cylinder: { initialPressureBar: 100, volumeL: 12 },
    physics: { model: 'ideal', temperatureC: 40 },
    thermal: {
      tankMaterial: 'steel',
      coolingMedium: 'air',
      ambientTemperatureC: 20,
      inletTemperatureC: 20,
      waitMode: 'minutes',
      waitMinutes: 0,
      targetTemperatureC: 25
    },
    settings: {
      booster: {
        drainingRateBarPerMin: 10
      }
    }
  });

  const thermal = simulation.protocolSteps[0].thermal;
  assert.equal(thermal.rateSource, 'draining-rate');
  assert.equal(thermal.rateBarPerMin, 10);
  assert.equal(thermal.durationMinutes, 5);
  assert.ok(thermal.temperatureAtTransferEndC < thermal.temperatureStartC);
});
test('preserving the original gas does not consume a fixed wait', () => {
  const simulation = simulateThermalProtocol({
    protocolSteps: [
      {
        type: 'keep',
        operation: 'Preserve',
        resultingPressureBar: 100,
        resultingMix: { oxygenPercent: 21, heliumPercent: 0 },
        receiverStartPressureBar: 100,
        receiverEndPressureBar: 100
      },
      {
        type: 'decant',
        operation: 'Decant',
        resultingPressureBar: 110,
        resultingMix: { oxygenPercent: 21, heliumPercent: 0 },
        receiverStartPressureBar: 100,
        receiverEndPressureBar: 110,
        sourceOxygenPercent: 21,
        sourceHeliumPercent: 0,
        sourceStartPressureBar: 200,
        sourceEndPressureBar: 190
      }
    ],
    cylinder: { initialPressureBar: 100, volumeL: 12 },
    physics: { model: 'ideal', temperatureC: 40 },
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
        otherDecantRateBarPerMin: 5
      }
    }
  });

  assert.equal(simulation.protocolSteps[0].thermal.waitMinutes, 0);
  assert.equal(simulation.protocolSteps[0].thermal.temperatureAfterWaitC, 40);
});

test('zero-change stages have no transfer rate', () => {
  const simulation = simulateThermalProtocol({
    protocolSteps: [{
      type: 'boost',
      operation: 'Boost',
      resultingPressureBar: 100,
      resultingMix: { oxygenPercent: 21, heliumPercent: 0 },
      sourceStartPressureBar: 200,
      sourceEndPressureBar: 200,
      receiverStartPressureBar: 100,
      receiverEndPressureBar: 100
    }],
    cylinder: { initialPressureBar: 100, volumeL: 12 },
    physics: { model: 'ideal', temperatureC: 20 },
    thermal: {
      tankMaterial: 'steel',
      coolingMedium: 'air',
      ambientTemperatureC: 20,
      waitMode: 'minutes',
      waitMinutes: 0,
      targetTemperatureC: 25
    }
  });

  assert.equal(simulation.protocolSteps[0].thermal.rateSource, 'none');
  assert.equal(simulation.protocolSteps[0].thermal.rateBarPerMin, null);
  assert.equal(simulation.protocolSteps[0].thermal.durationMinutes, 0);
});

test('an empty protocol cools the initial tank state to ambient', () => {
  const simulation = simulateThermalProtocol({
    protocolSteps: [],
    cylinder: {
      initialPressureBar: 200,
      initialOxygenPercent: 21,
      initialHeliumPercent: 0,
      volumeL: 12
    },
    physics: { model: 'ideal', temperatureC: 60 },
    thermal: {
      tankMaterial: 'steel',
      coolingMedium: 'air',
      ambientTemperatureC: 20,
      waitMode: 'minutes',
      waitMinutes: 10,
      targetTemperatureC: 25
    }
  });

  assert.equal(simulation.protocolSteps.length, 0);
  assert.equal(simulation.final.finalTransferEndPressureBar, 200);
  assert.equal(simulation.final.finalTransferEndTemperatureC, 60);
  assert.equal(simulation.final.finalAmbientTemperatureC, 20);
  assert.ok(Math.abs(simulation.final.finalAmbientPressureBar - 175.989) < 0.01);
});

test('projects final gauge pressure across the requested water temperatures', () => {
  const projections = projectPressureAtTemperatures({
    pressureBar: 200,
    oxygenPercent: 18,
    heliumPercent: 45,
    fromTemperatureC: 20,
    temperaturesC: [6, 8, 10, 12, 20, 22, 24],
    volumeL: 12,
    useVdw: false
  });

  assert.deepEqual(
    projections.map(({ temperatureC }) => temperatureC),
    [6, 8, 10, 12, 20, 22, 24]
  );
  assert.ok(Math.abs(projections[4].pressureBar - 200) < 1e-9);
  assert.ok(projections[0].pressureBar < projections[4].pressureBar);
  assert.ok(projections[6].pressureBar > projections[4].pressureBar);
});
