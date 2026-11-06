#!/usr/bin/env node
/**
 * Parity crawl: fetch the same public URLs from two sites and compare the answers (data design
 * phase2-plan.md stage G.5). Read-only; GET only.
 *
 *   node scripts/records/parity-crawl.mjs --a https://civgraph.net --b http://127.0.0.1:8788
 *        [--db tmp/records/civgraph-records.sqlite] [--seed 1] [--scale 1] [--only kind,kind]
 *        [--delay-a 350] [--concurrency-b 6] [--out tmp/records/parity-report.json]
 *
 * Side A is the reference (before go-live: production on the old transport; after: production on
 * the new one), side B the candidate (the local rehearsal: wrangler pages dev over the local D1).
 * Requests to a host other than 127.0.0.1/localhost go one at a time, --delay-a ms apart, with the
 * User-Agent "civgraph-research (+https://civgraph.net)" and no personal identifiers.
 *
 * The URL sample is drawn deterministically (--seed) from the records database: election
 * bundles (the three largest always), the manifest, summaries, provenance shards, the elections,
 * persons, sources and register APIs, the /data/browse files Browse reads (index files, party
 * details and profiles, election details and contests, offices, votes), and the server-rendered
 * /browse/<type>/<slug> heads, with merged-person and retired-party redirects. --scale multiplies
 * the per-kind sample sizes.
 *
 * JSON answers are compared deep, with generatedAt/builtAt dropped at any depth; a difference that
 * vanishes when arrays are sorted is reported as "order". HTML pages are compared on status,
 * redirect target, title, description and canonical. Exit 0 when every URL matches, 1 otherwise;
 * the report lists every difference with its first differing path.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { REPO_ROOT } from './paths.mjs';

const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };
const A = String(opt('--a', 'https://civgraph.net')).replace(/\/$/, '');
const B = String(opt('--b', 'http://127.0.0.1:8788')).replace(/\/$/, '');
const DB = path.resolve(opt('--db', path.join(REPO_ROOT, 'tmp', 'records', 'civgraph-records.sqlite')));
const SEED = Number(opt('--seed', 1));
const SCALE = Number(opt('--scale', 1));
const ONLY = opt('--only', '') ? new Set(opt('--only', '').split(',')) : null;
const DELAY_A = Number(opt('--delay-a', 350));
const CONC_B = Number(opt('--concurrency-b', 6));
const OUT = path.resolve(opt('--out', path.join(REPO_ROOT, 'tmp', 'records', 'parity-report.json')));
const UA = 'civgraph-research (+https://civgraph.net)';

// ---------------------------------------------------------------- sampling
function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 2 ** 32; };
}
const rand = rng(SEED);
function sample(list, n) {
  const a = [...list];
  const k = Math.min(a.length, Math.max(0, Math.round(n * SCALE)));
  for (let i = 0; i < k; i += 1) {
    const j = i + Math.floor(rand() * (a.length - i));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, k).sort();
}

export function buildUrlList(db) {
  const col = (sql) => db.prepare(sql).all().map((r) => Object.values(r)[0]).filter((v) => v !== null && v !== undefined);
  const urls = [];
  const add = (kind, url, mode = 'json') => urls.push({ kind, url, mode });
  const enc = encodeURIComponent;

  const keys = col('SELECT key FROM r_elections ORDER BY key');
  const largest = col("SELECT election_key FROM election_aggregates GROUP BY election_key ORDER BY SUM(LENGTH(payload)) DESC LIMIT 3");
  const bundleKeys = [...new Set([...largest, ...sample(keys, 100)])];
  for (const k of bundleKeys) add('bundle', `/render/metadata/elections-test2/${k}.json`);
  add('manifest', '/render/metadata/elections-test2.json');
  for (const k of sample(keys, 50)) add('provenance-shard', `/render/metadata/election-provenance/${k}.json`);
  const summaries = col("SELECT file FROM election_summaries ORDER BY file");
  for (const n of sample(summaries, 50)) add('summary', `/render/metadata/elections-test2-summaries/${n}`);
  for (const k of sample(keys, 60)) add('api-bundle', `/_api/elections?key=${enc(k)}&format=bundle&lite=1`);
  const contests = db.prepare('SELECT election_key AS k, seq FROM contests ORDER BY election_key, seq').all();
  for (const c of sample(contests.map((r) => `${r.k}|${r.seq}`), 40)) {
    const [k, seq] = c.split('|');
    add('api-constituency', `/_api/elections?key=${enc(k)}&constituency=${seq}`);
  }
  add('api-elections-index', '/_api/elections');

  const persons = col('SELECT slug FROM person_cards ORDER BY slug');
  for (const s of sample(persons, 150)) add('api-person', `/_api/persons?slug=${enc(s)}`);
  for (const q of ['paisley', 'hume', 'devlin', 'kelly']) add('api-person-search', `/_api/persons?q=${q}&limit=25`);
  const sources = col('SELECT slug FROM sources ORDER BY slug');
  for (const s of sample(sources, 80)) add('api-source', `/_api/sources?slug=${enc(s)}`);
  const register = col('SELECT slug FROM register_entries ORDER BY slug');
  for (const s of sample(register, 40)) add('api-register', `/_api/register-interests?slug=${enc(s)}`);

  for (const f of ['index.json', 'persons.json', 'persons-facets.json', 'sources.json', 'register-interests.json', 'parties.json',
    'party-names.json', 'party-label-folds.json', 'offices.json', 'source-merges.json', 'elections-list.json', 'votes/index.json']) {
    add('browse-file', `/data/browse/${f}`);
  }
  const parties = col('SELECT slug FROM party_cards ORDER BY slug');
  for (const s of sample(parties, 120)) add('party-detail', `/data/browse/details/parties/${s}.json`);
  for (const s of sample(parties, 60)) add('party-profile', `/data/browse/party-profiles/${s}.json`);
  const retired = col('SELECT alias FROM party_aliases ORDER BY alias');
  for (const s of sample(retired, 20)) add('party-detail-retired', `/data/browse/details/parties/${s}.json`);
  const electionSlugs = col("SELECT slug FROM election_details WHERE detail IS NOT NULL ORDER BY slug");
  for (const s of sample(electionSlugs, 60)) add('election-detail', `/data/browse/details/elections/${s}.json`);
  const contestSlugs = col("SELECT slug FROM election_details WHERE contests IS NOT NULL ORDER BY slug");
  for (const s of sample(contestSlugs, 40)) add('election-contests', `/data/browse/details/election-contests/${s}.json`);
  const offices = col('SELECT slug FROM office_cards ORDER BY slug');
  for (const s of sample(offices, 60)) add('office-detail', `/data/browse/details/offices/${s}.json`);
  for (let i = 0; i < Math.ceil(persons.length / 5000); i += 1) add('person-shard', `/data/browse/person-shards/persons-${String(i).padStart(3, '0')}.json`);
  // The other sharded indexes, every shard: a shard is a slice of its table in source order, so
  // these hold the order of every row (the last shard of each included).
  for (let i = 0; i < Math.ceil(sources.length / 5000); i += 1) add('source-shard', `/data/browse/source-index-shards/sources-${String(i).padStart(3, '0')}.json`);
  for (let i = 0; i < Math.ceil(register.length / 5000); i += 1) add('register-shard', `/data/browse/register-interest-shards/register-interests-${String(i).padStart(3, '0')}.json`);
  for (const f of ['elections.json', 'election-contest-parents.json']) add('browse-file', `/data/browse/${f}`);
  // The list APIs in their default (source) order, first and later pages.
  for (const q of ['limit=50', 'limit=50&offset=10000', 'limit=50&offset=36300']) add('api-person-list', `/_api/persons?${q}`);
  for (const q of ['limit=60', 'limit=60&offset=20000', 'limit=60&offset=39300']) add('api-source-list', `/_api/sources?${q}`);
  for (const q of ['limit=60', 'limit=60&offset=5000']) add('api-register-list', `/_api/register-interests?${q}`);
  for (const q of ['view=list', 'view=list&decade=1920s&limit=40&offset=20', 'view=manifest']) add('api-election-list', `/_api/elections?${q}`);
  for (const q of ['', '?view=names']) add('api-party-list', `/_api/parties${q}`);
  for (const q of ['belfast', 'paisley', 'unionist']) add('api-graph-search', `/_api/graph?q=${q}`);
  for (const e of ['cg:party:uup', 'cg:party:sdlp', 'cg:party:sinn-fein']) add('api-graph-entity', `/_api/graph?entity=${enc(e)}&related=1`);
  const votePersons = col('SELECT person_id FROM vote_persons ORDER BY person_id');
  for (const id of sample(votePersons, 40)) add('votes-person', `/data/browse/votes/persons/${id}.json`);
  const voteParties = col('SELECT slug FROM vote_parties ORDER BY slug');
  for (const s of sample(voteParties, 10)) add('votes-party', `/data/browse/votes/parties/${s}.json`);

  const page = (type, slugs, n) => { for (const s of sample(slugs, n)) add(`page-${type}`, `/browse/${type}/${enc(s)}`, 'html'); };
  page('persons', persons, 60);
  page('parties', parties, 30);
  page('sources', sources, 40);
  page('register-interests', register, 20);
  page('offices', offices, 30);
  page('elections', col("SELECT slug FROM election_cards ORDER BY slug"), 60);
  const mergedIds = col('SELECT alias FROM person_aliases ORDER BY alias');
  page('persons', mergedIds, 20);
  for (const s of sample(retired, 15)) add('page-parties-retired', `/browse/parties/${enc(s)}`, 'html');
  add('page-elections-alias', '/browse/elections/bangor-urban-district-council-1920-01-15', 'html');

  // The grouped local-election years (ni-local__YYYY from 1921, ireland-local__YYYY before):
  // the year files and coverage are committed static files, the year records come from D1.
  const groupYears = col("SELECT slug FROM election_cards ORDER BY slug").filter((s) => /^(ni|ireland)-local-\d{4}$/.test(s));
  for (const s of groupYears) add('ni-local-year-file', `/render/metadata/ni-local/${s.slice(-4)}.json`);
  add('ni-local-coverage', '/render/metadata/ni-local-coverage.json');
  for (const s of sample(groupYears, 15)) add('ni-local-detail', `/data/browse/details/elections/${s}.json`);
  for (const s of sample(groupYears, 15)) add('page-elections-ni-local', `/browse/elections/${enc(s)}`, 'html');
  return urls.filter((u) => !ONLY || ONLY.has(u.kind));
}

// ---------------------------------------------------------------- fetching
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isLocal = (base) => /^https?:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/.test(base);

async function get(base, url) {
  const started = Date.now();
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const res = await fetch(base + url, { redirect: 'manual', headers: { 'User-Agent': UA, Accept: '*/*' } });
      const body = Buffer.from(await res.arrayBuffer());
      if (res.status >= 500 && attempt < 3) { await sleep(2000 * attempt); continue; }
      return { status: res.status, location: res.headers.get('location'), type: res.headers.get('content-type') || '', body, ms: Date.now() - started };
    } catch (error) {
      if (attempt === 3) return { status: 0, error: String(error.message || error), body: Buffer.alloc(0), ms: Date.now() - started };
      await sleep(2000 * attempt);
    }
  }
  return null;
}

