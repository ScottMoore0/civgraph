/**
 * One rule for "unopposed" (owner-approved 11 Nov 2026; Elections arch audit gap 3):
 * packages/core/src/unopposed.mjs decides, everywhere. A contest without votes is "returned
 * unopposed" only when the records say so; one whose votes are missing is "votes not recorded".
 *
 *   - core: contestPollStatus (a contest's candidates) and summaryPollStatus (a summary row);
 *   - the Elections app: the count sheet (lib/count.js), the overview and maps (lib/scales.js,
 *     views/map.js) read core and keep no rule of their own;
 *   - the map app: the first-past-the-post table and the NI councils view read core too
 *     (tests/unit/unopposed-map-tables.test.mjs holds the tables);
 *   - parity: over the records build, the summary-row reading agrees with the candidates' for
 *     every contest (skipped without a build).
 */
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { contestPollStatus, POLL_STATUS_TEXT, summaryPollStatus } from '../../packages/core/src/unopposed.mjs';
import { countSheet } from '../../site/apps/elections/lib/count.js';
import { areaRows } from '../../site/apps/elections/lib/scales.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const RECORDS = path.join(ROOT, 'tmp', 'records', 'civgraph-records.sqlite');

test('core: a contest is unopposed only when its candidates or its status say so', () => {
  assert.equal(contestPollStatus({ candidates: [{ status: 'Elected unopposed', firstPrefs: null }, { status: 'Elected unopposed' }] }), 'unopposed');
  assert.equal(contestPollStatus({ candidates: [{ unopposed: true, firstPrefs: 0 }] }), 'unopposed', '0 votes on an older unopposed row');
  assert.equal(contestPollStatus({ contestStatus: 'uncontested', candidates: [{ status: 'Elected' }] }), 'unopposed');
  assert.equal(contestPollStatus({ candidates: [{ status: 'Elected', firstPrefs: 5000 }, { status: 'Not elected', firstPrefs: 3000 }] }), 'polled');
  assert.equal(contestPollStatus({ validPoll: 8000, candidates: [{ status: 'Elected' }] }), 'polled');
  // Missing votes are not an unopposed return: two candidates for one seat, nothing recorded.
  assert.equal(contestPollStatus({ candidates: [{ status: 'Elected', firstPrefs: null }, { status: 'Not elected', firstPrefs: null }] }), 'not-recorded');
  assert.equal(contestPollStatus({ candidates: [{ status: 'Elected', firstPrefs: null }] }), 'not-recorded', 'one candidate with no status is not known to be unopposed');
  assert.equal(contestPollStatus({ candidates: [] }), 'not-recorded');
  assert.equal(POLL_STATUS_TEXT['not-recorded'], 'votes not recorded');
});

test('core: a summary row (no candidates) reads the same rule from its counts', () => {
  assert.equal(summaryPollStatus({ validPoll: 43248, leadingVotes: 9000, candidateCount: 9, seatsTotal: 5 }), 'polled');
  assert.equal(summaryPollStatus({ validPoll: 0, leadingVotes: 4000, candidateCount: 2, seatsTotal: 1 }), 'polled');
  assert.equal(summaryPollStatus({ validPoll: 0, leadingVotes: 0, candidateCount: 1, seatsTotal: 1 }), 'unopposed');
  assert.equal(summaryPollStatus({ validPoll: 0, leadingVotes: 0, candidateCount: 4, seatsTotal: 4 }), 'unopposed');
  // Swinford 2024: 9 candidates for 4 seats and no votes on file: the votes are missing.
  assert.equal(summaryPollStatus({ validPoll: 0, leadingVotes: 0, candidateCount: 9, seatsTotal: 4 }), 'not-recorded');
  assert.equal(summaryPollStatus({ validPoll: 0, leadingVotes: 0, candidateCount: 0, seatsTotal: 1 }), 'not-recorded', 'no candidates on file');
});

test('the count sheet: unopposed from core, missing votes are "none" (votes not recorded)', () => {
  const unopposed = countSheet([{ id: 'a', name: 'A', status: 'Elected unopposed', firstPrefs: null, elected: 1 }], { seatsTotal: 1 });
  assert.equal(unopposed.kind, 'unopposed');
  const missing = countSheet([
    { id: 'a', name: 'A', status: 'Elected', firstPrefs: null, elected: 1 },
    { id: 'b', name: 'B', status: 'Not elected', firstPrefs: null },
  ], { seatsTotal: 1 });
  assert.equal(missing.kind, 'none');
  // The app's old rule called a contest with no more candidates than seats unopposed whatever
  // its statuses said; core does not: such a contest is unopposed when the records mark it so
  // (every one in the records build is, the parity test below).
  assert.equal(countSheet([{ id: 'a', name: 'A', status: 'Elected', firstPrefs: null, elected: 1 }], { seatsTotal: 1 }).kind, 'none');
  assert.equal(countSheet([{ id: 'a', name: 'A', status: 'Elected', firstPrefs: null, elected: 1 }], { seatsTotal: 1, contestStatus: 'uncontested' }).kind, 'unopposed');
});

