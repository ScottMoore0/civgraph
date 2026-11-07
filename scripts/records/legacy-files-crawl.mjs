#!/usr/bin/env node
/**
 * Crawl the old /data/browse and /data/graph file URLs on a running site and compare each answer
 * with the file the records build wrote (data phase 4). Read-only; GET only.
 *
 *   node scripts/records/legacy-files-crawl.mjs --base http://127.0.0.1:8788
 *        [--browse-dir tmp/records/browse] [--graph-dir tmp/records/graph] [--per-kind 12]
 *        [--concurrency 6] [--delay 0] [--out tmp/records/legacy-files-report.json]
 *
 * Every directory of the two build trees is a file kind; each kind is sampled evenly
 * (--per-kind files, every top-level file), plus the redirects and misses the Functions answer
 * without a file (older layouts -> 301, unknown paths -> 404) and HEAD on a sample. A JSON answer
 * matches when it deep-equals the file with `generatedAt` dropped from both wrappers. The bulk
 * dumps (graph statement-shards/, exports/) are expected to answer 200 (the R2 copy, while it is
 * there) or 301 to the downloads. Use it locally against `wrangler pages dev` over a local D1
 * loaded from the same build, or after a publish against production with --delay 350 (requests
 * then go one at a time with the research User-Agent). Exit 0 when every URL answers correctly.
 * graph_files is frozen (graph-files-freeze.mjs): the graph files the last build reported as
 * drifted (tmp/records/graph-files-drift.json) need only answer, not match.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import path from 'node:path';
import { REPO_ROOT } from './paths.mjs';
import { driftedFile, readDrift } from './graph-files-freeze.mjs';

const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };
const BASE = String(opt('--base', 'http://127.0.0.1:8788')).replace(/\/$/, '');
const BROWSE = path.resolve(opt('--browse-dir', path.join(REPO_ROOT, 'tmp/records/browse')));
const GRAPH = path.resolve(opt('--graph-dir', path.join(REPO_ROOT, 'tmp/records/graph')));
const PER_KIND = Number(opt('--per-kind', 12));
const DELAY = Number(opt('--delay', 0));
const local = /^https?:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/.test(BASE);
const CONCURRENCY = local ? Number(opt('--concurrency', 6)) : 1;
const OUT = path.resolve(opt('--out', path.join(REPO_ROOT, 'tmp/records/legacy-files-report.json')));
const HEADERS = local ? {} : { 'User-Agent': 'civgraph-research (+https://civgraph.net)' };
const BULK = /^(statement-shards|exports)(\/|$)/;

const sample = (list, n) => {
  if (list.length <= n) return list;
  const step = list.length / n;
  return Array.from({ length: n }, (_, i) => list[Math.floor(i * step)]);
};

/** Every directory of a tree (relative), with its files sorted. */
function kinds(root, rel = '') {
  const out = [];
  const abs = path.join(root, rel);
  const entries = readdirSync(abs).sort();
  const files = entries.filter((e) => statSync(path.join(abs, e)).isFile());
  if (files.length) out.push([rel, files]);
  for (const e of entries) if (!files.includes(e)) out.push(...kinds(root, rel ? `${rel}/${e}` : e));
  return out;
}

function plan() {
  const urls = [];
  const drift = readDrift();
  for (const [prefix, root] of [['/data/browse/', BROWSE], ['/data/graph/', GRAPH]]) {
    if (!existsSync(root)) throw new Error(`no build tree at ${root}`);
    for (const [dir, files] of kinds(root)) {
      const picked = dir ? sample(files, BULK.test(dir) ? 2 : PER_KIND) : files;
      for (const f of picked) {
        const rel = dir ? `${dir}/${f}` : f;
        const kind = `${prefix}${dir || '(top)'}`;
        if (prefix === '/data/graph/' && BULK.test(rel)) urls.push({ kind, url: `${prefix}${rel}`, expect: 'bulk' });
        // graph_files is frozen as loaded at go-live: a file whose keys changed since answers
        // its go-live keys (or 404 if it is new), not this build's file.
        else if (prefix === '/data/graph/' && driftedFile(rel, drift)) urls.push({ kind, url: `${prefix}${rel}`, expect: 'drifted' });
        else urls.push({ kind, url: `${prefix}${rel}`, expect: 'file', file: path.join(root, ...rel.split('/')) });
      }
    }
  }
  for (const [url, location] of [
    ['/data/browse/proni-roots.json', '/_api/proni/node'],
    ['/data/browse/details/sources/a-source.json', '/_api/sources?slug=a-source&view=detail'],
    ['/data/browse/details/proni/D~1~2.json', '/_api/proni/node?ref=D%2F1%2F2'],
    ['/data/browse/map-features/x/0001.json', 'https://data.civgraph.net/data/browse/map-features/x/0001.json'],
  ]) urls.push({ kind: 'moved', url, expect: 'redirect', location });
  for (const url of ['/data/browse/no-such-file.json', '/data/graph/no-such-file.json', '/data/graph/entity-shards/entities-999999.json']) {
    urls.push({ kind: 'missing', url, expect: 404 });
  }
  for (const u of sample(urls.filter((x) => x.expect === 'file'), 6)) urls.push({ ...u, kind: 'head', expect: 'head' });
  return urls;
}

