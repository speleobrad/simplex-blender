import test from 'node:test';
import assert from 'node:assert/strict';
import { optimizeBlend, isSafeSimulation, scheduleSafeThermalProtocol, solveThermalWithSalvageFallback } from '../js/optimizer.js';
import * as optimizerModule from '../js/optimizer.js';
import { calcMolarDensity } from '../js/physics.js';
import { calculatePressureAtTemperature } from '../js/thermodynamics.js';
import { DEFAULT_BANKS } from '../js/bank-storage.js';
import { DEFAULT_SETTINGS } from '../js/settings.js';

const defaultInput = {
  cylinder: {
    volumeL: 12,
    initialPressureBar: 80,
    initialOxygenPercent: 21,
    initialHeliumPercent: 35,
    targetPressureBar: 210,
    targetOxygenPercent: 18,
    targetHeliumPercent: 45
  },
  physics: { model: 'vdw', temperatureC: 20 },
  banks: [
    { id: 'bank-he', name: 'Pure Helium', volumeL: 50, pressureBar: 200, maxPressureBar: 350, minimumPressureBar: 15, oxygenPercent: 0, heliumPercent: 100, enabled: true },
    { id: 'bank-1845', name: 'Tx 18/45 Bank', volumeL: 50, pressureBar: 200, maxPressureBar: 350, minimumPressureBar: 20, oxygenPercent: 18, heliumPercent: 45, enabled: true },
    { id: 'bank-o2', name: 'Pure Oxygen', volumeL: 40, pressureBar: 180, maxPressureBar: 350, minimumPressureBar: 10, oxygenPercent: 100, heliumPercent: 0, enabled: true }
  ],
  settings: {
    booster: {
      maxCompressorPressureBar: 350,
      maxBoosterOutputPressureBar: 350
    }
  }
};

test('default example keeps the cylinder gas when the safety ceiling is active', () => {
  const result = optimizeBlend({
    cylinder: {
      volumeL: 12,
      initialPressureBar: 80,
      initialOxygenPercent: 21,
      initialHeliumPercent: 35,
      targetPressureBar: 210,
      targetOxygenPercent: 18,
      targetHeliumPercent: 45
    },
    physics: { model: DEFAULT_SETTINGS.physics.model, temperatureC: 20 },
    banks: DEFAULT_BANKS.map(bank => ({ ...bank })),
    settings: DEFAULT_SETTINGS
  });

  assert.equal(result.feasible, true);
  assert.ok(result.solution.x_cyl > result.gas.initialMoles * 0.99);
  assert.ok(Math.abs(result.blend.retainedPressureBar - 80) < 0.1);
  assert.ok(Math.abs(result.blend.ventedPressureBar) < 0.1);
  assert.ok(result.blend.heliumSalvagedLitres > 300);
  assert.equal(result.protocolSteps[0].type, 'keep');
});

test('safety fallback preserves working gas and uses available premixes before pure helium', () => {
  const result = optimizeBlend({
    cylinder: {
      volumeL: 12,
      initialPressureBar: 80,
      initialOxygenPercent: 21,
      initialHeliumPercent: 35,
      targetPressureBar: 210,
      targetOxygenPercent: 18,
      targetHeliumPercent: 45
    },
    physics: { model: 'vdw', temperatureC: 20 },
    banks: [
      { id: 'he', name: 'Pure Helium', volumeL: 50, pressureBar: 200, maxPressureBar: 350, minimumPressureBar: 15, oxygenPercent: 0, heliumPercent: 100, enabled: true },
      { id: 'o2', name: 'Pure Oxygen', volumeL: 40, pressureBar: 180, maxPressureBar: 350, minimumPressureBar: 10, oxygenPercent: 100, heliumPercent: 0, enabled: true },
      { id: '1845', name: '18/45', volumeL: 18, pressureBar: 200, maxPressureBar: 350, minimumPressureBar: 20, oxygenPercent: 18, heliumPercent: 45, enabled: true },
      { id: '770', name: '7/70', volumeL: 50, pressureBar: 200, maxPressureBar: 350, minimumPressureBar: 20, oxygenPercent: 7, heliumPercent: 70, enabled: true }
    ],
    settings: {
      booster: {
        maxCompressorPressureBar: 232,
        maxBoosterOutputPressureBar: 200
      }
    }
  });

  assert.equal(result.feasible, true);
  assert.ok(result.solution.x_cyl > 0);
  assert.ok(
    result.solution['x_b3_18/45'] > 0
      || result.solution['x_b4_7/70'] > 0
  );
  assert.equal(result.solution.x_b1_Pure, 0);
});

function equalGasTransferInput({ initialPressureBar, targetPressureBar, bankPressureBar }) {
  return {
    cylinder: {
      volumeL: 10,
      initialPressureBar,
      initialOxygenPercent: 0,
      initialHeliumPercent: 0,
      targetPressureBar,
      targetOxygenPercent: 0,
      targetHeliumPercent: 0
    },
    physics: { model: 'ideal', temperatureC: 20 },
    banks: [{
      id: 'nitrogen',
      name: 'Nitrogen source',
      volumeL: 10,
      pressureBar: bankPressureBar,
      minimumPressureBar: 0,
      maxPressureBar: 350,
      oxygenPercent: 0,
      heliumPercent: 0,
      enabled: true
    }]
  };
}
test('uses implicit unlimited Air without an Air bank', () => {
  const result = optimizeBlend({
    cylinder: {
      volumeL: 12,
      initialPressureBar: 0,
      initialOxygenPercent: 0,
      initialHeliumPercent: 0,
      targetPressureBar: 180,
      targetOxygenPercent: 21,
      targetHeliumPercent: 0
    },
    physics: { model: 'ideal', temperatureC: 20 },
    banks: [],
    settings: {
      booster: {
        maxCompressorPressureBar: 232,
        maxBoosterOutputPressureBar: 200
      }
    }
  });

  assert.equal(result.feasible, true);
  assert.equal(result.protocolSteps.at(-1).operation, 'Top-up');
  assert.equal(result.protocolSteps.at(-1).minimumSourcePressureBar, null);
  assert.equal(result.protocolSteps.at(-1).sourceExhausted, false);
});

test('rejects finite Air banks in favor of the implicit compressor source', () => {
  const result = optimizeBlend({
    cylinder: {
      volumeL: 12,
      initialPressureBar: 0,
      initialOxygenPercent: 0,
      initialHeliumPercent: 0,
      targetPressureBar: 180,
      targetOxygenPercent: 21,
      targetHeliumPercent: 0
    },
    physics: { model: 'ideal', temperatureC: 20 },
    banks: [{
      id: 'air-bank',
      name: 'Air bank',
      volumeL: 10,
      pressureBar: 200,
      maxPressureBar: 350,
      oxygenPercent: 21,
      heliumPercent: 0,
      enabled: true
    }]
  });

  assert.equal(result.feasible, false);
  assert.match(result.error, /Air.*compressor|compressor.*Air/i);
});

test('compressor Air cannot top up above its configured ceiling', () => {
  const result = optimizeBlend({
    cylinder: {
      volumeL: 12,
      initialPressureBar: 0,
      initialOxygenPercent: 0,
      initialHeliumPercent: 0,
      targetPressureBar: 250,
      targetOxygenPercent: 21,
      targetHeliumPercent: 0
    },
    physics: { model: 'ideal', temperatureC: 20 },
    banks: [],
    settings: {
      booster: {
        maxCompressorPressureBar: 232,
        maxBoosterOutputPressureBar: 200
      }
    }
  });

  assert.equal(result.feasible, false);
  assert.ok(result.maximumPressure.pressureBar <= 232 + 1e-9);
});

test('non-Air boost cannot end above the booster output ceiling', () => {
  const result = optimizeBlend({
    cylinder: {
      volumeL: 12,
      initialPressureBar: 0,
      initialOxygenPercent: 0,
      initialHeliumPercent: 0,
      targetPressureBar: 250,
      targetOxygenPercent: 0,
      targetHeliumPercent: 100
    },
    physics: { model: 'ideal', temperatureC: 20 },
    banks: [{
      id: 'he',
      name: 'Helium',
      volumeL: 50,
      pressureBar: 150,
      maxPressureBar: 350,
      oxygenPercent: 0,
      heliumPercent: 100,
      enabled: true
    }],
    settings: {
      booster: {
        maxCompressorPressureBar: 232,
        maxBoosterOutputPressureBar: 200
      }
    }
  });

  assert.equal(result.feasible, false);
  assert.ok(result.maximumPressure.pressureBar <= 200 + 1e-9);
});

test('non-Air decant can exceed the booster output ceiling', () => {
  const result = optimizeBlend({
    cylinder: {
      volumeL: 12,
      initialPressureBar: 0,
      initialOxygenPercent: 0,
      initialHeliumPercent: 0,
      targetPressureBar: 250,
      targetOxygenPercent: 0,
      targetHeliumPercent: 100
    },
    physics: { model: 'ideal', temperatureC: 20 },
    banks: [{
      id: 'he',
      name: 'Helium',
      volumeL: 100,
      pressureBar: 300,
      maxPressureBar: 350,
      oxygenPercent: 0,
      heliumPercent: 100,
      enabled: true
    }],
    settings: {
      booster: {
        maxCompressorPressureBar: 232,
        maxBoosterOutputPressureBar: 200
      }
    }
  });

  assert.equal(result.feasible, true);
  assert.ok(result.protocolSteps.some(step => step.operation === 'Decant' && step.resultingPressureBar > 200));
});

test('uses one booster minimum source pressure for every supply bank', () => {
  const result = optimizeBlend({
    cylinder: {
      volumeL: 10,
      initialPressureBar: 0,
      initialOxygenPercent: 0,
      initialHeliumPercent: 0,
      targetPressureBar: 100,
      targetOxygenPercent: 0,
      targetHeliumPercent: 100
    },
    physics: { model: 'ideal', temperatureC: 20 },
    settings: { booster: { minimumSourcePressureBar: 50 } },
    banks: [{
      id: 'helium',
      name: 'Helium',
      volumeL: 10,
      pressureBar: 100,
      maxPressureBar: 350,
      oxygenPercent: 0,
      heliumPercent: 100,
      enabled: true
    }]
  });

  assert.equal(result.feasible, false);
  assert.ok(Math.abs(result.maximumPressure.pressureBar - 50) < 1e-9);
});

test('formats equalising and top-up protocol stages with source leftovers and interim mix', () => {
  const result = optimizeBlend({
    cylinder: {
      volumeL: 10,
      initialPressureBar: 100,
      initialOxygenPercent: 21,
      initialHeliumPercent: 0,
      targetPressureBar: 140,
      targetOxygenPercent: 20.8,
      targetHeliumPercent: 0
    },
    physics: { model: 'ideal', temperatureC: 20 },
    settings: { booster: { minimumSourcePressureBar: 0 } },
    banks: [{
      id: 'mix',
      name: 'Nitrox source',
      volumeL: 10,
      pressureBar: 120,
      maxPressureBar: 350,
      minimumPressureBar: 0,
      oxygenPercent: 20,
      heliumPercent: 0,
      enabled: true
    }]
  });

  assert.equal(result.feasible, true);
  const step = result.protocolSteps.find(item => item.title.startsWith('Step 1:'));
  assert.match(step.title, /^Step 1: Equalize Nitrox source to \d+\.\d bar$/);
  assert.match(step.description, /^Equalize \d+\.\d bar from Nitrox source to \d+\.\d bar\. This will leave \d+\.\d bar of Nitrox source\. Interim mix is \d+\.\d\/\d+\.\d\./);
  const topUp = result.protocolSteps.at(-1);
  assert.match(topUp.title, /^Step \d+: Top-up Compressor Air to \d+\.\d bar$/);
});

test('counts helium from non-pure supply gas as salvaged helium', () => {
  const result = optimizeBlend({
    cylinder: {
      volumeL: 10,
      initialPressureBar: 0,
      initialOxygenPercent: 0,
      initialHeliumPercent: 0,
      targetPressureBar: 100,
      targetOxygenPercent: 0,
      targetHeliumPercent: 50
    },
    physics: { model: 'ideal', temperatureC: 20 },
    settings: { booster: { minimumSourcePressureBar: 0 } },
    banks: [{
      id: 'helium-mix',
      name: 'Helium mix',
      volumeL: 10,
      pressureBar: 200,
      maxPressureBar: 350,
      oxygenPercent: 0,
      heliumPercent: 50,
      enabled: true
    }]
  });

  assert.equal(result.feasible, true);
  assert.ok(Math.abs(result.blend.heliumSalvagedLitres - 500) < 1e-9);
});

test('reports vented helium as the helium share of the drained original mix', () => {
  const base = {
    physics: { model: 'ideal', temperatureC: 20 },
    settings: { booster: { minimumSourcePressureBar: 0 } },
    banks: []
  };
  const drained = optimizeBlend({
    ...base,
    cylinder: {
      volumeL: 10,
      initialPressureBar: 100,
      initialOxygenPercent: 21,
      initialHeliumPercent: 30,
      targetPressureBar: 60,
      targetOxygenPercent: 21,
      targetHeliumPercent: 30
    }
  });
  assert.equal(drained.feasible, true);
  assert.ok(Math.abs(drained.blend.ventedGasLitres - 400) < 1e-6);
  assert.ok(Math.abs(drained.blend.heliumVentedLitres - 120) < 1e-6);

  const kept = optimizeBlend({
    ...base,
    cylinder: { volumeL: 10, initialPressureBar: 100, initialOxygenPercent: 21, initialHeliumPercent: 30, targetPressureBar: 100, targetOxygenPercent: 21, targetHeliumPercent: 30 }
  });
  assert.equal(kept.feasible, true);
  assert.ok(kept.blend.heliumVentedLitres < 1e-6);
});

test('splits a transfer into decant and boost stages when source pressure crosses receiver pressure', () => {
  const result = optimizeBlend(equalGasTransferInput({
    initialPressureBar: 100,
    targetPressureBar: 140,
    bankPressureBar: 120
  }));

  assert.equal(result.feasible, true);
  const transferSteps = result.protocolSteps.slice(1);
  assert.deepEqual(transferSteps.map(step => step.type), ['decant', 'boost']);
  assert.deepEqual(transferSteps.map(step => step.title), [
    'Step 1: Equalize Nitrogen source to 110.0 bar',
    'Step 2: Boost Nitrogen source to 140.0 bar'
  ]);
  assert.ok(Math.abs(transferSteps[0].resultingPressureBar - 110) < 1e-9);
  assert.ok(Math.abs(transferSteps[1].resultingPressureBar - 140) < 1e-9);
  assert.ok(Math.abs(transferSteps[0].sourceStartPressureBar - 120) < 1e-9);
  assert.ok(Math.abs(transferSteps[0].sourceEndPressureBar - 110) < 1e-9);
  assert.ok(Math.abs(transferSteps[1].sourceStartPressureBar - 110) < 1e-9);
  assert.ok(Math.abs(transferSteps[1].sourceEndPressureBar - 80) < 1e-9);
  assert.doesNotMatch(
    transferSteps.map(step => step.description).join(' '),
    /Decompressively|mol|\(21\/0\)/
  );
});

test('uses one compressor top-up stage without a finite Air bank in thermal mode', () => {
  const result = optimizeBlend({
    cylinder: {
      volumeL: 10,
      initialPressureBar: 100,
      initialOxygenPercent: 21,
      initialHeliumPercent: 0,
      targetPressureBar: 140,
      targetOxygenPercent: 21,
      targetHeliumPercent: 0
    },
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
        minimumSourcePressureBar: 0,
        cylinderVolumeCm3: 9,
        oxygenBoostBpm: 50,
        otherBoostBpm: 50,
        oxygenDecantRateBarPerMin: 5,
        otherDecantRateBarPerMin: 5,
        compressorInletFlowLPerMin: 100
      }
    },
    banks: []
  });

  assert.equal(result.feasible, true);
  const topUps = result.protocolSteps.filter(step => step.operation === 'Top-up');
  assert.equal(topUps.length, 1);
  assert.equal(topUps[0].type, 'boost');
  assert.equal(topUps[0].thermal.rateSource, 'compressor');
});

test('uses boost when source pressure is lower than receiver pressure for the whole transfer', () => {
  const result = optimizeBlend(equalGasTransferInput({
    initialPressureBar: 100,
    targetPressureBar: 130,
    bankPressureBar: 80
  }));

  assert.equal(result.feasible, true);
  const transferSteps = result.protocolSteps.slice(1);
  assert.equal(transferSteps.length, 1);
  assert.equal(transferSteps[0].type, 'boost');
  assert.equal(transferSteps[0].operation, 'Boost');
});

test('uses decant when source pressure is not lower than receiver pressure for the whole transfer', () => {
  const result = optimizeBlend(equalGasTransferInput({
    initialPressureBar: 100,
    targetPressureBar: 110,
    bankPressureBar: 140
  }));

  assert.equal(result.feasible, true);
  const transferSteps = result.protocolSteps.slice(1);
  assert.equal(transferSteps.length, 1);
  assert.equal(transferSteps[0].type, 'decant');
  assert.equal(transferSteps[0].operation, 'Decant');
});

test('uses decant when source and receiver start at equal pressure', () => {
  const result = optimizeBlend(equalGasTransferInput({
    initialPressureBar: 100,
    targetPressureBar: 120,
    bankPressureBar: 100
  }));

  assert.equal(result.feasible, true);
  const transferSteps = result.protocolSteps.slice(1);
  assert.equal(transferSteps.length, 1);
  assert.equal(transferSteps[0].type, 'decant');
});

test('rejects a target-mix mismatch below the old absolute phase-I tolerance', () => {
  const result = optimizeBlend({
    cylinder: {
      volumeL: 0.1,
      initialPressureBar: 10,
      initialOxygenPercent: 21,
      initialHeliumPercent: 0,
      targetPressureBar: 10,
      targetOxygenPercent: 23,
      targetHeliumPercent: 0
    },
    physics: { model: 'ideal', temperatureC: 20 },
    banks: []
  });

  assert.equal(result.feasible, false);
  assert.equal(result.blend, null);
  assert.equal(result.maximumPressure, null);
});

