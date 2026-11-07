/**
 * The component gallery (/design-system/, functions/design-system/index.js) keeps up with the
 * design system and stays out of search:
 * - every component stylesheet under assets/ui/components/ has a specimen, and every template
 *   function of functions/_templates/components/index.js and shell.js's sectionNav is shown;
 * - every cg-* class the gallery uses is defined by a stylesheet under assets/ui/ (no typos,
 *   no classes that exist only here);
 * - it is a shelled page (skip link, main landmark), noindex in the page and the header, routed
 *   by _routes.json, and in no sitemap;
 * - the token parser of assets/ui/gallery/gallery.js finds every token of tokens.css.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import * as gallery from '../../functions/design-system/index.js';
import * as components from '../../functions/_templates/components/index.js';
import { parseTokens } from '../../assets/ui/gallery/gallery.js';
import { REPO_ROOT } from '@civgraph/config/node';

const UI = path.join(REPO_ROOT, 'assets', 'ui');
const read = (...p) => readFileSync(path.join(...p), 'utf8');

let page;
const render = async () => {
  if (!page) {
    const res = await gallery.onRequestGet();
    page = { status: res.status, headers: res.headers, text: await res.text() };
  }
  return page;
};

test('every component stylesheet has a specimen', () => {
  const sheets = readdirSync(path.join(UI, 'components')).filter((f) => f.endsWith('.css')).sort();
  const shown = new Set(gallery.SPECIMENS.map((s) => s.stylesheet).filter(Boolean));
  const missing = sheets.filter((f) => !shown.has(f));
  assert.deepEqual(missing, [], 'add a specimen to SPECIMENS in functions/design-system/index.js');
  for (const s of gallery.SPECIMENS) if (s.stylesheet) assert.ok(sheets.includes(s.stylesheet), `${s.id}: no ${s.stylesheet}`);
  assert.equal(new Set(gallery.SPECIMENS.map((s) => s.id)).size, gallery.SPECIMENS.length, 'specimen ids are unique');
});

test('every template function is shown', () => {
  const shown = new Set(gallery.SPECIMENS.flatMap((s) => s.templates));
  const templates = [...Object.keys(components).filter((k) => typeof components[k] === 'function'), 'sectionNav'];
  assert.deepEqual(templates.filter((t) => !shown.has(t)), []);
});

function definedClasses() {
  const files = [
    ...readdirSync(UI).filter((f) => f.endsWith('.css')).map((f) => path.join(UI, f)),
    ...readdirSync(path.join(UI, 'components')).map((f) => path.join(UI, 'components', f)),
    path.join(UI, 'gallery', 'gallery.css'),
  ];
  const out = new Set();
  for (const f of files) for (const m of read(f).matchAll(/\.(cg-[a-z0-9_-]+)/g)) out.add(m[1]);
  return out;
}

test('every cg-* class the gallery uses is defined by a stylesheet', async () => {
  const { text } = await render();
  const main = text.slice(text.indexOf('<main'), text.indexOf('</main>'));
  const used = new Set();
  for (const m of main.matchAll(/class="([^"]+)"/g)) for (const c of m[1].split(/\s+/)) if (c.startsWith('cg-')) used.add(c);
  assert.ok(used.size > 30, `only ${used.size} cg-* classes found`);
  const defined = definedClasses();
  assert.deepEqual([...used].filter((c) => !defined.has(c)).sort(), []);
});

test('it is a shelled page, kept out of search', async () => {
  const { status, headers, text } = await render();
  assert.equal(status, 200);
  assert.match(headers.get('Content-Type'), /text\/html/);
  assert.equal(headers.get('X-Robots-Tag'), 'noindex, nofollow');
  assert.match(text, /<meta name="robots" content="noindex, nofollow">/);
  assert.match(text, /<a class="cg-skip-link" href="#main-content">/);
  assert.match(text, /<main id="main-content"/);
  assert.match(text, /href="\/assets\/ui\/tokens\.css"/);
  assert.ok(text.indexOf('assets/ui/tokens.css') < text.indexOf('assets/ui/gallery/gallery.css'), 'tokens load before the gallery stylesheet');
  assert.ok(!/<link rel="canonical"/.test(text), 'no canonical link for a noindex page');
  for (const s of gallery.SPECIMENS) assert.match(text, new RegExp(`<section class="cg-gallery__specimen" id="${s.id}"`));
  // the markup panes show the real markup, escaped
  assert.match(text, /&lt;dl class=&quot;cg-facts&quot;&gt;/);
});

test('_routes.json routes it, and no sitemap lists it', () => {
  const routes = JSON.parse(read(REPO_ROOT, '_routes.json')).include;
  assert.ok(routes.includes('/design-system') && routes.includes('/design-system/'));
  assert.equal(gallery.GALLERY_PATH, '/design-system/');
  const sitemaps = [path.join(REPO_ROOT, 'sitemap.xml'), ...(existsSync(path.join(REPO_ROOT, 'sitemaps')) ? readdirSync(path.join(REPO_ROOT, 'sitemaps')).map((f) => path.join(REPO_ROOT, 'sitemaps', f)) : [])];
  for (const f of [...sitemaps, path.join(REPO_ROOT, 'scripts', 'build', 'build-sitemap.mjs')]) {
    if (existsSync(f)) assert.ok(!read(f).includes('design-system'), `${path.relative(REPO_ROOT, f)} names the gallery`);
  }
});

test('the token parser finds every token of tokens.css, under its group', () => {
  const css = read(UI, 'tokens.css');
  const light = parseTokens(css, ':root {');
  const declared = [...css.slice(0, css.indexOf('}')).matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]);
  assert.deepEqual(light.map((t) => t.name), declared);
  const groups = [...new Set(light.map((t) => t.group))];
  for (const g of ['brand', 'space', 'radius', 'elevation']) assert.ok(groups.includes(g), `group ${g}`);
  assert.ok(parseTokens(css, ':root[data-theme="dark"]').length > 10);
});
