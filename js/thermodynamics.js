import {
  GAS_CONSTANT,
  calcMolarDensity,
  calcPressure,
  calcZ
} from './physics.js';

const ATMOSPHERIC_PRESSURE_BAR = 1.01325;
const GAUGE_PRESSURE_OFFSET_BAR = 1;
const CLEARANCE_RATIO = 0.05;
const GAMMA = 1.4;
const OXYGEN_RICH_THRESHOLD = 40;

const PASCALS_PER_BAR = 100000;
const THERMAL_INTEGRATION_STEP_SECONDS = 0.5;

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

export function calculateBoosterFillRate({
  cylinderVolumeCm3,
  bpm,
  sourcePressureBar,
  receiverPressureBar,
  sourceOxygenPercent,
  sourceHeliumPercent,
  receiverOxygenPercent,
  receiverHeliumPercent,
  receiverVolumeL,
  temperatureC,
  useVdw
}) {
  const sourceAbsolutePressureBar = Math.max(0, sourcePressureBar + GAUGE_PRESSURE_OFFSET_BAR);
  const receiverAbsolutePressureBar = Math.max(0, receiverPressureBar + GAUGE_PRESSURE_OFFSET_BAR);
  const zSource = calcZ(
    sourceAbsolutePressureBar,
    sourceOxygenPercent,
    sourceHeliumPercent,
    temperatureC,
    useVdw
  );
  const zReceiver = calcZ(
    receiverAbsolutePressureBar,
    receiverOxygenPercent,
    receiverHeliumPercent,
    temperatureC,
    useVdw
  );
  const compressionRatio = sourceAbsolutePressureBar > 0
    ? receiverAbsolutePressureBar / sourceAbsolutePressureBar
    : Infinity;
  const volumetricEfficiency = receiverAbsolutePressureBar <= sourceAbsolutePressureBar
    ? 1
    : clamp(
      1 - CLEARANCE_RATIO * (Math.pow(compressionRatio, 1 / GAMMA) - 1),
      0.10,
      0.98
    );
  const effectiveFlowLPerMin = cylinderVolumeCm3 / 1000 * bpm * volumetricEfficiency;
  const temperatureK = temperatureC + 273.15;
  const molesPerMin = sourceAbsolutePressureBar * effectiveFlowLPerMin
    / (zSource * GAS_CONSTANT * temperatureK);
  const fillRateBarPerMin = molesPerMin * zReceiver * GAS_CONSTANT * temperatureK
    / receiverVolumeL;

  return {
    fillRateBarPerMin,
    volumetricEfficiency,
    zSource,
    zReceiver,
    molesPerMin
  };
}

export function calculateCompressorFillRate({
  inletFlowLPerMin,
  receiverPressureBar,
  receiverOxygenPercent,
  receiverHeliumPercent,
  receiverVolumeL,
  ambientTemperatureC,
  receiverTemperatureC,
  useVdw
}) {
  const inletTemperatureK = ambientTemperatureC + 273.15;
  const receiverTemperatureK = receiverTemperatureC + 273.15;
  const zInlet = calcZ(
    ATMOSPHERIC_PRESSURE_BAR,
    21,
    0,
    ambientTemperatureC,
    useVdw
  );
  const zReceiver = calcZ(
    receiverPressureBar + GAUGE_PRESSURE_OFFSET_BAR,
    receiverOxygenPercent,
    receiverHeliumPercent,
    receiverTemperatureC,
    useVdw
  );
  const molesPerMin = ATMOSPHERIC_PRESSURE_BAR * inletFlowLPerMin
    / (zInlet * GAS_CONSTANT * inletTemperatureK);

  return molesPerMin * zReceiver * GAS_CONSTANT * receiverTemperatureK / receiverVolumeL;
}

export function calculateCoolingTime({
  transferEndTemperatureC,
  ambientTemperatureC,
  targetTemperatureC,
  tauMinutes
}) {
  if (transferEndTemperatureC <= targetTemperatureC) return 0;

  return tauMinutes * Math.log(
    (transferEndTemperatureC - ambientTemperatureC)
      / (targetTemperatureC - ambientTemperatureC)
  );
}

