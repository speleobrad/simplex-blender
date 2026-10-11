import { isValidGasComposition } from './gas-input.js';

export function validateCalculatorInputs(cylinder, physics, thermal) {
  const errors = [];
  if (!Number.isFinite(cylinder?.volumeL) || cylinder.volumeL < 0.1) {
    errors.push('Cylinder capacity must be at least 0.1 L.');
  }
  if (!Number.isFinite(cylinder?.initialPressureBar)
    || cylinder.initialPressureBar < 0 || cylinder.initialPressureBar > 350) {
    errors.push('Initial pressure must be between 0 and 350 bar.');
  }
  if (!Number.isFinite(cylinder?.targetPressureBar)
    || cylinder.targetPressureBar < 10 || cylinder.targetPressureBar > 350) {
    errors.push('Target pressure must be between 10 and 350 bar.');
  }
  if (!Number.isFinite(physics?.temperatureC)
    || physics.temperatureC < 0 || physics.temperatureC > 50) {
    errors.push('Temperature must be between 0 and 50°C.');
  }
  if (thermal === undefined) return errors;

  if (!thermal || typeof thermal !== 'object') {
    errors.push('Thermal input must be an object.');
    return errors;
  }
  if (!['steel', 'aluminum'].includes(thermal.tankMaterial)) {
    errors.push('Thermal tank material must be steel or aluminum.');
  }
  if (!['air', 'water'].includes(thermal.coolingMedium)) {
    errors.push('Thermal cooling medium must be air or water.');
  }
  if (!Number.isFinite(thermal.ambientTemperatureC)
    || thermal.ambientTemperatureC < 0 || thermal.ambientTemperatureC > 50) {
    errors.push('Thermal ambient temperature must be between 0 and 50°C.');
  }
  if (thermal.inletTemperatureC !== undefined
    && (!Number.isFinite(thermal.inletTemperatureC)
      || thermal.inletTemperatureC < -20 || thermal.inletTemperatureC > 100)) {
    errors.push('Thermal inlet gas temperature must be between -20 and 100°C.');
  }
  if (!['minutes', 'temperature'].includes(thermal.waitMode)) {
    errors.push('Thermal wait mode must be minutes or temperature.');
  }
  if (!Number.isFinite(thermal.waitMinutes)
    || thermal.waitMinutes < 0 || thermal.waitMinutes > 1440) {
    errors.push('Thermal wait minutes must be between 0 and 1440.');
  }
  if (!Number.isFinite(thermal.targetTemperatureC)
    || thermal.targetTemperatureC < 0 || thermal.targetTemperatureC > 100) {
    errors.push('Thermal target temperature must be between 0 and 100°C.');
  } else if (thermal.waitMode === 'temperature'
    && Number.isFinite(thermal.ambientTemperatureC)
    && thermal.targetTemperatureC <= thermal.ambientTemperatureC) {
    errors.push('Thermal target temperature must be above ambient temperature.');
  }
  return errors;
}
export function validateSupplyBankInput(bank) {
  if (!bank || typeof bank !== 'object') return ['Supply bank is invalid.'];
  if (typeof bank.id !== 'string' || !bank.id) return ['Supply bank ID must be non-empty text.'];
  if (typeof bank.name !== 'string' || !bank.name.trim() || typeof bank.enabled !== 'boolean') {
    return ['Supply bank names must be non-empty text and enabled states must be boolean.'];
  }
  if (bank.oxygenPercent === 21 && bank.heliumPercent === 0) {
    return ['Air is supplied by the implicit compressor and cannot be a finite supply bank.'];
  }

  const numericFields = [
    ['volumeL', 1, 200],
    ['pressureBar', 1, 350]
  ];
  for (const [field, minimum, maximum] of numericFields) {
    if (!Number.isFinite(bank[field])) return ['Supply bank values must be finite numbers.'];
    if (bank[field] < minimum || bank[field] > maximum) {
      return ['Supply bank volume must be 1–200 L; pressure 1–350 bar.'];
    }
  }
  if (!isValidGasComposition(bank.oxygenPercent, bank.heliumPercent)) {
    return [`${bank.name} gas composition must total at most 100% O₂ and He.`];
  }
  if (bank.gasPresetName !== undefined && bank.gasPresetName !== null && typeof bank.gasPresetName !== 'string') {
    return ['Supply bank preset names must be text.'];
  }
  return [];
}
