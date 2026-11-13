// Owner rule, 13 Nov 2026: "By default, do not identify our crawlers or scrapers as Civgraph, or as
// anything, unless I approve you doing so." This holds it:
//
// - crawlHeaders() (packages/config/src/node.mjs) sets no User-Agent and drops one passed in;
// - a request made with it, and a Python urllib request made with no headers, reach a local
//   server (127.0.0.1, nothing leaves the machine) carrying only the client's generic default;
// - a ratchet over every tracked script in scripts/, packages/ and tools/: a line that sets a
//   User-Agent (a header, a Playwright or GDAL option, curl -A) may stand only in a file listed
//   below, each a request to Civgraph's own services, or code that only reads a User-Agent (a
//   visitor's, or a library default). The counts may only fall;
// - SITE.userAgent is read only by those own-service files and the C5 literal check.
import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { SITE, crawlHeaders } from '../../packages/config/src/node.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CONFIG = 'packages/config/src/config.js'; // defines SITE.userAgent

/**
 * Files that may name a User-Agent, with the number of lines doing so, and why. Each is a request
 * to Civgraph's own services (civgraph.net, data.civgraph.net, our dev proxies to them), or code
 * that only reads a User-Agent and sends none of its own. Never add a crawler here: an
 * identifying User-Agent to a third party needs the owner's approval for that service.
 * @type {Record<string, number>}
 */
const ALLOWED = {
  'packages/api/src/handlers/contributions/submit.js': 1, // keeps the visitor's own header with a submission
  'packages/intake/src/contribution.mjs': 1, // strips that header from the batch
  'packages/maps-pipeline/src/tiles/feature-index-from-tiles.mjs': 1, // GDAL reads our PMTiles on data.civgraph.net
  'scripts/dev/cors-proxy-server.cjs': 1, // dev proxy to data.civgraph.net
  'scripts/dev/dev-server.mjs': 1, // dev proxy to civgraph.net and data.civgraph.net
  'scripts/ingest/bna/render-book-thumbnails.py': 1, // book PDFs on civgraph.net and data.civgraph.net
  'scripts/ingest/bna/render-catalogue-thumbnails.py': 1, // our tiles on data.civgraph.net
  'scripts/ingest/census/build-census-explorer-bundle.mjs': 1, // our R2 bucket (data.civgraph.net)
  'scripts/ingest/osni/rebuild_island_terrain.py': 1, // our terrain tiles on data.civgraph.net
  'scripts/ingest/wikipedia/harvest_wikipedia_cited_sources.py': 1, // reads urllib's default, to check robots.txt for it; sets none
  'scripts/publish/elections-app-refresh.mjs': 1, // the manifest on our R2 bucket
  'scripts/records/parity-crawl.mjs': 1, // compares civgraph.net with a local rehearsal
  'tools/catalogue-editor/server.mjs': 1, // dev proxy to civgraph.net and data.civgraph.net
  'tools/dev-site/server.mjs': 1, // dev proxy to civgraph.net and data.civgraph.net
};

/** The files that may read SITE.userAgent: the own-service requests above, and the C5 literal check. */
const SITE_UA_READERS = new Set([
  'packages/maps-pipeline/src/tiles/feature-index-from-tiles.mjs',
  'scripts/check/architecture/literals.mjs',
  'scripts/ingest/census/build-census-explorer-bundle.mjs',
  'scripts/publish/elections-app-refresh.mjs',
  'scripts/records/parity-crawl.mjs',
]);

