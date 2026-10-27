/** Prefix for a currency symbol: alphanumeric symbols get a following space ("CHF 12.40"); punctuation stays attached ("€12.40"). */
export function currencyPrefix(symbol) {
  if (!symbol) return '';
  return /[\p{L}\p{N}]$/u.test(symbol) ? `${symbol} ` : symbol;
}

/** Format a money amount with a fixed number of decimal digits and the configured currency prefix. A negative amount gets its sign before the prefix ("-€1.20"); an amount that rounds to zero has no sign. */
export function formatMoney(amount, symbol, digits) {
  const negative = Number(amount.toFixed(digits)) < 0;
  return `${negative ? '-' : ''}${currencyPrefix(symbol)}${Math.abs(amount).toFixed(digits)}`;
}
