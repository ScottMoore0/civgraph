#!/usr/bin/env node
/**
 * Harvest the NI Assembly operations that have NO JSON variant.
 *
 * harvest-niassembly-opendata.mjs takes the _JSON operations, which is the
 * documented surface and covers 39 of the 45 declared. But the services expose
 * 141 operations in total, and counting them exposed the gap: members declares
 * 35 operations against only 11 _JSON, which is not the 2:1 you would expect if
 * every operation had a JSON twin.
 *
 * Most of the excess is _JSONP -- the same JSON in a callback wrapper, so not a
 * gap. Seven operations have no JSON form at all, and a JSON-only harvest never
 * sees them:
 *
 *   members.GetAllCurrentMinisters                            no parameters
 *   members.GetAllCurrentCommitteeChairs                      no parameters
 *   plenary.GetCommitteeAgendaItemsMeetingDate                meetingDate
 *   plenary.GetCommitteeAgendaItemsCommitteeMeetingDate       meetingDate, organisationId
 *   plenary.GetCommitteeAgendaItemsCommitteeMeetingId         eventId
 *   questions.GetWrittenAnswerHtml                            documentId
 *   questions.GetWrittenAnswerOpenXml                         documentId
 *
 * Committee business is the substantive find. Committees are where most NI
 * Assembly scrutiny happens and none of it appears in the JSON harvest.
 *
 * Output is the raw XML exactly as served. No parsing, no normalisation: the
 * bytes on disk are what the service returned, so a downstream parser bug can
 * never be mistaken for missing data, and re-parsing costs nothing.
 *
 * Usage:
 *   node scripts/harvest-niassembly-xml-only.mjs --out <dir>
 *        [--concurrency 6] [--phase all|committees|answers] [--dry]
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, statSync } from 'node:fs';
import path from 'node:path';

const BASE = 'http://data.niassembly.gov.uk';
const UA = 'civgraph-opendata-harvest/1.0 (+https://civgraph.net; contact via repo)';

const args = process.argv.slice(2);
const argVal = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const OUT = argVal('out', null);
const CONCURRENCY = Math.max(1, Number(argVal('concurrency', 6)));
const PHASE = argVal('phase', 'all');
const DRY = args.includes('--dry');
if (!OUT) { console.error('Usage: node scripts/harvest-niassembly-xml-only.mjs --out <dir> [--concurrency 6] [--phase all|committees|answers]'); process.exit(2); }

const stats = { fetched: 0, cached: 0, empty: 0, failed: 0, bytes: 0 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function outPath(service, op, key) {
  const dir = path.join(OUT, service, op);
  mkdirSync(dir, { recursive: true });
  return path.join(dir, `${String(key).replace(/[^A-Za-z0-9_.-]/g, '_')}.xml`);
}

/** Fetch one operation and write the raw XML. Returns the text, or null. */
async function fetchXml(service, op, params = {}, key = 'all') {
  const f = outPath(service, op, key);
  if (existsSync(f)) {
    stats.cached += 1;
    try { return readFileSync(f, 'utf8'); } catch { return null; }
  }
  if (DRY) return null;

  const qs = new URLSearchParams(params).toString();
  const url = `${BASE}/${service}.asmx/${op}${qs ? `?${qs}` : ''}`;

  for (let a = 0; a < 4; a += 1) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/xml' } });
      // 500 here is usually a bad signature, not a transient fault -- the
      // service answers "Missing parameter: startDate" with a 500. Retrying a
      // wrong signature four times just wastes time, so surface the body.
      if (res.status === 500) {
        const body = (await res.text()).slice(0, 120).replace(/\s+/g, ' ');
        if (/Missing parameter|not a valid|cannot be converted/i.test(body)) {
          console.error(`  SIGNATURE  ${service}.${op} ${qs} -> ${body}`);
          stats.failed += 1;
          return null;
        }
        await sleep(1200 * (a + 1)); continue;
      }
      if (res.status === 429 || res.status > 500) { await sleep(1500 * (a + 1)); continue; }
      if (!res.ok) { stats.failed += 1; return null; }

      const text = await res.text();
      stats.fetched += 1;
      stats.bytes += text.length;
      writeFileSync(f, text);
      return text;
    } catch { await sleep(1200 * (a + 1)); }
  }
  stats.failed += 1;
  return null;
}

