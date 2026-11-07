/**
 * The site theme preference (refactor state machine UI-05, the Functions' half): the states, the
 * moves between them, the storage key, and the first-paint choice the shell's head stamp makes
 * (functions/_templates/shell.js THEME_BOOTSTRAP, built from this file).
 *   system  nothing stored: the page follows prefers-color-scheme
 *   light   stored by the header's toggle
 *   dark    the same
 * The toggle (assets/site/site-chrome.js, and the map page's fallback in src/map/app/site-chrome.js)
 * flips light <-> dark and stores the result; nothing moves back to `system` (as today: clearing
 * site data is the only way back). Those two scripts are classic scripts outside functions/; the
 * test tests/functions/theme.test.mjs holds this table, the stamp and their literals together.
 */

/** @typedef {'system' | 'light' | 'dark'} ThemePreference */
/** @typedef {'light' | 'dark'} Theme */

/** The localStorage key the stamp reads and the toggle writes. */
export const THEME_KEY = 'theme';

/** The themes a page can carry on <html data-theme>. */
export const THEMES = Object.freeze(/** @type {Theme[]} */ (['dark', 'light']));

/** @type {ThemePreference} */
export const INITIAL_THEME_PREFERENCE = 'system';

/** @type {Readonly<Record<ThemePreference, readonly ThemePreference[]>>} */
export const THEME_PREFERENCE_TRANSITIONS = Object.freeze({
  system: Object.freeze(/** @type {ThemePreference[]} */ (['light', 'dark'])),
  light: Object.freeze(/** @type {ThemePreference[]} */ (['dark'])),
  dark: Object.freeze(/** @type {ThemePreference[]} */ (['light'])),
});

/**
 * The preference a stored value stands for: a theme, or `system` for anything else (nothing
 * stored, storage refused, or a value no version wrote).
 * @param {unknown} stored
 * @returns {ThemePreference}
 */
export const preferenceOf = (stored) => (THEMES.includes(/** @type {Theme} */ (stored)) ? /** @type {Theme} */ (stored) : 'system');

/**
 * The theme a page paints first: the stored one, else the system's.
 * @param {unknown} stored
 * @param {boolean} systemDark  prefers-color-scheme: dark matches
 * @returns {Theme}
 */
export function firstPaintTheme(stored, systemDark) {
  const preference = preferenceOf(stored);
  if (preference !== 'system') return preference;
  return systemDark ? 'dark' : 'light';
}

/**
 * The head stamp: firstPaintTheme as an inline script that runs before any stylesheet applies.
 * Its text is pinned by tests/functions/theme.test.mjs (the pages' bytes do not change).
 */
export const themeBootstrapScript = () => '<script>(function(){var t=null;'
  + `try{t=localStorage.getItem('${THEME_KEY}');}catch(e){}`
  + `if(${THEMES.map((theme) => `t!=='${theme}'`).join('&&')}){`
  + "t=window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';}"
  + 'document.documentElement.dataset.theme=t;})();</script>';
