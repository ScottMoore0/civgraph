/**
 * The shell in functions/_templates/shell.js must produce exactly what partials/*.html
 * produce through scripts/build-site-partials.mjs, so the static pages and the
 * server-rendered pages cannot drift while both sources exist (until F1 makes the build
 * import shell.js and partials/ goes).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { footer, head, header, NAV_KEYS, page, sectionNav, supportModal, THEME_BOOTSTRAP } from '../../functions/_templates/shell.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n').trimEnd();
const version = (rel) => createHash('sha256').update(readFileSync(path.join(ROOT, rel))).digest('hex').slice(0, 12);

/** The substitution rules of scripts/build-site-partials.mjs render(). */
function renderPartial(file, { active = 'none', layout } = {}) {
  return read(file)
    .replace(/\{\{active:([a-z]+)\}\}/g, (_, key) => (key === active ? ' app-header__link--active' : ''))
    .replace(/\{\{current:([a-z]+)\}\}/g, (_, key) => (key === active ? ' aria-current="page"' : ''))
    .replace(/\{\{layout\}\}/g, layout || 'page')
    .replace(/\{\{version:([^}]+)\}\}/g, (_, p) => version(p));
}

test('header() equals partials/site-header.html for every section and layout', () => {
  for (const active of NAV_KEYS) {
    for (const layout of ['page', 'app']) {
      assert.equal(String(header({ active, layout })), renderPartial('partials/site-header.html', { active, layout }), `active=${active} layout=${layout}`);
    }
  }
});

test('head() equals partials/site-head.html with the same asset versions', () => {
  assert.equal(String(head({ version })), renderPartial('partials/site-head.html'));
});

test('head() without versions links the assets plainly', () => {
  const out = String(head());
  assert.ok(out.includes('href="/assets/site/site-chrome.css"'));
  assert.ok(out.startsWith(THEME_BOOTSTRAP));
});

test('footer() and supportModal() equal their partials', () => {
  assert.equal(String(footer()), renderPartial('partials/site-footer.html'));
  assert.equal(String(supportModal()), renderPartial('partials/support-modal.html'));
});

test('the theme bootstrap in the shell is the one the static pages carry', () => {
  assert.ok(read('browse/index.html').includes(THEME_BOOTSTRAP));
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
});
