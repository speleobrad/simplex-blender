import test from 'node:test';
import assert from 'node:assert/strict';
import { optimizeBlend } from '../js/optimizer.js';

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
    { id: 'bank-he', name: 'Pure Helium', volumeL: 50, pressureBar: 200, minimumPressureBar: 15, oxygenPercent: 0, heliumPercent: 100, enabled: true },
    { id: 'bank-1845', name: 'Tx 18/45 Bank', volumeL: 50, pressureBar: 200, minimumPressureBar: 20, oxygenPercent: 18, heliumPercent: 45, enabled: true },
    { id: 'bank-o2', name: 'Pure Oxygen', volumeL: 40, pressureBar: 180, minimumPressureBar: 10, oxygenPercent: 100, heliumPercent: 0, enabled: true },
    { id: 'bank-air', name: 'Air Top-off', volumeL: 80, pressureBar: 230, minimumPressureBar: 1, oxygenPercent: 21, heliumPercent: 0, enabled: true }
  ]
};
function equalGasTransferInput({ initialPressureBar, targetPressureBar, bankPressureBar }) {
  return {
    cylinder: {
      volumeL: 10,
      initialPressureBar,
      initialOxygenPercent: 21,
      initialHeliumPercent: 0,
      targetPressureBar,
      targetOxygenPercent: 21,
      targetHeliumPercent: 0
    },
    physics: { model: 'ideal', temperatureC: 20 },
    banks: [{
      id: 'air',
      name: 'Air bank',
      volumeL: 10,
      pressureBar: bankPressureBar,
      minimumPressureBar: 0,
      oxygenPercent: 21,
      heliumPercent: 0,
      enabled: true
    }]
  };
}

test('uses one booster minimum source pressure for every supply bank', () => {
  const result = optimizeBlend({
    cylinder: {
      volumeL: 10,
      initialPressureBar: 0,
      initialOxygenPercent: 21,
      initialHeliumPercent: 0,
      targetPressureBar: 100,
      targetOxygenPercent: 21,
      targetHeliumPercent: 0
    },
    physics: { model: 'ideal', temperatureC: 20 },
    settings: { booster: { minimumSourcePressureBar: 50 } },
    banks: [{
      id: 'air',
      name: 'Air',
      volumeL: 10,
      pressureBar: 100,
      minimumPressureBar: 0,
      oxygenPercent: 21,
      heliumPercent: 0,
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
      minimumPressureBar: 0,
      oxygenPercent: 20,
      heliumPercent: 0,
      enabled: true
    }, {
      id: 'air',
      name: 'Air',
      volumeL: 10,
      pressureBar: 200,
      minimumPressureBar: 0,
      oxygenPercent: 21,
      heliumPercent: 0,
      enabled: true
    }]
  });

  assert.equal(result.feasible, true);
  const step = result.protocolSteps.find(item => item.title.startsWith('Step 1:'));
  assert.match(step.title, /^Step 1: Equalize Nitrox source to \d+\.\d bar$/);
  assert.match(step.description, /^Equalize \d+\.\d bar from Nitrox source to \d+\.\d bar\. This will leave \d+\.\d bar of Nitrox source\. Interim mix is \d+\.\d\/\d+\.\d\./);
  const topUp = result.protocolSteps.at(-1);
  assert.match(topUp.title, /^Step \d+: Top-up Air to \d+\.\d bar$/);
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
      oxygenPercent: 0,
      heliumPercent: 50,
      enabled: true
    }]
  });

  assert.equal(result.feasible, true);
  assert.ok(Math.abs(result.blend.heliumSalvagedLitres - 500) < 1e-9);
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
    'Step 1: Top-up Air bank to 110.0 bar',
    'Step 2: Top-up Air bank to 140.0 bar'
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
  assert.match(transferSteps[0].title, /Top-up/);
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
  assert.match(transferSteps[0].title, /Top-up/);
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
    physics: { model: 'ideal', temperatureC: 50 },
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


