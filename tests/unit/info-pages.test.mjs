
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { INFO_PAGES, draftBanner, draftHead, fillLastUpdated, footerLinks, footerMeta, hasLastUpdatedPlaceholder, isLiveInfoPage, licencePageLive, livePages } from '@civgraph/ui/templates/info-pages.js';
import { footer } from '@civgraph/ui/templates/shell.js';
import { toHtmlString } from '@civgraph/core/html.js';
import { TOP_LEVEL_PAGES } from '../../scripts/build/build-sitemap.mjs';

// The information pages (Privacy, Licence, How to cite, Downloads) are drafts until the owner
// makes each public: a page's `live` flag decides its noindex line, its banner, its footer link
// and its sitemap entry. Licence and How to cite went live on 24 Nov 2026.

const NOINDEX = '<meta name="robots" content="noindex">';
/** A link to one information page, by its extensionless address (/pages/privacy) or with .html. */
const linkTo = (/** @type {string} */ p) => new RegExp(`href="${p.replace(/\//g, '\/')}(\.html)?(#[^"]*)?"`);

test('the four pages, each with both draft regions', () => {
  assert.deepEqual(INFO_PAGES.map((p) => p.file).sort(),
    ['site/pages/cite.html', 'site/pages/downloads.html', 'site/pages/licence.html', 'site/pages/privacy.html']);
  for (const p of INFO_PAGES) {
    const html = readFileSync(p.file, 'utf8');
    assert.match(html, /<!-- site:draft-head -->[\s\S]*?<!-- \/site:draft-head -->/, `${p.file}: no site:draft-head region`);
    assert.match(html, /<!-- site:draft-banner -->[\s\S]*?<!-- \/site:draft-banner -->/, `${p.file}: no site:draft-banner region`);
    assert.equal(p.path, `/${p.file.replace(/^site\//, '').replace(/\.html$/, '')}`);
    assert.equal(typeof p.live, 'boolean');
  }
});

test('the owner\'s decision of 24 Nov 2026: Licence and How to cite are public, Downloads and Privacy are drafts', () => {
  assert.deepEqual(livePages().map((p) => p.path).sort(), ['/pages/cite', '/pages/licence']);
  assert.ok(licencePageLive());
  assert.ok(isLiveInfoPage('site/pages/licence.html'));
  assert.ok(!isLiveInfoPage('site/pages/privacy.html'));
  assert.ok(!isLiveInfoPage('site/pages/about.html'), 'a page that is not an information page is not one');
});

test('live: no noindex, no banner; draft: both', () => {
  assert.equal(draftHead(true), '');
  assert.equal(draftBanner(true), '');
  assert.equal(draftHead(false), NOINDEX);
  assert.match(draftBanner(false), /class="draft-banner"/);
});

test('the footer links the live pages only, and names the licence once its page is live', () => {
  const pages = [
    { file: 'a.html', path: '/pages/a', label: 'A', live: true },
    { file: 'b.html', path: '/pages/b', label: 'B', live: false },
  ];
  assert.deepEqual(footerLinks(pages), ['<a href="/pages/a">A</a>']);
  assert.deepEqual(footerLinks(pages.map((p) => ({ ...p, live: false }))), []);
  assert.match(footerMeta(true), /href="\/pages\/licence"/);
  assert.equal(footerMeta(false), '© Civgraph');
});

test('the committed pages, footer and sitemap agree with each page\'s flag', () => {
  const html = toHtmlString(footer());
  for (const p of INFO_PAGES) {
    const page = readFileSync(p.file, 'utf8');
    assert.equal(page.includes(NOINDEX), !p.live, `${p.file}: noindex should be ${p.live ? 'gone' : 'present'}`);
    assert.equal(page.includes('class="draft-banner"'), !p.live, `${p.file}: draft banner should be ${p.live ? 'gone' : 'present'}`);
    if (p.live) assert.ok(!page.includes('class="owner-note"'), `${p.file}: OWNER TODO notes left on a live page`);
    assert.equal(TOP_LEVEL_PAGES.includes(p.path), p.live, `${p.path}: sitemap should ${p.live ? '' : 'not '}list it`);
    assert.equal(linkTo(p.path).test(html), p.live, `${p.path}: the footer should ${p.live ? '' : 'not '}link it`);
  }
  assert.match(html, /© Civgraph contributors · <a href="\/pages\/licence">Licence<\/a>/);
});

test('About links the live Licence and How to cite pages', () => {
  const about = readFileSync('site/pages/about.html', 'utf8');
  for (const p of livePages()) assert.match(about, linkTo(p.path), `About should link ${p.path}`);
});

test('no public page links a draft information page (the live ones included; drafts may link each other)', () => {
  const drafts = INFO_PAGES.filter((p) => !p.live);
  const draftFiles = new Set(drafts.map((p) => p.file));
  const offenders = [];
  const walk = (/** @type {string} */ dir) => {
    for (const name of readdirSync(dir)) {
      const file = path.posix.join(dir, name);
      if (statSync(file).isDirectory()) { if (!/^(app|build|data|sitemaps)$/.test(name)) walk(file); continue; }
      if (!/\.(html|js|mjs)$/.test(name) || draftFiles.has(file)) continue;
      const text = readFileSync(file, 'utf8');
      for (const d of drafts) if (linkTo(d.path).test(text)) offenders.push(`${file} -> ${d.path}`);
    }
  };
  walk('site');
  assert.deepEqual(offenders, []);
});

test('the Privacy page is dated the day it goes live (PG9)', () => {
  const privacy = readFileSync('site/pages/privacy.html', 'utf8');
  const live = isLiveInfoPage('site/pages/privacy.html');
  // A draft holds the named placeholder; the first live build of build-site-partials fills it.
  assert.equal(hasLastUpdatedPlaceholder(privacy), !live);
  if (!live) {
    const dated = fillLastUpdated(privacy, '2026-11-20');
    assert.ok(!hasLastUpdatedPlaceholder(dated));
    assert.match(dated, /Last updated: <time datetime="2026-11-20">20 November 2026<\/time>\./);
    assert.equal(fillLastUpdated(dated, '2027-01-01'), dated, 'a dated page keeps its date');
  }
  assert.throws(() => fillLastUpdated(privacy, 'today'), /not a date/);
});
