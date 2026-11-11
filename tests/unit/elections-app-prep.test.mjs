// The Elections app's go-public preparation (11 Nov 2026): self-hosted libraries, the R2 layout
// of the extracts, what the extracts may publish, the widget's framing default, the upload plan.
// Nothing here uploads or reaches the network.
//
//   node --test tests/unit/elections-app-prep.test.mjs
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  DATA_ORIGIN, DUCKDB_VERSION, MAPLIBRE_VERSION, PMTILES_VERSION, R2_PREFIX, SOURCES, VENDOR, sourceFor,
} from '../../site/apps/elections/config.js';
import { PAGES_MAX_BYTES, checkVendor, r2KeyOf } from '../../scripts/build/elections-app/vendor.mjs';
import { PRIVATE_VALUE_PATTERNS, PUBLISHABLE_COLUMNS, publicationProblems } from '../../scripts/build/elections-app/data.mjs';
import { EXTRACT_COLUMNS } from '../../scripts/build/elections-app/model.mjs';
import { isPublishable, loadAllowlist } from '../../scripts/lib/r2-publication-gate.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (/** @type {string} */ rel) => readFileSync(path.join(ROOT, rel), 'utf8');

test('config: local development reads the local copies, every other host the R2 copy, an override wins', () => {
  for (const host of ['localhost', '127.0.0.1', '[::1]', 'civgraph.localhost']) assert.equal(sourceFor(host), 'local', host);
  for (const host of ['civgraph.net', 'www.civgraph.net', 'civgraph.pages.dev', 'abc123.civgraph.pages.dev', '']) assert.equal(sourceFor(host), 'r2', host);
  assert.equal(sourceFor('127.0.0.1', 'r2'), 'r2');
  assert.equal(sourceFor('civgraph.net', 'local'), 'local');
  assert.equal(sourceFor('civgraph.net', 'elsewhere'), 'r2', 'an unknown override is ignored');
});

test('config: the R2 layout is data/elections-app/v1/ on data.civgraph.net, and the libraries are versioned paths', () => {
  assert.equal(R2_PREFIX, 'data/elections-app/v1/');
  assert.equal(DATA_ORIGIN, 'https://data.civgraph.net');
  assert.equal(SOURCES.r2.extracts, 'https://data.civgraph.net/data/elections-app/v1/extracts/');
  assert.equal(SOURCES.r2.duckdbWasm, `https://data.civgraph.net/data/elections-app/v1/duckdb-wasm-${DUCKDB_VERSION}/`);
  assert.equal(SOURCES.local.extracts, '/apps/elections/extracts/');
  assert.deepEqual([DUCKDB_VERSION, MAPLIBRE_VERSION, PMTILES_VERSION], ['1.29.0', '5.24.0', '4.5.0']);
  for (const v of Object.values(VENDOR)) assert.match(v, /^\/src\/libs\/[a-z-]+-\d+\.\d+\.\d+\/$/);
});

test('vendored libraries: the committed files match src/libs/elections-app-vendor.json', () => {
  const { problems } = checkVendor();
  assert.deepEqual(problems, []);
  const manifest = JSON.parse(read('src/libs/elections-app-vendor.json'));
  for (const f of manifest.files) {
    if (f.host === 'pages') assert.ok(f.bytes < PAGES_MAX_BYTES, `${f.path} fits Pages`);
    else {
      assert.equal(f.r2Key, r2KeyOf(f.path));
      assert.ok(f.r2Key.startsWith(R2_PREFIX), f.r2Key);
      assert.equal(f.contentType, 'application/wasm');
    }
  }
  // Only the over-the-limit or binary files are R2's: every WebAssembly file, nothing else.
  assert.deepEqual(manifest.files.filter((/** @type {any} */ f) => f.host === 'r2').map((/** @type {any} */ f) => f.path).every((/** @type {string} */ p) => p.endsWith('.wasm')), true);
  assert.deepEqual(manifest.files.filter((/** @type {any} */ f) => f.path.endsWith('.wasm')).every((/** @type {any} */ f) => f.host === 'r2'), true);
  // The WebAssembly is never committed (gitignored): Pages would drop the big ones anyway.
  const tracked = execFileSync('git', ['ls-files', 'src/libs'], { cwd: ROOT, encoding: 'utf8' }).split('\n');
  assert.equal(tracked.filter((f) => f.endsWith('.wasm')).length, 0);
});

