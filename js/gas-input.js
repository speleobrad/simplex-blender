const DECIMAL_NUMBER_PATTERN = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

export function splitGasInput(value) {
  const input = String(value);
  const separator = input.indexOf('/');
  if (separator < 0) return null;
  return {
    oxygenText: input.slice(0, separator).trim(),
    heliumText: input.slice(separator + 1).trim()
  };
}
export function isValidGasComposition(oxygenPercent, heliumPercent) {
  return Number.isFinite(oxygenPercent)
    && Number.isFinite(heliumPercent)
    && oxygenPercent >= 0
    && oxygenPercent <= 100
    && heliumPercent >= 0
    && heliumPercent <= 100
    && oxygenPercent + heliumPercent <= 100;
}

export function parseNumericInput(value) {
  const input = String(value).trim();
  if (!DECIMAL_NUMBER_PATTERN.test(input)) return Number.NaN;
  const parsed = Number(input);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}
