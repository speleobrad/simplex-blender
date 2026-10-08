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
