export const GAS_CONSTANT = 0.083144626;
export const HELIUM_SALVAGE_MAX_PERCENT = 98;

const GAS_PARAMETERS = {
  helium: { a: 0.0346, b: 0.0238 },
  oxygen: { a: 1.382, b: 0.0319 },
  nitrogen: { a: 1.370, b: 0.0387 }
};

export function getMixParams(oxygenPercent, heliumPercent) {
  const oxygenFraction = Math.max(0, oxygenPercent) / 100;
  const heliumFraction = Math.max(0, heliumPercent) / 100;
  const nitrogenFraction = Math.max(0, 1 - oxygenFraction - heliumFraction);

  const attractionRoot = oxygenFraction * Math.sqrt(GAS_PARAMETERS.oxygen.a)
    + heliumFraction * Math.sqrt(GAS_PARAMETERS.helium.a)
    + nitrogenFraction * Math.sqrt(GAS_PARAMETERS.nitrogen.a);

  return {
    a: attractionRoot * attractionRoot,
    b: oxygenFraction * GAS_PARAMETERS.oxygen.b
      + heliumFraction * GAS_PARAMETERS.helium.b
      + nitrogenFraction * GAS_PARAMETERS.nitrogen.b
  };
}

export function calcPressure(molarDensity, oxygenPercent, heliumPercent, temperatureC, useVdw = true) {
  const temperatureK = temperatureC + 273.15;
  if (!useVdw) return molarDensity * GAS_CONSTANT * temperatureK;

  const { a, b } = getMixParams(oxygenPercent, heliumPercent);
  const denominator = 1 - b * molarDensity;
  if (denominator <= 0.001) return 9999;

  const pressure = (molarDensity * GAS_CONSTANT * temperatureK) / denominator
    - a * molarDensity * molarDensity;
  return Math.max(0, pressure);
}

export function calcMolarDensity(pressureBar, oxygenPercent, heliumPercent, temperatureC, useVdw = true) {
  const temperatureK = temperatureC + 273.15;
  if (pressureBar <= 0) return 0;
  if (!useVdw) return pressureBar / (GAS_CONSTANT * temperatureK);

  const { a, b } = getMixParams(oxygenPercent, heliumPercent);
  let density = pressureBar / (GAS_CONSTANT * temperatureK);
  const maxDensity = 0.96 / b;
  if (density >= maxDensity) density = maxDensity * 0.8;

  for (let iteration = 0; iteration < 40; iteration++) {
    const denominator = 1 - b * density;
    if (denominator <= 0.001) {
      density = maxDensity * 0.95;
      break;
    }

    const residual = (density * GAS_CONSTANT * temperatureK) / denominator
      - a * density * density - pressureBar;
    const derivative = (GAS_CONSTANT * temperatureK) / (denominator * denominator)
      - 2 * a * density;

    if (Math.abs(derivative) < 1e-9) break;
    const delta = residual / derivative;
    density -= delta;

    if (density >= maxDensity) density = maxDensity * 0.95;
    if (density < 0) density = 1e-4;
    if (Math.abs(delta) < 1e-6) break;
  }

  return Math.max(0, density);
}

export function calcZFromDensity(pressureBar, molarDensity, temperatureC, useVdw = true) {
  if (pressureBar <= 0 || !useVdw || molarDensity <= 0) return 1;
  const temperatureK = temperatureC + 273.15;
  return pressureBar / (molarDensity * GAS_CONSTANT * temperatureK);
}

export function calcZ(pressureBar, oxygenPercent, heliumPercent, temperatureC, useVdw = true) {
  if (pressureBar <= 0 || !useVdw) return 1;
  const density = calcMolarDensity(pressureBar, oxygenPercent, heliumPercent, temperatureC, true);
  return calcZFromDensity(pressureBar, density, temperatureC, true);
}