// ---------------------------------------------------------------- comparing
const DROP = new Set(['generatedAt', 'builtAt']);
function clean(v) {
  if (Array.isArray(v)) return v.map(clean);
  if (v && typeof v === 'object') {
    const out = {};
    for (const k of Object.keys(v)) if (!DROP.has(k)) out[k] = clean(v[k]);
    return out;
  }
  return v;
}
function canon(v) {
  if (Array.isArray(v)) return v.map(canon).map((x) => JSON.stringify(x)).sort().map((s) => JSON.parse(s));
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])]));
  return v;
}
const stable = (v) => JSON.stringify(canon(v));
const sorted = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sorted(v[k])])) : Array.isArray(v) ? v.map(sorted) : v);

/** The first path at which two JSON values differ, with both values (clipped). */
export function firstDiff(a, b, at = '$') {
  if (JSON.stringify(sorted(a)) === JSON.stringify(sorted(b))) return null;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return { path: `${at}.length`, a: a.length, b: b.length };
    for (let i = 0; i < a.length; i += 1) { const d = firstDiff(a[i], b[i], `${at}[${i}]`); if (d) return d; }
    return null;
  }
  if (a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)) {
    for (const k of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) {
      if (!(k in a)) return { path: `${at}.${k}`, a: '(absent)', b: clip(b[k]) };
      if (!(k in b)) return { path: `${at}.${k}`, a: clip(a[k]), b: '(absent)' };
      const d = firstDiff(a[k], b[k], `${at}.${k}`); if (d) return d;
    }
    return null;
  }
  return { path: at, a: clip(a), b: clip(b) };
}
const clip = (v) => { const s = JSON.stringify(v); return s && s.length > 200 ? `${s.slice(0, 200)}...` : v; };

