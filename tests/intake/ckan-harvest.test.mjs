// The CKAN catalogue harvest (packages/intake/src/ckan-harvest.mjs, run by
// scripts/ingest/census/harvest-opendatani-catalogue.mjs and
// scripts/ingest/datagovie/harvest-datagovie-catalogue.mjs), against a local stub CKAN server:
// it sends no User-Agent of ours (owner rule, 13 Nov 2026) and nothing that identifies anyone,
// waits at least 2 s before every request after the first, pages package_search at 1,000 rows,
// and stops on a 403, a 429 or a bot challenge, writing nothing. No outside network.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import {
  CrawlRefused, MIN_DELAY_MS, ROWS, fromPages, harvestJson, harvestPages, parsePage, searchUrl, toDataset,
} from '../../packages/intake/src/ckan-harvest.mjs';

/** @typedef {import('../../packages/intake/src/ckan-harvest.mjs').CkanPackage} CkanPackage */

/** @param {number} n @returns {CkanPackage[]} */
const catalogue = (n) => Array.from({ length: n }, (_, i) => ({
  name: `ds-${String(i).padStart(5, '0')}`,
  title: `Dataset ${i}`,
  notes: 'Line one.\n\nLine  two.',
  license_title: 'UK Open Government Licence (OGL)',
  license_url: 'http://reference.data.gov.uk/id/open-government-licence',
  metadata_modified: '2026-05-01T10:00:00.000000',
  organization: { title: 'Department X', name: 'dept-x' },
  resources: [{ name: 'File', url: `https://files.example/${i}.csv`, format: 'CSV' }, { name: 'No URL', url: '' }],
}));

/**
 * A stub CKAN portal. `answer(start, n)` may override the answer to the n-th request (1-based).
 * @param {CkanPackage[]} packages
 * @param {(start: number, n: number) => { status: number, body: string } | undefined} [answer]
 */
async function stubPortal(packages, answer = () => undefined) {
  /** @type {{ url: string, headers: import('node:http').IncomingHttpHeaders, at: number }[]} */
  const seen = [];
  const server = createServer((req, res) => {
    seen.push({ url: String(req.url), headers: req.headers, at: Date.now() });
    const q = new URL(String(req.url), 'http://stub').searchParams;
    const start = Number(q.get('start') || 0);
    const rows = Number(q.get('rows') || 10);
    const forced = answer(start, seen.length);
    if (forced) { res.writeHead(forced.status, { 'content-type': 'text/html' }); res.end(forced.body); return; }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ success: true, result: { count: packages.length, results: packages.slice(start, start + rows) } }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(undefined)));
  const address = /** @type {import('node:net').AddressInfo} */ (server.address());
  return {
    origin: `http://127.0.0.1:${address.port}`,
    seen,
    close: () => new Promise((resolve) => server.close(() => resolve(undefined))),
  };
}

/** Real fetch; sleep recorded and skipped (one test below waits for real). */
function deps() {
  /** @type {number[]} */
  const sleeps = [];
  return {
    sleeps,
    deps: {
      /** @type {import('../../packages/intake/src/ckan-harvest.mjs').HarvestDeps['fetch']} */
      fetch: (url, init) => fetch(url, init),
      /** @param {number} ms */
      sleep: async (ms) => { sleeps.push(ms); },
    },
  };
}

/**
 * Run the harvest command line (runCli) in a child process against a stub origin.
 * @param {string} origin @param {string[]} args
 * @returns {Promise<{ status: number | null, stderr: string }>}
 */
function runCliChild(origin, args) {
  const mod = pathToFileURL(path.resolve('packages/intake/src/ckan-harvest.mjs')).href;
  const code = `import { runCli } from ${JSON.stringify(mod)};
await runCli({ origin: ${JSON.stringify(origin)}, generatedFrom: 'stub', fields: { notes: true, resources: true, licenseUrl: false } }, process.argv.slice(1));`;
  return new Promise((resolve) => {
    let stderr = '';
    const child = spawn(process.execPath, ['--input-type=module', '-e', code, ...args], { stdio: ['ignore', 'ignore', 'pipe'] });
    child.stderr.on('data', (b) => { stderr += b; });
    child.on('exit', (status) => resolve({ status, stderr }));
  });
}

const FIELDS = { notes: true, resources: true, licenseUrl: false };