// A line that sets (or names, as a key) a User-Agent: a quoted header or option name, a
// userAgent: property, GDAL's variable, .NET's UserAgent.ParseAdd, curl's -A or --user-agent.
const SETS_UA = /(['"]user[-_ ]?agent['"]\s*[:=,\]]|\buserAgent\s*:|GDAL_HTTP_USERAGENT|UserAgent\.ParseAdd|['"]-A['"]\s*,|--user-agent)/i;
const CODE = /\.(m?js|cjs|ts|py|ps1|sh)$/;
// Comment lines in the languages above (JS block and line comments, Python and shell hashes).
const isComment = (/** @type {string} */ line) => /^\s*(\*|\/\/|\/\*|#)/.test(line);

/** Tracked script files under the folders that make outside requests. */
function trackedScripts() {
  const out = execFileSync('git', ['ls-files', '-z', '--', 'scripts', 'packages', 'tools'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return out.split('\0').filter((rel) => CODE.test(rel) && !rel.endsWith('.d.ts'));
}

test('crawlHeaders() sets no User-Agent, drops one passed in, and keeps the rest', () => {
  assert.deepEqual(crawlHeaders(), {});
  assert.deepEqual(crawlHeaders({ Accept: 'application/json' }), { Accept: 'application/json' });
  const extra = { 'User-Agent': 'x', 'user-agent': 'y', 'USER-AGENT': 'z', 'X-Api-Key': 'k', Range: 'bytes=0-0' };
  assert.deepEqual(crawlHeaders(extra), { 'X-Api-Key': 'k', Range: 'bytes=0-0' });
  assert.equal(extra['User-Agent'], 'x', 'the argument is not changed');
});

/**
 * A local server that records the headers of each request it gets.
 * @returns {Promise<{ url: string, seen: import('node:http').IncomingHttpHeaders[], close: () => Promise<void> }>}
 */
async function recorder() {
  /** @type {import('node:http').IncomingHttpHeaders[]} */
  const seen = [];
  const server = createServer((req, res) => { seen.push(req.headers); res.end('ok'); });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(undefined)));
  const address = /** @type {import('node:net').AddressInfo} */ (server.address());
  return {
    url: `http://127.0.0.1:${address.port}/`,
    seen,
    close: () => new Promise((resolve) => server.close(() => resolve(undefined))),
  };
}

test('Node fetch with crawlHeaders() sends only the generic default User-Agent', async () => {
  const r = await recorder();
  try {
    await (await fetch(r.url, { headers: crawlHeaders({ Accept: 'text/html' }) })).text();
    assert.equal(r.seen.length, 1);
    const [h] = r.seen;
    assert.equal(h.accept, 'text/html');
    // undici's own default ("node"), when it sends one at all: never ours, never a browser's.
    assert.doesNotMatch(String(h['user-agent'] ?? ''), /civgraph|https?:|@|mozilla/i);
    assert.doesNotMatch(JSON.stringify(h), /civgraph|@/i);
  } finally {
    await r.close();
  }
});

const python = ['python3', 'python'].find((cmd) => spawnSync(cmd, ['-I', '-c', 'pass']).status === 0);

test('Python urllib with no headers sends only its generic default User-Agent', { skip: !python && 'no Python here' }, async () => {
  const r = await recorder();
  try {
    const code = 'import sys, urllib.request; urllib.request.urlopen(urllib.request.Request(sys.argv[1]), timeout=10).read()';
    // Async spawn: the server answers on this same event loop.
    const status = await new Promise((resolve) => {
      spawn(/** @type {string} */ (python), ['-I', '-c', code, r.url], { stdio: 'ignore' }).on('exit', resolve);
    });
    assert.equal(status, 0);
    assert.equal(r.seen.length, 1);
    assert.match(String(r.seen[0]['user-agent']), /^Python-urllib\//);
    assert.doesNotMatch(JSON.stringify(r.seen[0]), /civgraph|@|mozilla/i);
  } finally {
    await r.close();
  }
});

test('no script sets a User-Agent outside the own-service list, whose counts only fall', () => {
  /** @type {Record<string, number>} */
  const found = {};
  for (const rel of trackedScripts()) {
    if (rel === CONFIG) continue;
    const n = readFileSync(path.join(ROOT, rel), 'utf8').split('\n').filter((l) => !isComment(l) && SETS_UA.test(l)).length;
    if (n) found[rel] = n;
  }
  const over = Object.entries(found).filter(([rel, n]) => n > (ALLOWED[rel] ?? 0));
  assert.deepEqual(over, [], `a crawler, scraper or third-party fetch sends no User-Agent (owner rule, 13 Nov 2026): use crawlHeaders() or the library default. ${over.map(([rel, n]) => `${rel} (${n})`).join(', ')}`);
  const stale = Object.entries(ALLOWED).filter(([rel, n]) => (found[rel] ?? 0) < n);
  assert.deepEqual(stale, [], 'lower these allowances: the baseline only shrinks');
});

test('no script names Civgraph, a contact or an email address in a User-Agent value', () => {
  /** @type {string[]} */
  const found = [];
  for (const rel of trackedScripts()) {
    if (rel === CONFIG || rel in ALLOWED) continue;
    readFileSync(path.join(ROOT, rel), 'utf8').split('\n').forEach((line, i) => {
      if (isComment(line)) return;
      if (/civgraph-research \(|civgraph[\w.-]*\/\d|\(\+https?:\/\/|contact:? (via )?civgraph|Mozilla\/5\.0/i.test(line)) found.push(`${rel}:${i + 1}`);
    });
  }
  assert.deepEqual(found, []);
});

test('SITE.userAgent is read only by requests to our own services', () => {
  assert.equal(SITE.userAgent, 'civgraph-research (+https://civgraph.net)');
  /** @type {string[]} */
  const readers = [];
  for (const rel of trackedScripts()) {
    if (rel.startsWith('packages/config/')) continue;
    const lines = readFileSync(path.join(ROOT, rel), 'utf8').split('\n').filter((l) => !isComment(l));
    if (lines.some((l) => /\bSITE\.userAgent\b/.test(l))) readers.push(rel);
  }
  assert.deepEqual(readers.filter((rel) => !SITE_UA_READERS.has(rel)), []);
});
