#!/usr/bin/env node
/**
 * Harvest the Oireachtas full text that the API only points at.
 *
 * harvest-oireachtas-opendata.mjs takes every endpoint api.oireachtas.ie
 * declares, and that harvest is complete against its own surface. But the API
 * returns metadata: each of the 26,415 debate records carries
 *
 *   formats.xml.uri -> https://data.oireachtas.ie/akn/ie/debateRecord/...main.xml
 *
 * and each bill carries versions[].formats.{pdf,xml}.uri. The transcripts and
 * bill texts live on data.oireachtas.ie, a different host. So the API harvest
 * holds 761,904 debate-section descriptors -- dates, chambers, speakers,
 * section titles -- and not one word of what was actually said.
 *
 * This fetches the documents themselves. Sampled at ~774 KB per debate, the
 * debate corpus alone is roughly 13 GB, several times the size of the metadata
 * harvest. Check disk before running.
 *
 * The completeness rule is the same as the metadata harvester's: every record
 * that advertises a URI must end with a file, and a URI that cannot be fetched
 * is a hard failure, never a logged warning. A partial full-text corpus that
 * reports success is worse than no corpus, because the gaps are invisible at
 * the point of use.
 *
 * Usage:
 *   node scripts/harvest-oireachtas-fulltext.mjs --meta <metadata-dir> --out <dir>
 *        [--concurrency 6] [--kind all|debates|legislation] [--dry]
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, statSync } from 'node:fs';
import path from 'node:path';

const UA = 'civgraph-opendata-harvest/1.0 (+https://civgraph.net; contact via repo)';

const args = process.argv.slice(2);
const argVal = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const META = argVal('meta', null);
const OUT = argVal('out', null);
const CONCURRENCY = Math.max(1, Number(argVal('concurrency', 6)));
const KIND = argVal('kind', 'all');
const DRY = args.includes('--dry');
if (!META || !OUT) {
  console.error('Usage: node scripts/harvest-oireachtas-fulltext.mjs --meta <metadata-dir> --out <dir> [--concurrency 6] [--kind all|debates|legislation]');
  process.exit(2);
}

const stats = { fetched: 0, cached: 0, failed: 0, bytes: 0 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Mirror the remote path under OUT rather than hashing the URI. The Akoma Ntoso
 * paths are already a meaningful hierarchy (chamber / date / kind), so keeping
 * them makes the corpus navigable and makes it obvious what is missing.
 */
function destFor(uri) {
  const u = new URL(uri);
  const rel = decodeURIComponent(u.pathname).replace(/^\/+/, '').replace(/[<>:"|?*]/g, '_');
  const f = path.join(OUT, u.hostname, rel);
  mkdirSync(path.dirname(f), { recursive: true });
  return f;
}

async function fetchDoc(uri) {
  const f = destFor(uri);
  // A zero-byte file is a previous run interrupted mid-write, not a cache hit.
  if (existsSync(f) && statSync(f).size > 0) { stats.cached += 1; return { ok: true, cached: true }; }
  if (DRY) return { ok: true, cached: false };

  for (let a = 0; a < 4; a += 1) {
    try {
      const res = await fetch(uri, { headers: { 'User-Agent': UA }, redirect: 'follow' });
      if (res.status === 429 || res.status >= 500) { await sleep(1500 * (a + 1)); continue; }
      if (!res.ok) return { ok: false, status: res.status, uri };
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length === 0) return { ok: false, status: 'empty', uri };
      writeFileSync(f, buf);
      stats.fetched += 1;
      stats.bytes += buf.length;
      return { ok: true, cached: false };
    } catch (e) { await sleep(1200 * (a + 1)); }
  }
  return { ok: false, status: 'network', uri };
}

async function pool(items, worker) {
  let i = 0;
  const out = [];
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length || 1) }, async () => {
    while (i < items.length) { const idx = i; i += 1; out[idx] = await worker(items[idx], idx); }
  }));
  return out;
}

const readRecords = (dir) => {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.json')) continue;
    try { out.push(...(JSON.parse(readFileSync(path.join(dir, f), 'utf8')).results || [])); } catch { /* skip */ }
  }
  return out;
};

console.log('Oireachtas full-text harvest');
console.log(`  metadata    : ${META}`);
console.log(`  output      : ${OUT}`);
console.log(`  concurrency : ${CONCURRENCY}`);
console.log(`  kind        : ${KIND}${DRY ? ' (dry run)' : ''}\n`);