test('vendored libraries: MapLibre and PMTiles are the versions packages/map installs, byte for byte', () => {
  for (const [pkg, version, files] of /** @type {const} */ ([['maplibre-gl', MAPLIBRE_VERSION, ['maplibre-gl.js', 'maplibre-gl.css']], ['pmtiles', PMTILES_VERSION, ['pmtiles.js']]])) {
    const man = path.join(ROOT, 'node_modules', pkg, 'package.json');
    if (!existsSync(man)) continue; // no install here
    assert.equal(JSON.parse(readFileSync(man, 'utf8')).version, version, `${pkg}: the map package installs another version; re-vendor (npm run build:elections-app:vendor) or pin`);
    for (const f of files) {
      assert.ok(readFileSync(path.join(ROOT, 'node_modules', pkg, 'dist', f)).equals(readFileSync(path.join(ROOT, 'src/libs', `${pkg}-${version}`, f))), `${pkg}/${f}`);
    }
  }
});

test('the app loads nothing from a CDN', () => {
  const files = [];
  const walk = (/** @type {string} */ dir) => {
    for (const e of readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      const rel = `${dir}/${e.name}`;
      if (e.isDirectory()) { if (e.name !== 'extracts') walk(rel); } else if (/\.(js|html|css)$/.test(e.name)) files.push(rel);
    }
  };
  walk('site/apps/elections');
  assert.ok(files.length > 10);
  for (const f of files) assert.doesNotMatch(read(f), /cdn\.jsdelivr\.net|unpkg\.com|esm\.sh|extensions\.duckdb\.org/, f);
});

test('extracts: every column is in the reviewed publishable set, and none is an address, agent, contact or source field', () => {
  assert.deepEqual([...EXTRACT_COLUMNS].sort(), [...PUBLISHABLE_COLUMNS].sort());
  for (const c of PUBLISHABLE_COLUMNS) assert.doesNotMatch(c, /address|postcode|eircode|agent|propos|second|nominat|email|phone|occupation|note|source|citation|file|private/, c);
  assert.deepEqual(publicationProblems(new Map(), [...EXTRACT_COLUMNS, 'address']), ['column address is not in PUBLISHABLE_COLUMNS (review it before publishing)']);
});

test('extracts: the private-value scan catches postcodes, Eircodes, emails, phones and street addresses, and passes names', () => {
  const caught = (/** @type {string} */ v) => PRIVATE_VALUE_PATTERNS.filter(([, re]) => re.test(v)).map(([what]) => what);
  assert.deepEqual(caught('12 Malone Road, Belfast BT9 6AB').sort(), ['UK postcode', 'street address']);
  assert.deepEqual(caught('Dublin D02 X285'), ['Eircode']);
  assert.deepEqual(caught('agent@example.org'), ['email address']);
  assert.deepEqual(caught('028 9012 3456'), ['phone number']);
  for (const v of ['Belfast South and Mid Down', 'Sinn Féin', 'Alliance Party of Northern Ireland', "Máirtín Ó Muilleoir", 'Dún Laoghaire',
    '2022 Northern Ireland Assembly election', 'Dublin South-Central', 'elected unopposed', 'House of Commons of the United Kingdom', 'Ward 3 (Park)']) {
    assert.deepEqual(caught(v), [], v);
  }
  const rows = new Map([['x', { rows: [{ candidate: 'A Person', area: 'Somewhere', party: 'p', election: 'e', body: 'b', kind: 'k', voting_system: 'fptp', outcome: 'elected' }, { candidate: 'B, 4 Main Street', area: 'X' }] }]]);
  assert.equal(publicationProblems(rows).length, 1);
});