test('nitrox preset reports vented gas as equivalent litres at one bar', () => {
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

  assert.equal(result.feasible, true);
  assert.ok(Math.abs(result.blend.ventedGasLitres - 838.377979816809) < 1e-8);
});

test('reports the maximum achievable pressure with a recipe at the exact target mix', () => {
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
    banks: [{
      id: 'air',
      name: 'Air bank',
      volumeL: 10,
      pressureBar: 100,
      minimumPressureBar: 0,
      oxygenPercent: 21,
      heliumPercent: 0,
      enabled: true
    }]
  });

  assert.equal(result.feasible, false);
  assert.ok(result.maximumPressure);
  assert.ok(Math.abs(result.maximumPressure.pressureBar - 150) < 1e-6);
  assert.equal(result.maximumPressure.blend.finalPressureBar, result.maximumPressure.pressureBar);
  assert.equal(result.maximumPressure.blend.finalOxygenPercent, 21);
  assert.equal(result.maximumPressure.blend.finalHeliumPercent, 0);
  assert.deepEqual(result.maximumPressure.protocolSteps.map(step => step.title), [
    'Preserve 100% of Cylinder Gas',
    'Step 1: Top-up Air bank to 75.0 bar',
    'Step 2: Top-up Air bank to 150.0 bar'
  ]);
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
      { id: 'he', name: 'Pure Helium', volumeL: 1, pressureBar: 10, minimumPressureBar: 0, oxygenPercent: 0, heliumPercent: 100, enabled: true },
      { id: 'o2', name: 'Pure Oxygen', volumeL: 10, pressureBar: 100, minimumPressureBar: 0, oxygenPercent: 100, heliumPercent: 0, enabled: true },
      { id: 'air', name: 'Air Top-off', volumeL: 10, pressureBar: 100, minimumPressureBar: 0, oxygenPercent: 21, heliumPercent: 0, enabled: true }
    ]
  });

  assert.equal(result.feasible, false);
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
      { id: 'he', name: 'Pure Helium', volumeL: 1, pressureBar: 10, minimumPressureBar: 0, oxygenPercent: 0, heliumPercent: 100, enabled: true },
      { id: 'o2', name: 'Pure Oxygen', volumeL: 10, pressureBar: 100, minimumPressureBar: 0, oxygenPercent: 100, heliumPercent: 0, enabled: true },
      { id: 'air', name: 'Air Top-off', volumeL: 10, pressureBar: 100, minimumPressureBar: 0, oxygenPercent: 21, heliumPercent: 0, enabled: true }
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
      { id: 'he', name: 'Pure Helium', volumeL: 1, pressureBar: 10, minimumPressureBar: 0, oxygenPercent: 0, heliumPercent: 100, enabled: true },
      { id: 'o2', name: 'Pure Oxygen', volumeL: 10, pressureBar: 100, minimumPressureBar: 0, oxygenPercent: 100, heliumPercent: 0, enabled: true },
      { id: 'air', name: 'Air Top-off', volumeL: 10, pressureBar: 100, minimumPressureBar: 0, oxygenPercent: 21, heliumPercent: 0, enabled: true }
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
      minimumPressureBar: 0,
      oxygenPercent: 0,
      heliumPercent: 100,
      enabled: true
    }]
  });

  assert.equal(result.maximumPressure, null);
  assert.ok(!result.diagnostics.exhaustedBanks.some(bank => bank.name === 'Trace helium bank'));
});

