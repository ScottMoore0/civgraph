/**
 * functions/_templates/shell.js is the one source of the site shell: the server-rendered
 * pages call it at request time and scripts/build/build-site-partials.mjs stamps the same output
 * into the static pages (partials/site-*.html are gone). These tests hold its contract: the
 * head loads the design-system layer before anything else, the header starts with the skip
 * link, and the stamped static pages carry exactly what it produces.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { footer, head, header, NAV, NAV_KEYS, page, sectionNav, SHELL_STYLES, SKIP_LINK, supportModal, THEME_BOOTSTRAP } from '../../functions/_templates/shell.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');

test('head() bootstraps the theme first, then loads tokens, aliases, base and chrome in order', () => {
  const out = String(head());
  assert.ok(out.startsWith(THEME_BOOTSTRAP));
  assert.deepEqual(SHELL_STYLES, ['assets/ui/tokens.css', 'assets/ui/tokens-legacy.css', 'assets/ui/base.css', 'assets/site/site-chrome.css']);
  const at = SHELL_STYLES.map((p) => out.indexOf(`<link rel="stylesheet" href="/${p}">`));
  assert.ok(at.every((i) => i > 0), 'every shell stylesheet is linked');
  assert.deepEqual([...at].sort((x, y) => x - y), at, 'in cascade order');
  assert.ok(out.includes('<script defer src="/assets/site/site-chrome.js"></script>'));
});

test('head() versions every asset it links when given a version function', () => {
  const out = String(head({ version: () => 'abc123def456' }));
  for (const p of SHELL_STYLES) assert.ok(out.includes(`href="/${p}?v=abc123def456"`), p);
  assert.ok(!/href="\/assets\/[^"?]+"/.test(out), 'no unversioned stylesheet');
});

test('header() starts with the skip link, marks the current section, and can leave the skip link to the page', () => {
  for (const active of NAV_KEYS) {
    for (const layout of ['page', 'app']) {
      const out = String(header({ active, layout }));
      assert.ok(out.startsWith(`${SKIP_LINK}\n<header class="app-header" data-site-chrome data-header-layout="${layout}">`), `${active}/${layout}`);
      const current = [...out.matchAll(/aria-current="page"/g)].length;
      assert.equal(current, active === 'none' ? 0 : 1, `${active}: one current link`);
    }
  }
  assert.ok(String(header({ active: 'maps', layout: 'app', skipLink: false })).startsWith('<header '));
  for (const item of NAV) assert.ok(String(header()).includes(`href="${item.href}"`), item.href);
});

test('footer() and supportModal() are the shared landmarks', () => {
  assert.ok(String(footer()).startsWith('<footer class="ftr">'));
  assert.ok(String(footer()).includes('<nav aria-label="Footer navigation" class="ftr__nav">'));
  const modal = String(supportModal());
  assert.ok(modal.includes('role="dialog"') && modal.includes('aria-modal="true"') && modal.includes('id="supportModal"'));
});

test('the static pages carry the shell exactly as shell.js renders it', () => {
  const browse = read('browse/index.html');
  assert.ok(browse.includes(THEME_BOOTSTRAP));
  assert.ok(browse.includes(String(header({ active: 'browse', skipAlso: [{ href: '#browseResults', label: 'Skip to results' }] }))));
  assert.ok(browse.includes(String(footer())));
  const maps = read('maps/index.html');
  assert.ok(maps.includes(String(header({ active: 'maps', layout: 'app', skipLink: false }))));
  // The theme bootstrap exists once per page: in the stamped head, nowhere else.
  for (const rel of ['index.html', 'browse/index.html', 'maps/index.html', 'apps/proni-search/index.html', '404.html']) {
    assert.equal(read(rel).split("localStorage.getItem('theme')").length - 1, 1, rel);
  }
});

test('header() refuses an unknown section', () => {
  assert.throws(() => header({ active: 'nowhere' }));
});

test('sectionNav marks the current item and links the rest', () => {
  const out = String(sectionNav({ items: [{ href: '/browse/', label: 'Browse' }, { href: '/browse/#/persons', label: 'People' }, { label: 'A & B' }] }));
  assert.equal(out, '<nav class="cg-section-nav" aria-label="Breadcrumb"><ol><li><a href="/browse/">Browse</a></li><li><a href="/browse/#/persons">People</a></li><li><span aria-current="page">A &amp; B</span></li></ol></nav>');
  assert.equal(String(sectionNav({ items: [] })), '');
});

test('page() is a complete document with landmarks, escaped head and safe JSON-LD', () => {
  const out = String(page({
    title: 'O\'Neill <b> – Civgraph',
    description: 'A "quoted" description',
    canonical: 'https://civgraph.net/browse/persons/x',
    section: 'browse',
    body: 'plain <text>',
    jsonLd: { '@type': 'Person', name: '</script><script>alert(1)</script>' },
    robots: 'noindex',
  }));
  assert.ok(out.startsWith('<!DOCTYPE html>\n<html lang="en">'));
  assert.ok(out.includes('<title>O&#39;Neill &lt;b&gt; – Civgraph</title>'));
  assert.ok(out.includes('<meta name="description" content="A &quot;quoted&quot; description">'));
  assert.ok(out.includes('<meta name="robots" content="noindex">'));
  assert.ok(out.includes('<link rel="canonical" href="https://civgraph.net/browse/persons/x">'));
  assert.ok(out.includes('<meta property="og:url" content="https://civgraph.net/browse/persons/x">'));
  assert.ok(out.includes('<main id="main-content" class="cg-main" tabindex="-1">\nplain &lt;text&gt;\n</main>'));
  assert.ok(out.includes('class="app-header__link app-header__link--active" href="/browse/" aria-current="page"'));
  assert.ok(out.includes('<a class="cg-skip-link" href="#main-content">'));
  assert.ok(out.includes('<footer class="ftr">'));
  assert.ok(!out.includes('</script><script>alert(1)'), 'JSON-LD must not be able to close its script');
  assert.ok(out.includes('\\u003c/script>'));
  for (const css of ['tokens.css', 'tokens-legacy.css', 'base.css', 'components.css']) assert.ok(out.includes(`href="/assets/ui/${css}"`), css);
  assert.equal(out.split('href="/assets/ui/tokens.css"').length - 1, 1, 'tokens linked once');
  assert.equal(out.split('class="cg-skip-link"').length - 1, 1, 'one skip link');
  assert.ok(out.indexOf('cg-skip-link') < out.indexOf('<header'), 'skip link before the header');
});