test('protocol drains any gas required to reach a lower target pressure', () => {
  const result = optimizeBlend({
    cylinder: {
      volumeL: 12,
      initialPressureBar: 10.4,
      initialOxygenPercent: 21,
      initialHeliumPercent: 0,
      targetPressureBar: 10,
      targetOxygenPercent: 21,
      targetHeliumPercent: 0
    },
    physics: { model: 'ideal', temperatureC: 20 },
    banks: []
  });

  assert.equal(result.feasible, true);
  assert.equal(result.protocolSteps[0].type, 'drain');
  assert.ok(Math.abs(result.blend.ventedPressureBar - 0.4) < 1e-9);
  assert.ok(Math.abs(result.protocolSteps.at(-1).resultingPressureBar - result.blend.finalPressureBar) < 1e-9);
  assert.match(result.protocolSteps[0].description, /from 10\.40 bar down to 10\.00 bar/);
});
test('drain steps retain receiver composition for a following transfer in both gas models', () => {
  for (const model of ['ideal', 'vdw']) {
    const result = optimizeBlend({
      cylinder: {
        volumeL: 12,
        initialPressureBar: 100,
        initialOxygenPercent: 0,
        initialHeliumPercent: 0,
        targetPressureBar: 150,
        targetOxygenPercent: 21,
        targetHeliumPercent: 0,
        workingPressureBar: 250
      },
      physics: { model, temperatureC: 20 },
      thermal: {
        tankMaterial: 'steel',
        coolingMedium: 'air',
        ambientTemperatureC: 20,
        inletTemperatureC: 20,
        targetMediumTemperatureC: 20,
        targetInWaterTemperatureC: 20,
        waitMode: 'minutes',
        waitMinutes: 0
      },
      settings: { booster: { compressorInletFlowLPerMin: 100 } },
      banks: []
    });

    assert.equal(result.feasible, true, model);
    const drain = result.protocolSteps.find(step => step.type === 'drain');
    const transfer = result.protocolSteps.find(step => step.type !== 'drain' && step.type !== 'keep');
    assert.ok(drain, model);
    assert.ok(transfer, model);
    assert.deepEqual(drain.resultingMix, { oxygenPercent: 0, heliumPercent: 0 });
    assert.equal(transfer.thermal.receiverStartMix.oxygenPercent, 0);
    assert.equal(transfer.thermal.receiverStartMix.heliumPercent, 0);
  }
});

test('shows tiny required drains with a nonzero pressure change', () => {
  const result = optimizeBlend({
    cylinder: {
      volumeL: 12,
      initialPressureBar: 10,
      initialOxygenPercent: 21,
      initialHeliumPercent: 0,
      targetPressureBar: 10,
      targetOxygenPercent: 21.01,
      targetHeliumPercent: 0
    },
    physics: { model: 'ideal', temperatureC: 20 },
    banks: [{
      id: 'oxygen',
      name: 'Pure Oxygen',
      volumeL: 10,
      pressureBar: 100,
      maxPressureBar: 350,
      minimumPressureBar: 0,
      oxygenPercent: 100,
      heliumPercent: 0,
      enabled: true
    }]
  });

  assert.equal(result.feasible, true);
  const pressureChange = result.protocolSteps[0].description.match(
    /from ([\d.]+) bar down to ([\d.]+) bar \(-([\d.]+) bar vented\)/
  );
  assert.ok(pressureChange);
  assert.notEqual(pressureChange[1], pressureChange[2]);
  assert.ok(Number(pressureChange[3]) > 0);
});

test('emits a drain for a representable pressure reduction below the old mole cutoff', () => {
  const result = optimizeBlend({
    cylinder: {
      volumeL: 0.1,
      initialPressureBar: 10.0000002,
      initialOxygenPercent: 21,
      initialHeliumPercent: 0,
      targetPressureBar: 10,
      targetOxygenPercent: 21,
      targetHeliumPercent: 0
    },
    physics: { model: 'ideal', temperatureC: 40 },
    banks: []
  });

  assert.equal(result.feasible, true);
  assert.ok(result.blend.ventedMoles > 0 && result.blend.ventedMoles < 1e-9);
  assert.match(result.protocolSteps[0].description, /Retains 100% of the original mix\./);
  assert.doesNotMatch(result.protocolSteps[0].description, /mol/);
  assert.equal(result.protocolSteps[0].type, 'drain');
  const pressureChange = result.protocolSteps[0].description.match(
    /from ([\d.]+) bar down to ([\d.]+) bar \(-([\d.]+) bar vented\)/
  );
  assert.ok(pressureChange);
  assert.notEqual(pressureChange[1], pressureChange[2]);
  assert.ok(Number(pressureChange[3]) > 0);
});

test('orders recipe transfer stages by descending oxygen content', () => {
  const result = optimizeBlend(defaultInput);

  assert.equal(result.feasible, true);
  assert.ok(Math.abs(result.gas.initialMoles - 38.4) < 0.1);
  assert.ok(Math.abs(result.gas.targetMoles - 90.8) < 0.1);
  assert.ok(Math.abs(result.blend.retainedPressureBar - 80) < 0.1);
  assert.ok(Math.abs(result.blend.ventedPressureBar) < 0.1);
  assert.ok(Math.abs(result.blend.finalPressureBar - 210) < 0.1);
  assert.deepEqual(result.protocolSteps.map(step => step.title), [
    'Preserve 100% of Cylinder Gas',
    'Step 1: Decant Pure Oxygen to 80.3 bar',
    'Step 2: Equalize Tx 18/45 Bank to 174.6 bar',
    'Step 3: Boost Tx 18/45 Bank to 188.4 bar',
    'Step 4: Equalize Pure Helium to 197.8 bar',
    'Step 5: Boost Pure Helium to 210.0 bar'
  ]);
  assert.equal(result.trajectory.length, 6);
});
test('protocol steps record the pressure and mix at the end of each stage', () => {
  const result = optimizeBlend(defaultInput);
  const expectedStages = [
    { pressureBar: 80, oxygenPercent: 21, heliumPercent: 35 },
    { pressureBar: 80.3, oxygenPercent: 21.3, heliumPercent: 34.9 },
    { pressureBar: 174.6, oxygenPercent: 19.6, heliumPercent: 40.0 },
    { pressureBar: 188.4, oxygenPercent: 19.5, heliumPercent: 40.3 },
    { pressureBar: 197.8, oxygenPercent: 18.8, heliumPercent: 42.5 },
    { pressureBar: 210, oxygenPercent: 18, heliumPercent: 45 }
  ];

  assert.equal(result.protocolSteps.length, expectedStages.length);
  result.protocolSteps.forEach((step, index) => {
    const expected = expectedStages[index];
    assert.ok(Math.abs(step.resultingPressureBar - expected.pressureBar) < 0.5);
    assert.ok(step.resultingMix, `${step.title} must include its end-of-stage mix`);
    assert.ok(Math.abs(step.resultingMix.oxygenPercent - expected.oxygenPercent) < 0.1);
    assert.ok(Math.abs(step.resultingMix.heliumPercent - expected.heliumPercent) < 0.1);
  });
});
test('trajectory records source-bank pressure ranges for each transfer stage', () => {
  const result = optimizeBlend(defaultInput);
  const banksById = new Map(defaultInput.banks.map(bank => [bank.id, bank]));
  const transferPoints = result.trajectory.filter(point => point.bankId);

  assert.equal(transferPoints.length, 5);
  for (const [index, point] of transferPoints.entries()) {
    const bank = banksById.get(point.bankId);
    assert.ok(Number.isFinite(point.sourceStartPressureBar));
    assert.ok(Number.isFinite(point.sourceEndPressureBar));
    assert.ok(point.sourceEndPressureBar < point.sourceStartPressureBar);
    if (index === 0 || transferPoints[index - 1].bankId !== point.bankId) {
      assert.ok(Math.abs(point.sourceStartPressureBar - bank.pressureBar) < 1e-9);
    } else {
      assert.ok(Math.abs(point.sourceStartPressureBar - transferPoints[index - 1].sourceEndPressureBar) < 1e-9);
    }
  }
});


test('nitrox preset vents the surplus and keeps the cylinder retained gas', () => {
  const input = {
    ...defaultInput,
    cylinder: {
      ...defaultInput.cylinder,
      initialPressureBar: 100,
      initialOxygenPercent: 32,
      initialHeliumPercent: 0,
      targetPressureBar: 220,
      targetOxygenPercent: 21,
      targetHeliumPercent: 30
    }
  };
  const result = optimizeBlend(input);
  const baseline = optimizeBlend({ ...input, _salvage: false });

  // Salvage into bank-1845 (the recipe's own draw source) would move 34.4 mol but cut the
  // retained cylinder gas (11.60 mol vs 17.77 mol), so the retention gate keeps vent-only.
  assert.equal(result.feasible, true);
  assert.equal(result.salvageTransfers, undefined);
  assert.ok(Math.abs(result.blend.ventedGasLitres - 838.377979816809) < 1e-8);
  assert.ok(result.solution.x_cyl >= baseline.solution.x_cyl * (1 - 1e-9));
});

test('vent-only mode keeps 838.38 L vented for the nitrox preset', () => {
  const input = {
    ...defaultInput,
    cylinder: {
      ...defaultInput.cylinder,
      initialPressureBar: 100,
      initialOxygenPercent: 32,
      initialHeliumPercent: 0,
      targetPressureBar: 220,
      targetOxygenPercent: 21,
      targetHeliumPercent: 30
    }
  };
  const result = optimizeBlend({ ...input, _salvage: false });

  assert.equal(result.feasible, true);
  assert.equal(result.salvageTransfers, undefined);
  assert.ok(Math.abs(result.blend.ventedGasLitres - 838.377979816809) < 1e-8);
});

test('reports the maximum achievable pressure at the compressor ceiling', () => {
  const result = optimizeBlend({
    cylinder: {
      volumeL: 10,
      initialPressureBar: 50,
      initialOxygenPercent: 21,
      initialHeliumPercent: 0,
      targetPressureBar: 200,
      targetOxygenPercent: 21,
      targetHeliumPercent: 0
    },
    physics: { model: 'ideal', temperatureC: 20 },
    banks: [],
    settings: {
      booster: {
        maxCompressorPressureBar: 150,
        maxBoosterOutputPressureBar: 200
      }
    }
  });

  assert.equal(result.feasible, false);
  assert.ok(result.maximumPressure);
  assert.ok(Math.abs(result.maximumPressure.pressureBar - 150) < 1e-6);
  assert.equal(result.maximumPressure.blend.finalPressureBar, result.maximumPressure.pressureBar);
  assert.equal(result.maximumPressure.blend.finalOxygenPercent, 21);
  assert.equal(result.maximumPressure.blend.finalHeliumPercent, 0);
  assert.deepEqual(result.maximumPressure.protocolSteps.map(step => step.title), [
    'Preserve 100% of Cylinder Gas',
    'Step 1: Top-up Compressor Air to 150.0 bar'
  ]);
});
test('converts compressor-ceiling fallback with the selected real-gas model', () => {
  const result = optimizeBlend({
    cylinder: {
      volumeL: 10,
      initialPressureBar: 50,
      initialOxygenPercent: 21,
      initialHeliumPercent: 0,
      targetPressureBar: 200,
      targetOxygenPercent: 21,
      targetHeliumPercent: 0
    },
    physics: { model: 'vdw', temperatureC: 20 },
    banks: [],
    settings: {
      booster: {
        maxCompressorPressureBar: 150,
        maxBoosterOutputPressureBar: 200
      }
    }
  });

  assert.equal(result.feasible, false);
  assert.ok(Math.abs(result.maximumPressure.pressureBar - 150) < 1e-6);
  assert.ok(
    Math.abs(
      result.maximumPressure.protocolSteps.at(-1).resultingPressureBar
        - result.maximumPressure.pressureBar
    ) < 1e-6
  );
});

test('reports helium shortage as required source-bank pressure and names the depleted bank', () => {
  const result = optimizeBlend({
    cylinder: {
      volumeL: 10,
      initialPressureBar: 80,
      initialOxygenPercent: 21,
      initialHeliumPercent: 0,
      targetPressureBar: 200,
      targetOxygenPercent: 15,
      targetHeliumPercent: 55
    },
    physics: { model: 'ideal', temperatureC: 20 },
    banks: [
      { id: 'he', name: 'Pure Helium', volumeL: 1, pressureBar: 10, maxPressureBar: 350, minimumPressureBar: 0, oxygenPercent: 0, heliumPercent: 100, enabled: true },
      { id: 'o2', name: 'Pure Oxygen', volumeL: 10, pressureBar: 100, maxPressureBar: 350, minimumPressureBar: 0, oxygenPercent: 100, heliumPercent: 0, enabled: true },
    ]
  });

  assert.equal(result.feasible, false);
  assert.equal(result.reasonCode, 'insufficient-source-gas');
  assert.ok(result.maximumPressure);
  const helium = result.diagnostics.componentShortfalls.find(item => item.component === 'Helium');
  assert.ok(helium);
  assert.ok(helium.requiredMoles > 40);
  assert.ok(helium.availableMoles < 1);
  assert.ok(helium.deficitMoles > 39);
  const exhaustedHelium = result.diagnostics.exhaustedBanks.find(bank => bank.name === 'Pure Helium');
  assert.ok(exhaustedHelium);
  assert.equal(exhaustedHelium.currentPressureBar, 10);
  assert.equal(exhaustedHelium.minimumSourcePressureBar, 0);
  assert.equal(helium.sourceBank.name, 'Pure Helium');
  assert.equal(helium.sourceBank.volumeL, 1);
  assert.equal(helium.sourceBank.currentPressureBar, 10);
  assert.equal(helium.sourceBank.minimumSourcePressureBar, 0);
  assert.ok(Math.abs(helium.sourceBank.requiredPressureBar - 1100) < 1e-6);
  assert.ok(Math.abs(helium.sourceBank.pressureIncreaseBar - 1090) < 1e-6);
});

test('converts required source-bank pressure with the selected real-gas model', () => {
  const result = optimizeBlend({
    cylinder: {
      volumeL: 10,
      initialPressureBar: 80,
      initialOxygenPercent: 21,
      initialHeliumPercent: 0,
      targetPressureBar: 200,
      targetOxygenPercent: 15,
      targetHeliumPercent: 55
    },
    physics: { model: 'vdw', temperatureC: 20 },
    banks: [
      { id: 'he', name: 'Pure Helium', volumeL: 1, pressureBar: 10, maxPressureBar: 350, minimumPressureBar: 0, oxygenPercent: 0, heliumPercent: 100, enabled: true },
      { id: 'o2', name: 'Pure Oxygen', volumeL: 10, pressureBar: 100, maxPressureBar: 350, minimumPressureBar: 0, oxygenPercent: 100, heliumPercent: 0, enabled: true },
    ]
  });

  const helium = result.diagnostics.componentShortfalls.find(item => item.component === 'Helium');
  assert.ok(helium.sourceBank);
  assert.equal(helium.sourceBank.name, 'Pure Helium');
  assert.equal(helium.sourceBank.volumeL, 1);
  assert.equal(helium.sourceBank.currentPressureBar, 10);
  assert.ok(helium.sourceBank.requiredPressureBar > 10);
  assert.ok(helium.sourceBank.pressureIncreaseBar > 0);
});

test('does not present an out-of-range real-gas source pressure as exact', () => {
  const result = optimizeBlend({
    cylinder: {
      volumeL: 10,
      initialPressureBar: 80,
      initialOxygenPercent: 21,
      initialHeliumPercent: 0,
      targetPressureBar: 350,
      targetOxygenPercent: 15,
      targetHeliumPercent: 55
    },
    physics: { model: 'vdw', temperatureC: 20 },
    banks: [
      { id: 'he', name: 'Pure Helium', volumeL: 1, pressureBar: 10, maxPressureBar: 350, minimumPressureBar: 0, oxygenPercent: 0, heliumPercent: 100, enabled: true },
      { id: 'o2', name: 'Pure Oxygen', volumeL: 10, pressureBar: 100, maxPressureBar: 350, minimumPressureBar: 0, oxygenPercent: 100, heliumPercent: 0, enabled: true },
    ]
  });

  const helium = result.diagnostics.componentShortfalls.find(item => item.component === 'Helium');
  assert.equal(helium.sourceBank.pressureEstimateOutOfRange, true);
  assert.equal(helium.sourceBank.requiredPressureBar, null);
  assert.equal(helium.sourceBank.pressureIncreaseBar, null);
});

test('does not label an unused trace bank as exhausted', () => {
  const result = optimizeBlend({
    cylinder: {
      volumeL: 10,
      initialPressureBar: 0,
      initialOxygenPercent: 0,
      initialHeliumPercent: 0,
      targetPressureBar: 100,
      targetOxygenPercent: 100,
      targetHeliumPercent: 0
    },
    physics: { model: 'ideal', temperatureC: 20 },
    banks: [{
      id: 'he',
      name: 'Trace helium bank',
      volumeL: 1,
      pressureBar: 1,
      maxPressureBar: 350,
      minimumPressureBar: 0,
      oxygenPercent: 0,
      heliumPercent: 100,
      enabled: true
    }]
  });

  assert.equal(result.maximumPressure, null);
  assert.ok(!result.diagnostics.exhaustedBanks.some(bank => bank.name === 'Trace helium bank'));
});

test('converts compressor-ceiling fallback with the selected real-gas model', () => {
  const result = optimizeBlend({
    cylinder: {
      volumeL: 10,
      initialPressureBar: 50,
      initialOxygenPercent: 21,
      initialHeliumPercent: 0,
      targetPressureBar: 200,
      targetOxygenPercent: 21,
      targetHeliumPercent: 0
    },
    physics: { model: 'vdw', temperatureC: 20 },
    banks: [],
    settings: {
      booster: {
        maxCompressorPressureBar: 150,
        maxBoosterOutputPressureBar: 200
      }
    }
  });

  assert.equal(result.feasible, false);
  assert.ok(Math.abs(result.maximumPressure.pressureBar - 150) < 1e-6);
  assert.ok(
    Math.abs(
      result.maximumPressure.protocolSteps.at(-1).resultingPressureBar
        - result.maximumPressure.pressureBar
    ) < 1e-6
  );
});