test('converts maximum fallback moles with the selected real-gas model', () => {
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
    banks: [{
      id: 'air',
      name: 'Air bank',
      volumeL: 10,
      pressureBar: 100,
      minimumPressureBar: 0,
      oxygenPercent: 21,
      heliumPercent: 0,
      enabled: true
    }]
  });

  assert.ok(Math.abs(result.maximumPressure.pressureBar - 149.80912252198542) < 1e-8);
  assert.equal(
    result.maximumPressure.protocolSteps.at(-1).resultingPressureBar,
    result.maximumPressure.pressureBar
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
      { id: 'air', name: 'Air bank', volumeL: 10, pressureBar: 100, minimumPressureBar: 0, oxygenPercent: 21, heliumPercent: 0, enabled: true },
      { id: 'he', name: 'Helium bank', volumeL: 10, pressureBar: 100, minimumPressureBar: 0, oxygenPercent: 0, heliumPercent: 100, enabled: true },
      { id: 'nitrogen', name: 'Nitrogen bank', volumeL: 10, pressureBar: 100, minimumPressureBar: 0, oxygenPercent: 0, heliumPercent: 0, enabled: true }
    ]
  });

  assert.equal(result.feasible, false);
  assert.ok(Math.abs(result.maximumPressure.pressureBar - 210) < 1e-6);
  const finalStep = result.maximumPressure.trajectory.at(-1);
  assert.ok(Math.abs(finalStep.oxygenPercent - 10) < 1e-8);
  assert.ok(Math.abs(finalStep.heliumPercent - 45) < 1e-8);
  assert.ok(Math.abs(finalStep.pressureBar - 210) < 1e-6);
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
      { id: 'small-oxygen', name: 'Small oxygen bank', volumeL: 10, pressureBar: 80, minimumPressureBar: 0, oxygenPercent: 100, heliumPercent: 0, enabled: true },
      { id: 'large-oxygen', name: 'Large oxygen bank', volumeL: 100, pressureBar: 80, minimumPressureBar: 0, oxygenPercent: 100, heliumPercent: 0, enabled: true }
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
      { id: 'low-pressure', name: 'Low-pressure large bank', volumeL: 100, pressureBar: 20, minimumPressureBar: 0, oxygenPercent: 100, heliumPercent: 0, enabled: true },
      { id: 'high-pressure', name: 'High-pressure small bank', volumeL: 10, pressureBar: 100, minimumPressureBar: 0, oxygenPercent: 100, heliumPercent: 0, enabled: true }
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
      { id: 'oxygen-a', name: 'Oxygen A', volumeL: 10, pressureBar: 100, minimumPressureBar: 0, oxygenPercent: 100, heliumPercent: 0, enabled: true },
      { id: 'oxygen-b', name: 'Oxygen B', volumeL: 10, pressureBar: 100, minimumPressureBar: 0, oxygenPercent: 100, heliumPercent: 0, enabled: true }
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
      { id: 'oxygen-a', name: 'Oxygen A', volumeL: 20, pressureBar: 90, minimumPressureBar: 0, oxygenPercent: 100, heliumPercent: 0, enabled: true },
      { id: 'oxygen-b', name: 'Oxygen B', volumeL: 10, pressureBar: 90, minimumPressureBar: 0, oxygenPercent: 100, heliumPercent: 0, enabled: true }
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
      { id: 'oxygen-a', name: 'Low-pressure oxygen', volumeL: 10, pressureBar: 55, minimumPressureBar: 0, oxygenPercent: 100, heliumPercent: 0, enabled: true },
      { id: 'oxygen-b', name: 'High-pressure oxygen', volumeL: 10, pressureBar: 145, minimumPressureBar: 0, oxygenPercent: 100, heliumPercent: 0, enabled: true }
    ]
  });

  assert.equal(result.feasible, true);
  assert.equal(result.blend.finalPressureBar, 200);
  assert.ok(result.protocolSteps.some(step => step.title.includes('Low-pressure oxygen')));
  assert.ok(result.protocolSteps.some(step => step.title.includes('High-pressure oxygen')));
});

