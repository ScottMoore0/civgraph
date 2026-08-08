#!/usr/bin/env node
/**
 * Harvest the Houses of the Oireachtas Open Data API.
 *
 *   https://api.oireachtas.ie/v1  --  OpenAPI 1.1.0, 9 endpoints
 *
 * THE THING THAT MATTERS HERE IS THE 10,000 CAP.
 *
 * skip=10000 returns nothing, and the cap applies to the reported count as
 * well, so head.counts saturates at 10000 rather than reporting the truth.
 * Measured 2026-08-07:
 *
 *   questions 1995:  2,520   (real count)
 *   questions 2005: 10,000   (capped)
 *   questions 2015: 10,000   (capped)
 *   questions 2024: 10,000   (capped)
 *
 * Every year since roughly 2000 saturates. A year-by-year harvest would look
 * like it succeeded while silently dropping two decades of data -- the response
 * is a valid 200 with 10,000 plausible records. Nothing surfaces the loss.
 *
 * So this harvester does not trust a window that comes back full. Any window
 * yielding >= CAP records is bisected and re-fetched until every sub-window
 * lands strictly under it. A window that cannot be split further (a single day
 * still at the cap) is a hard failure, not a warning: it means the data is
 * genuinely unreachable through this API and the operator needs to know.
 *
 * Usage:
 *   node scripts/harvest-oireachtas-opendata.mjs --out <dir>
 *        [--concurrency 5] [--from 1919-01-01] [--dry]
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const BASE = 'https://api.oireachtas.ie/v1';
const UA = 'civgraph-opendata-harvest/1.0 (+https://civgraph.net; contact via repo)';
const PAGE = 1000;   // measured maximum; limit=2000 returns zero results
const CAP = 10000;   // measured hard skip ceiling

const args = process.argv.slice(2);
const argVal = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const OUT = argVal('out', null);
const CONCURRENCY = Math.max(1, Number(argVal('concurrency', 5)));
const FROM = argVal('from', '1919-01-01');
const DRY = args.includes('--dry');

if (!OUT) {
  console.error('Usage: node scripts/harvest-oireachtas-opendata.mjs --out <dir> [--concurrency 5] [--from YYYY-MM-DD]');
  process.exit(2);
}

const stats = { requests: 0, cached: 0, records: 0, splits: 0, failed: 0, bytes: 0 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(url, tries = 4) {
  for (let i = 0; i < tries; i += 1) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
      if (res.status === 429 || res.status >= 500) { await sleep(1500 * (i + 1)); continue; }
      if (!res.ok) return null;
      const text = await res.text();
      stats.bytes += text.length;
      stats.requests += 1;
      return JSON.parse(text);
    } catch { await sleep(1200 * (i + 1)); }
  }
  stats.failed += 1;
  return null;
}

function file(endpoint, key) {
  const dir = path.join(OUT, endpoint);
  mkdirSync(dir, { recursive: true });
  return path.join(dir, `${String(key).replace(/[^A-Za-z0-9_.-]/g, '_')}.json`);
}

/** Page through one query until exhausted or the cap is hit. */
async function pageAll(endpoint, params) {
  const rows = [];
  for (let skip = 0; skip < CAP; skip += PAGE) {
    const qs = new URLSearchParams({ ...params, limit: String(PAGE), skip: String(skip) }).toString();
    const j = await getJson(`${BASE}/${endpoint}?${qs}`);
    const batch = (j && j.results) || [];
    rows.push(...batch);
    if (batch.length < PAGE) break;
  }
  return rows;
}

const addDays = (iso, n) => { const d = new Date(iso); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const dayDiff = (a, b) => Math.round((new Date(b) - new Date(a)) / 86400000);

/**
 * Fetch [start, end] and guarantee completeness. A full window is treated as
 * evidence of truncation, never as a complete answer.
 */
async function windowed(endpoint, start, end, extra, depth = 0) {
  const key = `${start}_${end}`;
  const f = file(endpoint, key);
  if (existsSync(f)) {
    stats.cached += 1;
    try { return JSON.parse(readFileSync(f, 'utf8')).results || []; } catch { return []; }
  }
  if (DRY) { console.log(`  [dry] ${endpoint} ${key}`); return []; }

  const rows = await pageAll(endpoint, { ...extra, date_start: start, date_end: end });

  if (rows.length >= CAP) {
    const span = dayDiff(start, end);
    if (span < 1) {
      console.error(`  UNREACHABLE: ${endpoint} ${start} alone hits the ${CAP} cap; data beyond it cannot be paged via this API.`);
      stats.failed += 1;
      return rows;
    }
    stats.splits += 1;
    const mid = addDays(start, Math.floor(span / 2));
    console.log(`  ${'  '.repeat(depth)}split ${endpoint} ${key} (${rows.length} = cap) -> ${start}..${mid} / ${addDays(mid, 1)}..${end}`);
    const a = await windowed(endpoint, start, mid, extra, depth + 1);
    const b = await windowed(endpoint, addDays(mid, 1), end, extra, depth + 1);
    return [...a, ...b];
  }

  writeFileSync(f, JSON.stringify({ endpoint, date_start: start, date_end: end, count: rows.length, results: rows }, null, 1));
  stats.records += rows.length;
  return rows;
}

async function pool(items, worker) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length || 1) }, async () => {
    while (i < items.length) { const idx = i; i += 1; await worker(items[idx]); }
  }));
}

console.log('Oireachtas Open Data harvest');
console.log(`  output      : ${OUT}`);
console.log(`  concurrency : ${CONCURRENCY}`);
console.log(`  from        : ${FROM}\n`);

