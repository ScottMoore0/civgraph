// The site theme preference (refactor state machine UI-05, the Functions' half):
// functions/_lib/theme.js's table and first-paint rule, the shell's head stamp built from them,
// and the two classic scripts outside functions/ that implement the toggle.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { REPO_ROOT } from '../../scripts/lib/config.mjs';
import { defineMachine } from '../../scripts/lib/state-machine.mjs';
import {
  INITIAL_THEME_PREFERENCE, THEME_KEY, THEME_PREFERENCE_TRANSITIONS, THEMES, firstPaintTheme, preferenceOf,
} from '../../functions/_lib/theme.js';
import { THEME_BOOTSTRAP } from '../../functions/_templates/shell.js';

// The stamp every server-rendered page has carried since the shell landed: its bytes must not move.
const PINNED = "<script>(function(){var t=null;try{t=localStorage.getItem('theme');}catch(e){}if(t!=='dark'&&t!=='light'){t=window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';}document.documentElement.dataset.theme=t;})();</script>";

test('the head stamp is built from the table and keeps its bytes', () => {
  assert.equal(THEME_BOOTSTRAP, PINNED);
});

test('the preference table: system -> light | dark, light <-> dark, nothing back to system', () => {
  const m = defineMachine({ name: 'site theme preference', initial: INITIAL_THEME_PREFERENCE, transitions: THEME_PREFERENCE_TRANSITIONS });
  m.assertPath(['light', 'dark', 'light']);
  m.assertPath(['dark', 'light']);
  for (const from of ['light', 'dark']) assert.equal(m.can(from, 'system'), false, `${from} -> system`);
  assert.deepEqual([...THEMES].sort(), ['dark', 'light']);
});

test('the stamp paints what firstPaintTheme says, for every stored value and system setting', () => {
  const script = THEME_BOOTSTRAP.replace(/^<script>/, '').replace(/<\/script>$/, '');
  for (const stored of [null, 'dark', 'light', 'system', 'Dark', '', 'refused']) {
    for (const systemDark of [false, true]) {
      const dataset = {};
      const sandbox = {
        localStorage: { getItem: (key) => { assert.equal(key, THEME_KEY); if (stored === 'refused') throw new Error('private mode'); return stored; } },
        window: { matchMedia: (q) => ({ matches: q === '(prefers-color-scheme: dark)' && systemDark }) },
        document: { documentElement: { dataset } },
      };
      vm.runInNewContext(script, sandbox);
      const expected = firstPaintTheme(stored === 'refused' ? null : stored, systemDark);
      assert.equal(dataset.theme, expected, `stored ${stored}, system ${systemDark ? 'dark' : 'light'}`);
    }
  }
  assert.equal(preferenceOf(undefined), 'system');
});

test('the toggles outside functions/ use the same key and flip light <-> dark', () => {
  const chrome = readFileSync(path.join(REPO_ROOT, 'assets/site/site-chrome.js'), 'utf8');
  assert.ok(chrome.includes(`THEME_KEY = '${THEME_KEY}'`));
  assert.match(chrome, /root\.dataset\.theme === 'dark' \? 'light' : 'dark'/);
  // The map page's fallback (src/map/app/site-chrome.js, only without the shared header) reads the
  // same key; it paints any stored value it finds (`savedTheme || system`), where the stamp
  // ignores values that are not a theme: a difference for r2-mapapp, not asserted here.
  const mapFallback = readFileSync(path.join(REPO_ROOT, 'src/map/app/site-chrome.js'), 'utf8');
  assert.ok(mapFallback.includes(`localStorage.getItem('${THEME_KEY}')`));
  assert.ok(mapFallback.includes(`localStorage.setItem('${THEME_KEY}', next)`));
});
