/**
 * The Elections app's pure browser modules (site/apps/elections/lib/): formatting, routes, the
 * count sheet model and the SVG charts. The last test runs the count model over real contests of
 * the records build (skipped without one).
 */
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import test from 'node:test';
import {
  fmtDelta, fmtInt, fmtPct, isUnopposed, median, personUrl, slugify, summaryHasVotes, summaryUnopposed,
} from '../../site/apps/elections/lib/format.js';
import { isAppHref, parseRoute } from '../../site/apps/elections/lib/route.js';
import { countSheet, fptpMajority, quotaProgress, transferStages } from '../../site/apps/elections/lib/count.js';
import { arcLayout, hbars, parliamentArc, seatBar, transferFlow } from '../../site/apps/elections/lib/charts.js';
import { contestSlugs, partyRows } from '../../site/apps/elections/views/election.js';

const counts = (...totals) => totals.map((total, i) => ({ count: i + 1, total, transfers: i ? total - totals[i - 1] : 0, status: '' }));

test('formatting: numbers, shares, signed changes, slugs and person links', () => {
  assert.equal(fmtInt(12345), '12,345');
  assert.equal(fmtInt(12.5), '12.50');
  assert.equal(fmtInt(null), '—');
  assert.equal(fmtPct(29.0234), '29.0%');
  assert.equal(fmtDelta(3), '+3');
  assert.equal(fmtDelta(-1.25, 1), '−1.3');
  assert.equal(fmtDelta(0), '0');
  assert.equal(slugify('Sinéad Ennis'), 'sinead-ennis');
  assert.equal(personUrl('Naomi Long', '51102'), '/browse/persons/naomi-long-51102');
  assert.equal(personUrl('X', null), null);
  assert.equal(median([3, 1, 2, null]), 2);
});

test('unopposed: no votes and an unopposed status, candidates <= seats, or an uncontested election', () => {
  assert.equal(isUnopposed({ candidates: [{ status: 'Elected unopposed', firstPrefs: null }] }), true);
  assert.equal(isUnopposed({ candidates: [{ status: 'Elected', firstPrefs: null }], seats: 1 }), true);
  assert.equal(isUnopposed({ candidates: [{ firstPrefs: null }, { firstPrefs: null }], seats: 1 }), false);
  assert.equal(isUnopposed({ candidates: [{ firstPrefs: 10 }], seats: 1 }), false);
  // The summaries write 0 for "no poll": that is not a poll with no votes (QA, 11 Nov 2026).
  const r = { validPoll: 0, leadingVotes: 0, candidateCount: 1, seatsTotal: 1 };
  assert.equal(summaryHasVotes(r), false);
  assert.equal(summaryUnopposed(r), true);
  assert.equal(summaryUnopposed({ ...r, candidateCount: 3 }), false);
  assert.equal(summaryHasVotes({ validPoll: 43248 }), true);
});

test('routes: both prefixes, elections, contests, bodies and tools', () => {
  assert.equal(parseRoute('/elections/').view, 'home');
  assert.equal(parseRoute('/elections').view, 'home');
  assert.equal(parseRoute('/apps/elections/index.html').view, 'home');
  assert.deepEqual({ ...parseRoute('/elections/dail-eireann-2024-11-29/'), query: null }, { view: 'election', election: 'dail-eireann-2024-11-29', query: null });
  const c = parseRoute('/apps/elections/dail-eireann-2024-11-29/dublin-central/');
  assert.equal(c.view, 'contest');
  assert.equal(c.contest, 'dublin-central');
  assert.equal(parseRoute('/elections/body/dail-eireann/').body, 'dail-eireann');
  const p = parseRoute('/elections/pivot/', '?body=dail-eireann&rows=party');
  assert.equal(p.view, 'pivot');
  assert.equal(p.query.get('rows'), 'party');
  assert.equal(isAppHref('/elections/x/', 'http://a.test'), true);
  assert.equal(isAppHref('/browse/elections/x', 'http://a.test'), false);
  assert.equal(isAppHref('https://other.test/elections/', 'http://a.test'), false);
});

test('count sheet: real stages give the full sheet and transfer stages', () => {
  const sheet = countSheet([
    { id: 'a', name: 'A', party: 'P', firstPrefs: 250, elected: 1, electedAt: 1, counts: counts(250, 201, 201) },
    { id: 'b', name: 'B', party: 'Q', firstPrefs: 150, elected: 1, electedAt: 3, counts: counts(150, 190, 230) },
    { id: 'c', name: 'C', party: 'R', firstPrefs: 100, excluded: 1, excludedAt: 2, counts: counts(100, 105, 60) },
  ], { quota: 201, seatsTotal: 2 });
  assert.equal(sheet.kind, 'stages');
  assert.deepEqual(sheet.stages, [1, 2, 3]);
  assert.deepEqual(sheet.rows.map((r) => r.id), ['a', 'b', 'c']);
  const flows = transferStages(sheet);
  assert.equal(flows.length, 2);
  assert.equal(flows[0].kind, 'surplus');
  assert.deepEqual(flows[0].from.map((f) => f.name), ['A']);
  assert.equal(flows[0].distributed, 49);
  assert.equal(flows[0].nonTransferable, 4); // 49 out, 45 in
  assert.equal(flows[1].kind, 'exclusion');
  const q = quotaProgress(sheet);
  assert.equal(q.find((r) => r.id === 'b').total, 230);
});