test('maximum-pressure fallback uses complementary banks to preserve the exact target fractions', () => {
  const result = optimizeBlend({
    cylinder: {
      volumeL: 10,
      initialPressureBar: 0,
      initialOxygenPercent: 0,
      initialHeliumPercent: 0,
      targetPressureBar: 300,
      targetOxygenPercent: 10,
      targetHeliumPercent: 45
    },
    physics: { model: 'ideal', temperatureC: 20 },
    banks: [
      { id: 'he', name: 'Helium bank', volumeL: 10, pressureBar: 100, maxPressureBar: 350, minimumPressureBar: 0, oxygenPercent: 0, heliumPercent: 100, enabled: true },
      { id: 'nitrogen', name: 'Nitrogen bank', volumeL: 10, pressureBar: 100, maxPressureBar: 350, minimumPressureBar: 0, oxygenPercent: 0, heliumPercent: 0, enabled: true }
    ],
    settings: {
      booster: {
        maxCompressorPressureBar: 350,
        maxBoosterOutputPressureBar: 350
      }
    }
  });

  assert.equal(result.feasible, false);
  assert.ok(Math.abs(result.maximumPressure.pressureBar - (2000 / 9)) < 1e-6);
  const finalStep = result.maximumPressure.trajectory.at(-1);
  assert.ok(Math.abs(finalStep.oxygenPercent - 10) < 1e-8);
  assert.ok(Math.abs(finalStep.heliumPercent - 45) < 1e-8);
  assert.ok(Math.abs(finalStep.pressureBar - (2000 / 9)) < 1e-6);
});

test('keeps a sub-0.05-mol bank contribution in the fallback recipe', () => {
  const result = optimizeBlend({
    cylinder: {
      volumeL: 10,
      initialPressureBar: 100,
      initialOxygenPercent: 0,
      initialHeliumPercent: 0,
      targetPressureBar: 300,
      targetOxygenPercent: 0.01,
      targetHeliumPercent: 0
    },
    physics: { model: 'ideal', temperatureC: 20 },
    banks: [{
      id: 'oxygen',
      name: 'Oxygen bank',
      volumeL: 200,
      pressureBar: 100,
      maxPressureBar: 350,
      minimumPressureBar: 0,
      oxygenPercent: 100,
      heliumPercent: 0,
      enabled: true
    }]
  });

  assert.ok(result.maximumPressure);
  const finalStep = result.maximumPressure.trajectory.at(-1);
  assert.ok(finalStep.addedMoles > 0);
  assert.ok(finalStep.addedMoles < 0.05);
  assert.ok(Math.abs(finalStep.oxygenPercent - 0.01) < 1e-8);
  const stepDescription = result.maximumPressure.protocolSteps.at(-1).description;
  assert.match(stepDescription, /bar/);
  assert.doesNotMatch(stepDescription, /Decompressively|mol|\(100\/0\)/);
});

test('uses a larger interchangeable oxygen bank when it keeps the maximum recipe safe', () => {
  const result = optimizeBlend({
    cylinder: {
      volumeL: 10,
      initialPressureBar: 150,
      initialOxygenPercent: 0,
      initialHeliumPercent: 0,
      targetPressureBar: 200,
      targetOxygenPercent: 25,
      targetHeliumPercent: 0
    },
    physics: { model: 'ideal', temperatureC: 20 },
    banks: [
      { id: 'small-oxygen', name: 'Small oxygen bank', volumeL: 10, pressureBar: 80, maxPressureBar: 350, minimumPressureBar: 0, oxygenPercent: 100, heliumPercent: 0, enabled: true },
      { id: 'large-oxygen', name: 'Large oxygen bank', volumeL: 100, pressureBar: 80, maxPressureBar: 350, minimumPressureBar: 0, oxygenPercent: 100, heliumPercent: 0, enabled: true }
    ]
  });

  assert.equal(result.feasible, true);
  assert.equal(result.blend.finalPressureBar, 200);
  assert.ok(result.protocolSteps.some(step => step.title.includes('Large oxygen bank')));
});

test('searches an alternative high-pressure source instead of overstating an unsafe-bank deficit', () => {
  const result = optimizeBlend({
    cylinder: {
      volumeL: 10,
      initialPressureBar: 150,
      initialOxygenPercent: 0,
      initialHeliumPercent: 0,
      targetPressureBar: 250,
      targetOxygenPercent: 25,
      targetHeliumPercent: 0
    },
    physics: { model: 'ideal', temperatureC: 20 },
    banks: [
      { id: 'low-pressure', name: 'Low-pressure large bank', volumeL: 100, pressureBar: 20, maxPressureBar: 350, minimumPressureBar: 0, oxygenPercent: 100, heliumPercent: 0, enabled: true },
      { id: 'high-pressure', name: 'High-pressure small bank', volumeL: 10, pressureBar: 100, maxPressureBar: 350, minimumPressureBar: 0, oxygenPercent: 100, heliumPercent: 0, enabled: true }
    ]
  });

  assert.equal(result.feasible, false);
  assert.ok(Math.abs(result.maximumPressure.pressureBar - 200) < 1e-6);
  assert.ok(result.maximumPressure.protocolSteps.some(step => step.title.includes('High-pressure small bank')));
});

test('splits oxygen transfers when neither full-bank allocation is safe', () => {
  const result = optimizeBlend({
    cylinder: {
      volumeL: 10,
      initialPressureBar: 100,
      initialOxygenPercent: 0,
      initialHeliumPercent: 0,
      targetPressureBar: 200,
      targetOxygenPercent: 50,
      targetHeliumPercent: 0
    },
    physics: { model: 'ideal', temperatureC: 20 },
    banks: [
      { id: 'oxygen-a', name: 'Oxygen A', volumeL: 10, pressureBar: 100, maxPressureBar: 350, minimumPressureBar: 0, oxygenPercent: 100, heliumPercent: 0, enabled: true },
      { id: 'oxygen-b', name: 'Oxygen B', volumeL: 10, pressureBar: 100, maxPressureBar: 350, minimumPressureBar: 0, oxygenPercent: 100, heliumPercent: 0, enabled: true }
    ]
  });

  assert.equal(result.feasible, true);
  assert.equal(result.blend.finalPressureBar, 200);
  assert.ok(result.protocolSteps.some(step => step.title.includes('Oxygen A')));
  assert.ok(result.protocolSteps.some(step => step.title.includes('Oxygen B')));
  assert.ok(Math.abs(result.trajectory.at(-1).oxygenPercent - 50) < 1e-8);
});

test('searches uneven oxygen-bank splits when an equal split fails the 4:1 limit', () => {
  const result = optimizeBlend({
    cylinder: {
      volumeL: 10,
      initialPressureBar: 100,
      initialOxygenPercent: 0,
      initialHeliumPercent: 0,
      targetPressureBar: 200,
      targetOxygenPercent: 50,
      targetHeliumPercent: 0
    },
    physics: { model: 'ideal', temperatureC: 20 },
    banks: [
      { id: 'oxygen-a', name: 'Oxygen A', volumeL: 20, pressureBar: 90, maxPressureBar: 350, minimumPressureBar: 0, oxygenPercent: 100, heliumPercent: 0, enabled: true },
      { id: 'oxygen-b', name: 'Oxygen B', volumeL: 10, pressureBar: 90, maxPressureBar: 350, minimumPressureBar: 0, oxygenPercent: 100, heliumPercent: 0, enabled: true }
    ]
  });

  assert.equal(result.feasible, true);
  assert.equal(result.blend.finalPressureBar, 200);
  assert.ok(result.protocolSteps.some(step => step.title.includes('Oxygen A')));
  assert.ok(result.protocolSteps.some(step => step.title.includes('Oxygen B')));
});

test('finds a narrow safe bank split outside the fixed-share samples', () => {
  const result = optimizeBlend({
    cylinder: {
      volumeL: 10,
      initialPressureBar: 100,
      initialOxygenPercent: 0,
      initialHeliumPercent: 0,
      targetPressureBar: 200,
      targetOxygenPercent: 50,
      targetHeliumPercent: 0
    },
    physics: { model: 'ideal', temperatureC: 20 },
    banks: [
      { id: 'oxygen-a', name: 'Low-pressure oxygen', volumeL: 10, pressureBar: 55, maxPressureBar: 350, minimumPressureBar: 0, oxygenPercent: 100, heliumPercent: 0, enabled: true },
      { id: 'oxygen-b', name: 'High-pressure oxygen', volumeL: 10, pressureBar: 145, maxPressureBar: 350, minimumPressureBar: 0, oxygenPercent: 100, heliumPercent: 0, enabled: true }
    ]
  });

  assert.equal(result.feasible, true);
  assert.equal(result.blend.finalPressureBar, 200);
  assert.ok(result.protocolSteps.some(step => step.title.includes('Low-pressure oxygen')));
  assert.ok(result.protocolSteps.some(step => step.title.includes('High-pressure oxygen')));
});

test('allows a later non-Air transfer after compressor Air reaches its ceiling', () => {
  const result = optimizeBlend({
    cylinder: {
      volumeL: 10,
      initialPressureBar: 100,
      initialOxygenPercent: 0,
      initialHeliumPercent: 0,
      targetPressureBar: 250,
      targetOxygenPercent: 25,
      targetHeliumPercent: 0
    },
    physics: { model: 'ideal', temperatureC: 20 },
    banks: [{
      id: 'oxygen-source',
      name: 'Oxygen source',
      volumeL: 100,
      pressureBar: 200,
      maxPressureBar: 350,
      minimumPressureBar: 0,
      oxygenPercent: 100,
      heliumPercent: 0,
      enabled: true
    }],
    settings: {
      booster: {
        maxCompressorPressureBar: 232,
        maxBoosterOutputPressureBar: 350
      }
    }
  });

  assert.equal(result.feasible, true);
  const compressorStep = result.protocolSteps.find(step => step.title.includes('Compressor Air'));
  assert.ok(compressorStep);
  assert.ok(compressorStep.resultingPressureBar <= 232 + 1e-9);
  assert.equal(result.blend.finalPressureBar, 250);
});

test('ignores oxygen inventory in air when the exact target contains no nitrogen', () => {
  const result = optimizeBlend({
    cylinder: {
      volumeL: 10,
      initialPressureBar: 100,
      initialOxygenPercent: 0,
      initialHeliumPercent: 0,
      targetPressureBar: 250,
      targetOxygenPercent: 100,
      targetHeliumPercent: 0
    },
    physics: { model: 'ideal', temperatureC: 20 },
    banks: [
      { id: 'oxygen-a', name: 'Oxygen A', volumeL: 2, pressureBar: 100, maxPressureBar: 350, minimumPressureBar: 45, oxygenPercent: 100, heliumPercent: 0, enabled: true },
      { id: 'oxygen-b', name: 'Oxygen B', volumeL: 10, pressureBar: 240, maxPressureBar: 350, minimumPressureBar: 45, oxygenPercent: 100, heliumPercent: 0, enabled: true },
    ]
  });

  assert.equal(result.feasible, false);
  assert.ok(result.maximumPressure.pressureBar >= 200 && result.maximumPressure.pressureBar < 206);
  assert.ok(result.maximumPressure.protocolSteps.some(step => step.title.includes('Oxygen A')));
  assert.ok(result.maximumPressure.protocolSteps.some(step => step.title.includes('Oxygen B')));
  assert.ok(!result.maximumPressure.protocolSteps.some(step => step.title.includes('Air bank')));
});

test('drains small amounts of cylinder gas when fallback fractions require it', () => {
  const result = optimizeBlend({
    cylinder: {
      volumeL: 10,
      initialPressureBar: 100,
      initialOxygenPercent: 0,
      initialHeliumPercent: 0,
      targetPressureBar: 200,
      targetOxygenPercent: 25,
      targetHeliumPercent: 75
    },
    physics: { model: 'ideal', temperatureC: 20 },
    banks: [{
      id: 'oxygen',
      name: 'Oxygen bank',
      volumeL: 10,
      pressureBar: 100,
      maxPressureBar: 350,
      minimumPressureBar: 66.8,
      oxygenPercent: 100,
      heliumPercent: 0,
      enabled: true
    }, {
      id: 'helium',
      name: 'Helium bank',
      volumeL: 10,
      pressureBar: 100,
      maxPressureBar: 350,
      minimumPressureBar: 0,
      oxygenPercent: 0,
      heliumPercent: 100,
      enabled: true
    }]
  });

  const drain = result.maximumPressure.protocolSteps[0];
  const finalStep = result.maximumPressure.trajectory.at(-1);
  assert.equal(drain.type, 'drain');
  assert.ok(drain.resultingPressureBar < 100);
  assert.ok(Math.abs(finalStep.oxygenPercent - 25) < 1e-8);
  assert.ok(Math.abs(finalStep.pressureBar - result.maximumPressure.pressureBar) < 1e-6);
});

test('does not display moles for small fallback transfers', () => {
  const result = optimizeBlend({
    cylinder: {
      volumeL: 10,
      initialPressureBar: 100,
      initialOxygenPercent: 0,
      initialHeliumPercent: 0,
      targetPressureBar: 300,
      targetOxygenPercent: 0.365,
      targetHeliumPercent: 99.635
    },
    physics: { model: 'ideal', temperatureC: 20 },
    banks: [{
      id: 'oxygen',
      name: 'Oxygen bank',
      volumeL: 200,
      pressureBar: 100,
      maxPressureBar: 350,
      minimumPressureBar: 0,
      oxygenPercent: 100,
      heliumPercent: 0,
      enabled: true
    }, {
      id: 'helium',
      name: 'Helium bank',
      volumeL: 10,
      pressureBar: 100,
      maxPressureBar: 350,
      minimumPressureBar: 0,
      oxygenPercent: 0,
      heliumPercent: 100,
      enabled: true
    }]
  });

  const oxygenStep = result.maximumPressure.trajectory.find(point => point.bankName === 'Oxygen bank');
  const stepDescription = result.maximumPressure.protocolSteps.at(-1).description;
  assert.ok(oxygenStep.addedMoles > 0.1 && oxygenStep.addedMoles < 0.5);
  assert.match(stepDescription, /bar/);
  assert.doesNotMatch(stepDescription, /Decompressively|mol|\(100\/0\)/);
});

test('does not report a maximum-pressure recipe when no positive amount matches the target mix', () => {
  const result = optimizeBlend({ ...defaultInput, banks: [] });

  assert.equal(result.feasible, false);
  assert.equal(result.maximumPressure, null);
  assert.ok(result.tableauSteps.some(step => step.varNames.includes('n_total')));
});

test('unavailable banks report infeasible without a fabricated blend protocol', () => {
  const result = optimizeBlend({ ...defaultInput, banks: [] });
  assert.equal(result.feasible, false);
  assert.equal(result.blend, null);
  assert.deepEqual(result.protocolSteps, []);
  assert.ok(result.error.length > 0);
  assert.ok(result.tableauSteps.length > 0);
});

function oxygenTransferInput(sourcePressureBar, sourceOxygenPercent = 100) {
  return {
    cylinder: {
      volumeL: 10,
      initialPressureBar: 150,
      initialOxygenPercent: 0,
      initialHeliumPercent: 0,
      targetPressureBar: 200,
      targetOxygenPercent: sourceOxygenPercent * 0.25,
      targetHeliumPercent: 0
    },
    physics: { model: 'ideal', temperatureC: 20 },
    banks: [{
      id: 'oxygen-source',
      name: 'Oxygen source',
      volumeL: 10,
      pressureBar: sourcePressureBar,
      maxPressureBar: 350,
      minimumPressureBar: 0,
      oxygenPercent: sourceOxygenPercent,
      heliumPercent: 0,
      enabled: true
    }]
  };
}

test('rejects oxygen-rich transfer when receiver exceeds four times source residual pressure', () => {
  const result = optimizeBlend(oxygenTransferInput(80));

  assert.equal(result.feasible, false);
  assert.match(result.error, /4:1/);
  assert.equal(result.reasonCode, 'oxygen-boost-ratio');
  assert.equal(result.blend, null);
  assert.deepEqual(result.protocolSteps, []);
});
test('checks oxygen transfer after compressor Air is staged first', () => {
  const result = optimizeBlend({
    cylinder: {
      volumeL: 10,
      initialPressureBar: 150,
      initialOxygenPercent: 0,
      initialHeliumPercent: 0,
      targetPressureBar: 280,
      targetOxygenPercent: 25,
      targetHeliumPercent: 0
    },
    physics: { model: 'ideal', temperatureC: 20 },
    banks: [{
      id: 'oxygen-source',
      name: 'Oxygen source',
      volumeL: 10,
      pressureBar: 110,
      maxPressureBar: 350,
      oxygenPercent: 100,
      heliumPercent: 0,
      enabled: true
    }],
    settings: {
      booster: {
        maxCompressorPressureBar: 232,
        maxBoosterOutputPressureBar: 350
      }
    }
  });

  assert.equal(result.feasible, false);
  assert.match(result.error, /4:1/);
  assert.equal(result.reasonCode, 'oxygen-boost-ratio');
});

test('finds the maximum lower pressure that keeps the exact mix within the oxygen transfer limit', () => {
  const result = optimizeBlend(oxygenTransferInput(80));

  assert.equal(result.feasible, false);
  assert.ok(result.maximumPressure);
  assert.ok(Math.abs(result.maximumPressure.pressureBar - 160) < 1e-6);
  assert.match(result.error, /4:1/);
  const finalStep = result.maximumPressure.trajectory.at(-1);
  assert.ok(Math.abs(finalStep.oxygenPercent - 25) < 1e-8);
  assert.ok(Math.abs(finalStep.pressureBar - 160) < 1e-6);
});

