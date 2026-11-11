/**
 * Link previews (QA 2026-11-11, H1 and L3): every public page type carries a <title>, a meta
 * description, a canonical link, Open Graph (og:title, og:description, og:url, og:type,
 * og:image with its width and height) and a summary_large_image Twitter card.
 *
 *   - the static pages, read from site/ as they are deployed;
 *   - page() in packages/ui/src/templates/shell.js (the server-rendered record pages);
 *   - the PRONI record pages (functions/_proni-shell.js) over an in-memory catalogue;
 *   - the share image itself: 1200x630, as the tags declare.
 *
 * The Browse record pages (functions/_browse-page.js) are held to the same set in
 * tests/functions/browse-pages.test.mjs, over the records schema.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readShareTags, SHARE_IMAGE, shareTagList, withShareTags } from '../../packages/ui/src/templates/share.js';
import { page } from '../../packages/ui/src/templates/shell.js';
import { proniRecordHead, proniRefFromPath, serveShell } from '../../functions/_proni-shell.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');

/** What every shareable page must carry; [] when it does. */
function shareProblems(html, { url, type = 'website' } = {}) {
  const tags = readShareTags(html);
  const problems = [];
  const need = (ok, what) => { if (!ok) problems.push(what); };
  need(tags.title, '<title>');
  need(tags.description && tags.description.length >= 50, `meta description (${tags.description})`);
  need(/^https:\/\/civgraph\.net\//.test(tags.canonical || ''), `absolute canonical (${tags.canonical})`);
  need(!/\.html$/.test(tags.canonical || ''), `canonical is the served URL, not the .html that redirects (${tags.canonical})`);
  if (url) need(tags.canonical === url, `canonical ${tags.canonical} is ${url}`);
  need(tags['og:url'] === tags.canonical, `og:url (${tags['og:url']}) is the canonical`);
  need(tags['og:type'] === type, `og:type ${type} (${tags['og:type']})`);
  need(tags['og:site_name'] === 'Civgraph', 'og:site_name');
  need(tags['og:title'] && tags['og:title'] === tags['twitter:title'], 'og:title = twitter:title');
  need(tags['og:description'] && tags['og:description'] === tags['twitter:description'], 'og:description = twitter:description');
  need(tags['og:image'] === SHARE_IMAGE.url, `og:image (${tags['og:image']})`);
  need(tags['og:image:width'] === '1200' && tags['og:image:height'] === '630', 'og:image:width/height 1200x630');
  need(tags['og:image:alt'], 'og:image:alt');
  need(tags['twitter:card'] === 'summary_large_image', `twitter:card (${tags['twitter:card']})`);
  need(tags['twitter:image'] === SHARE_IMAGE.url, 'twitter:image');
  const head = html.split(/<\/head>/i)[0];
  for (const key of ['og:url', 'og:title', 'og:image', 'twitter:card']) {
    const count = (head.match(new RegExp(`(?:property|name)="${key}"`, 'g')) || []).length;
    need(count === 1, `${key} once (${count})`);
  }
  need((head.match(/rel="canonical"/g) || []).length === 1, 'one canonical');
  return problems;
}

const STATIC_PAGES = [
  ['site/index.html', 'https://civgraph.net/'],
  ['site/pages/about.html', 'https://civgraph.net/pages/about'],
  ['site/pages/status.html', 'https://civgraph.net/pages/status'],
  ['site/pages/census-explorer.html', 'https://civgraph.net/pages/census-explorer'],
  ['site/apps/index.html', 'https://civgraph.net/apps/'],
  ['site/apps/words/index.html', 'https://civgraph.net/apps/words/'],
  ['site/apps/proni-search/index.html', 'https://civgraph.net/proni'],
  ['site/browse/index.html', 'https://civgraph.net/browse/'],
  ['site/catalogue/index.html', 'https://civgraph.net/catalogue/'],
  ['site/records/index.html', 'https://civgraph.net/records/'],
  ['site/maps/index.html', 'https://civgraph.net/maps/'],
];

for (const [file, url] of STATIC_PAGES) {
  test(`${file} carries the whole share set`, () => {
    assert.deepEqual(shareProblems(read(file), { url }), []);
  });
}

test('the share image is a 1200x630 PNG, as og:image:width and og:image:height say', () => {
  const buf = readFileSync(path.join(ROOT, 'site/assets/images/og-preview.png'));
  assert.equal(buf.toString('ascii', 1, 4), 'PNG');
  assert.equal(buf.toString('ascii', 12, 16), 'IHDR');
  assert.equal(buf.readUInt32BE(16), SHARE_IMAGE.width);
  assert.equal(buf.readUInt32BE(20), SHARE_IMAGE.height);
  assert.ok(buf.length < 1_000_000, 'small enough for a crawler to fetch eagerly');
  assert.equal(SHARE_IMAGE.url, 'https://civgraph.net/assets/images/og-preview.png');
});

test('withShareTags replaces every earlier share tag and the canonical, and escapes', () => {
  const before = `<html><head><title>x</title>
  <link rel="canonical" href="https://civgraph.net/old">
  <meta property="og:title" content="old">
  <meta
    name="twitter:card" content="summary">
  <meta content="old" property="og:url">
</head><body><meta property="og:title" content="in the body stays"></body></html>`;
  const out = withShareTags(before, { title: 'A "quoted" <title>', description: 'd & d', url: 'https://civgraph.net/new' });
  const tags = readShareTags(out);
  assert.equal(tags.canonical, 'https://civgraph.net/new');
  assert.equal(tags['og:title'], 'A "quoted" <title>');
  assert.equal(tags['og:url'], 'https://civgraph.net/new');
  assert.equal(tags['twitter:card'], 'summary_large_image');
  assert.ok(out.includes('content="A &quot;quoted&quot; &lt;title&gt;"'));
  assert.equal((out.match(/rel="canonical"/g) || []).length, 1);
  assert.equal((out.match(/og:url/g) || []).length, 1);
  assert.ok(out.includes('in the body stays'), 'only the head is rewritten');
  assert.equal(withShareTags('no head here', { title: 't', url: 'https://civgraph.net/' }), 'no head here');
});

test('shareTagList leaves out what it was not given, never writing an empty description', () => {
  const keys = shareTagList({ title: 't', url: 'https://civgraph.net/x' }).map(([, key]) => key);
  assert.ok(!keys.includes('og:description') && !keys.includes('twitter:description'));
  assert.ok(keys.includes('og:image') && keys.includes('twitter:card'));
});

test('page() (the server-rendered records) carries the whole share set', () => {
  const out = String(page({
    title: 'Gerry Adams – Person – Civgraph',
    description: 'Gerry Adams (Sinn Féin) stood in 15 elections between 1983 and 2016. Election results on Civgraph.',
    canonical: 'https://civgraph.net/browse/persons/gerry-adams-27771',
    og: { 'og:type': 'profile' },
    body: 'x',
  }));
  assert.deepEqual(shareProblems(out, { url: 'https://civgraph.net/browse/persons/gerry-adams-27771', type: 'profile' }), []);
});

// --- PRONI record pages ---------------------------------------------------------------------

const PRONI_SHELL = read('site/apps/proni-search/index.html');

function proniDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE proni (ref TEXT NOT NULL, title TEXT, dates TEXT, slug TEXT, level TEXT, parent TEXT, parent_slug TEXT,
             has_children INTEGER, fond TEXT, description TEXT, access TEXT, digital_record TEXT);
           CREATE TABLE ext (ref TEXT PRIMARY KEY, ext_start_date TEXT, ext_end_date TEXT, ext_start_year INTEGER, ext_end_year INTEGER,
             ext_circa INTEGER, ext_estimated INTEGER, ext_bound TEXT, ext_undated INTEGER, ext_display TEXT);`);
  db.prepare('INSERT INTO proni VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
    .run('LA/7/1/CA/1/3', 'Register of Members', '1899-1920', 'LA~7~1~CA~1~3', 'Item', 'LA/7/1/CA/1', 'LA~7~1~CA~1', 0, 'LA', 'Register of members of Antrim County Council & its committees.', 'Open', '');
  // As D1: prepare(sql).bind(...).all(), or all() unbound.
  return {
    prepare(sql) {
      let args = [];
      const bound = {
        bind(...values) { args = values; return bound; },
        async all() { return { results: db.prepare(sql).all(...args) }; },
        async first() { return db.prepare(sql).get(...args) ?? null; },
        async run() { return {}; },
      };
      return bound;
    },
  };
}

const ASSETS = { fetch: async () => new Response(PRONI_SHELL, { status: 200, headers: { 'Content-Type': 'text/html' } }) };

async function proniGet(pathname, env) {
  return serveShell({ request: new Request(`https://civgraph.net${pathname}`), env, waitUntil() {} });
}

