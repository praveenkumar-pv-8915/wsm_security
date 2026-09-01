/**
 * Light/Dark theme persistence. Applies a `data-theme` attribute on <html>, which App.css's
 * `:root[data-theme="light"]` block reads to swap the neutral role tokens (see
 * claude/ui-design-system.md). No system-preference detection — defaults to the app's existing
 * dark "Indigo" theme unless the user has explicitly switched.
 */

const STORAGE_KEY = 'wsm-security-theme';

export function getTheme() {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === 'light' || stored === 'dark') return stored;
  } catch {
    /* localStorage unavailable (privacy mode, etc.) — fall back to default */
  }
  return 'dark';
}

export function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  try {
    window.localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    /* best-effort persistence only */
  }
}

export function toggleTheme(current) {
  return current === 'light' ? 'dark' : 'light';
}