test('allows oxygen-rich transfer when receiver pressure is exactly four times source residual pressure', () => {
  const result = optimizeBlend(oxygenTransferInput(100));

  assert.equal(result.feasible, true);
  assert.equal(result.blend.finalPressureBar, 200);
});

test('does not apply the oxygen compression limit to source gas at exactly 25 percent oxygen', () => {
  const result = optimizeBlend(oxygenTransferInput(80, 25));

  assert.equal(result.feasible, true);
  assert.equal(result.blend.finalPressureBar, 200);
});
test('reports the configured minimum when a finite boost source is exhausted', () => {
  const result = optimizeBlend({
    cylinder: {
      volumeL: 10,
      initialPressureBar: 0,
      initialOxygenPercent: 0,
      initialHeliumPercent: 0,
      targetPressureBar: 80,
      targetOxygenPercent: 100,
      targetHeliumPercent: 0
    },
    physics: { model: 'ideal', temperatureC: 20 },
    banks: [{
      id: 'oxygen',
      name: 'Oxygen bank',
      volumeL: 10,
      pressureBar: 100,
      maxPressureBar: 350,
      minimumPressureBar: 0,
      oxygenPercent: 100,
      heliumPercent: 0,
      enabled: true
    }],
    settings: {
      booster: {
        minimumSourcePressureBar: 20,
        maxCompressorPressureBar: 232,
        maxBoosterOutputPressureBar: 200
      }
    }
  });

  assert.equal(result.feasible, true);
  const step = result.protocolSteps.find(candidate => candidate.type === 'boost');
  assert.ok(step);
  assert.equal(step.minimumSourcePressureBar, 20);
  assert.equal(step.sourceExhausted, true);
  assert.match(step.description, /This empties Oxygen bank and leaves only 20\.0 bar of gas\./);
});

test('reports the end-of-boost compression ratio only above 40 percent oxygen', () => {
  const highOxygenResult = optimizeBlend(oxygenTransferInput(100, 41));
  const highOxygenBoost = highOxygenResult.protocolSteps.find(step => step.type === 'boost');
  assert.equal(highOxygenResult.feasible, true);
  assert.ok(highOxygenBoost);
  assert.ok(Math.abs(highOxygenBoost.oxygenCompressionRatio - 4) < 1e-6);
  assert.match(
    highOxygenBoost.description,
    /O2 compression ratio is 4\.00:1 \(source 50\.0 bar to receiver 200\.0 bar\)\./
  );

  const thresholdResult = optimizeBlend(oxygenTransferInput(100, 40));
  const thresholdBoost = thresholdResult.protocolSteps.find(step => step.type === 'boost');
  assert.equal(thresholdResult.feasible, true);
  assert.ok(thresholdBoost);
  assert.equal(thresholdBoost.oxygenCompressionRatio, null);
  assert.doesNotMatch(thresholdBoost.description, /O2 compression ratio/);
});
test('rejects impossible target gas composition without returning a recipe', () => {
  const result = optimizeBlend({
    ...defaultInput,
    cylinder: {
      ...defaultInput.cylinder,
      targetOxygenPercent: 110,
      targetHeliumPercent: 20
    }
  });

  assert.equal(result.feasible, false);
  assert.equal(result.gas, null);
  assert.equal(result.maximumPressure, null);
  assert.deepEqual(result.protocolSteps, []);
  assert.match(result.error, /target.*gas composition/i);
});
test('does not recommend implicit Compressor Air for a pure-oxygen shortfall', () => {
  const result = optimizeBlend({
    cylinder: {
      volumeL: 10,
      initialPressureBar: 0,
      initialOxygenPercent: 0,
      initialHeliumPercent: 0,
      targetPressureBar: 100,
      targetOxygenPercent: 100,
      targetHeliumPercent: 0
    },
    physics: { model: 'ideal', temperatureC: 20 },
    banks: []
  });

  assert.equal(result.feasible, false);
  assert.equal(result.diagnostics.componentShortfalls[0].sourceBank, null);
});

test('rejects impossible enabled-bank composition before solving', () => {
  const result = optimizeBlend({
    ...defaultInput,
    banks: [
      { ...defaultInput.banks[0], oxygenPercent: 10 },
      ...defaultInput.banks.slice(1)
    ]
  });

  assert.equal(result.feasible, false);
  assert.equal(result.gas, null);
  assert.equal(result.maximumPressure, null);
  assert.deepEqual(result.protocolSteps, []);
  assert.match(result.error, /pure helium.*gas composition/i);
});
test('rejects a supply bank without a usable name', () => {
  const result = optimizeBlend({
    ...defaultInput,
    banks: [
      { ...defaultInput.banks[0], name: '   ' },
      ...defaultInput.banks.slice(1)
    ]
  });

  assert.equal(result.feasible, false);
  assert.equal(result.gas, null);
  assert.match(result.error, /bank.*name/i);
});
test('rejects target pressures outside the supported range in direct calls', () => {
  for (const targetPressureBar of [9, 351]) {
    const result = optimizeBlend({
      cylinder: {
        volumeL: 10,
        initialPressureBar: 50,
        initialOxygenPercent: 21,
        initialHeliumPercent: 0,
        targetPressureBar,
        targetOxygenPercent: 21,
        targetHeliumPercent: 0
      },
      physics: { model: 'ideal', temperatureC: 20 },
      banks: []
    });

    assert.equal(result.feasible, false);
    assert.equal(result.gas, null);
    assert.match(result.error, /target pressure.*10.*350/i);
  }
});

test('rejects bank volumes outside the supported range in direct calls', () => {
  for (const volumeL of [0.5, 201]) {
    const result = optimizeBlend({
      ...defaultInput,
      banks: [
        { ...defaultInput.banks[0], volumeL },
        ...defaultInput.banks.slice(1)
      ]
    });

    assert.equal(result.feasible, false);
    assert.equal(result.gas, null);
    assert.match(result.error, /bank volume.*1.*200/i);
  }
});

test('rejects unsupported gas models instead of silently switching to ideal gas', () => {
  const result = optimizeBlend({
    ...defaultInput,
    physics: { ...defaultInput.physics, model: 'vdw ' }
  });

  assert.equal(result.feasible, false);
  assert.equal(result.gas, null);
  assert.match(result.error, /gas model.*ideal.*vdw/i);
});

test('thermal recipe overshoots the last hot target so ambient pressure reaches the request', () => {
  const result = optimizeBlend({
    cylinder: {
      volumeL: 12,
      initialPressureBar: 80,
      initialOxygenPercent: 21,
      initialHeliumPercent: 0,
      targetPressureBar: 210,
      targetOxygenPercent: 21,
      targetHeliumPercent: 0
    },
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
        minimumSourcePressureBar: 0,
        cylinderVolumeCm3: 9,
        oxygenBoostBpm: 50,
        otherBoostBpm: 50,
        oxygenDecantRateBarPerMin: 5,
        otherDecantRateBarPerMin: 5,
        compressorInletFlowLPerMin: 100
      }
    },
    banks: []
  });

  assert.equal(result.feasible, true);
  assert.equal(result.thermal.requestedSettledTargetPressureBar, 210);
  assert.equal(result.gas.targetPressureBar, 210);
  assert.ok(result.thermal.finalTransferEndPressureBar > 210);
  assert.ok(Math.abs(result.thermal.finalAmbientPressureBar - 210) < 1e-5);
});
test('optimizeBlend exposes the hot transfer endpoint separately from the physics reference pressure', () => {
  const result = optimizeBlend({
    cylinder: {
      volumeL: 12,
      initialPressureBar: 0,
      initialOxygenPercent: 0,
      initialHeliumPercent: 0,
      targetPressureBar: 150,
      targetOxygenPercent: 21,
      targetHeliumPercent: 0,
      workingPressureBar: 250
    },
    physics: { model: 'ideal', temperatureC: 20 },
    thermal: {
      tankMaterial: 'steel',
      coolingMedium: 'air',
      ambientTemperatureC: 20,
      inletTemperatureC: 40,
      targetMediumTemperatureC: 20,
      targetInWaterTemperatureC: 20,
      waitMode: 'minutes',
      waitMinutes: 0
    },
    settings: {
      booster: {
        compressorInletFlowLPerMin: 100
      }
    },
    banks: []
  });

  assert.equal(result.feasible, true);
  const transfer = result.protocolSteps.find(step => step.type === 'boost');
  assert.ok(transfer);
  const thermal = transfer.thermal;
  assert.equal(thermal.pressureReferenceTemperatureC, 20);
  assert.ok(thermal.temperatureAtTransferEndC > 20);
  const expectedHotPressure = calculatePressureAtTemperature({
    pressureBar: thermal.pressureAtTransferEndReferenceBar,
    oxygenPercent: transfer.resultingMix.oxygenPercent,
    heliumPercent: transfer.resultingMix.heliumPercent,
    fromTemperatureC: 20,
    toTemperatureC: thermal.temperatureAtTransferEndC,
    volumeL: 12,
    useVdw: false
  });
  assert.ok(Math.abs(thermal.pressureAtTransferEndHotBar - expectedHotPressure) < 1e-9);
  assert.ok(Math.abs(thermal.pressureAtTransferEndReferenceBar - thermal.pressureAtTransferEndBar) > 1e-6);
  assert.ok(Math.abs(thermal.pressureAtTransferEndBar - thermal.pressureAtTransferEndHotBar) < 1e-9);
  assert.ok(Math.abs(result.thermal.finalTransferEndPressureBar - thermal.pressureAtTransferEndHotBar) < 1e-9);
  assert.equal(result.thermal.finalTransferEndTemperatureC, thermal.temperatureAtTransferEndC);
  const trajectoryPoint = result.trajectory.find(point => point.bankId);
  assert.ok(trajectoryPoint);
  assert.equal(trajectoryPoint.ambientPressureBar, result.thermal.finalAmbientPressureBar);
  assert.equal(trajectoryPoint.hotPressureBar, result.thermal.finalTransferEndPressureBar);
});

test('thermal trajectory maps each bank point to its corresponding transfer state', () => {
  const result = optimizeBlend({
    cylinder: {
      volumeL: 12,
      initialPressureBar: 0,
      initialOxygenPercent: 0,
      initialHeliumPercent: 0,
      targetPressureBar: 150,
      targetOxygenPercent: 21,
      targetHeliumPercent: 79,
      workingPressureBar: 250
    },
    physics: { model: 'ideal', temperatureC: 20 },
    thermal: {
      tankMaterial: 'steel',
      coolingMedium: 'air',
      ambientTemperatureC: 20,
      inletTemperatureC: 40,
      targetMediumTemperatureC: 20,
      targetInWaterTemperatureC: 20,
      waitMode: 'minutes',
      waitMinutes: 0
    },
    settings: {
      booster: {
        minimumSourcePressureBar: 0,
        cylinderVolumeCm3: 9,
        oxygenBoostBpm: 50,
        otherBoostBpm: 50,
        oxygenDecantRateBarPerMin: 5,
        otherDecantRateBarPerMin: 5
      }
    },
    banks: [
      {
        id: 'o2',
        name: 'Oxygen',
        volumeL: 12,
        pressureBar: 300,
        maxPressureBar: 350,
        minimumPressureBar: 0,
        oxygenPercent: 100,
        heliumPercent: 0,
        enabled: true
      },
      {
        id: 'he',
        name: 'Helium',
        volumeL: 12,
        pressureBar: 300,
        maxPressureBar: 350,
        minimumPressureBar: 0,
        oxygenPercent: 0,
        heliumPercent: 100,
        enabled: true
      }
    ]
  });

  assert.equal(result.feasible, true);
  const transferSteps = result.protocolSteps.filter(step => (
    step.type !== 'drain'
      && step.thermal?.rateSource
      && step.thermal.rateSource !== 'none'
  ));
  const transferPoints = result.trajectory.filter(point => point.bankId);
  assert.equal(transferSteps.length, 2);
  assert.equal(transferPoints.length, 2);
  transferPoints.forEach((point, index) => {
    const thermal = transferSteps[index].thermal;
    assert.equal(point.pressureAtTransferEndReferenceBar, thermal.pressureAtTransferEndReferenceBar);
    assert.equal(point.pressureAtTransferEndAmbientBar, thermal.pressureAtTransferEndAmbientBar);
    assert.equal(point.pressureAtTransferEndHotBar, thermal.pressureAtTransferEndHotBar);
    assert.equal(point.ambientPressureBar, thermal.pressureAtTransferEndAmbientBar);
    assert.equal(point.hotPressureBar, thermal.pressureAtTransferEndHotBar);
  });
});
test('optimizeBlend returns a feasible automatic wait extension with complete safety metadata', () => {
  const result = optimizeBlend({
    cylinder: {
      volumeL: 12,
      initialPressureBar: 0,
      initialOxygenPercent: 21,
      initialHeliumPercent: 0,
      targetPressureBar: 95,
      targetOxygenPercent: 21,
      targetHeliumPercent: 0,
      workingPressureBar: 100,
      hotOverfillPercent: 0
    },
    physics: { model: 'ideal', temperatureC: 20 },
    thermal: {
      tankMaterial: 'steel',
      coolingMedium: 'air',
      ambientTemperatureC: 20,
      inletTemperatureC: 40,
      targetMediumTemperatureC: 20,
      targetInWaterTemperatureC: 20,
      waitMode: 'minutes',
      waitMinutes: 0,
      interimMeasurements: [{ pressureBar: 0, temperatureC: 40 }]
    },
    settings: {
      booster: {
        compressorInletFlowLPerMin: 100,
        otherBoostBpm: 50,
        oxygenBoostBpm: 50,
        otherDecantRateBarPerMin: 5,
        oxygenDecantRateBarPerMin: 5,
        cylinderVolumeCm3: 9,
        minimumSourcePressureBar: 0
      }
    },
    banks: []
  });

  assert.equal(result.feasible, true);
  assert.ok(Math.abs(result.thermal.finalAmbientPressureBar - 95) < 1e-5);
  const wait = result.protocolSteps.find(step => step.automaticWaitMetadata);
  assert.ok(wait);
  const metadata = wait.automaticWaitMetadata;
  assert.equal(metadata.configuredWaitMinutes, 0);
  assert.ok(metadata.addedWaitMinutes > 0);
  assert.equal(metadata.actualWaitMinutes, wait.thermal.waitMinutes);
  const transfer = result.protocolSteps.find(step => step.type === 'boost');
  assert.ok(transfer);
  assert.equal(transfer.thermal.measuredStartPressureBar, transfer.thermal.pressureStartBar);
  assert.notEqual(transfer.thermal.measuredStartTemperatureC, 40);
  assert.equal(transfer.thermal.measuredStartTemperatureC, transfer.thermal.temperatureStartC);
  assert.equal(metadata.warning, '!');
  for (const step of result.protocolSteps) {
    if (!step.thermal) continue;
    const pressures = [
      step.thermal.pressureStartBar,
      step.thermal.pressureAtTransferEndReferenceBar,
      step.thermal.pressureAtTransferEndBar,
      step.thermal.pressureAtTransferEndHotBar,
      step.thermal.pressureAfterWaitBar,
      ...(step.thermal.samples ?? []).map(sample => sample.projectedPressureBar ?? sample.pressureBar)
    ];
    assert.ok(pressures.every(pressure => pressure <= 100 + 1e-7), step.title);
  }
});

const warningInput = (maxCompressorPressureBar = 232) => ({
  cylinder: {
    volumeL: 12,
    initialPressureBar: 0,
    initialOxygenPercent: 21,
    initialHeliumPercent: 0,
    targetPressureBar: 105,
    targetOxygenPercent: 21,
    targetHeliumPercent: 0,
    workingPressureBar: 100,
    hotOverfillPercent: 0
  },
  physics: { model: 'ideal', temperatureC: 20 },
  thermal: {
    tankMaterial: 'steel',
    coolingMedium: 'air',
    ambientTemperatureC: 20,
    inletTemperatureC: 40,
    targetMediumTemperatureC: 20,
    targetInWaterTemperatureC: 20,
    waitMode: 'minutes',
    waitMinutes: 0
  },
  settings: {
    pressureLimitMode: 'warning',
    booster: {
      compressorInletFlowLPerMin: 100,
      maxCompressorPressureBar,
      maxBoosterOutputPressureBar: 230,
      otherBoostBpm: 50,
      oxygenBoostBpm: 50,
      otherDecantRateBarPerMin: 5,
      oxygenDecantRateBarPerMin: 5,
      cylinderVolumeCm3: 9,
      minimumSourcePressureBar: 0
    }
  },
  banks: []
});

test('Warning mode ignores cylinder-only thermal waits but retains equipment caps', () => {
  const result = optimizeBlend(warningInput());
  assert.equal(result.feasible, true, result.error);
  assert.ok(result.thermal.finalTransferEndPressureBar > 100);
  assert.equal(result.protocolSteps.some(step => step.automaticWaitMetadata), false);
  assert.equal(result.protocolSteps.filter(step => step.thermal?.rateSource === 'compressor').length, 1);

  const capped = optimizeBlend(warningInput(100));
  assert.equal(capped.feasible, false);
  assert.ok(capped.maximumPressure);
  assert.ok(capped.maximumPressure.pressureBar <= 100 + 1e-6);
});