test('a PRONI record page carries the record\'s own head and share set', async () => {
  const res = await proniGet('/proni/LA/7/1/CA/1/3', { PRONI_DB: proniDb(), ASSETS });
  assert.equal(res.status, 200);
  const html = await res.text();
  const tags = readShareTags(html);
  assert.equal(tags.title, 'Register of Members (LA/7/1/CA/1/3) – PRONI record – Civgraph');
  assert.match(tags.description, /^PRONI LA\/7\/1\/CA\/1\/3: Register of Members \(Item, 1899-1920\)\. Register of members of Antrim County Council & its committees\.$/);
  assert.deepEqual(shareProblems(html, { url: 'https://civgraph.net/proni/LA/7/1/CA/1/3' }), []);
  assert.ok(html.includes('data-app="proni"'), 'the app shell still loads');
});

test('a PRONI reference not in the catalogue answers 404; an outage answers 200 with the generic head', async () => {
  const missing = await proniGet('/proni/ZZZ/999/NOTREAL', { PRONI_DB: proniDb(), ASSETS });
  assert.equal(missing.status, 404);
  assert.ok((await missing.text()).includes('data-app="proni"'));
  const down = await proniGet('/proni/LA/7/1/CA/1/3', { ASSETS });
  assert.equal(down.status, 200);
  assert.equal(readShareTags(await down.text())['og:url'], 'https://civgraph.net/proni');
  const home = await proniGet('/proni', { PRONI_DB: proniDb(), ASSETS });
  assert.equal(home.status, 200);
  assert.deepEqual(shareProblems(await home.text(), { url: 'https://civgraph.net/proni' }), []);
});

test('PRONI references come from the path, slashes kept', () => {
  assert.equal(proniRefFromPath('/proni/LA/7/1/CA/1/3/'), 'LA/7/1/CA/1/3');
  assert.equal(proniRefFromPath('/proni/D/1234/A%20B'), 'D/1234/A B');
  assert.equal(proniRefFromPath('/proni'), null);
  assert.equal(proniRefFromPath('/proni/'), null);
  assert.equal(proniRecordHead({ ref: 'D/1', title: 'D/1' }).title, 'D/1 – PRONI record – Civgraph');
});
