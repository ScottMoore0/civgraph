import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { INFO_PAGES, INFO_PAGES_LIVE, draftBanner, draftHead, footerLinks, footerMeta } from '../../packages/ui/src/templates/info-pages.js';
import { footer } from '../../packages/ui/src/templates/shell.js';
import { toHtmlString } from '../../packages/core/src/html.js';
import { TOP_LEVEL_PAGES } from '../../scripts/build/build-sitemap.mjs';

// The information pages (Privacy, Licence, How to cite, Downloads) are drafts until the owner
// sets INFO_PAGES_LIVE: one flag decides noindex, the banner, the footer links and the sitemap.

const NOINDEX = '<meta name="robots" content="noindex">';
const LINK = /href="\/pages\/(privacy|licence|cite|downloads)\.html"/;

test('the four pages, each with both draft regions', () => {
  assert.deepEqual(INFO_PAGES.map((p) => p.file).sort(),
    ['site/pages/cite.html', 'site/pages/downloads.html', 'site/pages/licence.html', 'site/pages/privacy.html']);
  for (const p of INFO_PAGES) {
    const html = readFileSync(p.file, 'utf8');
    assert.match(html, /<!-- site:draft-head -->[\s\S]*?<!-- \/site:draft-head -->/, `${p.file}: no site:draft-head region`);
    assert.match(html, /<!-- site:draft-banner -->[\s\S]*?<!-- \/site:draft-banner -->/, `${p.file}: no site:draft-banner region`);
    assert.equal(p.path, `/${p.file.replace(/^site\//, '')}`);
  }
});

test('live: no noindex, no banner, four footer links, the licence in the footer meta', () => {
  assert.equal(draftHead(true), '');
  assert.equal(draftBanner(true), '');
  assert.deepEqual(footerLinks(true), INFO_PAGES.map((p) => `<a href="${p.path}">${p.label}</a>`));
  assert.match(footerMeta(true), /href="\/pages\/licence\.html"/);
});

test('draft: noindex and banner, and nothing links the pages', () => {
  assert.equal(draftHead(false), NOINDEX);
  assert.match(draftBanner(false), /class="draft-banner"/);
  assert.deepEqual(footerLinks(false), []);
  assert.equal(footerMeta(false), '© Civgraph');
});

test('the committed pages, footer and sitemap agree with the flag', () => {
  for (const p of INFO_PAGES) {
    const html = readFileSync(p.file, 'utf8');
    assert.equal(html.includes(NOINDEX), !INFO_PAGES_LIVE, `${p.file}: noindex should be ${INFO_PAGES_LIVE ? 'gone' : 'present'}`);
    assert.equal(html.includes('class="draft-banner"'), !INFO_PAGES_LIVE, `${p.file}: draft banner should be ${INFO_PAGES_LIVE ? 'gone' : 'present'}`);
    if (INFO_PAGES_LIVE) assert.ok(!html.includes('class="owner-note"'), `${p.file}: OWNER TODO notes left on a live page`);
    assert.equal(TOP_LEVEL_PAGES.includes(p.path), INFO_PAGES_LIVE, `${p.path}: sitemap should ${INFO_PAGES_LIVE ? '' : 'not '}list it`);
  }
  assert.equal(LINK.test(toHtmlString(footer())), INFO_PAGES_LIVE);
});

test('while they are drafts, no other page on the site links them', () => {
  if (INFO_PAGES_LIVE) return;
  const own = new Set(INFO_PAGES.map((p) => p.file));
  const offenders = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const file = path.posix.join(dir, name);
      if (statSync(file).isDirectory()) { if (!/^(app|build|data|sitemaps)$/.test(name)) walk(file); continue; }
      if (!/\.(html|js|mjs)$/.test(name) || own.has(file)) continue;
      if (LINK.test(readFileSync(file, 'utf8'))) offenders.push(file);
    }
  };
  walk('site');
  assert.deepEqual(offenders, []);
});
