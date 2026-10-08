import {
  GAS_CONSTANT,
  calcMolarDensity,
  calcPressure,
  calcZ
} from './physics.js';

const ATMOSPHERIC_PRESSURE_BAR = 1.01325;
const CLEARANCE_RATIO = 0.05;
const GAMMA = 1.4;
const OXYGEN_RICH_THRESHOLD = 40;

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
  const zSource = calcZ(
    sourcePressureBar,
    sourceOxygenPercent,
    sourceHeliumPercent,
    temperatureC,
    useVdw
  );
  const zReceiver = calcZ(
    receiverPressureBar,
    receiverOxygenPercent,
    receiverHeliumPercent,
    temperatureC,
    useVdw
  );
  const compressionRatio = sourcePressureBar > 0
    ? receiverPressureBar / sourcePressureBar
    : Infinity;
  const volumetricEfficiency = receiverPressureBar <= sourcePressureBar
    ? 1
    : clamp(
      1 - CLEARANCE_RATIO * (Math.pow(compressionRatio, 1 / GAMMA) - 1),
      0.10,
      0.98
    );
  const effectiveFlowLPerMin = cylinderVolumeCm3 / 1000 * bpm * volumetricEfficiency;
  const temperatureK = temperatureC + 273.15;
  const molesPerMin = sourcePressureBar * effectiveFlowLPerMin
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
    ATMOSPHERIC_PRESSURE_BAR,
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

export function estimateCompressionTemperature({
  startTemperatureC,
  addedPressureBar,
  fillTimeMinutes,
  volumeL,
  heliumFraction,
  tankMaterial,
  coolingMedium
}) {
  const sizeFactor = volumeL <= 7 ? 0.85 : volumeL >= 15 ? 1.15 : 1;
  const materialFactor = tankMaterial === 'aluminum' ? 2.6 : 1.8;
  const coolingFactor = coolingMedium === 'water' ? materialFactor * 2.8 : materialFactor;
  const gasFactor = 1 + 0.45 * heliumFraction;
  const deltaTemperatureC = addedPressureBar * sizeFactor * gasFactor
    / (coolingFactor + 0.15 * fillTimeMinutes);

  return startTemperatureC + deltaTemperatureC;
}

const DEFAULT_BOOSTER_SETTINGS = {
  cylinderVolumeCm3: 9,
  oxygenBoostBpm: 50,
  otherBoostBpm: 50,
  oxygenDecantRateBarPerMin: 5,
  otherDecantRateBarPerMin: 5,
  compressorInletFlowLPerMin: 100
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

function stepTransferEndPressure(step, currentPressureBar) {
  if (Number.isFinite(step.receiverEndPressureBar)) return step.receiverEndPressureBar;
  if (Number.isFinite(step.resultingPressureBar)) return step.resultingPressureBar;
  return currentPressureBar;
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
  const pressureIncreaseBar = Math.max(0, transferEndPressureBar - currentPressureBar);
  const useVdw = physics.model === 'vdw';

  if (step.operation === 'Top-up') {
    return {
      rateSource: 'compressor',
      rateBarPerMin: calculateCompressorFillRate({
        inletFlowLPerMin: booster.compressorInletFlowLPerMin,
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
  let currentPressureBar = cylinder.initialPressureBar
    ?? protocolSteps[0]?.receiverStartPressureBar
    ?? protocolSteps[0]?.resultingPressureBar
    ?? 0;
  let currentTemperatureC = physics.temperatureC;

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
    const temperatureAtTransferEndC = transfer.rateSource === 'booster'
      || transfer.rateSource === 'compressor'
      ? estimateCompressionTemperature({
        startTemperatureC: currentTemperatureC,
        addedPressureBar: transfer.pressureIncreaseBar,
        fillTimeMinutes: durationMinutes,
        volumeL: cylinder.volumeL,
        heliumFraction: receiverMix.heliumPercent / 100,
        tankMaterial: thermal.tankMaterial,
        coolingMedium: thermal.coolingMedium
      })
      : currentTemperatureC;
    const isFinalStep = index === protocolSteps.length - 1;
    const waitMinutes = isFinalStep
      ? 4.6 * tauMinutes
      : thermal.waitMode === 'temperature'
        ? calculateCoolingTime({
          transferEndTemperatureC: temperatureAtTransferEndC,
          ambientTemperatureC: thermal.ambientTemperatureC,
          targetTemperatureC: thermal.targetTemperatureC,
          tauMinutes
        })
        : thermal.waitMinutes;
    const temperatureAfterWaitC = isFinalStep
      ? thermal.ambientTemperatureC
      : calculateTemperatureAfterWait({
        transferEndTemperatureC: temperatureAtTransferEndC,
        ambientTemperatureC: thermal.ambientTemperatureC,
        waitMinutes,
        tauMinutes
      });
    const pressureAfterWaitBar = calculatePressureAtTemperature({
      pressureBar: transferEndPressureBar,
      oxygenPercent: receiverMix.oxygenPercent,
      heliumPercent: receiverMix.heliumPercent,
      fromTemperatureC: temperatureAtTransferEndC,
      toTemperatureC: temperatureAfterWaitC,
      volumeL: cylinder.volumeL,
      useVdw
    });
    const thermalStep = {
      rateSource: transfer.rateSource,
      rateBarPerMin: transfer.rateBarPerMin,
      durationMinutes,
      temperatureStartC: currentTemperatureC,
      temperatureAtTransferEndC,
      waitMinutes,
      temperatureAfterWaitC,
      pressureAtTransferEndBar: transferEndPressureBar,
      pressureAfterWaitBar
    };

    currentPressureBar = pressureAfterWaitBar;
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