test('pages package_search at 1,000 rows, sorted by name, until the count is reached', async () => {
  const portal = await stubPortal(catalogue(2500));
  try {
    const d = deps();
    const { pages, count, requests } = await harvestPages({ origin: portal.origin }, d.deps);
    assert.equal(ROWS, 1000);
    assert.equal(count, 2500);
    assert.equal(requests, 3);
    assert.deepEqual(pages.map((p) => p.results.length), [1000, 1000, 500]);
    const params = portal.seen.map((s) => Object.fromEntries(new URL(s.url, 'http://stub').searchParams));
    assert.deepEqual(params.map((p) => p.start), ['0', '1000', '2000']);
    for (const p of params) assert.deepEqual(p, { q: '*:*', sort: 'name asc', rows: '1000', start: p.start });
    assert.ok(portal.seen.every((s) => s.url.startsWith('/api/3/action/package_search?')));
    const datasets = fromPages(pages, FIELDS);
    assert.equal(datasets.length, 2500);
    assert.equal(new Set(datasets.map((x) => x.slug)).size, 2500);
  } finally {
    await portal.close();
  }
});

test('an exact multiple of 1,000 takes no extra request; an empty portal takes one', async () => {
  for (const [n, expected] of [[2000, 2], [0, 1], [999, 1]]) {
    const portal = await stubPortal(catalogue(n));
    try {
      const { requests } = await harvestPages({ origin: portal.origin }, deps().deps);
      assert.equal(requests, expected, `${n} datasets`);
    } finally {
      await portal.close();
    }
  }
});

test('no request carries a User-Agent of ours or anything that identifies anyone', async () => {
  const portal = await stubPortal(catalogue(1500));
  try {
    await harvestPages({ origin: portal.origin }, deps().deps);
    assert.equal(portal.seen.length, 2);
    for (const { headers, url } of portal.seen) {
      assert.equal(headers.accept, 'application/json');
      // undici's own generic default ("node"), when it sends one at all: never ours, never a browser's.
      assert.doesNotMatch(String(headers['user-agent'] ?? ''), /civgraph|https?:|@|mozilla/i);
      assert.equal(headers.from, undefined);
      assert.equal(headers.cookie, undefined);
      assert.equal(headers.authorization, undefined);
      assert.doesNotMatch(JSON.stringify(headers) + url, /civgraph|@|mailto/i);
    }
  } finally {
    await portal.close();
  }
});

test('waits at least 2 s before every request after the first, whatever delay is asked for', async () => {
  const portal = await stubPortal(catalogue(2500));
  try {
    const d = deps();
    await harvestPages({ origin: portal.origin, delayMs: 10 }, d.deps);
    assert.equal(MIN_DELAY_MS, 2000);
    assert.deepEqual(d.sleeps, [2000, 2000]);
    const slower = deps();
    await harvestPages({ origin: portal.origin, delayMs: 3500 }, slower.deps);
    assert.deepEqual(slower.sleeps, [3500, 3500]);
  } finally {
    await portal.close();
  }
});

test('the requests really are 2 s apart (real timers)', async () => {
  const portal = await stubPortal(catalogue(1001));
  try {
    await harvestPages({ origin: portal.origin }, {
      fetch: (url, init) => fetch(url, init),
      sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    });
    assert.equal(portal.seen.length, 2);
    const [a, b] = portal.seen;
    assert.ok(/** @type {{ at: number }} */ (b).at - /** @type {{ at: number }} */ (a).at >= MIN_DELAY_MS - 5, 'second request came too soon');
  } finally {
    await portal.close();
  }
});

for (const [label, forced] of /** @type {[string, { status: number, body: string }][]} */ ([
  ['a 403', { status: 403, body: 'Forbidden' }],
  ['a 429', { status: 429, body: 'Too Many Requests' }],
  ['a bot challenge', { status: 200, body: '<html><head><title>Just a moment...</title></head><script src="/cdn-cgi/challenge-platform/x.js"></script></html>' }],
  ['a CAPTCHA', { status: 503, body: '<div class="g-recaptcha"></div>' }],
])) {
  test(`${label} on the second page stops the run at once, with no retry`, async () => {
    const portal = await stubPortal(catalogue(2500), (_start, n) => (n === 2 ? forced : undefined));
    try {
      await assert.rejects(harvestPages({ origin: portal.origin }, deps().deps), (e) => e instanceof CrawlRefused);
      assert.equal(portal.seen.length, 2, 'no request after the refusal');
    } finally {
      await portal.close();
    }
  });
}

