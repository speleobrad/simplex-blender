import {
  DEFAULT_HOT_OVERFILL_PERCENT,
  isValidHotOverfillPercent
} from './preset-validation.js';
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
  if (cylinder?.workingPressureBar !== undefined) {
    if (!Number.isFinite(cylinder.workingPressureBar)
      || cylinder.workingPressureBar < 10
      || cylinder.workingPressureBar > 350) {
      errors.push('Cylinder working pressure must be between 10 and 350 bar.');
    } else {
      if (Number.isFinite(cylinder.initialPressureBar)
        && cylinder.initialPressureBar > cylinder.workingPressureBar) {
        errors.push(`Initial pressure cannot exceed the selected cylinder working pressure of ${cylinder.workingPressureBar} bar.`);
      }
      if (Number.isFinite(cylinder.targetPressureBar)
        && cylinder.targetPressureBar > cylinder.workingPressureBar) {
        errors.push(`Target pressure cannot exceed the selected cylinder working pressure of ${cylinder.workingPressureBar} bar.`);
      }
    }
  }
  if (cylinder?.hotOverfillPercent !== undefined
    && !isValidHotOverfillPercent(cylinder.hotOverfillPercent)) {
    errors.push('Cylinder hot overfill must be between 0 and 5% in 0.5% steps.');
  }
  if (!Number.isFinite(physics?.temperatureC)
    || physics.temperatureC < 5 || physics.temperatureC > 40) {
    errors.push('Temperature must be between 5 and 40°C.');
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
  const legacy = thermal.targetInWaterTemperatureC === undefined
    && thermal.targetMediumTemperatureC === undefined;
  const ambient = thermal.ambientTemperatureC;
  const targetMedium = thermal.targetMediumTemperatureC ?? thermal.targetTemperatureC;
  const targetInWater = thermal.targetInWaterTemperatureC
    ?? thermal.settledTemperatureC
    ?? (legacy ? ambient : undefined);
  if (!Number.isFinite(ambient) || ambient < 5 || ambient > 40) {
    errors.push('Thermal ambient temperature must be between 5 and 40°C.');
  }
  const inlet = thermal.inletTemperatureC ?? (legacy ? ambient : undefined);
  if (!Number.isFinite(inlet) || inlet < 5 || inlet > 40) {
    errors.push('Thermal inlet gas temperature must be between 5 and 40°C.');
  }
  if (!Number.isFinite(targetMedium)
    || targetMedium < 5 || targetMedium > 40) {
    errors.push('Thermal target-medium temperature must be between 5 and 40°C.');
  } else if (Number.isFinite(ambient) && targetMedium < ambient) {
    errors.push('Thermal target-medium temperature cannot be below ambient temperature.');
  }
  if (!Number.isFinite(targetInWater)
    || targetInWater < 1 || targetInWater > 30) {
    errors.push('Thermal target in-water temperature must be between 1 and 30°C.');
  }
  if (thermal.interimMeasurements !== undefined) {
    if (!Array.isArray(thermal.interimMeasurements)) {
      errors.push('Measured interim readings must be an array.');
    } else {
      for (const measurement of thermal.interimMeasurements) {
        if (measurement === null || measurement === undefined) continue;
        if (!measurement || typeof measurement !== 'object') {
          errors.push('Measured interim readings must contain pressure and temperature values.');
          continue;
        }
        if (!Number.isFinite(measurement.pressureBar)
          || measurement.pressureBar < 0
          || measurement.pressureBar > 350) {
          errors.push('Measured pressure must be between 0 and 350 bar.');
        } else if (Number.isFinite(cylinder?.workingPressureBar)
          && measurement.pressureBar > cylinder.workingPressureBar) {
          const hotOverfillPercent = isValidHotOverfillPercent(cylinder.hotOverfillPercent)
            ? cylinder.hotOverfillPercent
            : DEFAULT_HOT_OVERFILL_PERCENT;
          const hotOverfillPressureBar = cylinder.workingPressureBar
            * (1 + hotOverfillPercent / 100);
          const isTransientHot = Number.isFinite(thermal.ambientTemperatureC)
            && Number.isFinite(measurement.temperatureC)
            && measurement.temperatureC > thermal.ambientTemperatureC;
          if (!isTransientHot || measurement.pressureBar > hotOverfillPressureBar) {
            errors.push(isTransientHot
              ? `Measured pressure cannot exceed the selected cylinder hot overfill limit of ${hotOverfillPressureBar} bar.`
              : `Measured pressure cannot exceed the selected cylinder working pressure of ${cylinder.workingPressureBar} bar.`);
          }
        }
        if (!Number.isFinite(measurement.temperatureC)
          || measurement.temperatureC < -20
          || measurement.temperatureC > 100) {
          errors.push('Measured temperature must be between -20 and 100°C.');
        }
      }
    }
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