export function calculateTemperatureAfterWait({
  transferEndTemperatureC,
  ambientTemperatureC,
  waitMinutes,
  tauMinutes
}) {
  return ambientTemperatureC + (transferEndTemperatureC - ambientTemperatureC)
    * Math.exp(-waitMinutes / tauMinutes);
}

export function calculatePressureAtTemperature({
  pressureBar,
  oxygenPercent,
  heliumPercent,
  fromTemperatureC,
  toTemperatureC,
  volumeL,
  useVdw
}) {
  const molarDensity = calcMolarDensity(
    pressureBar,
    oxygenPercent,
    heliumPercent,
    fromTemperatureC,
    useVdw
  );

  return calcPressure(
    molarDensity,
    oxygenPercent,
    heliumPercent,
    toTemperatureC,
    useVdw
  );
}

export function projectPressureAtTemperatures({
  pressureBar,
  oxygenPercent,
  heliumPercent,
  fromTemperatureC,
  temperaturesC,
  volumeL,
  useVdw
}) {
  return temperaturesC.map(temperatureC => ({
    temperatureC,
    pressureBar: calculatePressureAtTemperature({
      pressureBar,
      oxygenPercent,
      heliumPercent,
      fromTemperatureC,
      toTemperatureC: temperatureC,
      volumeL,
      useVdw
    })
  }));
}

export function estimateTransferTemperature({
  startTemperatureC,
  startPressureBar = 0,
  addedPressureBar,
  fillTimeMinutes,
  volumeL,
  heliumFraction,
  oxygenFraction = 0.21,
  tankMaterial,
  coolingMedium,
  tankMassKg: configuredTankMassKg,
  ambientTemperatureC = startTemperatureC,
  inletTemperatureC = ambientTemperatureC
}) {
  const pressureChangeBar = Number(addedPressureBar) || 0;
  const pressureMagnitudeBar = Math.abs(pressureChangeBar);
  const fillTimeSeconds = Math.max(0, Number(fillTimeMinutes) || 0) * 60;
  if (pressureMagnitudeBar <= 0 || fillTimeSeconds <= 0) return startTemperatureC;

  const tankVolumeL = Math.max(0.1, Number(volumeL) || 0.1);
  const startTemperatureK = startTemperatureC + 273.15;
  const ambientTemperatureK = ambientTemperatureC + 273.15;
  const inletTemperatureK = inletTemperatureC + 273.15;
  const fHe = clamp(Number(heliumFraction) || 0, 0, 1);
  const fOxygen = clamp(Number(oxygenFraction) || 0, 0, 1 - fHe);
  const fNitrogen = Math.max(0, 1 - fHe - fOxygen);
  const cvMolar = fHe * 12.47 + (fOxygen + fNitrogen) * 20.78;
  const cpMolar = fHe * 20.78 + (fOxygen + fNitrogen) * 29.10;
  const averageMolarMassKg = fHe * 0.004 + fOxygen * 0.032 + fNitrogen * 0.028;
  const cvKg = cvMolar / averageMolarMassKg;
  const cpKg = cpMolar / averageMolarMassKg;
  const specificGasConstant = 8.314 / averageMolarMassKg;

  const isSteel = tankMaterial !== 'aluminum';
  const defaultTankMassKg = isSteel ? 14 : 14.2;
  const tankMassKg = Math.max(0.1, Number(configuredTankMassKg) || defaultTankMassKg);
  const metalSpecificHeat = isSteel ? 490 : 900;
  const areaM2 = isSteel ? 0.45 : 0.48;
  const heatTransferCoefficient = coolingMedium === 'water' ? 250 : 12;
  const heatTransferArea = heatTransferCoefficient * areaM2;
  const volumeM3 = tankVolumeL * 0.001;
  const initialPressureBar = Math.max(0, Number(startPressureBar) || 0);
  const targetPressureBar = Math.max(0, initialPressureBar + pressureChangeBar);
  let gasMassKg = (initialPressureBar + 1) * PASCALS_PER_BAR * volumeM3
    / (specificGasConstant * startTemperatureK);
  const targetGasMassKg = (targetPressureBar + 1) * PASCALS_PER_BAR * volumeM3
    / (specificGasConstant * ambientTemperatureK);
  const massFlowKgPerSecond = (targetGasMassKg - gasMassKg) / fillTimeSeconds;
  let temperatureK = startTemperatureK;
  let elapsedSeconds = 0;
  while (elapsedSeconds < fillTimeSeconds) {
    const stepSeconds = Math.min(
      THERMAL_INTEGRATION_STEP_SECONDS,
      fillTimeSeconds - elapsedSeconds
    );
    const thermalCapacityJPerK = tankMassKg * metalSpecificHeat + gasMassKg * cvKg;
    const flowWorkWatts = massFlowKgPerSecond
      * (cpKg * inletTemperatureK - cvKg * temperatureK);
    const heatLossWatts = heatTransferArea * (temperatureK - ambientTemperatureK);
    temperatureK += (flowWorkWatts - heatLossWatts)
      / thermalCapacityJPerK * stepSeconds;
    gasMassKg += massFlowKgPerSecond * stepSeconds;
    elapsedSeconds += stepSeconds;
  }
  return temperatureK - 273.15;
}

