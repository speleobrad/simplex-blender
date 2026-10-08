import { isValidGasComposition } from './gas-input.js';

export function validateCalculatorInputs(cylinder, physics) {
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
  return errors;
}
export function validateSupplyBankInput(bank) {
  if (!bank || typeof bank !== 'object') return ['Supply bank is invalid.'];
  if (typeof bank.id !== 'string' || !bank.id) return ['Supply bank ID must be non-empty text.'];
  if (typeof bank.name !== 'string' || !bank.name.trim() || typeof bank.enabled !== 'boolean') {
    return ['Supply bank names must be non-empty text and enabled states must be boolean.'];
  }

  const numericFields = [
    ['volumeL', 1, 200],
    ['pressureBar', 1, 350]
  ];
  for (const [field, minimum, maximum] of numericFields) {
    if (!Number.isFinite(bank[field])) return ['Supply bank values must be finite numbers.'];
    if (bank[field] < minimum || bank[field] > maximum) {
      return ['Supply bank volume must be 1–200 L; pressure 1–350 bar; minimum pressure 0–100 bar.'];
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
