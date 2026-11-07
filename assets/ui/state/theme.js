/**
 * The site theme preference (state-machine catalogue UI-05): the one table.
 *
 * The preference is what the reader asked for: nothing yet (`system`, follow
 * prefers-color-scheme), or `light` or `dark`, saved under localStorage `theme`. The theme shown
 * on <html data-theme> is the preference, or the system's when there is none.
 *
 * The toggle flips the theme shown and saves it, so the first click leaves `system` for the
 * opposite of what the system gave, and after that it moves between `light` and `dark`. There is
 * no way back to `system` (as before this table; clearing site data is the way).
 *
 * Three places act on it, and none of them can import this module before first paint:
 *   - the head bootstrap, functions/_templates/shell.js THEME_BOOTSTRAP (inline, before any
 *     stylesheet), stamped into every page by the shell and by scripts/build/build-site-partials.mjs;
 *   - the shared header's toggle, assets/site/site-chrome.js (a classic script, which carries a
 *     copy of this table in THEME_TRANSITIONS and guards its click with it);
 *   - the map app's fallback for a page without the shared header, src/map/app/site-chrome.js.
 * tests/unit/ui-theme.test.mjs runs the first two against this module for every stored value
 * and system setting, and fails when the copied table drifts.
 *
 * Pure: no DOM, no storage.
 */
import { defineMachine } from './machine.js';

/** The localStorage key of the saved preference. */
export const THEME_KEY = 'theme';

/** @typedef {'system' | 'light' | 'dark'} ThemePreference */
/** @typedef {'light' | 'dark'} Theme */

export const THEME_PREFERENCE = defineMachine({
  name: 'site theme preference',
  initial: /** @type {ThemePreference} */ ('system'),
  transitions: {
    system: /** @type {ThemePreference[]} */ (['light', 'dark']),
    light: /** @type {ThemePreference[]} */ (['dark']),
    dark: /** @type {ThemePreference[]} */ (['light']),
  },
});

/**
 * The preference a stored value means: anything but `light` or `dark` (nothing saved, an old or
 * foreign value, storage blocked) is `system`.
 * @param {unknown} stored
 * @returns {ThemePreference}
 */
export function preferenceOf(stored) {
  return stored === 'light' || stored === 'dark' ? stored : 'system';
}

/**
 * The theme a preference shows.
 * @param {ThemePreference} preference
 * @param {boolean} systemDark   prefers-color-scheme: dark matches
 * @returns {Theme}
 */
export function themeFor(preference, systemDark) {
  if (preference === 'light' || preference === 'dark') return preference;
  return systemDark ? 'dark' : 'light';
}

/**
 * Where the toggle goes from the theme shown: the other one, saved.
 * @param {Theme} shown
 * @returns {Theme}
 */
export function toggledFrom(shown) {
  return shown === 'dark' ? 'light' : 'dark';
}