test('count sheet: padded stages are count order only; unopposed and missing votes are not zeros', () => {
  const order = countSheet([
    { id: 'a', name: 'A', firstPrefs: 300, elected: 1, electedAt: 1, counts: counts(300, 300, 300) },
    { id: 'b', name: 'B', firstPrefs: 100, excluded: 1, excludedAt: 2, counts: counts(100, 100, 100) },
  ], { seatsTotal: 1 });
  assert.equal(order.kind, 'order');
  assert.deepEqual(order.stages, [1]);
  assert.deepEqual(transferStages(order), []);
  const un = countSheet([{ id: 'a', name: 'A', status: 'Elected unopposed', firstPrefs: null, elected: 1, counts: [{ count: 1, total: null }] }], { seatsTotal: 1 });
  assert.equal(un.kind, 'unopposed');
  assert.equal(un.validPoll, null);
  const none = countSheet([{ id: 'a', name: 'A', firstPrefs: null }, { id: 'b', name: 'B', firstPrefs: null }], { seatsTotal: 1 });
  assert.equal(none.kind, 'none');
  const fptp = countSheet([{ id: 'a', name: 'A', firstPrefs: 60, elected: 1 }, { id: 'b', name: 'B', firstPrefs: 40 }], { seatsTotal: 1 });
  assert.equal(fptp.kind, 'single');
  assert.equal(fptpMajority(fptp), 20);
  assert.equal(fptp.validPoll, 100);
});

test('charts: arc layout places every seat; charts are labelled SVG', () => {
  for (const n of [1, 3, 18, 90, 160, 650]) {
    const { points } = arcLayout(n);
    assert.equal(points.length, n, `arc of ${n}`);
    for (let i = 1; i < points.length; i += 1) assert.ok(points[i - 1].a >= points[i].a - 1e-9, 'left to right');
  }
  const arc = parliamentArc([{ party: 'A', seats: 50, colour: '#ff0000' }, { party: 'B', seats: 40, colour: '#0000ff' }], { title: '90 seats' });
  assert.equal((arc.match(/<circle /g) || []).length, 90);
  assert.match(arc, /role="img" aria-label="90 seats"/);
  assert.match(arc, /majority 46/);
  assert.match(seatBar([{ party: 'A', seats: 3, colour: '#000000' }]), /<rect/);
  assert.match(hbars([{ label: 'A', value: 10 }, { label: 'B', value: null }]), /—/);
  const flow = transferFlow({ stage: 2, kind: 'surplus', from: [{ name: 'A', amount: 49 }], to: [{ name: 'B', amount: 40 }, { name: 'C', amount: 5 }], nonTransferable: 4, distributed: 49 });
  assert.match(flow, /Non-transferable/);
  assert.equal((flow.match(/<path /g) || []).length, 3);
});

test('overview: party change rows and contest slugs by name', () => {
  const rows = partyRows(
    [{ party: 'A', seats: 10, stood: 12, votes: 100, share: 40, colour: '' }, { party: 'C', seats: 1, stood: 2, votes: 20, share: 8, colour: '' }],
    [{ party: 'A', seats: 8, share: 35 }, { party: 'B', seats: 3, share: 20 }],
    { votes: true, prevVotes: true },
  );
  assert.deepEqual(rows.map((r) => [r.party, r.seatChange, r.shareChange]), [['A', 2, 5], ['C', 1, 8], ['B', -3, -20]]);
  assert.equal(rows.find((r) => r.party === 'C').isNew, true);
  assert.equal(partyRows([{ party: 'A', seats: 1, stood: 1, votes: 0, share: 0, colour: '' }], null, { votes: false, prevVotes: false })[0].seatChange, null);
  const slugs = contestSlugs([{ key: 'e::a', resultName: 'A', resultKind: 'constituency-result' }, { key: 'e::a-2', resultName: 'A', resultKind: 'constituency-result' }, { key: 'e', resultName: 'Overall', resultKind: 'overall' }]);
  assert.deepEqual(slugs.get('A'), ['a', 'a-2']);
  assert.equal(slugs.has('Overall'), false);
});

