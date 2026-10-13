const STORAGE_KEY = 'simplex-gas-remixer-theme';

export const DEFAULT_THEME = 'light';

export function loadTheme(storage) {
  try {
    const theme = storage.getItem(STORAGE_KEY);
    return theme === 'light' || theme === 'dark' ? theme : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

export function saveTheme(theme, storage) {
  if (theme !== 'light' && theme !== 'dark') throw new RangeError('Theme must be light or dark.');
  storage.setItem(STORAGE_KEY, theme);
}
