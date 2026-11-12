/**
 * Site chrome on the map page: the theme toggle and the support modal. The page carries the shared
 * site header (packages/ui/src/templates/shell.js, `.app-header[data-site-chrome]`), which owns both
 * (assets/site/site-chrome.js); then the map only follows the theme through the
 * `civgraph:themechange` event, and the rest serves a page without that header. What the map app
 * needs of a shared shell: that marker and event (here), `.app-header` (the phone pane toggle goes
 * into it, mobile-layout.js) and its height or `--header-height` (the election pane, election-pane.js).
 *
 * Methods of the map app (Test2App, packages/map/app/app.js), installed on its prototype by installMethods: `this` is the app.
 */

import { THEME_KEY, THEME_PREFERENCE, preferenceOf, themeFor, toggledFrom } from '../../../ui/assets/state/theme.js';

export class SiteChromeMethods {
  setupThemeToggle() {
    // The shared site header (packages/ui/src/templates/shell.js) brings its own toggle, wired by
    // assets/site/site-chrome.js. The map only follows the theme, so binding a second click
    // handler here would flip it twice.
    if (document.querySelector('.app-header[data-site-chrome]')) {
      void this.syncBasemapToTheme();
      document.addEventListener('civgraph:themechange', () => void this.syncBasemapToTheme(), { signal: this.lifecycle.signal });
      return;
    }
    const toggles = [document.getElementById('themeToggle'), document.getElementById('themeToggleMobile')].filter(Boolean);
    // The site's one theme table (assets/ui/state/theme.js, UI-05), as the shared header uses it:
    // a stored value other than light or dark, or storage that is blocked, means the system's.
    let stored = null;
    try { stored = localStorage.getItem(THEME_KEY); } catch { /* blocked: follow the system */ }
    let preference = preferenceOf(stored);
    const prefersDark = Boolean(window.matchMedia?.('(prefers-color-scheme: dark)').matches);
    document.documentElement.dataset.theme = themeFor(preference, prefersDark);

    // T1-06: the basemap follows the theme from the first paint, not just on
    // toggle — someone arriving with prefers-color-scheme: dark should not get one
    // frame of white landmass. Fire-and-forget: applyBaseMap already handles the
    // map not being ready, and nothing here should block setup.
    void this.syncBasemapToTheme();

    toggles.forEach((toggle) => {
      toggle.addEventListener('click', () => {
        const next = toggledFrom(document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');
        THEME_PREFERENCE.assertTransition(preference, next);
        preference = next;
        document.documentElement.dataset.theme = next;
        try { localStorage.setItem(THEME_KEY, next); } catch { /* blocked: the theme still changes for this page */ }
        void this.syncBasemapToTheme();
      });
    });
  }

  setupSupportModal() {
    // Owned by assets/site/site-chrome.js when the shared site header is present.
    if (document.querySelector('.app-header[data-site-chrome]')) return;
    const modal = document.getElementById('supportModal');
    const buttons = [document.getElementById('supportBtn'), document.getElementById('mobileSupportBtn')].filter(Boolean);
    if (!modal || buttons.length === 0) return;

    // T3-06. The markup already declared role="dialog" aria-modal="true", which PROMISES
    // a keyboard user that focus is confined to the dialog and returns when it closes.
    // Nothing implemented that: focus stayed wherever it was, Tab walked straight out
    // into the page behind, and closing left focus nowhere. aria-modal="true" also tells
    // a screen reader the background is inert, so without this the announcement was
    // simply untrue.
    const FOCUSABLE = 'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])';
    let lastFocused = null;

    const focusables = () => [...modal.querySelectorAll(FOCUSABLE)].filter((el) => el.offsetParent !== null);

    const trap = (event) => {
      if (event.key !== 'Tab') return;
      const items = focusables();
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      // Wrap at both ends, and also catch the case where focus has escaped the modal
      // entirely (a click on the background, a browser quirk) by pulling it back.
      if (event.shiftKey && (document.activeElement === first || !modal.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !modal.contains(document.activeElement))) {
        event.preventDefault();
        first.focus();
      }
    };

    // Everything that is NOT the modal, so the background can be made inert. Computed on
    // open rather than cached: the shell is built at runtime and children change.
    const backgroundSiblings = () => [...document.body.children].filter((el) => el !== modal);

    const open = () => {
      lastFocused = document.activeElement;
      modal.classList.remove('hidden');
      backgroundSiblings().forEach((el) => {
        el.setAttribute('aria-hidden', 'true');
        if ('inert' in el) el.inert = true;
      });
      document.addEventListener('keydown', trap, true);
      (focusables()[0] || modal).focus();
    };

    const close = () => {
      modal.classList.add('hidden');
      backgroundSiblings().forEach((el) => {
        el.removeAttribute('aria-hidden');
        if ('inert' in el) el.inert = false;
      });
      document.removeEventListener('keydown', trap, true);
      // Return focus to whatever opened it, not to <body>.
      if (lastFocused && typeof lastFocused.focus === 'function' && document.contains(lastFocused)) {
        lastFocused.focus();
      }
      lastFocused = null;
    };

    buttons.forEach((button) => button.addEventListener('click', (event) => {
      event.preventDefault();
      open();
    }));
    modal.querySelector('.support-modal__backdrop')?.addEventListener('click', close);
    modal.querySelector('.support-modal__close')?.addEventListener('click', close);
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !modal.classList.contains('hidden')) close();
    });
  }
}
