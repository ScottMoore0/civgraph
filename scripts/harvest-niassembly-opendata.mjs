#!/usr/bin/env node
/**
 * Harvest the Northern Ireland Assembly Open Data web services.
 *
 *   https://data.niassembly.gov.uk  --  Open Government Licence
 *   "a worldwide, royalty-free, perpetual, non-exclusive licence to use the
 *    Information", per https://data.niassembly.gov.uk/licence.aspx
 *
 * Five ASMX services expose 141 operations; 45 have _JSON variants, of which 15
 * take no parameters and 30 are keyed by an id or a date range. The no-parameter
 * calls are therefore the seed layer: constituencies, parties, departments,
 * members and Hansard reports supply the ids that unlock everything else.
 *
 * Behaviour worth knowing:
 *   - Resumable. A response already on disk is not re-fetched, so an interrupted
 *     run costs nothing and the service is not asked twice for the same thing.
 *   - Concurrent with backoff on 429/5xx. Measured 2026-08-07 against the live
 *     service: no throttling appeared at any level up to 16 parallel requests,
 *     but latency inflated steadily (p50 52ms at c=1, 152ms at c=8, 195ms at
 *     c=16), which is the server queueing. Throughput gains flatten well before
 *     that -- c=4 gives 50 req/s, c=16 only 74. The default of 5 sits just past
 *     the knee: ~52 req/s, p95 under 200ms, and 211k calls in about 1.2 hours
 *     rather than 23.5 at the old 400ms serial default. Raising it further buys
 *     minutes and costs a shared public service real capacity.
 *   - Output root is a parameter, never a hardcoded path. See
 *     validate-local-paths.mjs for why that rule exists here.
 *
 * Usage:
 *   node scripts/harvest-niassembly-opendata.mjs --out <dir> [--phase seed|all]
 *                                                [--delay 400] [--dry]
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const BASE = 'https://data.niassembly.gov.uk';
const UA = 'civgraph-opendata-harvest/1.0 (+https://civgraph.net; contact via repo)';

const args = process.argv.slice(2);
const argVal = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const OUT = argVal('out', null);
const PHASE = argVal('phase', 'seed');
const DELAY = Number(argVal('delay', 0));
const CONCURRENCY = Math.max(1, Number(argVal('concurrency', 5)));
const DRY = args.includes('--dry');

// Run jobs through a fixed-size worker pool. Each worker calls fetchOp, which
// already caches, retries and backs off, so a pool member that hits a 429 slows
// only itself rather than the whole run.
async function pool(items, worker) {
  let i = 0;
  const out = [];
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length || 1) }, async () => {
    while (i < items.length) {
      const idx = i; i += 1;
      out[idx] = await worker(items[idx], idx);
    }
  }));
  return out;
}

if (!OUT) {
  console.error('Usage: node scripts/harvest-niassembly-opendata.mjs --out <dir> [--phase seed|all] [--delay ms]');
  process.exit(2);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stats = { fetched: 0, cached: 0, empty: 0, failed: 0, bytes: 0 };

// The 15 operations that take no parameters.
const SEED_OPS = [
  ['members', 'GetAllConstituencies_JSON'],
  ['members', 'GetAllCurrentMembers_JSON'],
  ['members', 'GetAllMemberContactDetails_JSON'],
  ['members', 'GetAllMemberRoles_JSON'],
  ['members', 'GetAllMembers_JSON'],
  ['organisations', 'GetAllPartyGroupsListCurrent_JSON'],
  ['organisations', 'GetCommitteesListCurrent_AdHoc_JSON'],
  ['organisations', 'GetCommitteesListCurrent_Other_JSON'],
  ['organisations', 'GetCommitteesListCurrent_Standing_JSON'],
  ['organisations', 'GetCommitteesListCurrent_Statutory_JSON'],
  ['organisations', 'GetDepartmentListCurrent_JSON'],
  ['organisations', 'GetOrganisationListCurrent_JSON'],
  ['organisations', 'GetPartiesListCurrent_JSON'],
  ['plenary', 'GetNoDayNamedMotions_JSON'],
  ['hansard', 'GetAllHansardReports_JSON']
];

function outPath(service, op, key) {
  const dir = path.join(OUT, service, op);
  mkdirSync(dir, { recursive: true });
  const name = key ? `${String(key).replace(/[^A-Za-z0-9_.-]/g, '_')}.json` : 'all.json';
  return path.join(dir, name);
}

async function fetchOp(service, op, params = {}, key = null) {
  const file = outPath(service, op, key);
  if (existsSync(file)) { stats.cached += 1; try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return null; } }
  if (DRY) { console.log(`  [dry] ${service}.${op} ${key ?? ''}`); return null; }

  const qs = new URLSearchParams(params).toString();
  const url = `${BASE}/${service}.asmx/${op}${qs ? `?${qs}` : ''}`;

  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
      if (res.status === 429 || res.status >= 500) { await sleep(2000 * (attempt + 1)); continue; }
      if (!res.ok) { stats.failed += 1; return null; }
      const text = await res.text();
      stats.bytes += text.length;
      let json;
      try { json = JSON.parse(text); } catch { stats.failed += 1; return null; }
      writeFileSync(file, JSON.stringify(json, null, 1));
      stats.fetched += 1;
      await sleep(DELAY);
      return json;
    } catch { await sleep(1500 * (attempt + 1)); }
  }
  stats.failed += 1;
  return null;
}

// The services wrap payloads inconsistently; unwrap to an array of records.
function records(json) {
  if (!json || typeof json !== 'object') return [];
  const top = Object.values(json)[0];
  if (Array.isArray(top)) return top;
  if (top && typeof top === 'object') {
    const inner = Object.values(top)[0];
    if (Array.isArray(inner)) return inner;
    if (inner && typeof inner === 'object') return [inner];
  }
  return [];
}

console.log(`NI Assembly Open Data harvest`);
console.log(`  output : ${OUT}`);
console.log(`  phase  : ${PHASE}${DRY ? ' (dry run)' : ''}`);
console.log(`  delay  : ${DELAY}ms\n`);

const seeds = {};
for (const [svc, op] of SEED_OPS) {
  const json = await fetchOp(svc, op);
  const n = records(json).length;
  if (json && n === 0) stats.empty += 1;
  seeds[op] = records(json);
  console.log(`  ${String(n).padStart(6)}  ${svc}.${op}`);
}

writeFileSync(path.join(OUT, '_seed-summary.json'), JSON.stringify(
  Object.fromEntries(Object.entries(seeds).map(([k, v]) => [k, v.length])), null, 2
));

if (PHASE !== 'seed') {
  const personIds = [...new Set(seeds.GetAllMembers_JSON.map((r) => r.PersonId).filter(Boolean))];
  const constituencyIds = [...new Set(seeds.GetAllConstituencies_JSON.map((r) => r.ConstituencyId).filter(Boolean))];
  const partyIds = [...new Set(seeds.GetPartiesListCurrent_JSON.map((r) => r.OrganisationId).filter(Boolean))];
  const departmentIds = [...new Set(seeds.GetDepartmentListCurrent_JSON.map((r) => r.OrganisationId).filter(Boolean))];
  const reportIds = [...new Set(seeds.GetAllHansardReports_JSON.map((r) => r.ReportDocId).filter(Boolean))];

  console.log(`\n  ids: ${personIds.length} persons, ${constituencyIds.length} constituencies, ${partyIds.length} parties, ${departmentIds.length} departments, ${reportIds.length} hansard reports`);

  const idJobs = [
    ['members', 'GetMemberContactDetailsByPersonId_JSON', 'personId', personIds],
    ['members', 'GetMemberRolesByPersonId_JSON', 'personId', personIds],
    ['questions', 'GetQuestionsByMember_JSON', 'personId', personIds],
    ['members', 'GetAllCurrentMembersByGivenConstituencyId_JSON', 'constituencyId', constituencyIds],
    ['members', 'GetAllCurrentMembersByGivenPartyId_JSON', 'partyId', partyIds],
    ['questions', 'GetQuestionsByDepartment_JSON', 'departmentId', departmentIds],
    ['hansard', 'GetHansardComponentsByReportId_JSON', 'reportId', reportIds]
  ];

  for (const [svc, op, pname, ids] of idJobs) {
    const res = await pool(ids, (id) => fetchOp(svc, op, { [pname]: id }, id));
    const n = res.reduce((a, j) => a + records(j).length, 0);
    console.log(`  ${String(n).padStart(7)} records  ${svc}.${op}  (${ids.length} calls)`);
    // Non-empty in, non-empty out. Calling an operation for every known id and
    // getting nothing back is a bug in this script far more often than it is a
    // true empty result.
    if (ids.length > 0 && n === 0) {
      console.error(`\n  FAIL: ${svc}.${op} was called for ${ids.length} ids and returned no records at all.`);
      console.error(`  Check the parameter name ('${pname}') and the id field against the service's ?op= page.`);
      process.exit(1);
    }
  }

  // Date-keyed operations. Questions exist from 2007; plenary business from 1998.
  // Yearly windows keep each response a sane size and make the cache granular.
  const thisYear = new Date().getFullYear();
  const years = (from) => Array.from({ length: thisYear - from + 1 }, (_, i) => from + i);
  const dateJobs = [
    ['questions', 'GetQuestionsForOralAnswer_TabledInRange_JSON', 2007],
    ['questions', 'GetQuestionsForOralAnswer_AnsweredInRange_JSON', 2007],
    ['questions', 'GetQuestionsForWrittenAnswer_TabledInRange_JSON', 2007],
    ['questions', 'GetQuestionsForWrittenAnswer_AnsweredInRange_JSON', 2007],
    ['plenary', 'GetPlenaryItemsPlenaryDate_JSON', 1998],
    ['plenary', 'GetPlenaryItemsTabledDate_JSON', 1998],
    ['plenary', 'GetVotesOnDivision_JSON', 1998],
    ['plenary', 'GetBusinessDiary_JSON', 1998]
  ];

  for (const [svc, op, from] of dateJobs) {
    const ys = years(from);
    const res = await pool(ys, (y) => fetchOp(svc, op, { startDate: `${y}-01-01`, endDate: `${y}-12-31` }, String(y)));
    const n = res.reduce((a, j) => a + records(j).length, 0);
    console.log(`  ${String(n).padStart(7)} records  ${svc}.${op}  (${ys.length} yearly windows)`);
  }
}

// ---- Phase 3: per-document detail -------------------------------------------
// Divisions and votes come first deliberately: for a boundaries and elections
// site, how each member voted in each division is the highest-value data here,
// and it is a few thousand calls rather than a few hundred thousand.
if (PHASE === 'detail' || PHASE === 'all') {
  const idsFrom = (svc, op, field) => {
    const dir = path.join(OUT, svc, op);
    if (!existsSync(dir)) return [];
    const out = new Set();
    for (const f of readdirSync(dir)) {
      try {
        for (const r of records(JSON.parse(readFileSync(path.join(dir, f), 'utf8')))) {
          // Case-insensitive on purpose. The services are not consistent with
          // each other: questions return DocumentId, plenary returns DocumentID.
          // An exact-case lookup silently found zero plenary ids, so phase 3a
          // fetched nothing at all while reporting success.
          const k = Object.keys(r).find((x) => x.toLowerCase() === field.toLowerCase());
          const v = k ? r[k] : undefined;
          if (v) out.add(String(v));
        }
      } catch {}
    }
    return [...out];
  };

  // All three sources, not two. GetPlenaryItemsTabledDate holds 4,307 documents
  // the other two never mention -- items tabled that never reached a plenary
  // date, which is precisely the set a "what was proposed but not taken" query
  // would want. Drawing from votes + plenaryDate alone silently lost them.
  // COMPLETENESS CHECK.
  //
  // Three silent-success failures happened while building this harvester, all
  // the same shape: the code could not tell "there is no data" from "my
  // extraction found nothing", so a broken run printed a plausible number and
  // continued.
  //
  //   1. Field-name case. questions return DocumentId, plenary returns
  //      DocumentID. An exact-case lookup found 0 plenary ids, so all eight
  //      plenary detail operations fetched nothing and logged "0 records".
  //   2. Missing source. Ids were unioned from 2 of the 3 plenary list
  //      operations, silently dropping 4,307 documents (24%) -- the items
  //      tabled but never reaching a plenary date.
  //   3. Cap truncation, in the sibling Oireachtas harvester.
  //
  // So: every source that should contribute is named, its contribution is
  // printed, and a source yielding nothing while its siblings yield data is a
  // hard failure. A dead source is nearly always a field-name mismatch, not an
  // empty dataset -- and that distinction is exactly what was missed before.
  function unionIds(sources, field) {
    const union = new Set();
    const contributions = [];
    for (const [svc, op] of sources) {
      const got = idsFrom(svc, op, field);
      contributions.push([`${svc}.${op}`, got.length]);
      for (const v of got) union.add(v);
    }
    console.log(`\n  id union on '${field}': ${union.size} unique`);
    for (const [name, n] of contributions) {
      console.log(`      ${String(n).padStart(8)}  ${name}${n === 0 ? '   <-- CONTRIBUTES NOTHING' : ''}`);
    }
    // Two distinct failures, and the second one caught this check itself.
    //
    // (a) SOME sources dead while siblings produce ids -> partial id set.
    // (b) ALL sources dead -> union is empty. An earlier version of this check
    //     only tested case (a) ("dead.length && union.size > 0"), so when the
    //     field-name bug was reintroduced deliberately, every source returned 0,
    //     the union was 0, the condition was false, and the run sailed through
    //     to "0 records" across all eight operations -- reproducing exactly the
    //     bug this check exists to prevent. A guard that misses the total-failure
    //     case is worse than none, because it looks like coverage.
    const dead = contributions.filter(([, n]) => n === 0);

    if (union.size === 0) {
      // Distinguish "sources hold no records" from "records exist but no ids
      // were extracted". Only the latter is a bug, and it is the common one.
      const anyRecords = sources.some(([svc, op]) => {
        const dir = path.join(OUT, svc, op);
        if (!existsSync(dir)) return false;
        return readdirSync(dir).some((f) => {
          try { return records(JSON.parse(readFileSync(path.join(dir, f), 'utf8'))).length > 0; } catch { return false; }
        });
      });
      if (anyRecords) {
        console.error(`\n  FAIL: no '${field}' ids extracted, yet the source files contain records.`);
        for (const [svc, op] of sources) console.error(`      ${svc}.${op}`);
        console.error(`  The records are there but the field name does not match. The NI services are`);
        console.error(`  inconsistent -- questions use DocumentId, plenary uses DocumentID -- so check`);
        console.error(`  the actual keys before assuming the dataset is empty.`);
        process.exit(1);
      }
    }

    if (dead.length && union.size > 0) {
      console.error(`\n  FAIL: ${dead.length} of ${sources.length} sources contributed no '${field}' while others did.`);
      for (const [name] of dead) console.error(`      ${name}`);
      console.error(`  A source yielding nothing beside siblings that yield data is a field-name`);
      console.error(`  mismatch, not an empty dataset. Dropping it silently lost 4,307 documents once.`);
      console.error(`  Refusing to continue -- a partial id set produces a harvest that looks complete.`);
      process.exit(1);
    }
    return [...union];
  }

  const divisionIds = unionIds([
    ['plenary', 'GetVotesOnDivision_JSON'],
    ['plenary', 'GetPlenaryItemsPlenaryDate_JSON'],
    ['plenary', 'GetPlenaryItemsTabledDate_JSON']
  ], 'DocumentId');
  console.log(`\n  PHASE 3a — divisions and votes: ${divisionIds.length} document ids`);

  for (const op of ['GetDivisionResult_JSON', 'GetDivisionMemberVoting_JSON', 'GetPlenaryDetails_JSON',
    'GetPlenaryTablers_JSON', 'GetPlenaryAddressees_JSON', 'GetMotionAmendments_JSON',
    'GetMotionBill_JSON', 'GetMotionPetitionOfConcern_JSON']) {
    const res = await pool(divisionIds, (id) => fetchOp('plenary', op, { documentid: id }, id));
    const n = res.reduce((a, j) => a + records(j).length, 0);
    console.log(`  ${String(n).padStart(8)} records  plenary.${op}`);
    if (divisionIds.length > 0 && n === 0) {
      console.error(`\n  FAIL: plenary.${op} returned nothing across ${divisionIds.length} documents.`);
      console.error(`  Every one of these eight operations previously logged "0 records" for exactly`);
      console.error(`  this reason -- the id extraction was silently empty. Do not treat it as normal.`);
      process.exit(1);
    }
  }

  const questionIds = unionIds([
    ['questions', 'GetQuestionsByMember_JSON'],
    ['questions', 'GetQuestionsByDepartment_JSON'],
    ['questions', 'GetQuestionsForOralAnswer_TabledInRange_JSON'],
    ['questions', 'GetQuestionsForOralAnswer_AnsweredInRange_JSON'],
    ['questions', 'GetQuestionsForWrittenAnswer_TabledInRange_JSON'],
    ['questions', 'GetQuestionsForWrittenAnswer_AnsweredInRange_JSON']
  ], 'DocumentId');
  console.log(`\n  PHASE 3b — question details: ${questionIds.length} document ids`);
  console.log(`  (the answer text lives only here; list responses carry the question alone)`);

  let done = 0;
  const res = await pool(questionIds, async (id) => {
    const j = await fetchOp('questions', 'GetQuestionDetails_JSON', { documentId: id }, id);
    done += 1;
    if (done % 5000 === 0) console.log(`      ${done}/${questionIds.length} (${stats.fetched} fetched, ${stats.cached} cached, ${stats.failed} failed)`);
    return j;
  });
  console.log(`  ${String(res.reduce((a, j) => a + records(j).length, 0)).padStart(8)} records  questions.GetQuestionDetails_JSON`);
}

console.log(`\n  fetched ${stats.fetched}, cached ${stats.cached}, empty ${stats.empty}, failed ${stats.failed}`);
console.log(`  bytes: ${(stats.bytes / 1024 / 1024).toFixed(1)} MB`);