test('optimizeBlend returns a feasible split protocol with safe endpoints and target pressure', () => {
  const result = optimizeBlend({
    cylinder: {
      volumeL: 12,
      initialPressureBar: 0,
      initialOxygenPercent: 0,
      initialHeliumPercent: 0,
      targetPressureBar: 96,
      targetOxygenPercent: 0,
      targetHeliumPercent: 0,
      workingPressureBar: 100,
      hotOverfillPercent: 0
    },
    physics: { model: 'ideal', temperatureC: 20 },
    thermal: {
      tankMaterial: 'steel',
      coolingMedium: 'air',
      ambientTemperatureC: 20,
      inletTemperatureC: 40,
      targetMediumTemperatureC: 20,
      targetInWaterTemperatureC: 20,
      waitMode: 'minutes',
      waitMinutes: 0
    },
    settings: {
      booster: {
        otherBoostBpm: 50,
        oxygenBoostBpm: 50,
        otherDecantRateBarPerMin: 5,
        oxygenDecantRateBarPerMin: 5,
        cylinderVolumeCm3: 9,
        minimumSourcePressureBar: 0
      }
    },
    banks: [{
      id: 'nitrogen',
      name: 'Nitrogen',
      volumeL: 12,
      pressureBar: 300,
      maxPressureBar: 350,
      minimumPressureBar: 0,
      oxygenPercent: 0,
      heliumPercent: 0,
      enabled: true
    }]
  });

  assert.equal(result.feasible, true);
  assert.ok(Math.abs(result.thermal.finalAmbientPressureBar - 96) < 1e-5);
  const transferStages = result.protocolSteps.filter(step => step.type === 'decant');
  assert.equal(transferStages.length, 2);
  const transferPoints = result.trajectory.filter(point => point.bankId);
  assert.equal(transferPoints.length, 2);
  transferStages.forEach((stage, index) => {
    const point = transferPoints[index];
    assert.equal(point.pressureBar, stage.resultingPressureBar);
    assert.equal(point.oxygenPercent, stage.resultingMix.oxygenPercent);
    assert.equal(point.heliumPercent, stage.resultingMix.heliumPercent);
    assert.equal(point.pressureAtTransferEndReferenceBar, stage.thermal.pressureAtTransferEndReferenceBar);
    assert.equal(point.pressureAtTransferEndAmbientBar, stage.thermal.pressureAtTransferEndAmbientBar);
    assert.equal(point.pressureAtTransferEndHotBar, stage.thermal.pressureAtTransferEndHotBar);
  });
  assert.equal(
    transferPoints.at(-1).hotPressureBar,
    result.thermal.finalTransferEndPressureBar
  );
  const safetyWait = result.protocolSteps.find(step => step.automaticWaitMetadata);
  assert.ok(safetyWait);
  assert.equal(safetyWait.automaticWaitMetadata.warning, '!');
  for (const step of result.protocolSteps) {
    if (!step.thermal) continue;
    const pressures = [
      step.thermal.pressureStartBar,
      step.thermal.pressureAtTransferEndReferenceBar,
      step.thermal.pressureAtTransferEndBar,
      step.thermal.pressureAtTransferEndHotBar,
      step.thermal.pressureAfterWaitBar,
      ...(step.thermal.samples ?? []).map(sample => sample.projectedPressureBar ?? sample.pressureBar)
    ];
    assert.ok(pressures.every(pressure => pressure <= 100 + 1e-7), step.title);
  }
});
test('two scheduler-split transfers preserve stage order, inventories, and thermal safety', () => {
  const workingPressureBar = 99.01;
  const targetPressureBar = 99;
  const result = optimizeBlend({
    cylinder: {
      volumeL: 12,
      initialPressureBar: 95,
      initialOxygenPercent: 0,
      initialHeliumPercent: 0,
      targetPressureBar,
      targetOxygenPercent: 4,
      targetHeliumPercent: 0.2,
      workingPressureBar,
      hotOverfillPercent: 0
    },
    physics: { model: 'ideal', temperatureC: 20 },
    thermal: {
      tankMaterial: 'steel',
      coolingMedium: 'air',
      ambientTemperatureC: 20,
      inletTemperatureC: 40,
      targetMediumTemperatureC: 20,
      targetInWaterTemperatureC: 20,
      waitMode: 'minutes',
      waitMinutes: 0
    },
    settings: {
      booster: {
        otherBoostBpm: 50,
        oxygenBoostBpm: 50,
        otherDecantRateBarPerMin: 5,
        oxygenDecantRateBarPerMin: 5,
        cylinderVolumeCm3: 9,
        minimumSourcePressureBar: 0
      }
    },
    banks: [
      {
        id: 'o2',
        name: 'Oxygen',
        volumeL: 12,
        pressureBar: 300,
        maxPressureBar: 350,
        minimumPressureBar: 0,
        oxygenPercent: 100,
        heliumPercent: 0,
        enabled: true
      },
      {
        id: 'he',
        name: 'Helium',
        volumeL: 12,
        pressureBar: 300,
        maxPressureBar: 350,
        minimumPressureBar: 0,
        oxygenPercent: 0,
        heliumPercent: 100,
        enabled: true
      }
    ]
  });

  assert.equal(result.feasible, true, result.error);
  assert.ok(Math.abs(result.thermal.finalAmbientPressureBar - targetPressureBar) < 1e-5);
  const transferStages = result.protocolSteps.filter(step => step._thermalSplit);
  assert.equal(transferStages.length, 4);
  assert.deepEqual(transferStages.map(step => step.recipeGas), [
    'Oxygen', 'Oxygen', 'Helium', 'Helium'
  ]);
  assert.deepEqual(
    transferStages.map(step => step.title.match(/safe stage [12]/)?.[0]),
    ['safe stage 1', 'safe stage 2', 'safe stage 1', 'safe stage 2']
  );

  const transferPoints = result.trajectory.filter(point => point.bankId);
  assert.equal(transferPoints.length, transferStages.length);
  transferStages.forEach((stage, index) => {
    const point = transferPoints[index];
    assert.equal(point.pressureBar, stage.resultingPressureBar);
    assert.equal(point.oxygenPercent, stage.resultingMix.oxygenPercent);
    assert.equal(point.heliumPercent, stage.resultingMix.heliumPercent);
    assert.equal(point.pressureAtTransferEndReferenceBar, stage.thermal.pressureAtTransferEndReferenceBar);
    assert.equal(point.pressureAtTransferEndAmbientBar, stage.thermal.pressureAtTransferEndAmbientBar);
    assert.equal(point.pressureAtTransferEndHotBar, stage.thermal.pressureAtTransferEndHotBar);
    assert.equal(point.ambientPressureBar, stage.thermal.pressureAtTransferEndAmbientBar);
    assert.equal(point.hotPressureBar, stage.thermal.pressureAtTransferEndHotBar);
  });

  for (const [first, second] of [[0, 1], [2, 3]]) {
    const firstStage = transferStages[first];
    const secondStage = transferStages[second];
    assert.equal(secondStage.sourceStartMoles, firstStage.sourceEndMoles);
    assert.ok(Math.abs(
      firstStage.sourceStartMoles
        - firstStage.sourceConsumedMoles
        - firstStage.sourceEndMoles
    ) < 1e-9);
    assert.ok(Math.abs(
      secondStage.sourceStartMoles
        - secondStage.sourceConsumedMoles
        - secondStage.sourceEndMoles
    ) < 1e-9);
    assert.equal(secondStage.receiverStartMoles, firstStage.receiverEndMoles);
  }
  assert.equal(transferStages[2].receiverStartMoles, transferStages[1].receiverEndMoles);

  const pressures = result.protocolSteps.flatMap(step => {
    const thermal = step.thermal;
    if (!thermal) return [];
    return [
      thermal.pressureStartBar,
      thermal.pressureAtTransferEndReferenceBar,
      thermal.pressureAtTransferEndAmbientBar,
      thermal.pressureAtTransferEndHotBar,
      thermal.pressureAfterWaitBar,
      ...(thermal.samples ?? []).flatMap(sample => [
        sample.pressureAtTransferEndReferenceBar,
        sample.pressureAtTransferEndAmbientBar,
        sample.pressureAtTransferEndHotBar,
        sample.ambientPressureBar,
        sample.projectedPressureBar ?? sample.pressureBar
      ])
    ].filter(Number.isFinite);
  });
  assert.ok(pressures.every(pressure => pressure <= workingPressureBar + 1e-7));
});

test('thermal final settling defaults to ambient before in-water projection', () => {
  const result = optimizeBlend({
    cylinder: {
      volumeL: 12,
      initialPressureBar: 200,
      initialOxygenPercent: 21,
      initialHeliumPercent: 0,
      targetPressureBar: 200,
      targetOxygenPercent: 21,
      targetHeliumPercent: 0,
      workingPressureBar: 250
    },
    physics: { model: 'ideal', temperatureC: 20 },
    thermal: {
      tankMaterial: 'steel',
      coolingMedium: 'air',
      ambientTemperatureC: 20,
      inletTemperatureC: 20,
      targetMediumTemperatureC: 30,
      targetInWaterTemperatureC: 10,
      waitMode: 'minutes',
      waitMinutes: 0
    },
    settings: {},
    banks: []
  });

  assert.equal(result.feasible, true);
  assert.equal(result.thermal.finalAmbientTemperatureC, 20);
  assert.equal(result.thermal.finalInWaterTemperatureC, 10);
  assert.ok(Math.abs(result.thermal.finalInWaterPressureBar - 200) < 1e-5);
});
test('final settling remains ambient despite legacy target-temperature aliases', () => {
  const result = optimizeBlend({
    cylinder: {
      volumeL: 12,
      initialPressureBar: 80,
      initialOxygenPercent: 21,
      initialHeliumPercent: 0,
      targetPressureBar: 210,
      targetOxygenPercent: 21,
      targetHeliumPercent: 0
    },
    physics: { model: 'ideal', temperatureC: 20 },
    thermal: {
      tankMaterial: 'steel',
      coolingMedium: 'air',
      ambientTemperatureC: 20,
      waitMode: 'minutes',
      waitMinutes: 10,
      settledTemperatureC: 30,
      targetTemperatureC: 25,
    },
    settings: {
      booster: {
        minimumSourcePressureBar: 0,
        cylinderVolumeCm3: 9,
        oxygenBoostBpm: 50,
        otherBoostBpm: 50,
        oxygenDecantRateBarPerMin: 5,
        otherDecantRateBarPerMin: 5,
        compressorInletFlowLPerMin: 100
      }
    },
    banks: []
  });

  assert.equal(result.feasible, true);
  assert.equal(result.thermal.requestedSettledTargetPressureBar, 210);
  assert.equal(result.thermal.finalAmbientTemperatureC, 20);
  assert.ok(Math.abs(result.thermal.finalAmbientPressureBar - 210) < 1e-5);
});
test('projects a below-ambient water target after ambient settling', () => {
  const result = optimizeBlend({
    cylinder: {
      volumeL: 12,
      initialPressureBar: 50,
      initialOxygenPercent: 21,
      initialHeliumPercent: 0,
      targetPressureBar: 200,
      targetOxygenPercent: 18,
      targetHeliumPercent: 45
    },
    physics: { model: 'vdw', temperatureC: 25 },
    thermal: {
      tankMaterial: 'steel',
      coolingMedium: 'water',
      ambientTemperatureC: 25,
      inletTemperatureC: 25,
      targetMediumTemperatureC: 25,
      targetInWaterTemperatureC: 15,
      waitMode: 'minutes',
      waitMinutes: 10,
      targetTemperatureC: 15
    },
    banks: [
      { id: '1845', name: '18/45', volumeL: 50, pressureBar: 200, maxPressureBar: 350, minimumPressureBar: 20, oxygenPercent: 18, heliumPercent: 45, enabled: true }
    ],
    settings: {
      booster: {
        minimumSourcePressureBar: 0,
        maxCompressorPressureBar: 350,
        maxBoosterOutputPressureBar: 350,
        cylinderVolumeCm3: 9,
        oxygenBoostBpm: 50,
        otherBoostBpm: 50,
        oxygenDecantRateBarPerMin: 5,
        otherDecantRateBarPerMin: 5,
        compressorInletFlowLPerMin: 100
      }
    }
  });

  assert.equal(result.feasible, true);
  assert.equal(result.thermal.finalAmbientTemperatureC, 25);
  assert.equal(result.thermal.finalInWaterTemperatureC, 15);
  assert.ok(Math.abs(result.thermal.finalAmbientPressureBar - result.thermal.ambientSettledTargetPressureBar) < 1e-5);
  assert.ok(Math.abs(result.thermal.finalInWaterPressureBar - 200) < 1e-5);
});

test('fixed-minute waits allow a hidden target temperature below ambient', () => {
  const result = optimizeBlend({
    cylinder: {
      volumeL: 12,
      initialPressureBar: 80,
      initialOxygenPercent: 21,
      initialHeliumPercent: 0,
      targetPressureBar: 210,
      targetOxygenPercent: 21,
      targetHeliumPercent: 0
    },
    physics: { model: 'ideal', temperatureC: 20 },
    thermal: {
      tankMaterial: 'steel',
      coolingMedium: 'air',
      ambientTemperatureC: 30,
      inletTemperatureC: 29,
      targetMediumTemperatureC: 30,
      targetInWaterTemperatureC: 25,
      waitMode: 'minutes',
      waitMinutes: 10,
      targetTemperatureC: 25
    },
    settings: {
      booster: {
        minimumSourcePressureBar: 0,
        cylinderVolumeCm3: 9,
        oxygenBoostBpm: 50,
        otherBoostBpm: 50,
        oxygenDecantRateBarPerMin: 5,
        otherDecantRateBarPerMin: 5,
        compressorInletFlowLPerMin: 100
      }
    },
    banks: []
  });

  assert.equal(result.feasible, true);
});
test('excludes helium from an initial mix that is 98% helium or richer', () => {
  const result = optimizeBlend({
    cylinder: {
      volumeL: 12,
      initialPressureBar: 80,
      initialOxygenPercent: 0,
      initialHeliumPercent: 98,
      targetPressureBar: 80,
      targetOxygenPercent: 0,
      targetHeliumPercent: 98
    },
    physics: { model: 'ideal', temperatureC: 20 },
    banks: [],
    settings: DEFAULT_SETTINGS
  });

  assert.equal(result.feasible, true);
  assert.equal(result.blend.heliumSalvagedLitres, 0);
});


test('rejects invalid thermal inputs with the existing invalid result shape', () => {
  const input = {
    cylinder: {
      volumeL: 12,
      initialPressureBar: 80,
      initialOxygenPercent: 21,
      initialHeliumPercent: 0,
      targetPressureBar: 210,
      targetOxygenPercent: 21,
      targetHeliumPercent: 0
    },
    physics: { model: 'ideal', temperatureC: 20 },
    banks: []
  };
  const validThermal = {
    tankMaterial: 'steel',
    ambientTemperatureC: 20,
    inletTemperatureC: 20,
    targetMediumTemperatureC: 25,
    targetInWaterTemperatureC: 20,
    waitMode: 'minutes',
    waitMinutes: 10,
    targetTemperatureC: 25
  };

  for (const thermal of [
    { ...validThermal, tankMaterial: 'carbon' },
    { ...validThermal, coolingMedium: 'oil' },
    { ...validThermal, waitMode: 'hours' },
    { ...validThermal, waitMinutes: -1 },
    { ...validThermal, waitMode: 'temperature', targetTemperatureC: 20 }
  ]) {
    const result = optimizeBlend({ ...input, thermal });

    assert.equal(result.feasible, false);
    assert.equal(result.gas, null);
    assert.equal(result.solution, null);
    assert.equal(result.blend, null);
    assert.deepEqual(result.protocolSteps, []);
    assert.deepEqual(result.trajectory, []);
    assert.equal(result.maximumPressure, null);
    assert.equal(result.diagnostics, null);
    assert.match(result.error, /invalid blend input:.*thermal/i);
  }

  const missingCylinder = optimizeBlend({ thermal: validThermal });
  assert.equal(missingCylinder.feasible, false);
  assert.equal(missingCylinder.gas, null);
  assert.equal(missingCylinder.solution, null);
  assert.equal(missingCylinder.blend, null);
  assert.deepEqual(missingCylinder.protocolSteps, []);
  assert.deepEqual(missingCylinder.trajectory, []);
  assert.equal(missingCylinder.maximumPressure, null);
  assert.equal(missingCylinder.diagnostics, null);
  assert.match(missingCylinder.error, /invalid blend input:.*cylinder/i);
});

test('thermal target search lowers the hot recipe when ambient warming raises pressure', () => {
  const result = optimizeBlend({
    cylinder: {
      volumeL: 12,
      initialPressureBar: 80,
      initialOxygenPercent: 21,
      initialHeliumPercent: 0,
      targetPressureBar: 80,
      targetOxygenPercent: 21,
      targetHeliumPercent: 0
    },
    physics: { model: 'ideal', temperatureC: 20 },
    thermal: {
      tankMaterial: 'steel',
      coolingMedium: 'air',
      ambientTemperatureC: 30,
      waitMode: 'minutes',
      waitMinutes: 10,
      targetTemperatureC: 35
    },
    settings: {
      booster: {
        minimumSourcePressureBar: 0,
        cylinderVolumeCm3: 9,
        oxygenBoostBpm: 50,
        otherBoostBpm: 50,
        oxygenDecantRateBarPerMin: 5,
        otherDecantRateBarPerMin: 5,
        compressorInletFlowLPerMin: 100
      }
    },
    banks: []
  });

  assert.equal(result.feasible, true);
  assert.ok(result.thermal.finalTransferEndPressureBar < 80);
  assert.ok(Math.abs(result.thermal.finalAmbientPressureBar - 80) < 1e-5);
});

test('reaches a high settled target below the equipment pressure ceiling', () => {
  const result = optimizeBlend({
    cylinder: {
      volumeL: 12,
      initialPressureBar: 80,
      initialOxygenPercent: 21,
      initialHeliumPercent: 0,
      targetPressureBar: 340,
      targetOxygenPercent: 21,
      targetHeliumPercent: 0
    },
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
        minimumSourcePressureBar: 0,
        cylinderVolumeCm3: 9,
        oxygenBoostBpm: 50,
        otherBoostBpm: 50,
        oxygenDecantRateBarPerMin: 5,
        otherDecantRateBarPerMin: 5,
        compressorInletFlowLPerMin: 100,
        maxCompressorPressureBar: 350,
        maxBoosterOutputPressureBar: 350
      }
    },
    banks: []
  });

  assert.equal(result.feasible, true, result.error);
  assert.equal(result.maximumPressure, null);
  assert.ok(Math.abs(result.thermal.finalAmbientPressureBar - 340) < 1e-5);
  assert.ok(Math.abs(result.thermal.finalInWaterPressureBar - 340) < 1e-5);
});

