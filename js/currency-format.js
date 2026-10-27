/** Prefix for a currency symbol: alphanumeric symbols get a following space ("CHF 12.40"); punctuation stays attached ("€12.40"). */
export function currencyPrefix(symbol) {
  if (!symbol) return '';
  return /[A-Za-z0-9]$/.test(symbol) ? `${symbol} ` : symbol;
}

/** Format a money amount with a fixed number of decimal digits and the configured currency prefix. */
export function formatMoney(amount, symbol, digits) {
  return `${currencyPrefix(symbol)}${amount.toFixed(digits)}`;
}
