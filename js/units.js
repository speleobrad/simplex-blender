import { MATERIALS } from './materials.js';
export const METRIC_UNITS = 'metric';
export const IMPERIAL_UNITS = 'imperial';

const LITRES_PER_CUBIC_FOOT = 28.316846592;
const PSI_PER_BAR = 14.5037738;
const POUNDS_PER_KILOGRAM = 2.20462262185;
const CUBIC_INCHES_PER_CUBIC_CENTIMETRE = 0.0610237441;

const UNIT_DEFINITIONS = {
  pressureBar: { metric: ['bar', value => value], imperial: ['psi', value => value * PSI_PER_BAR, value => value / PSI_PER_BAR] },
  pressureBarPerMin: { metric: ['bar/min', value => value], imperial: ['psi/min', value => value * PSI_PER_BAR, value => value / PSI_PER_BAR] },
  volumeL: { metric: ['L', value => value], imperial: ['cu ft', value => value / LITRES_PER_CUBIC_FOOT, value => value * LITRES_PER_CUBIC_FOOT] },
  pricePerVolumeL: { metric: ['/L', value => value], imperial: ['/cu ft', value => value * LITRES_PER_CUBIC_FOOT, value => value / LITRES_PER_CUBIC_FOOT] },
  massKg: { metric: ['kg', value => value], imperial: ['lb', value => value * POUNDS_PER_KILOGRAM, value => value / POUNDS_PER_KILOGRAM] },
  temperatureC: { metric: ['°C', value => value], imperial: ['°F', value => value * 9 / 5 + 32, value => (value - 32) * 5 / 9] },
  temperatureDeltaC: { metric: ['°C', value => value], imperial: ['°F', value => value * 9 / 5, value => value * 5 / 9] },
  flowLPerMin: { metric: ['L/min', value => value], imperial: ['cu ft/min', value => value / LITRES_PER_CUBIC_FOOT, value => value * LITRES_PER_CUBIC_FOOT] },
  volumeCm3: { metric: ['cm³', value => value], imperial: ['in³', value => value * CUBIC_INCHES_PER_CUBIC_CENTIMETRE, value => value / CUBIC_INCHES_PER_CUBIC_CENTIMETRE] }
};

function canonicalQuantity(quantity) {
  return {
    pressure: 'pressureBar',
    volume: 'volumeL',
    mass: 'massKg',
    temperature: 'temperatureC',
    flow: 'flowLPerMin',
    volumeCm: 'volumeCm3'
  }[quantity] ?? quantity;
}

export function normalizeUnits(units) {
  return units === IMPERIAL_UNITS ? IMPERIAL_UNITS : METRIC_UNITS;
}

export function unitLabel(quantity, units) {
  return UNIT_DEFINITIONS[canonicalQuantity(quantity)]?.[normalizeUnits(units)]?.[0] ?? '';
}
export function materialLabel(material, units) {
  const definition = MATERIALS[material];
  if (!definition) return material;
  return units === IMPERIAL_UNITS && definition.labelImperial ? definition.labelImperial : definition.label;
}

export const getUnitLabel = unitLabel;

export function convertToDisplay(value, quantity, units) {
  const definition = UNIT_DEFINITIONS[canonicalQuantity(quantity)]?.[normalizeUnits(units)];
  return definition ? definition[1](value) : value;
}

export function convertFromDisplay(value, quantity, units) {
  const definition = UNIT_DEFINITIONS[canonicalQuantity(quantity)]?.[normalizeUnits(units)];
  return definition?.[2] ? definition[2](value) : value;
}


export function formatUnitValue(value, quantity, units, digits = 1) {
  return `${convertToDisplay(value, quantity, units).toFixed(digits)} ${unitLabel(quantity, units)}`;
}
export function displayStep(value, quantity, units) {
  return convertToDisplay(value, quantity, units);
}


export function formatInputValue(value, quantity, units) {
  const digits = quantity === 'pressureBar' && normalizeUnits(units) === IMPERIAL_UNITS ? 1 : 0;
  return convertToDisplay(value, quantity, units).toFixed(digits);
}