test('thermal infeasibility preserves the no-positive-candidate result shape', () => {
  const result = optimizeBlend({
    cylinder: {
      volumeL: 12,
      initialPressureBar: 80,
      initialOxygenPercent: 21,
      initialHeliumPercent: 0,
      targetPressureBar: 210,
      targetOxygenPercent: 32,
      targetHeliumPercent: 0
    },
    physics: { model: 'ideal', temperatureC: 20 },
    thermal: {
      tankMaterial: 'steel',
      coolingMedium: 'air',
      ambientTemperatureC: 20,
      waitMode: 'minutes',
      waitMinutes: 10,
      targetTemperatureC: 25
    },
    banks: []
  });

  assert.equal(result.feasible, false);
  assert.equal(result.gas.targetPressureBar, 210);
  assert.equal(result.maximumPressure, null);
  assert.deepEqual(result.protocolSteps, []);
  assert.equal(result.thermal.requestedInWaterPressureBar, 210);
  assert.equal(result.thermal.requestedInWaterTemperatureC, 20);
  assert.match(result.error, /requested in-water pressure/i);
});
test('normalizes the requested in-water target and reports all thermal states', () => {
  const result = optimizeBlend({
    cylinder: {
      volumeL: 12, initialPressureBar: 50, initialOxygenPercent: 21, initialHeliumPercent: 0,
      targetPressureBar: 188.6, targetOxygenPercent: 18, targetHeliumPercent: 45
    },
    physics: { model: 'vdw', temperatureC: 25 },
    thermal: {
      tankMaterial: 'steel', coolingMedium: 'water', ambientTemperatureC: 25,
      inletTemperatureC: 25, targetMediumTemperatureC: 25, targetInWaterTemperatureC: 10,
      waitMode: 'minutes', waitMinutes: 10
    },
    banks: [{ id: '1845', name: '18/45', volumeL: 50, pressureBar: 200, maxPressureBar: 350, minimumPressureBar: 20, oxygenPercent: 18, heliumPercent: 45, enabled: true }],
    settings: { booster: { minimumSourcePressureBar: 0, maxCompressorPressureBar: 350, maxBoosterOutputPressureBar: 350, cylinderVolumeCm3: 9, oxygenBoostBpm: 50, otherBoostBpm: 50, oxygenDecantRateBarPerMin: 5, otherDecantRateBarPerMin: 5, compressorInletFlowLPerMin: 100 } }
  });
  assert.equal(result.feasible, true);
  assert.ok(Math.abs(result.thermal.ambientSettledTargetPressureBar - 200) < 0.2);
  assert.ok(Math.abs(result.thermal.finalAmbientPressureBar - 200) < 0.2);
  assert.ok(Math.abs(result.thermal.finalAmbientTemperatureC - 25) < 1e-9);
  assert.ok(Math.abs(result.thermal.finalInWaterTemperatureC - 10) < 1e-9);
  assert.ok(Math.abs(result.thermal.finalInWaterPressureBar - 188.6) < 0.2);
  assert.equal(result.thermal.requestedInWaterPressureBar, 188.6);
  assert.equal(result.thermal.requestedInWaterTemperatureC, 10);
});

const thermalFailureFixture = {
  tankMaterial: 'steel',
  coolingMedium: 'air',
  ambientTemperatureC: 25,
  inletTemperatureC: 25,
  targetMediumTemperatureC: 25,
  targetInWaterTemperatureC: 10,
  waitMode: 'minutes',
  waitMinutes: 10,
  targetTemperatureC: 25
};

test('thermal initial infeasibility preserves requested target and maximum fallback state', () => {
  const result = optimizeBlend({
    ...defaultInput,
    cylinder: { ...defaultInput.cylinder, targetPressureBar: 200, targetOxygenPercent: 15, targetHeliumPercent: 55 },
    thermal: thermalFailureFixture,
    banks: [
      { id: 'he', name: 'Pure Helium', volumeL: 1, pressureBar: 10, maxPressureBar: 350, minimumPressureBar: 0, oxygenPercent: 0, heliumPercent: 100, enabled: true },
      { id: 'o2', name: 'Pure Oxygen', volumeL: 10, pressureBar: 100, maxPressureBar: 350, minimumPressureBar: 0, oxygenPercent: 100, heliumPercent: 0, enabled: true }
    ]
  });
  assert.equal(result.feasible, false);
  assert.equal(result.thermal.requestedInWaterPressureBar, 200);
  assert.equal(result.thermal.requestedInWaterTemperatureC, 10);
  assert.ok(result.thermal.ambientSettledTargetPressureBar > 200);
  assert.ok(result.maximumPressure);
});

test('thermal floor infeasibility prefixes the requested in-water pressure', () => {
  const result = optimizeBlend({
    ...defaultInput,
    cylinder: { ...defaultInput.cylinder, targetPressureBar: 300, targetOxygenPercent: 15, targetHeliumPercent: 55 },
    thermal: thermalFailureFixture,
    banks: [
      { id: 'he', name: 'Pure Helium', volumeL: 1, pressureBar: 10, maxPressureBar: 350, minimumPressureBar: 0, oxygenPercent: 0, heliumPercent: 100, enabled: true },
      { id: 'o2', name: 'Pure Oxygen', volumeL: 10, pressureBar: 100, maxPressureBar: 350, minimumPressureBar: 0, oxygenPercent: 100, heliumPercent: 0, enabled: true }
    ]
  });
  assert.equal(result.feasible, false);
  assert.match(result.error, /^Requested in-water pressure 300\.0 bar/);
  assert.match(result.error, /ambient/i);
});

test('thermal high-ceiling infeasibility retains requested and ambient target diagnostics', () => {
  const result = optimizeBlend({
    ...defaultInput,
    cylinder: { ...defaultInput.cylinder, targetPressureBar: 350 },
    thermal: thermalFailureFixture,
    banks: []
  });
  assert.equal(result.feasible, false);
  assert.equal(result.thermal.requestedInWaterPressureBar, 350);
  assert.equal(result.thermal.requestedInWaterTemperatureC, 10);
  assert.ok(result.thermal.ambientSettledTargetPressureBar > 350);
});

test('thermal no-maximum result leaves final state fields null', () => {
  const result = optimizeBlend({
    ...defaultInput,
    cylinder: { ...defaultInput.cylinder, targetPressureBar: 200, targetOxygenPercent: 100, targetHeliumPercent: 0 },
    thermal: thermalFailureFixture,
    banks: []
  });
  assert.equal(result.feasible, false);
  assert.equal(result.maximumPressure, null);
  assert.equal(result.thermal.finalAmbientPressureBar, null);
  assert.equal(result.thermal.finalAmbientTemperatureC, null);
  assert.equal(result.thermal.finalInWaterPressureBar, null);
  assert.equal(result.thermal.finalInWaterTemperatureC, null);
  assert.equal(result.thermal.requestedInWaterPressureBar, 200);
  assert.equal(result.thermal.requestedInWaterTemperatureC, 10);
});

const schedulerFixture = {
  cylinder: { volumeL: 12, initialPressureBar: 0, workingPressureBar: 80 },
  physics: { model: 'ideal', temperatureC: 20 },
  thermal: {
    tankMaterial: 'steel', coolingMedium: 'air', ambientTemperatureC: 20,
    inletTemperatureC: 40, targetMediumTemperatureC: 20, targetInWaterTemperatureC: 20,
    waitMode: 'minutes', waitMinutes: 0
  },
  settings: {}
};

test('scheduler enforces working pressure at above-ambient target-temperature waits', () => {
  const workingPressureBar = 100;
  const mix = { oxygenPercent: 21, heliumPercent: 0 };
  const scheduled = scheduleSafeThermalProtocol({
    ...schedulerFixture,
    cylinder: {
      ...schedulerFixture.cylinder,
      workingPressureBar,
      hotOverfillPercent: 5
    },
    thermal: {
      ...schedulerFixture.thermal,
      waitMode: 'temperature',
      targetMediumTemperatureC: 30,
      targetTemperatureC: 30,
      targetInWaterTemperatureC: 20
    },
    protocolSteps: [
      {
        type: 'boost',
        operation: 'Boost',
        receiverStartPressureBar: 0,
        receiverEndPressureBar: 99.5,
        resultingPressureBar: 99.5,
        resultingMix: mix,
        sourceOxygenPercent: 21,
        sourceHeliumPercent: 0,
        sourceStartPressureBar: 300,
        sourceEndPressureBar: 200,
        sourceVolumeL: 12
      },
      {
        type: 'keep',
        receiverStartPressureBar: 99.5,
        receiverEndPressureBar: 99.5,
        resultingPressureBar: 99.5,
        resultingMix: mix
      }
    ]
  });

  const targetWaitSteps = scheduled.protocolSteps.slice(0, -1).filter(step => (
    step.thermal?.temperatureAfterWaitC > schedulerFixture.thermal.ambientTemperatureC
  ));
  assert.ok(targetWaitSteps.length > 0);
  const exceedsWorkingPressure = targetWaitSteps.some(step => (
    step.thermal.pressureAfterWaitBar > workingPressureBar + 1e-7
  ));
  assert.ok(scheduled.unsafe || !exceedsWorkingPressure, JSON.stringify({
    unsafe: scheduled.unsafe,
    exceedsWorkingPressure,
    targetWaitSteps: targetWaitSteps.map(step => ({
      title: step.title,
      pressureAfterWaitBar: step.thermal.pressureAfterWaitBar,
      temperatureAfterWaitC: step.thermal.temperatureAfterWaitC,
      waitMinutes: step.thermal.waitMinutes
    }))
  }));
});

test('scheduler rejects an unsafe transfer after the 1440-minute ceiling', () => {
  const scheduled = scheduleSafeThermalProtocol({
    ...schedulerFixture,
    protocolSteps: [{
      type: 'boost',
      receiverStartPressureBar: 0,
      receiverEndPressureBar: 95,
      resultingPressureBar: 95,
      resultingMix: { oxygenPercent: 21, heliumPercent: 0 },
      sourceOxygenPercent: 21,
      sourceHeliumPercent: 0,
      sourceStartPressureBar: 200,
      sourceEndPressureBar: 100
    }]
  });
  assert.equal(scheduled.unsafe, true);
  assert.ok(scheduled.automaticWaits.every(wait => (
    wait.configuredWaitMinutes + wait.addedWaitMinutes <= 1440
  )));
});

test('scheduler reports split stages and warning metadata at a hot boundary', () => {
  const scheduled = scheduleSafeThermalProtocol({
    ...schedulerFixture,
    cylinder: { ...schedulerFixture.cylinder, workingPressureBar: 100 },
    protocolSteps: [{
      type: 'boost',
      receiverStartPressureBar: 0,
      receiverEndPressureBar: 95,
      resultingPressureBar: 95,
      resultingMix: { oxygenPercent: 21, heliumPercent: 0 },
      sourceOxygenPercent: 21,
      sourceHeliumPercent: 0,
      sourceStartPressureBar: 200,
      sourceEndPressureBar: 100
    }]
  });
  assert.ok(scheduled.protocolSteps.every(step => !step.thermal
    || step.thermal.pressureAtTransferEndBar <= 100 + 1e-7));
});

test('solves a nonzero minimum wait before the first transfer after keep', () => {
  const scheduled = scheduleSafeThermalProtocol({
    ...schedulerFixture,
    cylinder: {
      ...schedulerFixture.cylinder,
      initialOxygenPercent: 21,
      initialHeliumPercent: 0,
      workingPressureBar: 100,
      hotOverfillPercent: 0
    },
    physics: { model: 'ideal', temperatureC: 20 },
    thermal: {
      ...schedulerFixture.thermal,
      inletTemperatureC: 40,
      interimMeasurements: [{ pressureBar: 0, temperatureC: 40 }]
    },
    protocolSteps: [
      {
        type: 'keep',
        receiverStartPressureBar: 0,
        receiverEndPressureBar: 0,
        resultingPressureBar: 0,
        resultingMix: { oxygenPercent: 21, heliumPercent: 0 }
      },
      {
        type: 'boost',
        operation: 'Boost',
        receiverStartPressureBar: 0,
        receiverEndPressureBar: 95,
        resultingPressureBar: 95,
        resultingMix: { oxygenPercent: 21, heliumPercent: 0 },
        sourceOxygenPercent: 21,
        sourceHeliumPercent: 0,
        sourceStartPressureBar: 200,
        sourceEndPressureBar: 100,
        sourceVolumeL: 12
      }
    ]
  });
  assert.equal(scheduled.unsafe, false);
  const safetyWait = scheduled.protocolSteps.find(step => step._safetyWaitOnly);
  assert.ok(safetyWait);
  assert.ok(safetyWait.thermal.waitMinutes > 0);
  assert.equal(safetyWait.thermal.waitMinutes, safetyWait.thermal.automaticWaitMinutes);
  assert.equal(scheduled.automaticWaits.length, 1);
  assert.equal(scheduled.automaticWaits[0].actualWaitMinutes, safetyWait.thermal.waitMinutes);
  assert.ok(isSafeSimulation(scheduled.simulation, 100, {
    thermal: { ...schedulerFixture.thermal, inletTemperatureC: 40 },
    physics: { model: 'ideal', temperatureC: 40 },
    cylinder: { ...schedulerFixture.cylinder, workingPressureBar: 100 }
  }));
  const transfer = scheduled.protocolSteps.at(-1);
  assert.ok(transfer.thermal.pressureAtTransferEndBar <= 100 + 1e-7);
  assert.ok(transfer.thermal.samples.every(sample => (
    (sample.projectedPressureBar ?? sample.pressureBar) <= 100 + 1e-7
  )));
});