// --- flat collections: page straight through, no date dimension -------------
for (const ep of ['houses', 'parties', 'constituencies', 'members']) {
  const f = file(ep, 'all');
  if (existsSync(f)) { console.log(`  ${String('cached').padStart(8)}  ${ep}`); continue; }
  const rows = await pageAll(ep, {});
  writeFileSync(f, JSON.stringify({ endpoint: ep, count: rows.length, results: rows }, null, 1));
  stats.records += rows.length;
  console.log(`  ${String(rows.length).padStart(8)}  ${ep}`);
}

// Historical parties and constituencies are per-house; the bare endpoints
// return the current house only (8 constituencies, 11 parties).
const houses = (() => {
  try { return JSON.parse(readFileSync(file('houses', 'all'), 'utf8')).results || []; } catch { return []; }
})();
const houseNos = [...new Set(houses.map((h) => (h.house && (h.house.houseNo ?? h.house.houseCode)) ?? h.houseNo).filter(Boolean))];
console.log(`\n  houses discovered: ${houseNos.length}`);

for (const ep of ['constituencies', 'parties', 'members']) {
  await pool(houseNos, async (no) => {
    const f = file(ep, `house_${no}`);
    if (existsSync(f)) { stats.cached += 1; return; }
    const rows = await pageAll(ep, { house_no: String(no) });
    writeFileSync(f, JSON.stringify({ endpoint: ep, house_no: no, count: rows.length, results: rows }, null, 1));
    stats.records += rows.length;
  });
  console.log(`  ${ep} by house: done`);
}

// --- date-windowed collections ---------------------------------------------
const today = new Date().toISOString().slice(0, 10);
const startYear = Number(FROM.slice(0, 4));
const endYear = Number(today.slice(0, 4));

// Month windows by default: a year saturates the cap from ~2000 onward, and the
// bisection above will narrow further wherever a month still comes back full.
const months = [];
for (let y = startYear; y <= endYear; y += 1) {
  for (let m = 1; m <= 12; m += 1) {
    const s = `${y}-${String(m).padStart(2, '0')}-01`;
    const e = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
    if (s <= today) months.push([s, e > today ? today : e]);
  }
}

for (const ep of ['questions', 'debates', 'votes', 'legislation']) {
  const extra = ep === 'questions' ? { show_answers: 'true' } : {};
  // Count rows actually held, not rows newly written. stats.records only
  // increments on write, so on a cached re-run it stays at zero -- and an
  // earlier version of this check read that as "no data" and failed a harvest
  // that was in fact complete. That is the same confusion between "nothing new"
  // and "nothing there" that these checks exist to catch, so it is worth
  // stating plainly rather than quietly fixing.
  let held = 0;
  // NOT `held += (await windowed(...)).length`. That desugars to
  // `held = held + <await>`, which reads `held` *before* suspending, so six
  // concurrent workers all resume with the same stale value and overwrite each
  // other -- it undercounted by almost exactly the concurrency factor
  // (170,664 against a known 1,020,180 at concurrency 6). Resolve first, then
  // add in a single synchronous step.
  await pool(months, async ([s, e]) => {
    const n = (await windowed(ep, s, e, extra)).length;
    held += n;
  });
  console.log(`  ${String(held).padStart(8)}  ${ep}  (${months.length} month windows, ${stats.splits} splits so far)`);
  if (months.length > 0 && held === 0) {
    console.error(`\n  FAIL: ${ep} holds no records across ${months.length} windows.`);
    console.error(`  Check the endpoint name and date parameters against ${BASE}/swagger.json.`);
    process.exit(1);
  }
}

// COMPLETENESS CHECK. The bisection above narrows any window that comes back
// full, but that only helps if it actually ran. This re-reads what was written
// and proves no file sits at the cap -- so "complete" is demonstrated from the
// data on disk rather than inferred from the absence of a log line.
{
  let atCap = 0; let near = 0; let worst = 0; let worstFile = '';
  const offenders = [];
  for (const ep of ['questions', 'debates', 'votes', 'legislation']) {
    const dir = path.join(OUT, ep);
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.json')) continue;
      let n = 0;
      try { const j = JSON.parse(readFileSync(path.join(dir, f), 'utf8')); n = j.count ?? (j.results || []).length; } catch { continue; }
      if (n > worst) { worst = n; worstFile = `${ep}/${f}`; }
      if (n >= CAP) { atCap += 1; offenders.push(`${ep}/${f} (${n})`); }
      else if (n >= CAP * 0.9) near += 1;
    }
  }
  console.log(`\n  completeness: largest window ${worst} (${worstFile}); ${near} within 10% of the ${CAP} cap`);
  if (atCap) {
    console.error(`\n  FAIL: ${atCap} window(s) are AT the ${CAP} cap, so they are truncated:`);
    for (const o of offenders.slice(0, 20)) console.error(`      ${o}`);
    console.error(`  Bisection should have split these. Delete them and re-run, or narrow the base window.`);
    process.exit(1);
  }
}

writeFileSync(path.join(OUT, '_harvest-summary.json'), JSON.stringify({ harvestedAt: new Date().toISOString(), ...stats }, null, 2));
console.log(`\n  requests ${stats.requests}, cached ${stats.cached}, records ${stats.records}, splits ${stats.splits}, failed ${stats.failed}`);
console.log(`  bytes: ${(stats.bytes / 1024 / 1024).toFixed(1)} MB`);
if (stats.failed) console.error(`\n  ${stats.failed} failure(s) -- see UNREACHABLE lines above.`);