async function pool(items, worker) {
  let i = 0;
  const out = [];
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length || 1) }, async () => {
    while (i < items.length) { const idx = i; i += 1; out[idx] = await worker(items[idx], idx); }
  }));
  return out;
}

// Count repeated elements without a full XML parse. Deliberately crude: this is
// only ever used to answer "did anything come back", never to extract data.
const countTag = (xml, tag) => xml ? (xml.match(new RegExp(`<${tag}[\\s>]`, 'g')) || []).length : 0;
const isEmptyDoc = (xml) => !xml || /^\s*<\?xml[^>]*\?>\s*<\w+\s*\/>\s*$/.test(xml) || xml.length < 120;

console.log('NI Assembly XML-only harvest');
console.log(`  output      : ${OUT}`);
console.log(`  concurrency : ${CONCURRENCY}`);
console.log(`  phase       : ${PHASE}${DRY ? ' (dry run)' : ''}\n`);

// ---- Phase 1: the two parameterless operations ------------------------------
if (PHASE === 'all' || PHASE === 'committees') {
  for (const [svc, op, tag] of [
    ['members', 'GetAllCurrentMinisters', 'Minister'],
    ['members', 'GetAllCurrentCommitteeChairs', 'Committee']
  ]) {
    const xml = await fetchXml(svc, op);
    const n = countTag(xml, tag);
    console.log(`  ${String(n).padStart(7)} <${tag}>  ${svc}.${op}`);
    if (!xml || isEmptyDoc(xml)) {
      console.error(`\n  FAIL: ${svc}.${op} returned nothing. It takes no parameters, so there is no`);
      console.error(`  signature to get wrong -- an empty response means the service changed.`);
      process.exit(1);
    }
  }
}

// ---- Phase 2: committee agenda items ----------------------------------------
// The date-keyed operation is the enumerable entry point: it takes a bare date
// and returns every committee meeting on it. Sweeping all dates since the
// Assembly first sat is exhaustive by construction -- no committee list needed,
// so historical and dissolved committees are covered as well as current ones.
//
// The other two operations are narrower keys onto the same data. Rather than a
// blind cross product of dates x committees (millions of mostly-empty calls),
// they are driven by the date sweep's own output, which is both complete for
// what exists and far cheaper.
if (PHASE === 'all' || PHASE === 'committees') {
  const today = new Date().toISOString().slice(0, 10);
  const dates = [];
  for (let d = new Date('1998-07-01'); d.toISOString().slice(0, 10) <= today; d.setUTCDate(d.getUTCDate() + 1)) {
    const iso = d.toISOString().slice(0, 10);
    const dow = new Date(iso).getUTCDay();
    if (dow !== 0 && dow !== 6) dates.push(iso);   // committees do not sit at weekends
  }
  console.log(`\n  PHASE 2a — committee agenda items by date: ${dates.length} weekdays 1998-07-01..${today}`);

  let withItems = 0;
  const sweep = await pool(dates, async (d, i) => {
    const xml = await fetchXml('plenary', 'GetCommitteeAgendaItemsMeetingDate', { meetingDate: d }, d);
    if (countTag(xml, 'EventId') > 0) withItems += 1;
    if ((i + 1) % 2000 === 0) console.log(`      ${i + 1}/${dates.length} (${stats.fetched} fetched, ${stats.cached} cached, ${withItems} with meetings)`);
    return xml;
  });
  console.log(`  ${String(withItems).padStart(7)} dates with committee meetings`);
  if (dates.length > 0 && withItems === 0) {
    console.error(`\n  FAIL: not one of ${dates.length} weekdays returned a committee meeting.`);
    console.error(`  Verified working for meetingDate=2015-06-10 (25 KB, <ItemList><Committee><EventId>),`);
    console.error(`  so a total blank is a changed signature, not two decades without committees.`);
    process.exit(1);
  }

  // EventIds and organisationIds, harvested from what the sweep actually returned.
  const eventIds = new Set();
  const pairs = new Set();
  for (let i = 0; i < sweep.length; i += 1) {
    const xml = sweep[i];
    if (!xml) continue;
    for (const m of xml.matchAll(/<EventId>([^<]+)<\/EventId>/g)) eventIds.add(m[1].trim());
    for (const m of xml.matchAll(/<OrganisationId>([^<]+)<\/OrganisationId>/g)) pairs.add(`${dates[i]}|${m[1].trim()}`);
  }
  console.log(`\n  PHASE 2b — by event id: ${eventIds.size} distinct events`);
  if (eventIds.size > 0) {
    const ev = await pool([...eventIds], (id) => fetchXml('plenary', 'GetCommitteeAgendaItemsCommitteeMeetingId', { eventId: id }, id));
    const nonEmpty = ev.filter((x) => !isEmptyDoc(x)).length;
    console.log(`  ${String(nonEmpty).padStart(7)} events returned content`);
    if (nonEmpty === 0) {
      console.error(`\n  FAIL: ${eventIds.size} event ids all returned empty. The ids came from the`);
      console.error(`  service's own output, so they cannot be wrong -- check the parameter name.`);
      process.exit(1);
    }
  }

  console.log(`\n  PHASE 2c — by date and committee: ${pairs.size} observed date/committee pairs`);
  if (pairs.size > 0) {
    const pr = await pool([...pairs], (p) => {
      const [d, org] = p.split('|');
      return fetchXml('plenary', 'GetCommitteeAgendaItemsCommitteeMeetingDate', { meetingDate: d, organisationId: org }, `${d}_${org}`);
    });
    const nonEmpty = pr.filter((x) => !isEmptyDoc(x)).length;
    console.log(`  ${String(nonEmpty).padStart(7)} pairs returned content`);
  }
}