test('the command line writes nothing and exits 2 on a block', async () => {
  const portal = await stubPortal(catalogue(10), () => ({ status: 429, body: 'slow down' }));
  const dir = mkdtempSync(path.join(tmpdir(), 'ckan-harvest-'));
  try {
    const out = path.join(dir, 'harvest.json');
    const raw = path.join(dir, 'pages.json');
    const r = await runCliChild(portal.origin, [out, '--raw', raw]);
    assert.equal(r.status, 2, r.stderr);
    assert.match(r.stderr, /STOPPED: HTTP 429/);
    assert.equal(existsSync(out), false);
    assert.equal(existsSync(raw), false);
    assert.equal(portal.seen.length, 1);
  } finally {
    await portal.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a failing page is retried with the wait, and a page that never answers stops the run', async () => {
  const flaky = await stubPortal(catalogue(1500), (_s, n) => (n === 2 ? { status: 502, body: 'bad gateway' } : undefined));
  try {
    const d = deps();
    const { requests, pages } = await harvestPages({ origin: flaky.origin }, d.deps);
    assert.equal(requests, 3);
    assert.deepEqual(d.sleeps, [2000, 2000]);
    assert.equal(fromPages(pages, FIELDS).length, 1500);
  } finally {
    await flaky.close();
  }
  const broken = await stubPortal(catalogue(1500), (start) => (start === 1000 ? { status: 500, body: 'error' } : undefined));
  try {
    await assert.rejects(harvestPages({ origin: broken.origin }, deps().deps), /failed after 3 attempts: HTTP 500/);
    assert.equal(broken.seen.length, 4);
  } finally {
    await broken.close();
  }
});

test('an answer that is not CKAN JSON, or a run past its request cap, stops', async () => {
  const html = await stubPortal(catalogue(10), () => ({ status: 200, body: '<html>portal home</html>' }));
  try {
    await assert.rejects(harvestPages({ origin: html.origin }, deps().deps), /not JSON/);
  } finally {
    await html.close();
  }
  const big = await stubPortal(catalogue(5000));
  try {
    await assert.rejects(harvestPages({ origin: big.origin, maxRequests: 3 }, deps().deps), /request cap of 3/);
    assert.equal(big.seen.length, 3);
  } finally {
    await big.close();
  }
  assert.throws(() => parsePage('{"success":false,"error":{}}', 'u'), /not a CKAN package_search answer/);
});

test('each package becomes the dataset shape the emitters read', () => {
  const [pkg] = catalogue(1);
  assert.deepEqual(toDataset(/** @type {CkanPackage} */ (pkg), FIELDS), {
    slug: 'ds-00000',
    title: 'Dataset 0',
    org: 'Department X',
    license: 'UK Open Government Licence (OGL)',
    modified: '2026-05-01T10:00:00.000000',
    notes: 'Line one. Line two.',
    resources: [{ url: 'https://files.example/0.csv', name: 'File', format: 'CSV' }],
  });
  assert.deepEqual(toDataset(/** @type {CkanPackage} */ (pkg), { notes: false, resources: false, licenseUrl: true }), {
    slug: 'ds-00000',
    title: 'Dataset 0',
    org: 'Department X',
    license: 'UK Open Government Licence (OGL)',
    licenseUrl: 'http://reference.data.gov.uk/id/open-government-licence',
    modified: '2026-05-01T10:00:00.000000',
  });
  assert.deepEqual(toDataset({ name: 'bare', organization: null, resources: null }, FIELDS), { slug: 'bare', resources: [] });
  // A package seen twice (it moved between pages during the run) is kept once, where first seen.
  const twice = fromPages([{ count: 2, results: [{ name: 'a' }, { name: 'b' }] }, { count: 2, results: [{ name: 'b' }] }], FIELDS);
  assert.deepEqual(twice.map((d) => d.slug), ['a', 'b']);
  const doc = JSON.parse(harvestJson({ generatedFrom: 'x', harvestedAt: 't', count: 2, datasets: twice }));
  assert.ok(Array.isArray(doc.datasets));
  assert.equal(doc.count, 2);
  assert.equal(searchUrl('https://data.gov.ie', 2000), 'https://data.gov.ie/api/3/action/package_search?q=*%3A*&sort=name+asc&rows=1000&start=2000');
});

test('a kept raw run replays to the same harvest, byte for byte, with no requests', async () => {
  const portal = await stubPortal(catalogue(1200));
  const dir = mkdtempSync(path.join(tmpdir(), 'ckan-replay-'));
  try {
    const live = path.join(dir, 'live.json');
    const raw = path.join(dir, 'pages.json');
    const replayed = path.join(dir, 'replayed.json');
    assert.equal((await runCliChild(portal.origin, [live, '--raw', raw])).status, 0);
    assert.equal(portal.seen.length, 2);
    assert.equal((await runCliChild(portal.origin, [replayed, '--replay', raw])).status, 0);
    assert.equal(portal.seen.length, 2, 'the replay made no request');
    assert.equal(readFileSync(replayed, 'utf8'), readFileSync(live, 'utf8'));
    const doc = JSON.parse(readFileSync(live, 'utf8'));
    assert.equal(doc.datasets.length, 1200);
    assert.equal(doc.portalCount, 1200);
  } finally {
    await portal.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
