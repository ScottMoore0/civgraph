/**
 * The site theme preference (state-machine catalogue UI-05).
 *
 * assets/ui/state/theme.js holds the table (THEME_PREFERENCE) and the rules: a stored value
 * means a preference, a preference shows a theme, the toggle flips the theme shown. Two scripts
 * act on it without importing it, because both must run before or without modules:
 *   - the head bootstrap, THEME_BOOTSTRAP in functions/_templates/shell.js;
 *   - the shared header's toggle, assets/site/site-chrome.js, which carries a copy of the table.
 * This test runs both, in a vm with stubbed storage and media queries, for every stored value
 * and system setting, and requires them to agree with the module; it fails when the copied
 * table drifts, and walks the moves the table forbids.
 *
 *   node --test tests/unit/ui-theme.test.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { THEME_BOOTSTRAP } from '../../packages/ui/src/templates/shell.js';
import { preferenceOf, THEME_KEY, THEME_PREFERENCE, themeFor, toggledFrom } from '../../packages/ui/assets/state/theme.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CHROME = readFileSync(path.join(ROOT, 'site/assets/site/site-chrome.js'), 'utf8');

const STORED = [null, 'light', 'dark', 'sepia', 'BLOCKED'];
const SYSTEM = [true, false, undefined]; // prefers dark, prefers light, no matchMedia

/** A browser-ish global: localStorage (or one that throws), matchMedia, <html>, events. */
function sandbox({ stored, systemDark, header = null, theme } = {}) {
  const store = new Map(stored == null || stored === 'BLOCKED' ? [] : [[THEME_KEY, stored]]);
  const localStorage = {
    getItem(key) { if (stored === 'BLOCKED') throw new Error('blocked'); return store.has(key) ? store.get(key) : null; },
    setItem(key, value) { if (stored === 'BLOCKED') throw new Error('blocked'); store.set(key, String(value)); },
  };
  const events = [];
  const documentElement = { dataset: theme ? { theme } : {}, style: { setProperty() {} } };
  const document = {
    documentElement,
    readyState: 'complete',
    querySelector: (sel) => (sel === '.app-header[data-site-chrome]' ? header : null),
    querySelectorAll: () => [],
    getElementById: () => null,
    addEventListener() {},
    dispatchEvent: (event) => { events.push(event); return true; },
  };
  const window = { addEventListener() {} };
  if (systemDark !== undefined) window.matchMedia = (q) => ({ matches: q === '(prefers-color-scheme: dark)' && systemDark });
  class CustomEvent { constructor(type, init) { this.type = type; this.detail = init?.detail; } }
  const context = vm.createContext({ window, document, localStorage, CustomEvent });
  return { context, store, events, documentElement };
}

/** A shared header with one theme button; returns its click. */
function headerWithToggle() {
  let onClick = null;
  const button = { addEventListener: (type, fn) => { if (type === 'click') onClick = fn; } };
  const header = {
    dataset: { headerLayout: 'app' },
    querySelector: () => null,
    querySelectorAll: (sel) => (sel === '[data-theme-toggle]' ? [button] : []),
  };
  return { header, click: () => onClick() };
}

test('the theme preference table: from nothing saved to either theme, then between them, never back', () => {
  assert.deepEqual(THEME_PREFERENCE.states, ['system', 'light', 'dark']);
  assert.equal(THEME_PREFERENCE.initial, 'system');
  THEME_PREFERENCE.assertPath(['dark', 'light', 'dark']);
  THEME_PREFERENCE.assertPath(['light', 'dark']);
  const forbidden = [['light', 'light'], ['dark', 'dark'], ['light', 'system'], ['dark', 'system'], ['system', 'system']];
  for (const [from, to] of forbidden) {
    assert.equal(THEME_PREFERENCE.can(/** @type {any} */ (from), /** @type {any} */ (to)), false, `${from} -> ${to}`);
    assert.throws(() => THEME_PREFERENCE.assertTransition(/** @type {any} */ (from), /** @type {any} */ (to)), /is not a transition/);
  }
});

test('site/assets/site/site-chrome.js carries the same table as assets/ui/state/theme.js', () => {
  const literal = CHROME.match(/var THEME_TRANSITIONS = (\{[^\n]*\});/)?.[1];
  assert.ok(literal, 'THEME_TRANSITIONS not found in site-chrome.js');
  const copy = vm.runInNewContext(`(${literal})`);
  assert.deepEqual(JSON.parse(JSON.stringify(copy)), JSON.parse(JSON.stringify(THEME_PREFERENCE.transitions)));
});

test('the head bootstrap shows the theme the module gives, for every stored value and system setting', () => {
  const script = THEME_BOOTSTRAP.replace(/^<script>/, '').replace(/<\/script>$/, '');
  for (const stored of STORED) {
    for (const systemDark of SYSTEM) {
      const { context, documentElement } = sandbox({ stored, systemDark });
      vm.runInContext(script, context);
      const expected = themeFor(preferenceOf(stored === 'BLOCKED' ? null : stored), Boolean(systemDark));
      assert.equal(documentElement.dataset.theme, expected, `stored ${stored}, system dark ${systemDark}`);
    }
  }
});

test('site-chrome.js, on a page without the head bootstrap, shows the same theme', () => {
  for (const stored of STORED) {
    for (const systemDark of SYSTEM) {
      const { context, documentElement } = sandbox({ stored, systemDark });
      vm.runInContext(CHROME, context);
      const expected = themeFor(preferenceOf(stored === 'BLOCKED' ? null : stored), Boolean(systemDark));
      assert.equal(documentElement.dataset.theme, expected, `stored ${stored}, system dark ${systemDark}`);
    }
  }
});

test('the header toggle flips the theme shown, saves it and announces it, on every start', () => {
  for (const stored of STORED) {
    for (const systemDark of SYSTEM) {
      const start = themeFor(preferenceOf(stored === 'BLOCKED' ? null : stored), Boolean(systemDark));
      const { header, click } = headerWithToggle();
      const { context, store, events, documentElement } = sandbox({ stored, systemDark, header, theme: start });
      vm.runInContext(CHROME, context);
      // The preferences the clicks walk through are moves the table allows, from the one the
      // page honours (the saved theme when it is the one shown, otherwise the system's).
      const run = THEME_PREFERENCE.start(stored === start ? stored : 'system');
      let shown = start;
      for (let i = 0; i < 3; i += 1) {
        click();
        shown = toggledFrom(shown);
        run.to(shown);
        assert.equal(documentElement.dataset.theme, shown, `click ${i + 1}, stored ${stored}`);
        assert.equal(events.at(-1)?.type, 'civgraph:themechange');
        assert.equal(events.at(-1)?.detail.theme, shown);
        if (stored !== 'BLOCKED') assert.equal(store.get(THEME_KEY), shown);
      }
      assert.equal(events.length, 3);
    }
  }
});

test('the toggle still works when another tab saved a theme after this page drew', () => {
  const { header, click } = headerWithToggle();
  const { context, store, documentElement } = sandbox({ stored: 'light', systemDark: false, header, theme: 'dark' });
  vm.runInContext(CHROME, context);
  click();
  assert.equal(documentElement.dataset.theme, 'light');
  assert.equal(store.get(THEME_KEY), 'light');
});