/** Collect every document URI the metadata advertises, deduplicated. */
const targets = new Map();   // uri -> label

if (KIND === 'all' || KIND === 'debates') {
  const recs = readRecords(path.join(META, 'debates'));
  let advertised = 0;
  for (const r of recs) {
    const d = r.debateRecord;
    if (!d) continue;
    // The main record's XML is the full transcript. Section-level formats are
    // fragments of that same document, so taking main.xml is sufficient and
    // avoids re-fetching 761,904 overlapping sub-documents.
    const uri = d.formats && d.formats.xml && d.formats.xml.uri;
    if (uri) { targets.set(uri, 'debate'); advertised += 1; }
    for (const k of ['pdf', 'writtens_pdf']) {
      const u = d.formats && d.formats[k] && d.formats[k].uri;
      if (u) targets.set(u, `debate-${k}`);
    }
  }
  console.log(`  debates      : ${recs.length} records, ${advertised} advertise an XML transcript`);
  if (recs.length > 0 && advertised === 0) {
    console.error(`\n  FAIL: ${recs.length} debate records and not one formats.xml.uri.`);
    console.error(`  The metadata harvest was verified to carry these; an empty sweep means the`);
    console.error(`  record shape changed. Do not proceed -- you would write an empty corpus.`);
    process.exit(1);
  }
}

if (KIND === 'all' || KIND === 'legislation') {
  const recs = readRecords(path.join(META, 'legislation'));
  let advertised = 0;
  for (const r of recs) {
    const b = r.bill || r;
    for (const v of (b.versions || [])) {
      const ver = v.version || v;
      for (const k of ['pdf', 'xml']) {
        const u = ver.formats && ver.formats[k] && ver.formats[k].uri;
        if (u) { targets.set(u, `bill-${k}`); advertised += 1; }
      }
    }
    // The enacted Act, where the bill became one.
    for (const v of ((b.act && b.act.versions) || [])) {
      const ver = v.version || v;
      for (const k of ['pdf', 'xml']) {
        const u = ver.formats && ver.formats[k] && ver.formats[k].uri;
        if (u) { targets.set(u, `act-${k}`); advertised += 1; }
      }
    }
  }
  console.log(`  legislation  : ${recs.length} records, ${advertised} version documents advertised`);
}

const list = [...targets.keys()];
console.log(`\n  ${list.length} distinct documents to fetch\n`);
if (!list.length) { console.error('  Nothing to do -- no URIs found in the metadata.'); process.exit(1); }

let done = 0;
const results = await pool(list, async (uri, i) => {
  const r = await fetchDoc(uri);
  done += 1;
  if (done % 500 === 0) {
    console.log(`      ${done}/${list.length}  fetched ${stats.fetched}, cached ${stats.cached}, failed ${stats.failed}, ${(stats.bytes / 1073741824).toFixed(2)} GB`);
  }
  return r;
});

// COMPLETENESS. Re-derive from disk rather than trusting the counters: a
// document counts as held only if a non-empty file exists for it. This catches
// an interrupted run, which the in-memory tally cannot see.
const missing = [];
for (const uri of list) {
  const f = destFor(uri);
  if (!existsSync(f) || statSync(f).size === 0) missing.push(uri);
}

const failed = results.filter((r) => r && !r.ok);
console.log(`\n  fetched ${stats.fetched}, cached ${stats.cached}, ${(stats.bytes / 1073741824).toFixed(2)} GB`);
console.log(`  advertised ${list.length}, held on disk ${list.length - missing.length}, missing ${missing.length}`);

writeFileSync(path.join(OUT, '_fulltext-summary.json'), JSON.stringify({
  harvestedAt: new Date().toISOString(), advertised: list.length, missing: missing.length, ...stats,
  missingUris: missing.slice(0, 500)
}, null, 2));

if (missing.length) {
  console.error(`\n  FAIL: ${missing.length} advertised document(s) are not on disk:`);
  for (const u of missing.slice(0, 20)) console.error(`      ${u}`);
  if (missing.length > 20) console.error(`      ... and ${missing.length - 20} more (see _fulltext-summary.json)`);
  const codes = [...new Set(failed.map((r) => r.status))].join(', ');
  if (codes) console.error(`  HTTP outcomes seen: ${codes}`);
  console.error(`  Re-run to retry only these -- completed documents are cached and will be skipped.`);
  process.exit(1);
}
console.log(`\n  complete: every advertised document is on disk.`);