const DEFAULT_BOOSTER_SETTINGS = {
  cylinderVolumeCm3: 9,
  oxygenBoostBpm: 50,
  otherBoostBpm: 50,
  oxygenDecantRateBarPerMin: 5,
  otherDecantRateBarPerMin: 5,
  drainingRateBarPerMin: 5,
  compressorInletFlowLPerMin: 100,
  boosterTemperatureModifierC: 0,
  compressorTemperatureModifierC: 0
};

function coolingTimeConstantMinutes(tankMaterial, coolingMedium) {
  if (coolingMedium === 'water') return tankMaterial === 'aluminum' ? 5 : 3.5;
  return tankMaterial === 'aluminum' ? 25 : 18;
}

function thermalBoosterSettings(settings) {
  const booster = settings?.booster || {};
  return Object.fromEntries(
    Object.entries(DEFAULT_BOOSTER_SETTINGS).map(([name, defaultValue]) => [
      name,
      Number.isFinite(booster[name]) ? booster[name] : defaultValue
    ])
  );
}
function inletTemperatureFor(rateSource, thermal, booster) {
  const baseTemperatureC = Number.isFinite(thermal.inletTemperatureC)
    ? thermal.inletTemperatureC
    : thermal.ambientTemperatureC;
  if (rateSource === 'booster') {
    return baseTemperatureC + booster.boosterTemperatureModifierC;
  }
  if (rateSource === 'compressor') {
    return baseTemperatureC + booster.compressorTemperatureModifierC;
  }
  return baseTemperatureC;
}


function stepTransferEndPressure(step, currentPressureBar) {
  if (Number.isFinite(step.receiverEndPressureBar)) return Math.max(0, step.receiverEndPressureBar);
  if (Number.isFinite(step.resultingPressureBar)) return Math.max(0, step.resultingPressureBar);
  return Math.max(0, currentPressureBar);
}

function stepMix(step) {
  return {
    oxygenPercent: step.resultingMix?.oxygenPercent ?? 0,
    heliumPercent: step.resultingMix?.heliumPercent ?? 0
  };
}

