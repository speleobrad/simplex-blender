export const UNIT_SYSTEMS = Object.freeze({
  metric: Object.freeze({ pressure: 'bar', volume: 'L', mass: 'kg', temperature: '°C', flow: 'L/min' }),
  imperial: Object.freeze({ pressure: 'psi', volume: 'gal', mass: 'lb', temperature: '°F', flow: 'cfm' })
});

const FACTORS = Object.freeze({ pressure: 14.5037738, volume: 0.2641720526, mass: 2.20462262185, flow: 0.0353146667 });
const QUANTITIES = new Set(['pressure', 'volume', 'mass', 'temperature', 'flow']);
export function normalizeUnits(units) { return units === 'imperial' ? 'imperial' : 'metric'; }
export function getUnitLabel(quantity, units = 'metric') { return UNIT_SYSTEMS[normalizeUnits(units)][quantity] ?? ''; }
export function unitLabel(quantity, units = 'metric') { return getUnitLabel(quantity, units); }
export function convertToDisplay(value, quantity, units = 'metric') {
  if (!Number.isFinite(value) || !QUANTITIES.has(quantity) || normalizeUnits(units) === 'metric') return value;
  return quantity === 'temperature' ? value * 9 / 5 + 32 : value * FACTORS[quantity];
}
export function convertFromDisplay(value, quantity, units = 'metric') {
  if (!Number.isFinite(value) || !QUANTITIES.has(quantity) || normalizeUnits(units) === 'metric') return value;
  return quantity === 'temperature' ? (value - 32) * 5 / 9 : value / FACTORS[quantity];
}
export function formatQuantity(value, quantity, units = 'metric') {
  return `${Number.isFinite(value) ? value.toFixed(2) : '—'} ${getUnitLabel(quantity, units)}`;
}
export function formatPressure(value, units = 'metric') {
  const display = convertToDisplay(value, 'pressure', units);
  const precision = display === 0 || Math.abs(display) >= 1000 ? 0 : 1;
  return `${Number.isFinite(display) ? display.toFixed(precision) : '—'} ${getUnitLabel('pressure', units)}`;
}