test('brackets feasible source shares before refining safety-limited splits', () => {
  const result = optimizeBlend({
    cylinder: {
      volumeL: 10,
      initialPressureBar: 100,
      initialOxygenPercent: 0,
      initialHeliumPercent: 0,
      targetPressureBar: 250,
      targetOxygenPercent: 50,
      targetHeliumPercent: 0
    },
    physics: { model: 'ideal', temperatureC: 20 },
    banks: [
      { id: 'oxygen-a', name: 'Capacity-limited oxygen', volumeL: 100, pressureBar: 43.9, minimumPressureBar: 38.4, oxygenPercent: 100, heliumPercent: 0, enabled: true },
      { id: 'oxygen-b', name: 'High-capacity oxygen', volumeL: 10, pressureBar: 98, minimumPressureBar: 0, oxygenPercent: 100, heliumPercent: 0, enabled: true },
      { id: 'low-oxygen', name: 'Low O₂ bank', volumeL: 1, pressureBar: 1, minimumPressureBar: 0.99, oxygenPercent: 25, heliumPercent: 0, enabled: true },
      { id: 'trimix', name: 'Unused Tx bank', volumeL: 200, pressureBar: 20, minimumPressureBar: 0, oxygenPercent: 25, heliumPercent: 35, enabled: true },
    ]
  });

  assert.equal(result.feasible, false);
  assert.ok(result.maximumPressure.pressureBar >= 200 && result.maximumPressure.pressureBar < 200.01);
  assert.ok(result.maximumPressure.protocolSteps.some(step => step.title.includes('Capacity-limited oxygen')));
  assert.ok(result.maximumPressure.protocolSteps.some(step => step.title.includes('High-capacity oxygen')));
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
      { id: 'oxygen-a', name: 'Oxygen A', volumeL: 2, pressureBar: 100, minimumPressureBar: 45, oxygenPercent: 100, heliumPercent: 0, enabled: true },
      { id: 'oxygen-b', name: 'Oxygen B', volumeL: 10, pressureBar: 240, minimumPressureBar: 45, oxygenPercent: 100, heliumPercent: 0, enabled: true },
      { id: 'air', name: 'Air bank', volumeL: 80, pressureBar: 230, minimumPressureBar: 1, oxygenPercent: 21, heliumPercent: 0, enabled: true }
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
      targetHeliumPercent: 0
    },
    physics: { model: 'ideal', temperatureC: 20 },
    banks: [{
      id: 'oxygen',
      name: 'Oxygen bank',
      volumeL: 10,
      pressureBar: 100,
      minimumPressureBar: 66.8,
      oxygenPercent: 100,
      heliumPercent: 0,
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
      targetHeliumPercent: 0
    },
    physics: { model: 'ideal', temperatureC: 20 },
    banks: [{
      id: 'oxygen',
      name: 'Oxygen bank',
      volumeL: 200,
      pressureBar: 100,
      minimumPressureBar: 0,
      oxygenPercent: 100,
      heliumPercent: 0,
      enabled: true
    }]
  });

  const finalStep = result.maximumPressure.trajectory.at(-1);
  const stepDescription = result.maximumPressure.protocolSteps.at(-1).description;
  assert.ok(finalStep.addedMoles > 0.1 && finalStep.addedMoles < 0.5);
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
  assert.equal(result.blend, null);
  assert.deepEqual(result.protocolSteps, []);
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
test('reports the end-of-boost compression ratio only above 40 percent oxygen', () => {
  const highOxygenResult = optimizeBlend(oxygenTransferInput(100, 41));
  const highOxygenBoost = highOxygenResult.protocolSteps.find(step => step.type === 'boost');
  assert.equal(highOxygenResult.feasible, true);
  assert.ok(highOxygenBoost);
  assert.ok(Math.abs(highOxygenBoost.oxygenCompressionRatio - 4) < 1e-6);

  const thresholdResult = optimizeBlend(oxygenTransferInput(100, 40));
  const thresholdBoost = thresholdResult.protocolSteps.find(step => step.type === 'boost');
  assert.equal(thresholdResult.feasible, true);
  assert.ok(thresholdBoost);
  assert.equal(thresholdBoost.oxygenCompressionRatio, null);
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
    banks: [{
      id: 'air', name: 'Air', volumeL: 80, pressureBar: 300,
      oxygenPercent: 21, heliumPercent: 0, enabled: true
    }]
  });

  assert.equal(result.feasible, true);
  assert.ok(result.thermal.finalTransferEndPressureBar > 210);
  assert.ok(Math.abs(result.thermal.finalAmbientPressureBar - 210) < 1e-5);
});