function htmlHead(body) {
  const text = body.toString('utf8');
  const pick = (re) => (text.match(re)?.[1] || '').replace(/\s+/g, ' ').trim();
  return {
    title: pick(/<title>([^<]*)<\/title>/i),
    description: pick(/<meta\s+name="description"\s+content="([^"]*)"/i),
    canonical: pick(/<link\s+rel="canonical"\s+href="([^"]*)"/i),
  };
}

export function compare(u, a, b) {
  const base = { kind: u.kind, url: u.url, statusA: a.status, statusB: b.status };
  const sha = (buf) => createHash('sha1').update(buf).digest('hex').slice(0, 12);
  if (a.status !== b.status) return { ...base, result: 'status', note: a.error || b.error || undefined };
  if (a.status >= 300 && a.status < 400) {
    const loc = (l) => String(l || '').replace(/^https?:\/\/[^/]+/, '');
    return loc(a.location) === loc(b.location) ? { ...base, result: 'same' } : { ...base, result: 'redirect', a: a.location, b: b.location };
  }
  if (a.status !== 200) return { ...base, result: 'same' };
  if (u.mode === 'html') {
    const ha = htmlHead(a.body);
    const hb = htmlHead(b.body);
    const keys = ['title', 'description', 'canonical'].filter((k) => ha[k] !== hb[k]);
    return keys.length ? { ...base, result: 'html', fields: keys.map((k) => ({ field: k, a: ha[k], b: hb[k] })) } : { ...base, result: 'same' };
  }
  if (sha(a.body) === sha(b.body)) return { ...base, result: 'same', bytes: a.body.length };
  let ja; let jb;
  try { ja = clean(JSON.parse(a.body.toString('utf8'))); jb = clean(JSON.parse(b.body.toString('utf8'))); } catch {
    return { ...base, result: 'bytes', bytesA: a.body.length, bytesB: b.body.length };
  }
  if (JSON.stringify(sorted(ja)) === JSON.stringify(sorted(jb))) return { ...base, result: 'same', note: 'equal after dropping generatedAt / key order' };
  if (stable(ja) === stable(jb)) return { ...base, result: 'order', diff: firstDiff(ja, jb) };
  return { ...base, result: 'data', diff: firstDiff(ja, jb), bytesA: a.body.length, bytesB: b.body.length };
}