test('the maps: a contest with missing votes reads "votes not recorded", never "unopposed"', async () => {
  const rows = areaRows(
    { results: [
      { constituency: 'Polled', seatsTotal: 1, validPoll: 100, leadingVotes: 60, candidateCount: 2, leadingParty: 'X' },
      { constituency: 'Unopposed', seatsTotal: 1, validPoll: 0, leadingVotes: 0, candidateCount: 1, winnerParty: 'Y' },
      { constituency: 'Missing', seatsTotal: 4, validPoll: 0, leadingVotes: 0, candidateCount: 9, winnerParty: 'Z' },
    ] },
    { items: ['Polled', 'Unopposed', 'Missing'].map((name) => ({ entryKind: 'election-constituency-result', constituency: name, featureName: name, matched: true })) },
  );
  assert.deepEqual(rows.map((r) => [r.name, r.poll]), [['Polled', 'polled'], ['Unopposed', 'unopposed'], ['Missing', 'not-recorded']]);

  // The winner map's labels and table, through the view's own mapData (the records API stubbed).
  const answers = {
    summary: { results: [
      { constituency: 'Unopposed', seatsTotal: 1, validPoll: 0, leadingVotes: 0, candidateCount: 1, winnerParty: 'Y', winnerName: 'W' },
      { constituency: 'Missing', seatsTotal: 1, validPoll: 0, leadingVotes: 0, candidateCount: 3, winnerParty: 'Z', winnerName: 'V' },
    ] },
    contests: { items: ['Unopposed', 'Missing'].map((name) => ({ entryKind: 'election-constituency-result', constituency: name, featureName: name, matched: true })) },
    detail: { item: { partySummary: [] } },
  };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const view = new URL(String(url), 'http://x.test').searchParams.get('view');
    return new Response(JSON.stringify(answers[view] || {}), { status: 200 });
  };
  try {
    const { mapData } = await import('../../site/apps/elections/views/map.js');
    const data = await mapData({ key: 'body__1900-01-01', bodySlug: 'body' }, 'winner');
    assert.deepEqual(data.table, [['Unopposed', 'Y (returned unopposed)'], ['Missing', 'Z (votes not recorded)']]);
    assert.match(String(data.labels.get('MISSING')), /votes not recorded$/);
    assert.doesNotMatch(String(data.labels.get('MISSING')), /unopposed/);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('the app and the map app keep no rule of their own', () => {
  const app = path.join(ROOT, 'site', 'apps', 'elections');
  const files = ['lib/count.js', 'lib/format.js', 'lib/scales.js', 'views/election.js', 'views/compare.js', 'views/map.js'];
  for (const file of files) {
    const src = readFileSync(path.join(app, file), 'utf8');
    assert.doesNotMatch(src, /function isUnopposed|summaryUnopposed|summaryHasVotes|unopposed:\s*!\(/, `${file} keeps a rule of its own`);
    assert.doesNotMatch(src, /\/unopposed\/i\.test/, `${file} reads statuses itself`);
  }
  for (const file of ['lib/count.js', 'lib/format.js', 'lib/scales.js']) {
    assert.match(readFileSync(path.join(app, file), 'utf8'), /pkg\/core\/src\/unopposed\.mjs/, `${file} imports core's rule`);
  }
  const manager = readFileSync(path.join(ROOT, 'packages/map/app/election-manager.js'), 'utf8');
  assert.doesNotMatch(manager, /validPoll === 0 \|\|/, 'the map app: no poll is not "validPoll is 0"');
  assert.ok(readdirSync(app).length);
});

test('parity over the records build: the summary rows and the candidates agree on every contest', { skip: existsSync(RECORDS) ? false : 'no records build' }, async () => {
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(RECORDS, { readOnly: true });
  try {
    /** @type {Map<string, Array<Record<string, unknown>>>} */
    const candidates = new Map();
    for (const row of db.prepare('SELECT election_key AS k, contest_seq AS seq, status, unopposed, first_prefs AS firstPrefs, final_votes AS finalVotes FROM candidacies').iterate()) {
      const id = `${row.k}|${row.seq}`;
      if (!candidates.has(id)) candidates.set(id, []);
      candidates.get(id).push({ status: row.status, unopposed: row.unopposed === 1, firstPrefs: row.firstPrefs, finalVotes: row.finalVotes });
    }
    /** @type {Map<string, Array<{ seq: number, contestStatus: unknown }>>} */
    const contests = new Map();
    for (const row of db.prepare('SELECT election_key AS k, seq, name, meta FROM contests').iterate()) {
      const id = `${row.k}|${row.name}`;
      let meta = {};
      try { meta = JSON.parse(String(row.meta || '{}')); } catch { /* none */ }
      if (!contests.has(id)) contests.set(id, []);
      contests.get(id).push({ seq: Number(row.seq), contestStatus: meta.contestStatus ?? null });
    }
    let compared = 0;
    const differ = [];
    for (const { k, summary } of db.prepare('SELECT election_key AS k, summary FROM election_summaries').iterate()) {
      const taken = new Map();
      for (const r of JSON.parse(String(summary)).results || []) {
        const i = taken.get(r.constituency) || 0;
        taken.set(r.constituency, i + 1);
        const contest = contests.get(`${k}|${r.constituency}`)?.[i];
        if (!contest) continue;
        compared += 1;
        const fromRow = summaryPollStatus(r);
        const fromCandidates = contestPollStatus({ contestStatus: contest.contestStatus, validPoll: r.validPoll, candidates: candidates.get(`${k}|${contest.seq}`) || [] });
        if (fromRow !== fromCandidates) differ.push(`${k} ${r.constituency}: summary ${fromRow}, candidates ${fromCandidates}`);
      }
    }
    assert.ok(compared > 10000, `${compared} contests compared`);
    // Known data defects, not rule differences: 74 unopposed contests (presidential, 1922 Dail,
    // some local) whose summary row carries a vote (a marker final_votes of 1, or the electorate
    // in validPoll, Belfast North and West 1922), so the summary reads "polled". Every other
    // contest agrees. The count may only fall; any other kind of difference fails.
    assert.deepEqual(differ.filter((d) => !d.endsWith('summary polled, candidates unopposed')), []);
    assert.ok(differ.length <= 74, `${differ.length} summary rows read polled for an unopposed contest (was 74): ${differ.slice(0, 10).join('; ')}`);
  } finally {
    db.close();
  }
});
