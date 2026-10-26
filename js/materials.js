// Single source of truth for cylinder materials. Every value accepted by preset and
// input validation must have a complete thermal parameter set here.
//
// `carbon-wrapped-steel` (shown as "Fero-carbon") covers steel-lined, carbon-fibre
// hoop-wrapped cylinders such as the Worthington Carbondive. Its thermal parameters are
// deliberately UNCALIBRATED and borrowed from steel: the liner carries most of the mass,
// and no measured fill or cool-down data exists for the wrap's effect (it may slow
// cool-down in water). Aluminium-lined and polymer-lined (Type 3/4) composites are not
// modelled and must not be mapped onto these values.

const STEEL_THERMAL = Object.freeze({
  defaultTankMassKg: 14,
  specificHeatJPerKgK: 490,
  areaM2: 0.45,
  airTauMinutes: 18,
  waterTauMinutes: 3.5
});

export const MATERIALS = Object.freeze({
  steel: Object.freeze({ label: 'Steel', thermal: STEEL_THERMAL }),
  aluminum: Object.freeze({
    label: 'Aluminium',
    labelImperial: 'Aluminum',
    thermal: Object.freeze({
      defaultTankMassKg: 14.2,
      specificHeatJPerKgK: 900,
      areaM2: 0.48,
      airTauMinutes: 25,
      waterTauMinutes: 5
    })
  }),
  'carbon-wrapped-steel': Object.freeze({
    label: 'Fero-carbon',
    thermal: STEEL_THERMAL
  })
});

export const MATERIAL_VALUES = Object.freeze(Object.keys(MATERIALS));

export function isValidMaterial(material) {
  return Object.hasOwn(MATERIALS, material);
}

export function materialListText() {
  const labels = MATERIAL_VALUES.map(value => MATERIALS[value].label.toLowerCase());
  return `${labels.slice(0, -1).join(', ')} or ${labels.at(-1)}`;
}

// An absent material keeps the historical steel default; an unknown one is an error
// rather than silently inheriting steel behaviour.
export function materialThermal(material) {
  if (material === undefined || material === null) return STEEL_THERMAL;
  if (!isValidMaterial(material)) throw new Error(`Unknown cylinder material: ${material}`);
  return MATERIALS[material].thermal;
}
