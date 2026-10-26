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

function estimateMeasuredWaitMinutes({
  transferEndTemperatureC,
  ambientTemperatureC,
  measuredTemperatureC,
  tauMinutes
}) {
  if (![transferEndTemperatureC, ambientTemperatureC, measuredTemperatureC, tauMinutes].every(Number.isFinite)) {
    return null;
  }
  if (measuredTemperatureC > transferEndTemperatureC || measuredTemperatureC <= ambientTemperatureC) {
    return null;
  }
  const waitMinutes = calculateCoolingTime({
    transferEndTemperatureC,
    ambientTemperatureC,
    targetTemperatureC: measuredTemperatureC,
    tauMinutes
  });
  return Number.isFinite(waitMinutes) && waitMinutes >= 0 ? waitMinutes : null;
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

export const WATER_SUBMERSION_PERCENT_OPTIONS = Object.freeze([20, 40, 60, 80]);
export const DEFAULT_WATER_SUBMERSION_PERCENT = 60;
const HEAT_TRANSFER_AIR_W_PER_M2K = 12;
const HEAT_TRANSFER_WATER_W_PER_M2K = 250;

// Wet and dry surface areas exchange heat in parallel, so conductance (and 1/tau)
// is linear in the wetted fraction while temperature responses are not.
function wetSurfaceFraction(waterSubmersionPercent) {
  const percent = waterSubmersionPercent ?? DEFAULT_WATER_SUBMERSION_PERCENT;
  return Math.min(100, Math.max(0, Number(percent) || 0)) / 100;
}

function estimateTransferTemperatureSamples({
  startTemperatureC,
  startPressureBar = 0,
  addedPressureBar,
  fillTimeMinutes,
  volumeL,
  heliumFraction,
  oxygenFraction = 0.21,
  tankMaterial,
  coolingMedium,
  waterSubmersionPercent,
  tankMassKg: configuredTankMassKg,
  ambientTemperatureC = startTemperatureC,
  inletTemperatureC = ambientTemperatureC
}) {
  const pressureChangeBar = Number(addedPressureBar) || 0;
  const pressureMagnitudeBar = Math.abs(pressureChangeBar);
  const fillTimeSeconds = Math.max(0, Number(fillTimeMinutes) || 0) * 60;
  if (pressureMagnitudeBar <= 0 || fillTimeSeconds <= 0) {
    return [{ elapsedMinutes: 0, temperatureC: startTemperatureC }];
  }

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
  const wetFraction = wetSurfaceFraction(waterSubmersionPercent);
  const heatTransferCoefficient = coolingMedium === 'water'
    ? wetFraction * HEAT_TRANSFER_WATER_W_PER_M2K
      + (1 - wetFraction) * HEAT_TRANSFER_AIR_W_PER_M2K
    : HEAT_TRANSFER_AIR_W_PER_M2K;
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
  let nextSampleSeconds = 60;
  const samples = [{ elapsedMinutes: 0, temperatureC: startTemperatureC }];

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

    if (elapsedSeconds + Number.EPSILON >= nextSampleSeconds) {
      samples.push({
        elapsedMinutes: nextSampleSeconds / 60,
        temperatureC: temperatureK - 273.15
      });
      nextSampleSeconds += 60;
    }
  }

  const finalTemperatureC = temperatureK - 273.15;
  if (samples.at(-1).elapsedMinutes !== fillTimeSeconds / 60) {
    samples.push({
      elapsedMinutes: fillTimeSeconds / 60,
      temperatureC: finalTemperatureC
    });
  } else {
    samples.at(-1).temperatureC = finalTemperatureC;
  }
  return samples;
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
  waterSubmersionPercent,
  tankMassKg: configuredTankMassKg,
  ambientTemperatureC = startTemperatureC,
  inletTemperatureC = ambientTemperatureC
}) {
  return estimateTransferTemperatureSamples({
    startTemperatureC,
    startPressureBar,
    addedPressureBar,
    fillTimeMinutes,
    volumeL,
    heliumFraction,
    oxygenFraction,
    tankMaterial,
    coolingMedium,
    waterSubmersionPercent,
    tankMassKg: configuredTankMassKg,
    ambientTemperatureC,
    inletTemperatureC
  }).at(-1).temperatureC;
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

export function coolingTimeConstantMinutes(
  tankMaterial,
  coolingMedium,
  waterSubmersionPercent = DEFAULT_WATER_SUBMERSION_PERCENT
) {
  const airTauMinutes = tankMaterial === 'aluminum' ? 25 : 18;
  if (coolingMedium !== 'water') return airTauMinutes;
  const waterTauMinutes = tankMaterial === 'aluminum' ? 5 : 3.5;
  const wetFraction = wetSurfaceFraction(waterSubmersionPercent);
  return 1 / (wetFraction / waterTauMinutes + (1 - wetFraction) / airTauMinutes);
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


function compareTargetWaitError(message, details) {
  const error = new RangeError(message);
  error.name = 'CompareSimulationError';
  error.code = 'COMPARE_TARGET_STATE_UNREACHABLE';
  error.details = details;
  return error;
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

function buildThermalStepSamples({
  currentPressureBar,
  currentTemperatureC,
  transfer,
  transferTemperatureSamples,
  durationMinutes,
  transferEndPressureBar,
  pressureAtTransferEndAmbientBar,
  pressureAtTransferEndHotBar,
  receiverMix,
  temperatureAtTransferEndC,
  waitMinutes,
  temperatureAfterWaitC,
  pressureAfterWaitBar,
  isFinalStep,
  skipsConfiguredWait,
  thermal,
  waitAmbientTemperatureC,
  tauMinutes,
  cylinder,
  useVdw
}) {
  const samples = [];
  const append = (elapsedMinutes, temperatureC, pressureBar, details = {}) => {
    const previous = samples.at(-1);
    const sample = {
      elapsedMinutes,
      temperatureC,
      pressureBar: Math.max(0, pressureBar),
      ...details
    };
    if (previous && Math.abs(previous.elapsedMinutes - elapsedMinutes) < 1e-9) {
      samples[samples.length - 1] = sample;
    } else {
      samples.push(sample);
    }
  };

  append(0, currentTemperatureC, currentPressureBar, {
    projectedPressureBar: currentPressureBar,
    pressureReferenceTemperatureC: currentTemperatureC
  });
  const hasTransferProfile = transfer.rateSource === 'booster'
    || transfer.rateSource === 'compressor'
    || transfer.rateSource === 'decant-rate'
    || transfer.rateSource === 'draining-rate';
  const hotTransferEndPressure = pressureAtTransferEndHotBar
    ?? transferEndPressureBar;
  const ambientTransferEndPressure = pressureAtTransferEndAmbientBar
    ?? transferEndPressureBar;
  if (hasTransferProfile) {
    const startMix = receiverMix.startMix ?? receiverMix;
    const startAmbientPressureBar = calculatePressureAtTemperature({
      pressureBar: currentPressureBar,
      oxygenPercent: startMix.oxygenPercent,
      heliumPercent: startMix.heliumPercent,
      fromTemperatureC: currentTemperatureC,
      toTemperatureC: thermal.ambientTemperatureC,
      volumeL: cylinder.volumeL,
      useVdw
    });
    for (const sample of transferTemperatureSamples) {
      const transferProgress = durationMinutes > 0
        ? clamp(sample.elapsedMinutes / durationMinutes, 0, 1)
        : 1;
      const ambientPressureBar = startAmbientPressureBar
        + (ambientTransferEndPressure - startAmbientPressureBar) * transferProgress;
      const oxygenPercent = startMix.oxygenPercent
        + (receiverMix.oxygenPercent - startMix.oxygenPercent) * transferProgress;
      const heliumPercent = startMix.heliumPercent
        + (receiverMix.heliumPercent - startMix.heliumPercent) * transferProgress;
      const projectedPressureBar = calculatePressureAtTemperature({
        pressureBar: ambientPressureBar,
        oxygenPercent,
        heliumPercent,
        fromTemperatureC: thermal.ambientTemperatureC,
        toTemperatureC: sample.temperatureC,
        volumeL: cylinder.volumeL,
        useVdw
      });
      append(
        sample.elapsedMinutes,
        sample.temperatureC,
        currentPressureBar + (transferEndPressureBar - currentPressureBar) * transferProgress,
        {
          ambientPressureBar,
          projectedPressureBar,
          oxygenPercent,
          heliumPercent,
          pressureReferenceTemperatureC: sample.temperatureC
        }
      );
    }
  } else {
    append(0, temperatureAtTransferEndC, transferEndPressureBar, {
      projectedPressureBar: hotTransferEndPressure,
      pressureReferenceTemperatureC: temperatureAtTransferEndC
    });
  }

  const appendWaitSample = elapsedMinutes => {
    const temperatureC = skipsConfiguredWait
      ? temperatureAtTransferEndC
      : isFinalStep && elapsedMinutes >= waitMinutes
        ? thermal.ambientTemperatureC
        : calculateTemperatureAfterWait({
          transferEndTemperatureC: temperatureAtTransferEndC,
          ambientTemperatureC: Number.isFinite(waitAmbientTemperatureC)
            ? waitAmbientTemperatureC
            : thermal.ambientTemperatureC,
          waitMinutes: elapsedMinutes,
          tauMinutes: Number.isFinite(tauMinutes)
            ? tauMinutes
            : coolingTimeConstantMinutes(thermal.tankMaterial, thermal.coolingMedium, thermal.waterSubmersionPercent)
        });
    const pressureBar = elapsedMinutes >= waitMinutes
      ? pressureAfterWaitBar
      : calculatePressureAtTemperature({
        pressureBar: transferEndPressureBar,
        oxygenPercent: receiverMix.oxygenPercent,
        heliumPercent: receiverMix.heliumPercent,
        fromTemperatureC: temperatureAtTransferEndC,
        toTemperatureC: temperatureC,
        volumeL: cylinder.volumeL,
        useVdw
      });
    const projectedPressureBar = elapsedMinutes >= waitMinutes
      ? pressureAfterWaitBar
      : calculatePressureAtTemperature({
        pressureBar: hotTransferEndPressure,
        oxygenPercent: receiverMix.oxygenPercent,
        heliumPercent: receiverMix.heliumPercent,
        fromTemperatureC: temperatureAtTransferEndC,
        toTemperatureC: temperatureC,
        volumeL: cylinder.volumeL,
        useVdw
      });
    append(durationMinutes + elapsedMinutes, temperatureC, pressureBar, {
      projectedPressureBar,
      oxygenPercent: receiverMix.oxygenPercent,
      heliumPercent: receiverMix.heliumPercent,
      pressureReferenceTemperatureC: temperatureC
    });
  };

  for (let elapsedMinutes = 1; elapsedMinutes < waitMinutes; elapsedMinutes += 1) {
    appendWaitSample(elapsedMinutes);
  }
  if (waitMinutes > 0) appendWaitSample(waitMinutes);
  append(durationMinutes + waitMinutes, temperatureAfterWaitC, pressureAfterWaitBar, {
    projectedPressureBar: pressureAfterWaitBar,
    oxygenPercent: receiverMix.oxygenPercent,
    heliumPercent: receiverMix.heliumPercent,
    pressureReferenceTemperatureC: temperatureAfterWaitC,
    pressureAtTransferEndReferenceBar: transferEndPressureBar,
    pressureAtTransferEndAmbientBar: ambientTransferEndPressure,
    pressureAtTransferEndHotBar: hotTransferEndPressure
  });
  return samples;
}


export function simulateThermalProtocol({
  protocolSteps,
  cylinder,
  physics,
  thermal,
  settings
}) {
  const booster = thermalBoosterSettings(settings);
  const tauMinutes = coolingTimeConstantMinutes(thermal.tankMaterial, thermal.coolingMedium, thermal.waterSubmersionPercent);
  const finalSettledTemperatureC = thermal.ambientTemperatureC;
  const intermediateTargetTemperatureC = thermal.targetMediumTemperatureC
    ?? thermal.targetTemperatureC;
  const emptyProtocolTemperatureC = thermal.ambientTemperatureC;
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
      toTemperatureC: emptyProtocolTemperatureC,
      volumeL: cylinder.volumeL,
      useVdw
    });
    return {
      protocolSteps: [],
      final: {
        finalTransferEndPressureBar: currentPressureBar,
        finalTransferEndTemperatureC: currentTemperatureC,
        finalAmbientPressureBar,
        finalAmbientTemperatureC: emptyProtocolTemperatureC
      }
    };
  }

  let currentMix = {
    oxygenPercent: cylinder.initialOxygenPercent ?? 0,
    heliumPercent: cylinder.initialHeliumPercent ?? 0
  };
  let previousThermal = null;
  const simulatedProtocolSteps = protocolSteps.map((step, index) => {
    const measurementIndex = step._measurementIndex === null
      ? null
      : Number.isInteger(step._measurementIndex)
        ? step._measurementIndex
        : index;
    const measuredStart = measurementIndex === null
      ? undefined
      : thermal.interimMeasurements?.[measurementIndex];
    const plannedStartPressureBar = currentPressureBar;
    const plannedStartTemperatureC = currentTemperatureC;
    const measurementApplied = step._applyInterimMeasurement !== false;
    if (measurementApplied && Number.isFinite(measuredStart?.pressureBar)) {
      currentPressureBar = Math.max(0, measuredStart.pressureBar);
    }
    if (measurementApplied && Number.isFinite(measuredStart?.temperatureC)) {
      currentTemperatureC = measuredStart.temperatureC;
    }
    const measuredWaitMinutes = estimateMeasuredWaitMinutes({
      transferEndTemperatureC: previousThermal?.temperatureAtTransferEndC,
      ambientTemperatureC: thermal.ambientTemperatureC,
      measuredTemperatureC: measuredStart?.temperatureC,
      tauMinutes
    });
    const pressureStartBar = currentPressureBar;
    const temperatureStartC = currentTemperatureC;
    const pressureReferenceTemperatureC = Number.isFinite(step.pressureReferenceTemperatureC)
      ? step.pressureReferenceTemperatureC
      : physics.temperatureC;
    const targetMix = stepMix(step);
    const hasReferencePressure = Number.isFinite(step.pressureAtTransferEndReferenceBar);
    const hasTransferEndPressure = hasReferencePressure
      || Number.isFinite(step.receiverEndPressureBar)
      || Number.isFinite(step.resultingPressureBar);
    const transferEndReferencePressureBar = hasReferencePressure
      ? Math.max(0, step.pressureAtTransferEndReferenceBar)
      : hasTransferEndPressure
        ? stepTransferEndPressure(step, currentPressureBar)
        : calculatePressureAtTemperature({
          pressureBar: currentPressureBar,
          oxygenPercent: currentMix.oxygenPercent,
          heliumPercent: currentMix.heliumPercent,
          fromTemperatureC: currentTemperatureC,
          toTemperatureC: pressureReferenceTemperatureC,
          volumeL: cylinder.volumeL,
          useVdw
        });
    const transferEndPressureBar = calculatePressureAtTemperature({
      pressureBar: transferEndReferencePressureBar,
      oxygenPercent: targetMix.oxygenPercent,
      heliumPercent: targetMix.heliumPercent,
      fromTemperatureC: pressureReferenceTemperatureC,
      toTemperatureC: currentTemperatureC,
      volumeL: cylinder.volumeL,
      useVdw
    });
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
    const noTransfer = transfer.rateSource === 'none'
      && transfer.pressureIncreaseBar <= 0;
    const receiverMix = noTransfer ? currentMix : targetMix;
    const receiverStartMix = step.receiverStartMix ?? currentMix;
    const inletTemperatureC = inletTemperatureFor(transfer.rateSource, thermal, booster);
    const hasTransferProfile = transfer.rateSource === 'booster'
      || transfer.rateSource === 'compressor'
      || transfer.rateSource === 'decant-rate'
      || transfer.rateSource === 'draining-rate';
    const transferTemperatureSamples = hasTransferProfile
      ? estimateTransferTemperatureSamples({
        startTemperatureC: currentTemperatureC,
        startPressureBar: currentPressureBar,
        addedPressureBar: transfer.pressureChangeBar ?? transfer.pressureIncreaseBar,
        fillTimeMinutes: durationMinutes,
        volumeL: cylinder.volumeL,
        heliumFraction: (step.sourceHeliumPercent ?? receiverMix.heliumPercent) / 100,
        oxygenFraction: (step.sourceOxygenPercent ?? receiverMix.oxygenPercent) / 100,
        tankMaterial: thermal.tankMaterial,
        coolingMedium: thermal.coolingMedium,
        waterSubmersionPercent: thermal.waterSubmersionPercent,
        tankMassKg: thermal.tankMassKg,
        ambientTemperatureC: thermal.ambientTemperatureC,
        inletTemperatureC
      })
      : [{ elapsedMinutes: 0, temperatureC: currentTemperatureC }];
    const temperatureAtTransferEndC = transferTemperatureSamples.at(-1).temperatureC;
    const pressureAtTransferEndReferenceBar = noTransfer
      ? calculatePressureAtTemperature({
        pressureBar: currentPressureBar,
        oxygenPercent: currentMix.oxygenPercent,
        heliumPercent: currentMix.heliumPercent,
        fromTemperatureC: currentTemperatureC,
        toTemperatureC: pressureReferenceTemperatureC,
        volumeL: cylinder.volumeL,
        useVdw
      })
      : transferEndReferencePressureBar;
    const pressureAtTransferEndAmbientBar = noTransfer
      ? calculatePressureAtTemperature({
        pressureBar: currentPressureBar,
        oxygenPercent: currentMix.oxygenPercent,
        heliumPercent: currentMix.heliumPercent,
        fromTemperatureC: currentTemperatureC,
        toTemperatureC: thermal.ambientTemperatureC,
        volumeL: cylinder.volumeL,
        useVdw
      })
      : step.pressureAtTransferEndAmbientBar
        ?? calculatePressureAtTemperature({
          pressureBar: pressureAtTransferEndReferenceBar,
          oxygenPercent: receiverMix.oxygenPercent,
          heliumPercent: receiverMix.heliumPercent,
          fromTemperatureC: pressureReferenceTemperatureC,
          toTemperatureC: thermal.ambientTemperatureC,
          volumeL: cylinder.volumeL,
          useVdw
        });
    const pressureAtTransferEndHotBar = noTransfer
      ? currentPressureBar
      : step.pressureAtTransferEndHotBar
        ?? calculatePressureAtTemperature({
          pressureBar: pressureAtTransferEndReferenceBar,
          oxygenPercent: receiverMix.oxygenPercent,
          heliumPercent: receiverMix.heliumPercent,
          fromTemperatureC: pressureReferenceTemperatureC,
          toTemperatureC: temperatureAtTransferEndC,
          volumeL: cylinder.volumeL,
          useVdw
        });
    const isFinalStep = index === protocolSteps.length - 1;
    const skipsConfiguredWait = !isFinalStep && index === 0 && step.type === 'keep';
    const safetyWaitOnly = step._safetyWaitOnly === true;
    const waitAmbientTemperatureC = thermal.ambientTemperatureC;
    const intermediateTargetTemperatureC = thermal.targetMediumTemperatureC
      ?? thermal.targetTemperatureC;
    const configuredWaitMinutes = skipsConfiguredWait || safetyWaitOnly
      ? 0
      : isFinalStep
        ? 4.6 * tauMinutes
        : thermal.waitMode === 'temperature'
          ? Math.abs(intermediateTargetTemperatureC - thermal.ambientTemperatureC) < 1e-9
            ? 4.6 * tauMinutes
            : calculateCoolingTime({
              transferEndTemperatureC: temperatureAtTransferEndC,
              ambientTemperatureC: thermal.ambientTemperatureC,
              targetTemperatureC: intermediateTargetTemperatureC,
              tauMinutes
            })
          : Number.isFinite(thermal.waitMinutes) ? thermal.waitMinutes : 0;
    const waitMinutes = skipsConfiguredWait
      ? 0
      : Math.max(0, configuredWaitMinutes + (Number(step.automaticWaitMinutes) || 0));
    const temperatureAfterWaitC = skipsConfiguredWait
      ? temperatureAtTransferEndC
      : isFinalStep
        ? finalSettledTemperatureC
        : thermal.waitMode === 'temperature'
          && Math.abs(intermediateTargetTemperatureC - thermal.ambientTemperatureC) < 1e-9
          ? thermal.ambientTemperatureC
          : calculateTemperatureAfterWait({
            transferEndTemperatureC: temperatureAtTransferEndC,
            ambientTemperatureC: thermal.ambientTemperatureC,
            waitMinutes,
            tauMinutes
          });
    const pressureAfterWaitBar = Math.max(0, calculatePressureAtTemperature({
      pressureBar: pressureAtTransferEndHotBar,
      oxygenPercent: receiverMix.oxygenPercent,
      heliumPercent: receiverMix.heliumPercent,
      fromTemperatureC: temperatureAtTransferEndC,
      toTemperatureC: temperatureAfterWaitC,
      volumeL: cylinder.volumeL,
      useVdw
    }));
    const thermalStep = {
      plannedStartPressureBar,
      plannedStartTemperatureC,
      pressureStartBar,
      rateSource: transfer.rateSource,
      rateBarPerMin: transfer.rateBarPerMin,
      durationMinutes,
      inletTemperatureC,
      measurementIndex,
      measurementApplied,
      measuredStartPressureBar: measuredStart?.pressureBar
        ?? (measurementIndex === null
          ? pressureStartBar
          : step._scheduledMeasuredStartPressureBar ?? pressureStartBar),
      measuredStartTemperatureC: measuredStart?.temperatureC
        ?? (measurementIndex === null
          ? temperatureStartC
          : step._scheduledMeasuredStartTemperatureC ?? temperatureStartC),
      temperatureStartC,
      temperatureAtTransferEndC,
      pressureReferenceTemperatureC,
      receiverStartMix: step.receiverStartMix ?? currentMix,
      configuredWaitMinutes,
      automaticWaitMinutes: Number(step.automaticWaitMinutes) || 0,
      measuredWaitMinutes,
      waitMinutes,
      temperatureAfterWaitC,
      pressureAtTransferEndReferenceBar,
      pressureAtTransferEndAmbientBar,
      pressureAtTransferEndBar: pressureAtTransferEndHotBar,
      pressureAtTransferEndHotBar,
      pressureAfterWaitBar,
      samples: buildThermalStepSamples({
        currentPressureBar,
        currentTemperatureC,
        transfer,
        transferTemperatureSamples,
        durationMinutes,
        transferEndPressureBar: pressureAtTransferEndReferenceBar,
        pressureAtTransferEndAmbientBar,
        pressureAtTransferEndHotBar,
        receiverMix: { ...receiverMix, startMix: receiverStartMix },
        temperatureAtTransferEndC,
        waitMinutes,
        temperatureAfterWaitC,
        pressureAfterWaitBar,
        isFinalStep,
        skipsConfiguredWait,
        thermal,
        waitAmbientTemperatureC,
        tauMinutes,
        cylinder,
        useVdw
      })
    };

    currentPressureBar = Math.max(0, pressureAfterWaitBar);
    currentTemperatureC = temperatureAfterWaitC;
    previousThermal = thermalStep;
    currentMix = receiverMix;
    return { ...step, thermal: thermalStep };
  });

  const finalStep = simulatedProtocolSteps.at(-1)?.thermal;
  return {
    protocolSteps: simulatedProtocolSteps,
    final: {
      finalTransferEndPressureBar: finalStep?.pressureAtTransferEndHotBar ?? finalStep?.pressureAtTransferEndBar ?? currentPressureBar,
      finalTransferEndTemperatureC: finalStep?.temperatureAtTransferEndC ?? currentTemperatureC,
      finalAmbientPressureBar: finalStep?.pressureAfterWaitBar ?? currentPressureBar,
      finalAmbientTemperatureC: finalStep?.temperatureAfterWaitC ?? currentTemperatureC
    }
  };
}