const dropGeneratedAt = (doc) => {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return doc;
  const { generatedAt: _g, ...rest } = doc;
  return rest;
};

function firstDiff(a, b, at = '') {
  if (isDeepStrictEqual(a, b)) return null;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) {
    return `${at || '/'}: ${JSON.stringify(a)?.slice(0, 80)} vs ${JSON.stringify(b)?.slice(0, 80)}`;
  }
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])];
  for (const k of keys) {
    const d = firstDiff(a[k], b[k], `${at}/${k}`);
    if (d) return d;
  }
  return `${at || '/'}: differs`;
}

async function check(u) {
  const t0 = Date.now();
  const res = await fetch(`${BASE}${u.url}`, { method: u.expect === 'head' ? 'HEAD' : 'GET', redirect: 'manual', headers: HEADERS });
  const base = { kind: u.kind, url: u.url, status: res.status, ms: Date.now() - t0 };
  if (u.expect === 404) return { ...base, ok: res.status === 404 };
  if (u.expect === 'drifted') {
    if (res.status === 200) await res.arrayBuffer();
    return { ...base, ok: res.status === 200 || res.status === 404, diff: 'graph_files frozen: not compared' };
  }
  if (u.expect === 'head') return { ...base, ok: res.status === 200 && !(await res.text()) };
  if (u.expect === 'redirect') {
    const location = res.headers.get('Location');
    return { ...base, ok: res.status === 301 && location === u.location, location };
  }
  if (u.expect === 'bulk') {
    const location = res.headers.get('Location') || '';
    const ok = res.status === 200 || (res.status === 301 && location.startsWith('https://data.civgraph.net/downloads/'));
    if (res.status === 200) await res.arrayBuffer();
    return { ...base, ok, location };
  }
  if (res.status !== 200) return { ...base, ok: false, diff: `status ${res.status}` };
  const got = dropGeneratedAt(await res.json());
  const want = dropGeneratedAt(JSON.parse(readFileSync(u.file, 'utf8')));
  const diff = firstDiff(got, want);
  return { ...base, ok: !diff, ...(diff ? { diff } : {}) };
}

const urls = plan();
const results = [];
let next = 0;
async function worker() {
  while (next < urls.length) {
    const u = urls[next++];
    try { results.push(await check(u)); } catch (error) { results.push({ kind: u.kind, url: u.url, ok: false, diff: String(error.message || error) }); }
    if (DELAY) await new Promise((r) => setTimeout(r, DELAY));
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));

const byKind = new Map();
for (const r of results) {
  const k = byKind.get(r.kind) || { urls: 0, ok: 0 };
  k.urls += 1;
  if (r.ok) k.ok += 1;
  byKind.set(r.kind, k);
}
for (const [kind, k] of [...byKind].sort()) console.log(`${k.ok === k.urls ? 'ok  ' : 'FAIL'} ${kind.padEnd(58)} ${k.ok}/${k.urls}`);
const failed = results.filter((r) => !r.ok);
for (const r of failed.slice(0, 20)) console.log(`  ${r.url} ${r.status ?? ''} ${r.diff || r.location || ''}`);
mkdirSync(path.dirname(OUT), { recursive: true });
writeFileSync(OUT, `${JSON.stringify({ base: BASE, at: new Date().toISOString(), urls: results.length, failed: failed.length, kinds: Object.fromEntries(byKind), results }, null, 1)}\n`);
console.log(`${results.length} URLs, ${byKind.size} kinds, ${failed.length} failed (report: ${path.relative(REPO_ROOT, OUT)})`);
process.exit(failed.length ? 1 : 0);