function rateForProtocolStep({
  step,
  currentPressureBar,
  currentTemperatureC,
  transferEndPressureBar,
  cylinder,
  physics,
  thermal,
  booster
}) {
  const receiverMix = stepMix(step);
  const sourceOxygenPercent = step.sourceOxygenPercent ?? receiverMix.oxygenPercent;
  const sourceHeliumPercent = step.sourceHeliumPercent ?? receiverMix.heliumPercent;
  const isOxygenRich = sourceOxygenPercent >= OXYGEN_RICH_THRESHOLD;
  const pressureDecreaseBar = Math.max(0, currentPressureBar - transferEndPressureBar);
  if (step.type === 'drain' && pressureDecreaseBar > 0) {
    return {
      rateSource: 'draining-rate',
      rateBarPerMin: booster.drainingRateBarPerMin,
      pressureIncreaseBar: pressureDecreaseBar,
      pressureChangeBar: -pressureDecreaseBar
    };
  }
  const pressureIncreaseBar = Math.max(0, transferEndPressureBar - currentPressureBar);
  if (pressureIncreaseBar <= 0) {
    return {
      rateSource: 'none',
      rateBarPerMin: null,
      pressureIncreaseBar,
      pressureChangeBar: 0
    };
  }
  const useVdw = physics.model === 'vdw';

  if (step.operation === 'Top-up') {
    return {
      rateSource: 'compressor',
      rateBarPerMin: calculateCompressorFillRate({
        inletFlowLPerMin: booster.compressorInletFlowLPerMin,
        receiverPressureBar: (currentPressureBar + transferEndPressureBar) / 2,
        receiverOxygenPercent: receiverMix.oxygenPercent,
        receiverHeliumPercent: receiverMix.heliumPercent,
        receiverVolumeL: cylinder.volumeL,
        ambientTemperatureC: thermal.ambientTemperatureC,
        receiverTemperatureC: currentTemperatureC,
        useVdw
      }),
      pressureIncreaseBar
    };
  }

  if (step.type === 'boost') {
    const sourcePressureBar = (
      (step.sourceStartPressureBar ?? 0) + (step.sourceEndPressureBar ?? 0)
    ) / 2;
    return {
      rateSource: 'booster',
      rateBarPerMin: calculateBoosterFillRate({
        cylinderVolumeCm3: booster.cylinderVolumeCm3,
        bpm: isOxygenRich ? booster.oxygenBoostBpm : booster.otherBoostBpm,
        sourcePressureBar,
        receiverPressureBar: (currentPressureBar + transferEndPressureBar) / 2,
        sourceOxygenPercent,
        sourceHeliumPercent,
        receiverOxygenPercent: receiverMix.oxygenPercent,
        receiverHeliumPercent: receiverMix.heliumPercent,
        receiverVolumeL: cylinder.volumeL,
        temperatureC: currentTemperatureC,
        useVdw
      }).fillRateBarPerMin,
      pressureIncreaseBar
    };
  }

  if (step.type === 'decant') {
    return {
      rateSource: 'decant-rate',
      rateBarPerMin: isOxygenRich
        ? booster.oxygenDecantRateBarPerMin
        : booster.otherDecantRateBarPerMin,
      pressureIncreaseBar
    };
  }

  return {
    rateSource: 'none',
    rateBarPerMin: null,
    pressureIncreaseBar
  };
}