export function simulateCompareProtocol({
  protocolSteps,
  cylinder,
  physics,
  thermal,
  settings
}) {
  const booster = thermalBoosterSettings(settings);
  const tauMinutes = coolingTimeConstantMinutes(thermal.tankMaterial, thermal.coolingMedium, thermal.waterSubmersionPercent);
  const useVdw = physics.model === 'vdw';
  let currentPressureBar = Math.max(0, cylinder.initialPressureBar
    ?? protocolSteps[0]?.receiverStartPressureBar
    ?? protocolSteps[0]?.resultingPressureBar
    ?? 0);
  let currentTemperatureC = physics.temperatureC;
  let currentMix = {
    oxygenPercent: cylinder.initialOxygenPercent ?? protocolSteps[0]?.resultingMix?.oxygenPercent ?? 0,
    heliumPercent: cylinder.initialHeliumPercent ?? protocolSteps[0]?.resultingMix?.heliumPercent ?? 0
  };

  const simulatedProtocolSteps = protocolSteps.map(step => {
    const pressureStartBar = currentPressureBar;
    const temperatureStartC = currentTemperatureC;
    const receiverMix = stepMix(step);
    const isWait = step.type === 'wait';
    const isKeep = step.type === 'keep';
    const requestedTransferEndPressureBar = isWait || isKeep
      ? currentPressureBar
      : stepTransferEndPressure(step, currentPressureBar);
    let transferEndPressureBar = step.pressureAtTransferEndReferenceBar
      ?? requestedTransferEndPressureBar;
    let transfer = null;
    let durationMinutes = 0;
    let inletTemperatureC = inletTemperatureFor('none', thermal, booster);
    let transferTemperatureSamples = [{ elapsedMinutes: 0, temperatureC: currentTemperatureC }];
    let temperatureAtTransferEndC = currentTemperatureC;
    let hasTransferProfile = false;
    let pressureAtTransferEndHotBar = transferEndPressureBar;
    const solveHotEndpoint = !isWait
      && !isKeep
      && !Number.isFinite(step.pressureAtTransferEndReferenceBar);

    for (let iteration = 0; iteration < (solveHotEndpoint ? 8 : 1); iteration += 1) {
      const transferStep = step.type === 'add'
        ? step.method === 'boost'
          ? {
            ...step,
            type: 'boost',
            sourceStartPressureBar: step.sourcePressureBar,
            sourceEndPressureBar: step.sourcePressureBar
          }
          : step.method === 'compressor'
            ? { ...step, type: 'boost', operation: 'Top-up' }
            : { ...step, type: 'decant' }
        : step.type === 'equalize'
          ? { ...step, type: 'decant' }
          : step;
      transfer = isWait || isKeep
        ? {
          rateSource: 'none',
          rateBarPerMin: null,
          pressureIncreaseBar: 0,
          pressureChangeBar: 0
        }
        : rateForProtocolStep({
          step: transferStep,
          currentPressureBar,
          currentTemperatureC,
          transferEndPressureBar,
          cylinder,
          physics,
          thermal,
          booster
        });
      durationMinutes = transfer.rateBarPerMin && transfer.rateBarPerMin > 0
        ? transfer.pressureIncreaseBar / transfer.rateBarPerMin
        : 0;
      inletTemperatureC = inletTemperatureFor(transfer.rateSource, thermal, booster);
      hasTransferProfile = transfer.rateSource === 'booster'
        || transfer.rateSource === 'compressor'
        || transfer.rateSource === 'decant-rate'
        || transfer.rateSource === 'draining-rate';
      transferTemperatureSamples = hasTransferProfile
        ? estimateTransferTemperatureSamples({
          startTemperatureC: currentTemperatureC,
          startPressureBar: currentPressureBar,
          addedPressureBar: transfer.pressureChangeBar ?? transfer.pressureIncreaseBar,
          fillTimeMinutes: durationMinutes,
          volumeL: cylinder.volumeL,
          heliumFraction: (step.sourceHeliumPercent ?? receiverMix.heliumPercent) / 100,
          oxygenFraction: (step.sourceOxygenPercent ?? receiverMix.oxygenPercent) / 100,
          tankMaterial: thermal.tankMaterial,
          coolingMedium: thermal.coolingMedium,
          waterSubmersionPercent: thermal.waterSubmersionPercent,
          tankMassKg: thermal.tankMassKg,
          ambientTemperatureC: thermal.ambientTemperatureC,
          inletTemperatureC
        })
        : [{ elapsedMinutes: 0, temperatureC: currentTemperatureC }];
      temperatureAtTransferEndC = transferTemperatureSamples.at(-1).temperatureC;
      pressureAtTransferEndHotBar = hasTransferProfile
        ? calculatePressureAtTemperature({
          pressureBar: transferEndPressureBar,
          oxygenPercent: receiverMix.oxygenPercent,
          heliumPercent: receiverMix.heliumPercent,
          fromTemperatureC: physics.temperatureC,
          toTemperatureC: temperatureAtTransferEndC,
          volumeL: cylinder.volumeL,
          useVdw
        })
        : transferEndPressureBar;
      if (!solveHotEndpoint || !hasTransferProfile) break;
      const solvedReferencePressureBar = calculatePressureAtTemperature({
        pressureBar: requestedTransferEndPressureBar,
        oxygenPercent: receiverMix.oxygenPercent,
        heliumPercent: receiverMix.heliumPercent,
        fromTemperatureC: temperatureAtTransferEndC,
        toTemperatureC: physics.temperatureC,
        volumeL: cylinder.volumeL,
        useVdw
      });
      const lowerBound = Math.min(currentPressureBar, requestedTransferEndPressureBar);
      const upperBound = Math.max(currentPressureBar, requestedTransferEndPressureBar);
      const nextReferencePressureBar = clamp(solvedReferencePressureBar, lowerBound, upperBound);
      if (Math.abs(nextReferencePressureBar - transferEndPressureBar) < 1e-7) break;
      transferEndPressureBar = nextReferencePressureBar;
    }
    const pressureAtTransferEndReferenceBar = transferEndPressureBar;
    const pressureAtTransferEndAmbientBar = hasTransferProfile
      ? calculatePressureAtTemperature({
        pressureBar: pressureAtTransferEndReferenceBar,
        oxygenPercent: receiverMix.oxygenPercent,
        heliumPercent: receiverMix.heliumPercent,
        fromTemperatureC: physics.temperatureC,
        toTemperatureC: thermal.ambientTemperatureC,
        volumeL: cylinder.volumeL,
        useVdw
      })
      : pressureAtTransferEndReferenceBar;
    let waitMinutes = isWait
      ? (Number.isFinite(step.waitMinutes) ? step.waitMinutes : 0)
      : 0;
    if (isWait && step.waitMode === 'target') {
      const targetTemperatureC = step.targetTemperatureC;
      if (!Number.isFinite(targetTemperatureC)
        || targetTemperatureC <= thermal.ambientTemperatureC
        || temperatureAtTransferEndC < targetTemperatureC) {
        throw compareTargetWaitError('Compare target wait cannot reach the requested target temperature.', {
          targetTemperatureC,
          temperatureAtTransferEndC,
          ambientTemperatureC: thermal.ambientTemperatureC
        });
      }
      waitMinutes = calculateCoolingTime({
        transferEndTemperatureC: temperatureAtTransferEndC,
        ambientTemperatureC: thermal.ambientTemperatureC,
        targetTemperatureC,
        tauMinutes
      });
    }
    const temperatureAfterWaitC = calculateTemperatureAfterWait({
      transferEndTemperatureC: temperatureAtTransferEndC,
      ambientTemperatureC: thermal.ambientTemperatureC,
      waitMinutes,
      tauMinutes
    });
    const pressureAfterWaitBar = Math.max(0, calculatePressureAtTemperature({
      pressureBar: pressureAtTransferEndHotBar,
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
      pressureStartBar,
      temperatureStartC,
      temperatureAtTransferEndC,
      pressureReferenceTemperatureC: physics.temperatureC,
      pressureAtTransferEndReferenceBar,
      pressureAtTransferEndAmbientBar,
      waitMinutes,
      temperatureAfterWaitC,
      pressureAtTransferEndBar: pressureAtTransferEndHotBar,
      pressureAtTransferEndHotBar,
      pressureAfterWaitBar,
      samples: buildThermalStepSamples({
        currentPressureBar,
        currentTemperatureC,
        transfer,
        transferTemperatureSamples,
        durationMinutes,
        transferEndPressureBar,
        pressureAtTransferEndAmbientBar,
        pressureAtTransferEndHotBar,
        receiverMix,
        temperatureAtTransferEndC,
        waitMinutes,
        temperatureAfterWaitC,
        pressureAfterWaitBar,
        isFinalStep: false,
        skipsConfiguredWait: false,
        thermal,
        tauMinutes,
        cylinder,
        useVdw
      })
    };

    currentPressureBar = pressureAfterWaitBar;
    currentTemperatureC = temperatureAfterWaitC;
    currentMix = receiverMix;
    return { ...step, thermal: thermalStep };
  });

  const recipeEnd = {
    pressureBar: currentPressureBar,
    temperatureC: currentTemperatureC,
    oxygenPercent: currentMix.oxygenPercent,
    heliumPercent: currentMix.heliumPercent
  };
  const ambientSettled = {
    pressureBar: Math.max(0, calculatePressureAtTemperature({
      pressureBar: recipeEnd.pressureBar,
      oxygenPercent: recipeEnd.oxygenPercent,
      heliumPercent: recipeEnd.heliumPercent,
      fromTemperatureC: recipeEnd.temperatureC,
      toTemperatureC: thermal.ambientTemperatureC,
      volumeL: cylinder.volumeL,
      useVdw
    })),
    temperatureC: thermal.ambientTemperatureC,
    oxygenPercent: recipeEnd.oxygenPercent,
    heliumPercent: recipeEnd.heliumPercent
  };
  const inWaterTemperatureC = thermal.targetInWaterTemperatureC;
  const inWater = Number.isFinite(inWaterTemperatureC)
    ? {
      pressureBar: Math.max(0, calculatePressureAtTemperature({
        pressureBar: ambientSettled.pressureBar,
        oxygenPercent: ambientSettled.oxygenPercent,
        heliumPercent: ambientSettled.heliumPercent,
        fromTemperatureC: ambientSettled.temperatureC,
        toTemperatureC: inWaterTemperatureC,
        volumeL: cylinder.volumeL,
        useVdw
      })),
      temperatureC: inWaterTemperatureC,
      oxygenPercent: ambientSettled.oxygenPercent,
      heliumPercent: ambientSettled.heliumPercent
    }
    : null;
  return {
    protocolSteps: simulatedProtocolSteps,
    final: {
      recipeEnd,
      ambientSettled,
      ambientSettledDurationMinutes: 4.6 * tauMinutes,
      inWater
    }
  };
}