test('embedding is off by default: the widget may be framed by this site only, everything else by nobody', () => {
  // Cloudflare Pages' _headers, as its asset server applies them: every matching rule in file order;
  // "! Name" deletes the header so far, then the rule's own values are set (a name already set by an
  // earlier rule is appended to).
  const rules = [];
  /** @type {any} */
  let rule = null;
  for (const line of read('site/_headers').split('\n')) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    if (!/^\s/.test(line)) { rule = { re: new RegExp(`^${line.trim().replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/:[a-z]+/g, '[^/]+')}$`), set: [], unset: [] }; rules.push(rule); continue; }
    const t = line.trim();
    if (t.startsWith('!')) rule.unset.push(t.slice(1).trim().toLowerCase());
    else { const i = t.indexOf(':'); rule.set.push([t.slice(0, i).trim().toLowerCase(), t.slice(i + 1).trim()]); }
  }
  const headersFor = (/** @type {string} */ url) => {
    /** @type {Map<string, string>} */
    const h = new Map();
    const seen = new Set();
    for (const r of rules.filter((x) => x.re.test(url))) {
      for (const k of r.unset) h.delete(k);
      for (const [k, v] of r.set) { h.set(k, seen.has(k) && h.has(k) ? `${h.get(k)}, ${v}` : v); seen.add(k); }
    }
    return h;
  };
  const embed = headersFor('/apps/elections/embed/');
  assert.match(embed.get('content-security-policy') || '', /^frame-ancestors 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; upgrade-insecure-requests$/);
  assert.equal(embed.get('x-frame-options'), undefined);
  assert.equal(embed.get('x-robots-tag'), 'noindex, nofollow', 'the widget is never indexed');
  for (const url of ['/elections/', '/elections/pivot/', '/apps/elections/', '/']) {
    assert.match(headersFor(url).get('content-security-policy') || '', /^frame-ancestors 'none';/, url);
    assert.equal(headersFor(url).get('x-frame-options'), 'DENY', url);
  }
  assert.equal(headersFor('/src/libs/duckdb-wasm-1.29.0/duckdb-browser.mjs').get('cache-control'), 'public, max-age=31536000, immutable');
});

test('the R2 prefix is not in the publication allowlist yet: an upload is refused until the go-public change set adds it', () => {
  const allowlist = loadAllowlist(path.join(ROOT, 'data/database/r2-publication-allowlist.json'));
  assert.equal(isPublishable(`${R2_PREFIX}extracts/index.json`, allowlist), false);
});

test('upload plan: every key under the prefix, the WebAssembly typed, immutable files first, manifest then index.json last', async (t) => {
  if (!existsSync(path.join(ROOT, 'site/apps/elections/extracts/manifest.json'))) { t.skip('no extracts built here'); return; }
  const { plan, CACHE } = await import('../../scripts/publish/elections-app-r2-upload.mjs');
  const objects = plan();
  assert.ok(objects.every((o) => o.key.startsWith(R2_PREFIX)));
  assert.deepEqual(objects.slice(-2).map((o) => o.key), [`${R2_PREFIX}extracts/manifest.json`, `${R2_PREFIX}extracts/index.json`]);
  assert.ok(objects.slice(0, -2).every((o) => o.cacheControl === CACHE.immutable));
  assert.ok(objects.filter((o) => o.key.endsWith('.wasm')).every((o) => o.contentType === 'application/wasm'));
  assert.ok(objects.filter((o) => o.key.endsWith('.parquet')).every((o) => /-[0-9a-f]{12}\.parquet$/.test(o.key)), 'extracts are named by content');
  assert.equal(new Set(objects.map((o) => o.key)).size, objects.length);
});