test('splits by transferred inventories and cools between safe transfer stages', () => {
  const scheduled = scheduleSafeThermalProtocol({
    ...schedulerFixture,
    cylinder: {
      ...schedulerFixture.cylinder,
      initialOxygenPercent: 21,
      initialHeliumPercent: 0,
      workingPressureBar: 100,
      hotOverfillPercent: 0
    },
    physics: { model: 'ideal', temperatureC: 20 },
    thermal: { ...schedulerFixture.thermal, inletTemperatureC: 30 },
    protocolSteps: [{
      type: 'boost',
      operation: 'Boost',
      receiverStartPressureBar: 0,
      receiverEndPressureBar: 98,
      resultingPressureBar: 98,
      resultingMix: { oxygenPercent: 21, heliumPercent: 0 },
      sourceOxygenPercent: 21,
      sourceHeliumPercent: 0,
      sourceStartPressureBar: 300,
      sourceEndPressureBar: 200,
      sourceVolumeL: 12
    }]
  });
  assert.equal(scheduled.unsafe, false);
  assert.ok(isSafeSimulation(scheduled.simulation, 100, {
    thermal: { ...schedulerFixture.thermal, inletTemperatureC: 30 },
    physics: { model: 'ideal', temperatureC: 20 },
    cylinder: { ...schedulerFixture.cylinder, workingPressureBar: 100 }
  }));
  const stages = scheduled.protocolSteps.filter(step => step.type === 'boost');
  assert.equal(stages.length, 2);
  assert.equal(scheduled.protocolSteps.filter(step => step._safetyWaitOnly).length, 2);
  assert.equal(stages.at(-1).receiverEndPressureBar, 98);
  assert.ok(stages[0].receiverEndMoles < stages[1].receiverEndMoles);
  assert.ok(stages[0].sourceEndMoles > stages[1].sourceEndMoles);
  assert.ok(Math.abs(
    stages.reduce((total, stage) => total + stage.sourceConsumedMoles, 0)
      - (stages[0].sourceStartMoles - stages.at(-1).sourceEndMoles)
  ) < 1e-9);
  assert.ok(Math.abs(
    stages.reduce((total, stage) => total + stage.sourceConsumedMoles, 0)
      - (stages.at(-1).receiverEndMoles - stages[0].receiverStartMoles)
  ) < 1e-9);
  const sourceOxygenMoles = stages.reduce(
    (total, stage) => total + stage.sourceConsumedMoles * stage.sourceOxygenPercent / 100,
    0
  );
  const sourceHeliumMoles = stages.reduce(
    (total, stage) => total + stage.sourceConsumedMoles * stage.sourceHeliumPercent / 100,
    0
  );
  assert.ok(Math.abs(
    sourceOxygenMoles
      - (stages.at(-1).receiverEndMoles * stages.at(-1).resultingMix.oxygenPercent / 100
        - stages[0].receiverStartMoles * stages[0].receiverStartMix.oxygenPercent / 100)
  ) < 1e-9);
  assert.ok(Math.abs(
    sourceHeliumMoles
      - (stages.at(-1).receiverEndMoles * stages.at(-1).resultingMix.heliumPercent / 100
        - stages[0].receiverStartMoles * stages[0].receiverStartMix.heliumPercent / 100)
  ) < 1e-9);
  for (const stage of stages) {
    assert.ok(stage.thermal.durationMinutes > 0);
    const pressureAtTransferEndStartTemperature = calculatePressureAtTemperature({
      pressureBar: stage.thermal.pressureAtTransferEndReferenceBar,
      oxygenPercent: stage.resultingMix.oxygenPercent,
      heliumPercent: stage.resultingMix.heliumPercent,
      fromTemperatureC: stage.thermal.pressureReferenceTemperatureC,
      toTemperatureC: stage.thermal.temperatureStartC,
      volumeL: 12,
      useVdw: false
    });
    assert.ok(Math.abs(
      stage.thermal.durationMinutes
        - (pressureAtTransferEndStartTemperature - stage.thermal.pressureStartBar)
          / stage.thermal.rateBarPerMin
    ) < 1e-9);
    assert.ok(stage.thermal.samples.every(sample => (
      (sample.projectedPressureBar ?? sample.pressureBar) <= 100 + 1e-7
    )));
  }
  const totalWait = scheduled.simulation.protocolSteps.reduce(
    (total, step) => total + step.thermal.waitMinutes,
    0
  );
  assert.ok(totalWait <= 1440 + 1e-7);
  assert.equal(
    scheduled.automaticWaits[0].actualWaitMinutes,
    scheduled.protocolSteps.find(step => step._safetyWaitOnly && step.thermal.automaticWaitMinutes > 0)
      .thermal.waitMinutes
  );
});
test('generated split waits carry the first hot endpoint and cooled inventory forward', () => {
  const scheduled = scheduleSafeThermalProtocol({
    ...schedulerFixture,
    cylinder: {
      ...schedulerFixture.cylinder,
      initialOxygenPercent: 21,
      initialHeliumPercent: 0,
      workingPressureBar: 100
    },
    physics: { model: 'ideal', temperatureC: 20 },
    thermal: { ...schedulerFixture.thermal, inletTemperatureC: 30 },
    protocolSteps: [{
      type: 'boost',
      operation: 'Boost',
      receiverStartPressureBar: 0,
      receiverEndPressureBar: 98,
      resultingPressureBar: 98,
      resultingMix: { oxygenPercent: 21, heliumPercent: 0 },
      sourceOxygenPercent: 21,
      sourceHeliumPercent: 0,
      sourceStartPressureBar: 300,
      sourceEndPressureBar: 200,
      sourceVolumeL: 12
    }]
  });
  const first = scheduled.protocolSteps.find(step => step.title?.includes('safe stage 1'));
  const wait = scheduled.protocolSteps.find(step => step._safetyWaitOnly && step.title?.includes('between safe'));
  const second = scheduled.protocolSteps.find(step => step.title?.includes('safe stage 2'));
  assert.ok(first);
  assert.ok(wait);
  assert.ok(second);
  assert.equal(wait.resultingMix.oxygenPercent, first.resultingMix.oxygenPercent);
  assert.equal(wait.resultingMix.heliumPercent, first.resultingMix.heliumPercent);
  assert.equal(wait.thermal.pressureAtTransferEndHotBar, first.thermal.pressureAtTransferEndHotBar);
  assert.equal(wait.thermal.receiverStartMix.oxygenPercent, first.resultingMix.oxygenPercent);
  assert.equal(wait.thermal.receiverStartMix.heliumPercent, first.resultingMix.heliumPercent);
  assert.equal(second.thermal.receiverStartMix.oxygenPercent, first.resultingMix.oxygenPercent);
  assert.equal(second.thermal.receiverStartMix.heliumPercent, first.resultingMix.heliumPercent);
  assert.equal(second.thermal.pressureStartBar, wait.thermal.pressureAfterWaitBar);
  assert.equal(second.thermal.temperatureStartC, wait.thermal.temperatureAfterWaitC);
});
test('finite-source split inventories convert reference pressure to common ambient temperature', () => {
  const scheduled = scheduleSafeThermalProtocol({
    ...schedulerFixture,
    cylinder: {
      ...schedulerFixture.cylinder,
      initialOxygenPercent: 21,
      initialHeliumPercent: 0,
      workingPressureBar: 100
    },
    physics: { model: 'ideal', temperatureC: 30 },
    thermal: { ...schedulerFixture.thermal, inletTemperatureC: 30 },
    protocolSteps: [{
      type: 'boost',
      operation: 'Boost',
      receiverStartPressureBar: 0,
      receiverEndPressureBar: 120,
      resultingPressureBar: 120,
      resultingMix: { oxygenPercent: 21, heliumPercent: 0 },
      sourceOxygenPercent: 21,
      sourceHeliumPercent: 0,
      sourceStartPressureBar: 300,
      sourceEndPressureBar: 200,
      sourceVolumeL: 12
    }]
  });
  const stages = scheduled.protocolSteps.filter(step => step.type === 'boost');
  assert.equal(stages.length, 2);
  const sourceStartPressureAtAmbient = calculatePressureAtTemperature({
    pressureBar: 300,
    oxygenPercent: 21,
    heliumPercent: 0,
    fromTemperatureC: 30,
    toTemperatureC: 20,
    volumeL: 12,
    useVdw: false
  });
  const receiverEndPressureAtAmbient = calculatePressureAtTemperature({
    pressureBar: 120,
    oxygenPercent: 21,
    heliumPercent: 0,
    fromTemperatureC: 30,
    toTemperatureC: 20,
    volumeL: 12,
    useVdw: false
  });
  const expectedSourceStartMoles = calcMolarDensity(
    sourceStartPressureAtAmbient, 21, 0, 20, false
  ) * 12;
  const expectedReceiverEndMoles = calcMolarDensity(
    receiverEndPressureAtAmbient, 21, 0, 20, false
  ) * 12;
  assert.ok(Math.abs(stages[0].sourceStartMoles - expectedSourceStartMoles) < 1e-9);
  assert.ok(Math.abs(stages.at(-1).receiverEndMoles - expectedReceiverEndMoles) < 1e-9);
});

test('optimizer returns a safe split protocol near the thermal working-pressure ceiling', () => {
  const result = optimizeBlend({
    cylinder: {
      volumeL: 12,
      initialPressureBar: 0,
      initialOxygenPercent: 21,
      initialHeliumPercent: 0,
      targetPressureBar: 99.5,
      targetOxygenPercent: 21,
      targetHeliumPercent: 0,
      workingPressureBar: 100,
      hotOverfillPercent: 0
    },
    physics: { model: 'ideal', temperatureC: 20 },
    thermal: {
      tankMaterial: 'steel',
      coolingMedium: 'air',
      ambientTemperatureC: 20,
      inletTemperatureC: 40,
      targetMediumTemperatureC: 20,
      targetInWaterTemperatureC: 20,
      waitMode: 'minutes',
      waitMinutes: 0
    },
    settings: { booster: { compressorInletFlowLPerMin: 100 } },
    banks: []
  });
  assert.equal(result.feasible, true, result.error);
  assert.equal(result.maximumPressure, null);
  assert.ok(Math.abs(result.thermal.finalAmbientPressureBar - 99.5) < 1e-7);
  assert.ok(result.thermal.finalTransferEndPressureBar <= 100 + 1e-7);
  const transferSteps = result.protocolSteps.filter(step => (
    step.type === 'boost' || step.type === 'decant'
  ));
  assert.ok(transferSteps.length >= 2);
  for (const step of transferSteps) {
    const pressures = [
      step.thermal.pressureAtTransferEndReferenceBar,
      step.thermal.pressureAtTransferEndAmbientBar,
      step.thermal.pressureAtTransferEndHotBar,
      step.thermal.pressureAfterWaitBar,
      ...(step.thermal.samples ?? []).map(sample => (
        sample.ambientPressureBar ?? sample.projectedPressureBar ?? sample.pressureBar
      ))
    ];
    assert.ok(pressures.every(pressure => pressure <= 100 + 1e-7));
  }
});


test('scheduler preserves interim measurement identity across inserted waits', () => {
  const thermal = {
    ...schedulerFixture,
    interimMeasurements: [
      { pressureBar: 0, temperatureC: 40 },
      { pressureBar: 0, temperatureC: 40 },
      { pressureBar: 95, temperatureC: 20 }
    ]
  };
  const scheduled = scheduleSafeThermalProtocol({
    ...schedulerFixture,
    cylinder: {
      ...schedulerFixture.cylinder,
      initialOxygenPercent: 21,
      initialHeliumPercent: 0,
      workingPressureBar: 100,
      hotOverfillPercent: 0
    },
    physics: { model: 'ideal', temperatureC: 40 },
    thermal: {
      ...thermal.thermal,
      interimMeasurements: thermal.interimMeasurements
    },
    protocolSteps: [
      {
        id: 'keep',
        type: 'keep',
        receiverStartPressureBar: 0,
        receiverEndPressureBar: 0,
        resultingPressureBar: 0,
        resultingMix: { oxygenPercent: 21, heliumPercent: 0 }
      },
      {
        id: 'first-transfer',
        type: 'boost',
        operation: 'Boost',
        receiverStartPressureBar: 0,
        receiverEndPressureBar: 100,
        resultingPressureBar: 100,
        resultingMix: { oxygenPercent: 21, heliumPercent: 0 },
        sourceOxygenPercent: 21,
        sourceHeliumPercent: 0,
        sourceStartPressureBar: 200,
        sourceEndPressureBar: 100,
        sourceVolumeL: 12
      },
      {
        id: 'second-transfer',
        type: 'boost',
        operation: 'Boost',
        receiverStartPressureBar: 100,
        receiverEndPressureBar: 100,
        resultingPressureBar: 100,
        resultingMix: { oxygenPercent: 21, heliumPercent: 0 },
        sourceOxygenPercent: 21,
        sourceHeliumPercent: 0,
        sourceStartPressureBar: 200,
        sourceEndPressureBar: 100,
        sourceVolumeL: 12
      }
    ]
  });
  assert.equal(scheduled.unsafe, false, JSON.stringify({
    waits: scheduled.automaticWaits,
    steps: scheduled.protocolSteps.map(step => ({
      id: step.id,
      type: step.type,
      start: step.thermal?.pressureStartBar,
      reference: step.thermal?.pressureAtTransferEndReferenceBar,
      ambient: step.thermal?.pressureAtTransferEndAmbientBar,
      hot: step.thermal?.pressureAtTransferEndHotBar,
      afterWait: step.thermal?.pressureAfterWaitBar,
      temperatureStart: step.thermal?.temperatureStartC,
      temperatureEnd: step.thermal?.temperatureAtTransferEndC
    }))
  }));
  const keep = scheduled.protocolSteps.find(step => step.id === 'keep');
  const first = scheduled.protocolSteps.find(step => step.id === 'first-transfer');
  const second = scheduled.protocolSteps.find(step => step.id === 'second-transfer');
  assert.equal(keep.thermal.measuredStartPressureBar, 0);
  assert.equal(keep.thermal.measuredStartTemperatureC, 40);
  assert.equal(first.thermal.measuredStartPressureBar, 0);
  assert.equal(first.thermal.measuredStartTemperatureC, 40);
  assert.equal(second.thermal.measuredStartPressureBar, 95);
  assert.equal(second.thermal.measuredStartTemperatureC, 20);
  assert.ok(scheduled.protocolSteps.some(step => step._measurementIndex === null));
});

test('scheduler projects endpoints from the physics pressure reference temperature', () => {
  const scheduled = scheduleSafeThermalProtocol({
    ...schedulerFixture,
    cylinder: {
      ...schedulerFixture.cylinder,
      initialOxygenPercent: 21,
      initialHeliumPercent: 0,
      workingPressureBar: 100,
      hotOverfillPercent: 0
    },
    physics: { model: 'ideal', temperatureC: 30 },
    thermal: { ...schedulerFixture.thermal, inletTemperatureC: 40 },
    protocolSteps: [{
      type: 'boost',
      operation: 'Boost',
      receiverStartPressureBar: 0,
      receiverEndPressureBar: 98,
      resultingPressureBar: 98,
      resultingMix: { oxygenPercent: 21, heliumPercent: 0 },
      sourceOxygenPercent: 21,
      sourceHeliumPercent: 0,
      sourceStartPressureBar: 300,
      sourceEndPressureBar: 200,
      sourceVolumeL: 12
    }]
  });
  assert.equal(scheduled.unsafe, false);
  assert.ok(isSafeSimulation(scheduled.simulation, 100, {
    thermal: { ...schedulerFixture.thermal, inletTemperatureC: 40 },
    physics: { model: 'ideal', temperatureC: 30 },
    cylinder: { ...schedulerFixture.cylinder, workingPressureBar: 100 }
  }));
  for (const step of scheduled.protocolSteps) {
    const state = step.thermal;
    if (!state) continue;
    assert.equal(state.pressureReferenceTemperatureC, 30);
    const expectedHotPressure = calculatePressureAtTemperature({
      pressureBar: state.pressureAtTransferEndReferenceBar,
      oxygenPercent: step.resultingMix?.oxygenPercent ?? 21,
      heliumPercent: step.resultingMix?.heliumPercent ?? 0,
      fromTemperatureC: 30,
      toTemperatureC: state.temperatureAtTransferEndC,
      volumeL: 12,
      useVdw: false
    });
    assert.ok(Math.abs(expectedHotPressure - state.pressureAtTransferEndBar) < 1e-9);
    assert.ok(expectedHotPressure <= 100 + 1e-7);
  }
});

test('compressor-air splits keep the source effectively unlimited', () => {
  const scheduled = scheduleSafeThermalProtocol({
    ...schedulerFixture,
    cylinder: {
      ...schedulerFixture.cylinder,
      initialOxygenPercent: 21,
      initialHeliumPercent: 0,
      workingPressureBar: 100
    },
    physics: { model: 'ideal', temperatureC: 20 },
    thermal: { ...schedulerFixture.thermal, inletTemperatureC: 30 },
    protocolSteps: [{
      type: 'boost',
      operation: 'Top-up',
      recipeGas: 'Compressor Air',
      receiverStartPressureBar: 0,
      receiverEndPressureBar: 98,
      resultingPressureBar: 98,
      sourceOxygenPercent: 21,
      sourceHeliumPercent: 0,
      sourceStartPressureBar: 350,
      sourceEndPressureBar: 350,
      sourceVolumeL: 1
    }]
  });
  assert.equal(scheduled.unsafe, false);
  const stages = scheduled.protocolSteps.filter(step => step.type === 'boost');
  assert.equal(stages.length, 2);
  for (const stage of stages) {
    assert.equal(stage.sourceInventory, 'unlimited');
    assert.equal(stage.sourceStartMoles, null);
    assert.equal(stage.sourceEndMoles, null);
    assert.equal(stage.sourceVolumeL, null);
    assert.equal(stage.sourceOxygenPercent, 21);
    assert.equal(stage.sourceHeliumPercent, 0);
    assert.equal(stage.thermal.rateSource, 'compressor');
    assert.equal(stage.sourceStartPressureBar, 350);
    assert.equal(stage.sourceEndPressureBar, 350);
  }
});
test('thermal safety allows transient hot overfill but keeps settled pressure at working pressure', () => {
  const cylinder = {
    volumeL: 12,
    initialPressureBar: 0,
    targetPressureBar: 100,
    targetOxygenPercent: 21,
    targetHeliumPercent: 0,
    workingPressureBar: 100,
    hotOverfillPercent: 2
  };
  const thermal = { ambientTemperatureC: 20, targetInWaterTemperatureC: 10 };
  const physics = { model: 'ideal' };
  const state = {
    pressureStartBar: 0,
    temperatureStartC: 20,
    pressureAtTransferEndReferenceBar: 100,
    pressureAtTransferEndAmbientBar: 100,
    pressureAtTransferEndBar: 101.5,
    pressureAtTransferEndHotBar: 101.5,
    temperatureAtTransferEndC: 40,
    pressureAfterWaitBar: 100,
    temperatureAfterWaitC: 20,
    pressureReferenceTemperatureC: 20,
    samples: [
      { ambientPressureBar: 100, projectedPressureBar: 101.5, temperatureC: 40 },
      { ambientPressureBar: 100, projectedPressureBar: 100, temperatureC: 20 }
    ]
  };
  const simulation = { protocolSteps: [{ thermal: state }] };
  const context = { thermal, physics, cylinder, settings: {} };

  assert.equal(isSafeSimulation(simulation, 100, context), true);
  assert.equal(isSafeSimulation({
    protocolSteps: [{
      thermal: {
        ...state,
        pressureAtTransferEndBar: 102,
        pressureAtTransferEndHotBar: 102,
        samples: [{ ambientPressureBar: 100, projectedPressureBar: 102, temperatureC: 40 }]
      }
    }]
  }, 100, context), true);
  assert.equal(isSafeSimulation({
    protocolSteps: [{
      thermal: {
        ...state,
        pressureAtTransferEndBar: 102.1,
        pressureAtTransferEndHotBar: 102.1,
        samples: [{ ambientPressureBar: 100, projectedPressureBar: 102.1, temperatureC: 40 }]
      }
    }]
  }, 100, context), false);
  assert.equal(isSafeSimulation({
    protocolSteps: [{
      thermal: { ...state, pressureAtTransferEndAmbientBar: 100.1 }
    }]
  }, 100, context), false);
  assert.equal(isSafeSimulation(simulation, 100, {
    ...context,
    cylinder: { ...cylinder, hotOverfillPercent: 0 }
  }), false);
});

test('Hard stop retains hot overfill for measured warm interim starts', () => {
  const cylinder = {
    volumeL: 12,
    initialPressureBar: 0,
    workingPressureBar: 100,
    hotOverfillPercent: 5
  };
  const thermal = {
    ambientTemperatureC: 20,
    waitMode: 'temperature',
    targetMediumTemperatureC: 30
  };
  const state = {
    pressureStartBar: 101.5,
    temperatureStartC: 30,
    measurementApplied: true,
    measuredStartPressureBar: 101.5,
    measuredStartTemperatureC: 30,
    pressureAtTransferEndAmbientBar: 100,
    pressureAtTransferEndHotBar: 101.5,
    temperatureAtTransferEndC: 40,
    pressureAfterWaitBar: 100,
    temperatureAfterWaitC: 20,
    samples: []
  };

  assert.equal(isSafeSimulation({ protocolSteps: [{ thermal: state }] }, 100, {
    thermal,
    physics: { model: 'ideal' },
    cylinder,
    settings: {}
  }), true);
});

test('Hard stop applies working pressure at an above-ambient target-temperature wait', () => {
  const cylinder = {
    volumeL: 12,
    initialPressureBar: 0,
    workingPressureBar: 100,
    hotOverfillPercent: 5
  };
  const thermal = {
    ambientTemperatureC: 20,
    waitMode: 'temperature',
    targetMediumTemperatureC: 30,
    targetTemperatureC: 30
  };
  const state = {
    pressureStartBar: 0,
    temperatureStartC: 20,
    pressureAtTransferEndAmbientBar: 100,
    pressureAtTransferEndHotBar: 101.5,
    temperatureAtTransferEndC: 40,
    pressureAfterWaitBar: 101.5,
    temperatureAfterWaitC: 30,
    durationMinutes: 1,
    waitMinutes: 1,
    samples: [{
      elapsedMinutes: 2,
      ambientPressureBar: 100,
      projectedPressureBar: 101.5,
      temperatureC: 30
    }]
  };

  assert.equal(isSafeSimulation({ protocolSteps: [{ thermal: state }] }, 100, {
    thermal,
    physics: { model: 'ideal' },
    cylinder,
    settings: {}
  }), false);
});