async function crawl(urls) {
  const results = new Array(urls.length);
  const fetchB = new Array(urls.length);
  // B (local) in parallel; A (production) one at a time, politely.
  let next = 0;
  const workerB = async () => {
    while (next < urls.length) { const i = next; next += 1; fetchB[i] = await get(B, urls[i].url); }
  };
  const bDone = Promise.all(Array.from({ length: isLocal(B) ? CONC_B : 1 }, workerB));
  await bDone;
  for (let i = 0; i < urls.length; i += 1) {
    const a = await get(A, urls[i].url);
    results[i] = compare(urls[i], a, fetchB[i]);
    if (!isLocal(A)) await sleep(DELAY_A);
    if ((i + 1) % 100 === 0) console.log(`  ${i + 1}/${urls.length}`);
  }
  // A transient 5xx on either side (production answers 500 while a legacy D1 reload has its
  // tables dropped) is fetched again once, a minute later, before it counts as a difference.
  const again = results.map((r, i) => (r.result === 'status' && (r.statusA >= 500 || r.statusB >= 500 || !r.statusA || !r.statusB) ? i : -1)).filter((i) => i >= 0);
  if (again.length) {
    console.log(`  retrying ${again.length} URL(s) that answered 5xx`);
    await sleep(60_000);
    for (const i of again) {
      const a = await get(A, urls[i].url);
      const b = await get(B, urls[i].url);
      results[i] = { ...compare(urls[i], a, b), retried: true };
      if (!isLocal(A)) await sleep(DELAY_A);
    }
  }
  return results;
}

async function main() {
  const db = new DatabaseSync(DB, { readOnly: true });
  const urls = buildUrlList(db);
  db.close();
  console.log(`parity: ${urls.length} URLs, A=${A} B=${B}`);
  const t0 = Date.now();
  const results = await crawl(urls);
  const byKind = {};
  for (const r of results) {
    const k = (byKind[r.kind] ||= { urls: 0, same: 0, differ: 0 });
    k.urls += 1;
    if (r.result === 'same') k.same += 1; else k.differ += 1;
  }
  const differences = results.filter((r) => r.result !== 'same');
  const report = { a: A, b: B, seed: SEED, scale: SCALE, ranAt: new Date().toISOString(), seconds: Math.round((Date.now() - t0) / 1000), urls: urls.length, differences: differences.length, byKind, results: differences };
  mkdirSync(path.dirname(OUT), { recursive: true });
  writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`);
  for (const [kind, k] of Object.entries(byKind)) console.log(`  ${kind.padEnd(24)} ${String(k.urls).padStart(4)} urls  ${k.differ ? `${k.differ} differ` : 'all same'}`);
  console.log(`${differences.length ? 'DIFFERENCES' : 'PASS'}: ${differences.length} of ${urls.length} URLs differ (report: ${path.relative(REPO_ROOT, OUT)})`);
  return differences.length ? 1 : 0;
}

if (process.argv[1] && path.basename(process.argv[1]) === 'parity-crawl.mjs') {
  main().then((code) => { process.exitCode = code; }).catch((error) => { console.error(`FAIL: ${error.message}`); process.exitCode = 2; });
}