export function simulateThermalProtocol({
  protocolSteps,
  cylinder,
  physics,
  thermal,
  settings
}) {
  const booster = thermalBoosterSettings(settings);
  const tauMinutes = coolingTimeConstantMinutes(thermal.tankMaterial, thermal.coolingMedium);
  const useVdw = physics.model === 'vdw';
  let currentPressureBar = Math.max(0, cylinder.initialPressureBar
    ?? protocolSteps[0]?.receiverStartPressureBar
    ?? protocolSteps[0]?.resultingPressureBar
    ?? 0);
  let currentTemperatureC = physics.temperatureC;
  if (protocolSteps.length === 0) {
    const initialOxygenPercent = cylinder.initialOxygenPercent ?? 0;
    const initialHeliumPercent = cylinder.initialHeliumPercent ?? 0;
    const finalAmbientPressureBar = calculatePressureAtTemperature({
      pressureBar: currentPressureBar,
      oxygenPercent: initialOxygenPercent,
      heliumPercent: initialHeliumPercent,
      fromTemperatureC: currentTemperatureC,
      toTemperatureC: thermal.ambientTemperatureC,
      volumeL: cylinder.volumeL,
      useVdw
    });
    return {
      protocolSteps: [],
      final: {
        finalTransferEndPressureBar: currentPressureBar,
        finalTransferEndTemperatureC: currentTemperatureC,
        finalAmbientPressureBar,
        finalAmbientTemperatureC: thermal.ambientTemperatureC
      }
    };
  }


  const simulatedProtocolSteps = protocolSteps.map((step, index) => {
    const transferEndPressureBar = stepTransferEndPressure(step, currentPressureBar);
    const transfer = rateForProtocolStep({
      step,
      currentPressureBar,
      currentTemperatureC,
      transferEndPressureBar,
      cylinder,
      physics,
      thermal,
      booster
    });
    const durationMinutes = transfer.rateBarPerMin && transfer.rateBarPerMin > 0
      ? transfer.pressureIncreaseBar / transfer.rateBarPerMin
      : 0;
    const receiverMix = stepMix(step);
    const inletTemperatureC = inletTemperatureFor(transfer.rateSource, thermal, booster);
    const temperatureAtTransferEndC = transfer.rateSource === 'booster'
      || transfer.rateSource === 'compressor'
      || transfer.rateSource === 'decant-rate'
      || transfer.rateSource === 'draining-rate'
      ? estimateTransferTemperature({
        startTemperatureC: currentTemperatureC,
        startPressureBar: currentPressureBar,
        addedPressureBar: transfer.pressureChangeBar ?? transfer.pressureIncreaseBar,
        fillTimeMinutes: durationMinutes,
        volumeL: cylinder.volumeL,
        heliumFraction: (step.sourceHeliumPercent ?? receiverMix.heliumPercent) / 100,
        oxygenFraction: (step.sourceOxygenPercent ?? receiverMix.oxygenPercent) / 100,
        tankMaterial: thermal.tankMaterial,
        coolingMedium: thermal.coolingMedium,
        tankMassKg: thermal.tankMassKg,
        ambientTemperatureC: thermal.ambientTemperatureC,
        inletTemperatureC
      })
      : currentTemperatureC;
    const isFinalStep = index === protocolSteps.length - 1;
    const skipsConfiguredWait = !isFinalStep && index === 0 && step.type === 'keep';
    const waitMinutes = skipsConfiguredWait
      ? 0
      : isFinalStep
        ? 4.6 * tauMinutes
        : thermal.waitMode === 'temperature'
          ? calculateCoolingTime({
            transferEndTemperatureC: temperatureAtTransferEndC,
            ambientTemperatureC: thermal.ambientTemperatureC,
            targetTemperatureC: thermal.targetTemperatureC,
            tauMinutes
          })
          : thermal.waitMinutes;
    const temperatureAfterWaitC = skipsConfiguredWait
      ? temperatureAtTransferEndC
      : isFinalStep
        ? thermal.ambientTemperatureC
        : calculateTemperatureAfterWait({
          transferEndTemperatureC: temperatureAtTransferEndC,
          ambientTemperatureC: thermal.ambientTemperatureC,
          waitMinutes,
          tauMinutes
        });
    const pressureAfterWaitBar = Math.max(0, calculatePressureAtTemperature({
      pressureBar: transferEndPressureBar,
      oxygenPercent: receiverMix.oxygenPercent,
      heliumPercent: receiverMix.heliumPercent,
      fromTemperatureC: temperatureAtTransferEndC,
      toTemperatureC: temperatureAfterWaitC,
      volumeL: cylinder.volumeL,
      useVdw
    }));
    const thermalStep = {
      rateSource: transfer.rateSource,
      rateBarPerMin: transfer.rateBarPerMin,
      durationMinutes,
      inletTemperatureC,
      temperatureStartC: currentTemperatureC,
      temperatureAtTransferEndC,
      waitMinutes,
      temperatureAfterWaitC,
      pressureAtTransferEndBar: transferEndPressureBar,
      pressureAfterWaitBar
    };

    currentPressureBar = Math.max(0, pressureAfterWaitBar);
    currentTemperatureC = temperatureAfterWaitC;
    return { ...step, thermal: thermalStep };
  });

  const finalStep = simulatedProtocolSteps.at(-1)?.thermal;
  return {
    protocolSteps: simulatedProtocolSteps,
    final: {
      finalTransferEndPressureBar: finalStep?.pressureAtTransferEndBar ?? currentPressureBar,
      finalTransferEndTemperatureC: finalStep?.temperatureAtTransferEndC ?? currentTemperatureC,
      finalAmbientPressureBar: finalStep?.pressureAfterWaitBar ?? currentPressureBar,
      finalAmbientTemperatureC: finalStep?.temperatureAfterWaitC ?? currentTemperatureC
    }
  };
}