test('hot overfill preserves the requested ambient and target pressure at safe endpoints', () => {
  const workingPressureBar = 99.01;
  const result = optimizeBlend({
    cylinder: {
      volumeL: 12,
      initialPressureBar: 95,
      initialOxygenPercent: 0,
      initialHeliumPercent: 0,
      targetPressureBar: 99,
      targetOxygenPercent: 4,
      targetHeliumPercent: 0.2,
      workingPressureBar,
      hotOverfillPercent: 2
    },
    physics: { model: 'ideal', temperatureC: 20 },
    thermal: {
      tankMaterial: 'steel',
      coolingMedium: 'air',
      ambientTemperatureC: 20,
      inletTemperatureC: 40,
      targetMediumTemperatureC: 20,
      targetInWaterTemperatureC: 20,
      waitMode: 'minutes',
      waitMinutes: 0
    },
    settings: {
      booster: {
        otherBoostBpm: 50,
        oxygenBoostBpm: 50,
        otherDecantRateBarPerMin: 5,
        oxygenDecantRateBarPerMin: 5,
        cylinderVolumeCm3: 9,
        minimumSourcePressureBar: 0
      }
    },
    banks: [
      { id: 'o2', name: 'Oxygen', volumeL: 12, pressureBar: 300, maxPressureBar: 350, minimumPressureBar: 0, oxygenPercent: 100, heliumPercent: 0, enabled: true },
      { id: 'he', name: 'Helium', volumeL: 12, pressureBar: 300, maxPressureBar: 350, minimumPressureBar: 0, oxygenPercent: 0, heliumPercent: 100, enabled: true }
    ]
  });

  assert.equal(result.feasible, true, result.error);
  assert.ok(Math.abs(result.thermal.finalAmbientPressureBar - 99) < 1e-5);
  assert.ok(result.thermal.finalAmbientPressureBar <= workingPressureBar);
  assert.ok(result.thermal.finalInWaterPressureBar <= workingPressureBar);
  const hotPressures = result.protocolSteps.flatMap(step => (
    step.thermal?.temperatureAtTransferEndC > 20
      ? [step.thermal.pressureAtTransferEndHotBar]
      : []
  ));
  assert.ok(hotPressures.some(pressure => pressure > workingPressureBar));
  assert.ok(hotPressures.every(pressure => pressure <= workingPressureBar * 1.02));
});
test('rejects invalid explicit hot-overfill values in safety helpers', () => {
  const cylinder = {
    volumeL: 12,
    initialPressureBar: 0,
    workingPressureBar: 100,
    hotOverfillPercent: 2.25
  };
  const thermal = { ambientTemperatureC: 20 };
  const physics = { model: 'ideal', temperatureC: 20 };

  assert.throws(
    () => isSafeSimulation({ protocolSteps: [] }, 100, { cylinder }),
    /hot overfill/i
  );
  assert.throws(
    () => scheduleSafeThermalProtocol({
      protocolSteps: [],
      cylinder,
      physics,
      thermal,
      settings: {}
    }),
    /hot overfill/i
  );
});

function leftoverBank({ id, oxygenPercent, heliumPercent, pressureBar, maxPressureBar = 200, volumeL = 50, enabled = true }) {
  return {
    id,
    name: id,
    volumeL,
    pressureBar,
    oxygenPercent,
    heliumPercent,
    maxPressureBar,
    minimumPressureBar: 10,
    enabled,
    isCompressor: false
  };
}

function drainSalvageInput(banks) {
  return {
    cylinder: {
      volumeL: 12,
      initialPressureBar: 150,
      initialOxygenPercent: 21,
      initialHeliumPercent: 35,
      targetPressureBar: 100,
      targetOxygenPercent: 21,
      targetHeliumPercent: 35
    },
    physics: { model: 'vdw', temperatureC: 20 },
    banks
  };
}

test('salvage moves drained gas into an attractive leftover bank before the vent drain', () => {
  const input = drainSalvageInput([leftoverBank({ id: 'bank-n', oxygenPercent: 32, heliumPercent: 0, pressureBar: 20 })]);
  const baseline = optimizeBlend(drainSalvageInput([]));
  const result = optimizeBlend(input);

  assert.equal(result.feasible, true);
  const salvageIndex = result.protocolSteps.findIndex(step => step.type === 'salvage');
  const drainIndex = result.protocolSteps.findIndex(step => step.type === 'drain');
  assert.ok(salvageIndex >= 0, 'expected a salvage step');
  assert.ok(drainIndex < 0 || salvageIndex < drainIndex, 'salvage must precede the vent drain');
  assert.ok(result.blend.heliumVentedLitres < baseline.blend.heliumVentedLitres);
});

test('partial salvage is followed by the vent drain down to the retained pressure', () => {
  // The receiver's 30 bar ceiling caps the salvage below the surplus, so the tank is still
  // above its retained pressure after the salvage steps and the drain follows them.
  const input = drainSalvageInput([leftoverBank({ id: 'bank-n', oxygenPercent: 32, heliumPercent: 0, pressureBar: 20, maxPressureBar: 30 })]);
  const result = optimizeBlend(input);

  assert.equal(result.feasible, true);
  const types = result.protocolSteps.map(step => step.type);
  const salvageIndex = types.lastIndexOf('salvage');
  const drainIndex = types.indexOf('drain');
  assert.ok(salvageIndex >= 0, 'expected a salvage step');
  assert.equal(drainIndex, salvageIndex + 1, 'the drain follows the salvage steps');
  assert.equal(types.includes('keep'), false, 'no keep when the drain runs');
  const salvagePressure = result.protocolSteps[salvageIndex].resultingPressureBar;
  const drainPressure = result.protocolSteps[drainIndex].resultingPressureBar;
  assert.ok(salvagePressure > drainPressure + 1, 'the drain starts above its retained pressure');
  assert.ok(Math.abs(drainPressure - 100) < 0.01, 'the drain ends at the retained pressure');
  const salvageTitle = result.protocolSteps[salvageIndex].title;
  assert.match(salvageTitle, /^Salvage: (decant|boost) into .+ to [0-9]+\.[0-9] bar$/);
});

test('salvage never fills a receiver already at its maximum pressure', () => {
  const input = drainSalvageInput([leftoverBank({ id: 'bank-full', oxygenPercent: 32, heliumPercent: 0, pressureBar: 200, maxPressureBar: 200 })]);
  const result = optimizeBlend(input);

  assert.equal(result.feasible, true);
  assert.equal(result.protocolSteps.some(step => step.type === 'salvage'), false);
});

test('salvage with no eligible receivers matches the vent-only result exactly', () => {
  const input = drainSalvageInput([leftoverBank({ id: 'bank-off', oxygenPercent: 32, heliumPercent: 0, pressureBar: 20, enabled: false })]);
  const result = optimizeBlend(input);

  assert.deepEqual(result, optimizeBlend({ ...input, _salvage: false }));
  assert.equal(result.protocolSteps.some(step => step.type === 'salvage'), false);
});

test('salvage can be disabled by the internal flag and falls back to the vent', () => {
  const input = drainSalvageInput([leftoverBank({ id: 'bank-n', oxygenPercent: 32, heliumPercent: 0, pressureBar: 20 })]);
  const disabled = optimizeBlend({ ...input, _salvage: false });
  const ventOnly = optimizeBlend(drainSalvageInput([]));

  assert.equal(disabled.protocolSteps.some(step => step.type === 'salvage'), false);
  assert.equal(disabled.blend.heliumVentedLitres, ventOnly.blend.heliumVentedLitres);
});

test('default preservation case keeps the cylinder gas without salvage', () => {
  const result = optimizeBlend(defaultInput);

  assert.equal(result.feasible, true);
  assert.equal(result.protocolSteps[0].type, 'keep');
  assert.equal(result.protocolSteps.some(step => step.type === 'salvage'), false);
});

test('default input matches the salvage-off result apart from salvage-only fields', () => {
  const withSalvage = optimizeBlend(defaultInput);
  const withoutSalvage = optimizeBlend({ ...defaultInput, _salvage: false });
  const { salvageTransfers, salvageBanks, ...rest } = withSalvage;

  assert.deepEqual(rest, withoutSalvage);
  assert.equal('lpCost' in withSalvage, false);
  assert.equal('lpCost' in withoutSalvage, false);
});

test('salvage declines a receiver whose transfer would lose the target and vents instead', () => {
  const baseline = optimizeBlend(drainSalvageInput([]));
  const input = drainSalvageInput([leftoverBank({ id: 'bank-rich', oxygenPercent: 12, heliumPercent: 65, pressureBar: 150 })]);
  const result = optimizeBlend(input);

  assert.equal(result.feasible, true);
  assert.equal(result.protocolSteps.some(step => step.type === 'salvage'), false);
  assert.ok(Math.abs(result.blend.heliumVentedLitres - baseline.blend.heliumVentedLitres) < 1e-9);
});

test('thermal fallback returns the feasible vent baseline when the salvage winner is thermally infeasible', () => {
  const input = {
    ...drainSalvageInput([leftoverBank({ id: 'bank-src', oxygenPercent: 21, heliumPercent: 35, pressureBar: 40 })]),
    thermal: {
      tankMaterial: 'steel',
      coolingMedium: 'air',
      ambientTemperatureC: 20,
      inletTemperatureC: 20,
      targetMediumTemperatureC: 20,
      targetInWaterTemperatureC: 20,
      waitMode: 'minutes',
      waitMinutes: 0
    }
  };
  const withoutThermal = ({ thermal: ignored, ...rest }) => rest;
  const staticSolve = candidate => (candidate._salvage === false
    ? optimizeBlend(withoutThermal(candidate))
    : { feasible: false, error: 'injected: salvage winner has no feasible thermal plan' });

  assert.ok(
    optimizeBlend(withoutThermal(input)).protocolSteps.some(step => step.type === 'salvage'),
    'scenario must have a salvage winner in the static search'
  );
  const result = solveThermalWithSalvageFallback(input, staticSolve);
  const expected = optimizeBlend({ ...input, _salvage: false });

  assert.equal(result.feasible, true);
  assert.equal(result.protocolSteps.some(step => step.type === 'salvage'), false);
  assert.deepEqual(result.protocolSteps, expected.protocolSteps);
  assert.deepEqual(result.blend, expected.blend);
});

test('salvage keeps the receiver end state consistent with the salvaged bank', () => {
  const input = drainSalvageInput([leftoverBank({ id: 'bank-src', oxygenPercent: 21, heliumPercent: 35, pressureBar: 40 })]);
  const result = optimizeBlend(input);

  const salvageSteps = result.protocolSteps.filter(step => step.type === 'salvage');
  assert.ok(salvageSteps.length > 0, 'expected a salvage step');
  assert.equal(result.salvageTransfers.length, salvageSteps.length);
  const last = salvageSteps[salvageSteps.length - 1];
  const receiver = result.salvageBanks.find(bank => bank.id === last.receiverBankId);
  assert.ok(Math.abs(receiver.pressureBar - last.receiverEndPressureBar) < 1e-9);
  assert.equal(receiver.oxygenPercent, last.receiverEndMix.oxygenPercent);
  assert.equal(receiver.heliumPercent, last.receiverEndMix.heliumPercent);
});

test('thermal salvage step cools the tank while its pressure falls', () => {
  const input = {
    ...drainSalvageInput([leftoverBank({ id: 'bank-n', oxygenPercent: 32, heliumPercent: 0, pressureBar: 20 })]),
    thermal: {
      tankMaterial: 'steel',
      coolingMedium: 'air',
      ambientTemperatureC: 20,
      inletTemperatureC: 40,
      targetMediumTemperatureC: 20,
      targetInWaterTemperatureC: 20,
      waitMode: 'minutes',
      waitMinutes: 0
    },
    settings: { booster: { compressorInletFlowLPerMin: 100 } }
  };
  const result = optimizeBlend(input);

  assert.equal(result.feasible, true);
  const salvage = result.protocolSteps.find(step => step.type === 'salvage');
  assert.ok(salvage?.thermal, 'expected a thermal salvage step');
  assert.ok(salvage.thermal.temperatureAtTransferEndC < salvage.thermal.temperatureStartC);
  assert.ok(salvage.resultingPressureBar < input.cylinder.initialPressureBar);
});

// Salvage that moves the whole vent surplus into a leftover bank, with the drained cylinder
// then decanted from the recipe banks. Retained cylinder moles are unchanged by the salvage.
function salvageThenDecantInput({ thermal } = {}) {
  return {
    cylinder: {
      volumeL: 12,
      initialPressureBar: 150,
      initialOxygenPercent: 32,
      initialHeliumPercent: 0,
      targetPressureBar: 100,
      targetOxygenPercent: 21,
      targetHeliumPercent: 35
    },
    physics: { model: 'vdw', temperatureC: 20 },
    banks: [
      { id: 'bank-he', name: 'Pure Helium', volumeL: 50, pressureBar: 200, maxPressureBar: 350, minimumPressureBar: 15, oxygenPercent: 0, heliumPercent: 100, enabled: true },
      { id: 'bank-o2', name: 'Pure Oxygen', volumeL: 40, pressureBar: 180, maxPressureBar: 350, minimumPressureBar: 10, oxygenPercent: 100, heliumPercent: 0, enabled: true },
      { id: 'bank-n', name: 'Leftover N', volumeL: 50, pressureBar: 20, maxPressureBar: 200, minimumPressureBar: 10, oxygenPercent: 32, heliumPercent: 0, enabled: true }
    ],
    settings: { booster: { maxCompressorPressureBar: 350, maxBoosterOutputPressureBar: 350 } },
    ...(thermal ? { thermal } : {})
  };
}

const SALVAGE_THERMAL = {
  tankMaterial: 'steel',
  coolingMedium: 'air',
  ambientTemperatureC: 20,
  inletTemperatureC: 40,
  targetMediumTemperatureC: 20,
  targetInWaterTemperatureC: 20,
  waitMode: 'minutes',
  waitMinutes: 0
};

test('thermal trajectory maps bank points to recipe decants, never to salvage steps', () => {
  const result = optimizeBlend(salvageThenDecantInput({ thermal: SALVAGE_THERMAL }));
  assert.equal(result.feasible, true);
  assert.equal(result.salvageTransfers.length, 1);

  const decantPressures = result.protocolSteps
    .filter(step => step.type === 'decant')
    .map(step => step.resultingPressureBar);
  const bankPoints = result.trajectory.filter(point => point.bankId);
  assert.equal(bankPoints.length, decantPressures.length);
  bankPoints.forEach((point, index) => {
    assert.ok(Math.abs(point.pressureBar - decantPressures[index]) < 1e-6,
      `bank point ${index} at ${point.pressureBar} bar, expected decant ${decantPressures[index]} bar`);
  });
});

test('salvage that takes the whole surplus emits no drain and no keep step', () => {
  for (const thermal of [undefined, SALVAGE_THERMAL]) {
    const result = optimizeBlend(salvageThenDecantInput({ thermal }));
    assert.equal(result.feasible, true);
    assert.ok(Math.abs(result.blend.ventedGasLitres) < 1e-6, 'salvage takes the whole surplus');
    const types = result.protocolSteps.map(step => step.type);
    assert.equal(types[0], 'salvage');
    assert.equal(types.includes('drain'), false);
    assert.equal(types.includes('keep'), false);
  }
});

test('thermal salvage search runs once per optimize, not once per thermal candidate', () => {
  const calls = [];
  const result = solveThermalWithSalvageFallback(
    salvageThenDecantInput({ thermal: SALVAGE_THERMAL }),
    optimizerModule.optimizeBlendWithoutThermal,
    { searchSalvage: candidate => { calls.push(candidate); return optimizerModule.searchSalvageVariant(candidate); } }
  );
  assert.equal(result.feasible, true);
  assert.equal(result.salvageTransfers.length, 1);
  assert.equal(calls.length, 1);
});

test('salvage that keeps the cylinder retained gas unchanged is accepted and moves the whole surplus', () => {
  const input = salvageThenDecantInput();
  const baseline = optimizeBlend({ ...input, _salvage: false });
  const result = optimizeBlend(input);

  assert.equal(result.feasible, true);
  assert.equal(result.salvageTransfers.length, 1);
  assert.equal(result.salvageTransfers[0].receiverBankId, 'bank-n');
  assert.ok(Math.abs(result.salvageTransfers[0].movedMoles - baseline.blend.ventedMoles) < 1e-6,
    'salvage moves exactly the baseline vented moles');
  assert.ok(Math.abs(result.solution.x_cyl - baseline.solution.x_cyl) <= 1e-9 * Math.max(1, baseline.solution.x_cyl));
});

test('salvage search ignores invalid input and reports the usual invalid result', () => {
  const input = drainSalvageInput([leftoverBank({ id: 'bank-n', oxygenPercent: 32, heliumPercent: 0, pressureBar: 20 })]);
  const thermal = {
    tankMaterial: 'steel',
    ambientTemperatureC: 20,
    inletTemperatureC: 20,
    targetMediumTemperatureC: 25,
    targetInWaterTemperatureC: 20,
    waitMode: 'minutes',
    waitMinutes: 10,
    targetTemperatureC: 25
  };
  const withoutPhysics = { ...input, physics: undefined };
  assert.equal(optimizerModule.searchSalvageVariant(withoutPhysics), null);
  assert.equal(optimizerModule.searchSalvageVariant({ ...withoutPhysics, thermal }), null);

  const result = optimizeBlend({ ...withoutPhysics, thermal });
  assert.equal(result.feasible, false);
  assert.equal(result.blend, null);
  assert.match(result.error, /^Invalid blend input:/);
});