const RECORDS = 'tmp/records/civgraph-records.sqlite';
test('count sheet over real contests of the records build', { skip: existsSync(RECORDS) ? false : 'no records build' }, async () => {
  const { answerRecordApi } = await import('../../packages/loader/src/local-api.mjs');
  const kindOf = async (key, contest) => {
    const res = /** @type {Response} */ (await answerRecordApi(`/_api/elections?key=${key}&contest=${contest}`));
    const j = await res.json();
    const c = j.constituency;
    return countSheet(j.candidates, { quota: c.quota, validPoll: c.validPoll, seatsTotal: c.seatsTotal, nonTransferable: c.nonTransferable, contestStatus: c.contestStatus }).kind;
  };
  assert.equal(await kindOf('northern-ireland-assembly__2022-05-05', 'belfast-east'), 'stages');
  assert.equal(await kindOf('house-of-commons-of-the-united-kingdom__1803-06-09', 'dungannon'), 'unopposed');
});

test('pivot: URL state round-trips; dimensions and measures are whitelisted; filters are literals', async () => {
  const { DEFAULT_STATE, pivotCsv, pivotSql, pivotTable, queryFromState, stateFromQuery, whereSql } = await import('../../site/apps/elections/lib/pivot.js');
  const s = stateFromQuery(new URLSearchParams('body=dail-eireann,ireland-local&rows=party&cols=decade&measure=share&from=1990&f.party=Fianna%20F%C3%A1il&f.party=O%27Brien'));
  assert.deepEqual(s.bodies, ['dail-eireann', 'ireland-local']);
  assert.equal(s.measure, 'share');
  assert.equal(s.from, 1990);
  assert.deepEqual(stateFromQuery(new URLSearchParams(queryFromState(s))), s);
  const bad = stateFromQuery(new URLSearchParams('rows=1;DROP&measure=x&body=../etc'));
  assert.equal(bad.rows, DEFAULT_STATE.rows);
  assert.equal(bad.measure, DEFAULT_STATE.measure);
  assert.deepEqual(bad.bodies, DEFAULT_STATE.bodies);
  assert.match(whereSql(s), /party IN \('Fianna Fáil', 'O''Brien'\)/);
  assert.match(pivotSql(s), /GROUP BY r, c/);
  assert.match(pivotSql({ ...s, measure: 'turnout', rows: 'election' }), /SELECT DISTINCT election_key, contest_seq/);
  const t = pivotTable([{ r: 'A', c: '2020', v: 30 }, { r: 'B', c: '2020', v: 10 }, { r: 'A', c: '2016', v: 5 }], { ...s, measure: 'share', cols: 'year' });
  assert.deepEqual(t.cols, ['2016', '2020']);
  assert.deepEqual(t.rows.map((r) => r.key), ['A', 'B']);
  assert.equal(t.rows[0].values[1], 75);
  const seats = pivotTable([{ r: 'A', c: 'x', v: 3 }, { r: 'B', c: 'y', v: 2 }], { ...s, measure: 'seats', cols: 'party' });
  assert.deepEqual(seats.totals, [3, 2]);
  assert.equal(pivotCsv(seats, { ...s, measure: 'seats', cols: 'party' }), 'Party (ballot label),x,y,Total\nA,3,,3\nB,,2,2\n');
});

test('maps: scales, per-area rows and party shares', async () => {
  const { areaRows, butlerSwing, diverging, partyShares, sequential } = await import('../../site/apps/elections/lib/scales.js');
  assert.equal(sequential(null, 0, 1), null);
  assert.notEqual(sequential(0, 0, 10), sequential(10, 0, 10));
  assert.equal(diverging(0, 10), '#efefef');
  assert.notEqual(diverging(-8, 10), diverging(8, 10));
  const rows = areaRows(
    { results: [{ constituency: 'A', seatsTotal: 1, validPoll: 100, turnoutPct: 60, leadingParty: 'X', leadingVotes: 50 }, { constituency: 'B', seatsTotal: 1, validPoll: 0, turnoutPct: 0, leadingVotes: 0, winnerParty: 'Y' }] },
    { items: [{ entryKind: 'election-constituency-result', constituency: 'A', featureName: 'Area A', matched: true }, { entryKind: 'election-constituency-result', constituency: 'B', featureName: 'Area B', matched: true }] },
  );
  assert.deepEqual(rows.map((r) => [r.feature, r.turnout, r.unopposed]), [['AREA A', 60, false], ['AREA B', null, true]]);
  const shares = partyShares([{ area: 'A', party: 'X', votes: 30, valid: 100 }, { area: 'A', party: 'Y', votes: 70, valid: 100 }], 'X');
  assert.equal(shares.get('A'), 30);
  assert.equal(butlerSwing({ a1: 40, b1: 40 }, { a2: 45, b2: 35 }), 5);
});

