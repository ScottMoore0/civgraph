// The NISRA publication-files crawl (scripts/ingest/census/crawl-nisra-publication-files.mjs) and
// the enrichment that turns its manifest into the records' downloads
// (scripts/ingest/census/enrich-nisra-records-with-files.mjs). The crawl runs against a local
// stub server: one GET per publication page and nothing else, the request headers, at least 2 s
// before every request after the first, a 5xx retried and a 404 not, and a 403, a 429 or a bot
// challenge stopping the run with nothing written. No outside network.
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  ATTEMPTS, CrawlRefused, DEFAULT_DELAY_MS, HOST, MIN_DELAY_MS, crawlPages, isCensus, manifestFrom, manifestJson, parseFileLinks, publicationsOf, runCli,
} from '../../scripts/ingest/census/crawl-nisra-publication-files.mjs';
import { MAX_FILES, enrichNisraSources, nisraDownloads } from '../../scripts/ingest/census/enrich-nisra-records-with-files.mjs';

/** A publication page linking `files` (hrefs as written on the page). @param {string[]} files */
const pageWith = (files) => `<main><h1>Publication</h1>${files.map((f) => `<a href="${f}">${f}</a>`).join('\n')}</main>`;

/**
 * A stub publication site. `answers[slug]` is the page (200), or { status, body }, or a list of
 * those for successive requests of that page.
 * @param {Record<string, string | { status: number, body?: string } | Array<string | { status: number, body?: string }>>} answers
 */