// ---- Phase 3: written answers as HTML and OpenXml ---------------------------
// The JSON harvest already holds the answer text. These are the formatted
// renderings, and the reason to take them is tables: NI written answers
// routinely carry statistical tables, and a plain-text field flattens them into
// unusable runs of numbers. The OpenXml form is a Word document and preserves
// the table structure.
if (PHASE === 'all' || PHASE === 'answers') {
  const qdir = path.join(OUT, '..', 'niassembly-opendata', 'questions');
  const src = existsSync(qdir) ? qdir : argVal('questions', null);
  if (!src || !existsSync(src)) {
    console.error(`\n  Cannot locate the JSON questions harvest (looked in ${qdir}).`);
    console.error(`  Pass --questions <dir> pointing at <harvest>/questions.`);
    process.exit(2);
  }

  const rec = (j) => {
    const t = Object.values(j)[0];
    if (Array.isArray(t)) return t;
    const i = t && typeof t === 'object' ? Object.values(t)[0] : null;
    return Array.isArray(i) ? i : (i ? [i] : []);
  };

  // Only questions answered in writing. Oral answers have no written-answer
  // document, so asking for one is a guaranteed empty response.
  const ids = new Set();
  for (const op of readdirSync(src)) {
    if (!/Written/i.test(op)) continue;
    const d = path.join(src, op);
    if (!statSync(d).isDirectory()) continue;
    for (const f of readdirSync(d)) {
      try {
        for (const r of rec(JSON.parse(readFileSync(path.join(d, f), 'utf8')))) {
          const k = Object.keys(r).find((x) => x.toLowerCase() === 'documentid');
          if (k && r[k]) ids.add(String(r[k]));
        }
      } catch { /* a malformed cache file is not a reason to abandon the sweep */ }
    }
  }
  const idList = [...ids];
  console.log(`\n  PHASE 3 — written answers: ${idList.length} document ids`);

  for (const op of ['GetWrittenAnswerHtml', 'GetWrittenAnswerOpenXml']) {
    let done = 0; let nonEmpty = 0;
    await pool(idList, async (id) => {
      const xml = await fetchXml('questions', op, { documentId: id }, id);
      if (!isEmptyDoc(xml)) nonEmpty += 1;
      done += 1;
      if (done % 10000 === 0) console.log(`      ${op} ${done}/${idList.length} (${stats.fetched} fetched, ${stats.cached} cached, ${stats.failed} failed)`);
    });
    console.log(`  ${String(nonEmpty).padStart(7)} non-empty  questions.${op}`);
    if (idList.length > 0 && nonEmpty === 0) {
      console.error(`\n  FAIL: questions.${op} returned nothing across ${idList.length} documents.`);
      process.exit(1);
    }
  }
}

console.log(`\n  fetched ${stats.fetched}, cached ${stats.cached}, failed ${stats.failed}`);
console.log(`  bytes: ${(stats.bytes / 1024 / 1024).toFixed(1)} MB`);
if (stats.failed) { console.error(`\n  ${stats.failed} failure(s) -- see SIGNATURE lines above.`); process.exit(1); }