test('projections: uniform swing and seat allocation (the projections hook)', async () => {
  const { allocate, baseContests, deltasFromTargets, nationalShares, project } = await import('../../site/apps/elections/lib/project.js');
  assert.deepEqual([...allocate(new Map([['A', 40], ['B', 35], ['C', 25]]), 1)], [['A', 1]]);
  const five = allocate(new Map([['A', 40], ['B', 35], ['C', 25]]), 5);
  assert.equal([...five.values()].reduce((s, n) => s + n, 0), 5);
  assert.deepEqual(Object.fromEntries(five), { A: 2, B: 2, C: 1 });
  const contests = baseContests([{ area: 'X', party: 'A', votes: 55, seats: 1 }, { area: 'X', party: 'B', votes: 45, seats: 0 }]);
  assert.equal(contests[0].seats, 1);
  assert.equal(project(contests, new Map()).seats.get('A'), 1);
  assert.equal(project(contests, new Map([['B', 12]])).seats.get('B'), 1);
  const base = nationalShares(contests);
  assert.deepEqual(Object.fromEntries(deltasFromTargets(base, new Map([['A', 50]]))), { A: -5 });
});

test('notional results: votes carried by weights onto new areas', async () => {
  const { notionalVotes, titleCase } = await import('../../site/apps/elections/views/notional.js');
  const { areas, unmatched } = notionalVotes(
    [{ area: 'Belfast East', party: 'A', votes: 100 }, { area: 'Belfast East', party: 'B', votes: 50 }, { area: 'Nowhere', party: 'A', votes: 9 }],
    [['BELFAST EAST', 'BELFAST EAST', 0.9], ['BELFAST EAST', 'NORTH DOWN', 0.1]],
  );
  assert.equal(areas.get('BELFAST EAST')?.get('A'), 90);
  assert.equal(areas.get('NORTH DOWN')?.get('B'), 5);
  assert.deepEqual(unmatched, ['Nowhere']);
  assert.equal(titleCase('BELFAST SOUTH AND MID DOWN'), 'Belfast South and Mid Down');
});

test('the committed notional weights sum to one for every old area', async () => {
  const { readFileSync } = await import('node:fs');
  const w = JSON.parse(readFileSync('site/apps/elections/notional/pc-2008__pc-2023.json', 'utf8'));
  for (const method of ['areal', 'population']) {
    const sums = new Map();
    for (const [o, , x] of w.weights[method]) sums.set(o, (sums.get(o) || 0) + x);
    assert.equal(sums.size, w.old.areas.length, method);
    for (const [o, s] of sums) assert.ok(Math.abs(s - 1) < 0.01, `${method} ${o}: ${s}`);
  }
});

test('not public yet: no sitemap lists the app, and the sitemap builder names no app path for it', async () => {
  const { readFileSync, readdirSync, existsSync: exists } = await import('node:fs');
  const files = ['site/sitemap.xml', ...(exists('site/sitemaps') ? readdirSync('site/sitemaps').map((f) => `site/sitemaps/${f}`) : [])].filter((f) => exists(f));
  for (const f of files) assert.doesNotMatch(readFileSync(f, 'utf8'), /civgraph\.net\/(apps\/)?elections\//, f);
  assert.doesNotMatch(readFileSync('scripts/build/build-sitemap.mjs', 'utf8'), /['"]\/(apps\/)?elections\//);
  const page = readFileSync('site/apps/elections/index.html', 'utf8');
  assert.match(page, /<meta name="robots" content="noindex, nofollow"/);
  assert.match(readFileSync('site/_headers', 'utf8'), /\/elections\/\*\n {2}X-Robots-Tag: noindex, nofollow/);
});

test('no poll, as packages/core/src/unopposed.mjs reads it: 0 votes on an unopposed row, the auto-returned Ceann Comhairle', () => {
  const un = countSheet([{ id: 'a', name: 'A', status: 'Elected unopposed', firstPrefs: 0, elected: 1 }], { seatsTotal: 1 });
  assert.equal(un.kind, 'unopposed');
  assert.equal(un.rows[0].firstPrefs, null);
  const cc = countSheet([
    { id: 'cc', name: 'CC', status: 'Elected (auto returned)', autoReturnedCeannComhairle: true, firstPrefs: 0, elected: 1 },
    { id: 'b', name: 'B', firstPrefs: 500, elected: 1, electedAt: 1 }, { id: 'c', name: 'C', firstPrefs: 100 },
  ], { seatsTotal: 2 });
  const row = cc.rows.find((r) => r.id === 'cc');
  assert.equal(row?.autoReturned, true);
  assert.equal(row?.firstPrefs, null);
  assert.equal(cc.validPoll, 600);
});