async function stubSite(answers) {
  /** @type {{ method: string, url: string, headers: import('node:http').IncomingHttpHeaders }[]} */
  const seen = [];
  /** @type {Record<string, number>} */
  const count = {};
  const server = createServer((req, res) => {
    seen.push({ method: String(req.method), url: String(req.url), headers: req.headers });
    const slug = String(req.url).replace(/^\/publications\//, '');
    const n = count[slug] = (count[slug] ?? 0) + 1;
    const a = answers[slug];
    const one = Array.isArray(a) ? a[Math.min(n, a.length) - 1] : a;
    const { status, body } = one === undefined ? { status: 404, body: 'Not found' } : typeof one === 'string' ? { status: 200, body: one } : { status: one.status, body: one.body ?? '' };
    res.writeHead(status, { 'content-type': 'text/html' });
    res.end(body);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(undefined)));
  const address = /** @type {import('node:net').AddressInfo} */ (server.address());
  return {
    base: `http://127.0.0.1:${address.port}`,
    seen,
    close: () => new Promise((resolve) => server.close(() => resolve(undefined))),
  };
}

/** Real fetch; each wait recorded (and skipped), in order with the requests. */
function deps() {
  /** @type {string[]} */
  const timeline = [];
  /** @type {number[]} */
  const sleeps = [];
  return {
    timeline,
    sleeps,
    deps: {
      /** @type {import('../../scripts/ingest/census/crawl-nisra-publication-files.mjs').CrawlDeps['fetch']} */
      fetch: (url, init) => { timeline.push('get'); return fetch(url, init); },
      /** @param {number} ms */
      sleep: async (ms) => { sleeps.push(ms); timeline.push('sleep'); },
    },
  };
}

const pubs = (/** @type {string[]} */ ...slugs) => slugs.map((slug) => ({ slug, title: slug.toUpperCase() }));

test('parseFileLinks keeps NISRA-hosted data files, each once, in page order', () => {
  const html = pageWith([
    '/system/files/statistics/2026-10/Tables%20Q3.xlsx',
    'https://www.nisra.gov.uk/system/files/statistics/2026-10/Tables%20Q3.ODS',
    '/system/files/statistics/2026-10/Tables%20Q3.xlsx',
    'https://example.org/elsewhere.csv',
    'mailto:x@example.org.pdf',
    '/publications/other-page',
    'https://nisra.gov.uk/files/report.pdf',
  ]);
  assert.deepEqual(parseFileLinks(html), [
    { url: `${HOST}/system/files/statistics/2026-10/Tables%20Q3.xlsx`, ext: 'xlsx' },
    { url: 'https://www.nisra.gov.uk/system/files/statistics/2026-10/Tables%20Q3.ODS', ext: 'ods' },
    { url: 'https://nisra.gov.uk/files/report.pdf', ext: 'pdf' },
  ]);
  assert.deepEqual(parseFileLinks(''), []);
});

test('census publications are left out, as before', () => {
  assert.ok(isCensus('census-2021-main-statistics'));
  assert.ok(isCensus('ni-census-2011-x'));
  assert.ok(!isCensus('construction-output-statistics'));
  assert.deepEqual(publicationsOf({ publications: pubs('census-2021-x', 'a') }), pubs('a'));
});

test('one GET per page, nothing else, with the request headers only, and at least 2 s between requests', async () => {
  const site = await stubSite({ a: pageWith(['/system/files/statistics/a.xlsx']), b: pageWith([]), c: pageWith(['/system/files/statistics/c.pdf']) });
  try {
    const d = deps();
    const run = await crawlPages({ publications: pubs('a', 'b', 'c'), delayMs: 10, base: site.base }, d.deps);
    assert.equal(run.requests, 3);
    assert.deepEqual(site.seen.map((s) => `${s.method} ${s.url}`), ['GET /publications/a', 'GET /publications/b', 'GET /publications/c']);
    for (const { headers } of site.seen) {
      assert.equal(headers.accept, 'text/html');
      assert.doesNotMatch(String(headers['user-agent'] ?? ''), /civgraph|https?:|@|mozilla/i);
      assert.equal(headers.from, undefined);
      assert.equal(headers.cookie, undefined);
      assert.doesNotMatch(JSON.stringify(headers), /civgraph|@|mailto/i);
    }
    assert.deepEqual(d.timeline, ['get', 'sleep', 'get', 'sleep', 'get']);
    assert.ok(MIN_DELAY_MS >= 2000 && DEFAULT_DELAY_MS >= MIN_DELAY_MS);
    assert.ok(d.sleeps.every((ms) => ms >= 2000), 'a shorter delay asked for is raised to 2 s');
    assert.deepEqual(run.failed, []);
    assert.deepEqual(manifestFrom(pubs('a', 'b', 'c'), run.pages).publications.map((p) => p.slug), ['a', 'c']);
  } finally {
    await site.close();
  }
});

test('a 5xx is retried (waiting first) up to the attempt limit; a 404 is not retried', async () => {
  const site = await stubSite({ a: [{ status: 503 }, pageWith(['/system/files/statistics/a.csv'])], gone: { status: 404 }, down: { status: 500 } });
  try {
    const d = deps();
    const run = await crawlPages({ publications: pubs('a', 'gone', 'down'), base: site.base }, d.deps);
    assert.deepEqual(site.seen.map((s) => s.url), ['/publications/a', '/publications/a', '/publications/gone', ...Array(ATTEMPTS).fill('/publications/down')]);
    assert.equal(run.requests, 3 + ATTEMPTS);
    assert.equal(d.timeline.filter((x) => x === 'sleep').length, run.requests - 1);
    assert.deepEqual(run.failed, ['gone', 'down']);
    const manifest = manifestFrom(pubs('a', 'gone', 'down'), run.pages);
    assert.deepEqual(manifest, { generatedFrom: 'nisra.gov.uk publication pages', publicationsWithFiles: 1, fileTotal: 1, publications: [{ slug: 'a', title: 'A', files: [{ url: `${HOST}/system/files/statistics/a.csv`, ext: 'csv' }] }] });
  } finally {
    await site.close();
  }
});

for (const [what, answer] of /** @type {const} */ ([
  ['HTTP 403', { status: 403, body: 'Forbidden' }],
  ['HTTP 429', { status: 429, body: 'Too many requests' }],
  ['a bot challenge (HTTP 200)', { status: 200, body: '<html><head><title>Just a moment...</title></head><body><div id="cf-chl-widget"></div></body></html>' }],
])) {
  test(`${what} stops the run at once, with no retry, and nothing is written`, async () => {
    const site = await stubSite({ a: pageWith(['/system/files/statistics/a.xlsx']), b: answer, c: pageWith([]) });
    const dir = mkdtempSync(path.join(tmpdir(), 'nisra-files-'));
    try {
      await assert.rejects(crawlPages({ publications: pubs('a', 'b', 'c'), base: site.base }, deps().deps), CrawlRefused);
      assert.equal(site.seen.length, 2);
      const input = path.join(dir, 'publications.json');
      writeFileSync(input, JSON.stringify({ publications: pubs('a', 'b', 'c') }));
      const out = path.join(dir, 'out.json');
      const raw = path.join(dir, 'raw.json');
      const status = await runCli([input, out, '--raw', raw], deps().deps, { base: site.base });
      assert.equal(status, 2);
      assert.equal(existsSync(out), false);
      assert.equal(existsSync(raw), false);
    } finally {
      await site.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
}

test('the command line writes the manifest and the raw answers, and --replay rebuilds the same manifest offline', async () => {
  const site = await stubSite({ a: pageWith(['/system/files/statistics/2026-11/A%20tables.xlsx', '/system/files/statistics/2026-11/A%20tables.ods']), b: pageWith([]) });
  const dir = mkdtempSync(path.join(tmpdir(), 'nisra-files-'));
  try {
    const input = path.join(dir, 'publications.json');
    writeFileSync(input, JSON.stringify({ count: 3, publications: pubs('a', 'census-2021-x', 'b') }));
    const out = path.join(dir, 'out.json');
    const raw = path.join(dir, 'raw.json');
    assert.equal(await runCli([input, out, '--raw', raw], deps().deps, { base: site.base }), 0);
    assert.equal(site.seen.length, 2, 'the census publication is not fetched');
    const text = readFileSync(out, 'utf8');
    assert.equal(text, manifestJson(JSON.parse(text)));
    assert.equal(JSON.parse(text).fileTotal, 2);
    assert.deepEqual(JSON.parse(readFileSync(raw, 'utf8')).pages.map((/** @type {{ slug: string, status: number }} */ p) => [p.slug, p.status]), [['a', 200], ['b', 200]]);
    const again = path.join(dir, 'again.json');
    const offline = { fetch: async () => { throw new Error('no network in a replay'); }, sleep: async () => {} };
    assert.equal(await runCli([input, again, '--replay', raw], offline), 0);
    assert.equal(readFileSync(again, 'utf8'), text);
    assert.equal(await runCli([input], offline), 1);
  } finally {
    await site.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('nisraDownloads gives the July shape, at most 30 links', () => {
  const files = Array.from({ length: 35 }, (_, i) => ({ url: `${HOST}/system/files/statistics/2026-11/Table%20${i}.xlsx`, ext: 'xlsx' }));
  const d = nisraDownloads(files);
  assert.equal(MAX_FILES, 30);
  assert.equal(d.length, 30);
  assert.deepEqual(d[0], { label: 'Table 0.xlsx', url: `${HOST}/system/files/statistics/2026-11/Table%200.xlsx`, type: 'XLSX', source: 'NISRA' });
  assert.deepEqual(Object.keys(/** @type {object} */ (d[0])), ['label', 'url', 'type', 'source']);
});

test('only NISRA records with no downloads are enriched, and a second run changes nothing', () => {
  const rec = (/** @type {string} */ slug, extra = {}) => ({ id: `approved-publication:nisra-pub-${slug}`, url: `${HOST}/publications/${slug}`, approval: {}, ...extra });
  const kept = [{ label: 'old.xlsx', url: 'https://www.nisra.gov.uk/old.xlsx', type: 'XLSX', source: 'NISRA' }];
  const sources = [
    rec('new-one'),
    rec('has-links', { downloads: kept }),
    rec('no-files'),
    { id: 'approved-publication:opendata-ni-x', url: `${HOST}/publications/new-one` },
  ];
  const manifest = { publications: [
    { slug: 'new-one', files: [{ url: `${HOST}/a.xlsx`, ext: 'xlsx' }, { url: `${HOST}/a.pdf`, ext: 'pdf' }] },
    { slug: 'has-links', files: [{ url: `${HOST}/new.csv`, ext: 'csv' }] },
  ] };
  const before = JSON.parse(JSON.stringify(sources));
  const res = enrichNisraSources(sources, manifest);
  assert.deepEqual(res, { enriched: ['approved-publication:nisra-pub-new-one'], linked: 2 });
  assert.deepEqual(Object.keys(sources[0] ?? {}), ['id', 'url', 'approval', 'downloads'], 'downloads goes last, as on its siblings');
  assert.deepEqual(sources.slice(1), before.slice(1), 'every other record is untouched');
  const once = JSON.parse(JSON.stringify(sources));
  assert.deepEqual(enrichNisraSources(sources, manifest), { enriched: [], linked: 0 });
  assert.deepEqual(sources, once);
});
