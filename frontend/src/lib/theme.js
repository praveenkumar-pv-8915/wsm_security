/**
 * Light/Dark ground persistence. Applies a `data-theme` attribute on <html>, which App.css's
 * `:root[data-theme="light"]` block reads to swap the ground and invert the accent ramp.
 *
 * The app's ground tokens come from the "WSM Security v3" mockup: dark is `nordic`, light is
 * `porcelain`, both on the `gold` accent with `electric` as the second accent. The mockup's own
 * theme and accent pickers are deliberately not shipped — they were an exploration tool, so the
 * palette is fixed and only the light/dark ground is user-switchable.
 *
 * No system-preference detection — defaults to dark unless the user has explicitly switched.
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
