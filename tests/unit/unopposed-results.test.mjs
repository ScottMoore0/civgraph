// Unopposed returns (QA launch-readiness H4, 11 Nov 2026): a candidate returned unopposed shows
// "Unopposed", never "0" votes and "0.00%"; a contest with no poll shows no valid poll or turnout;
// party summaries count unopposed seats as seats and never as votes, and say so. Covers the
// shared rule (packages/core/src/unopposed.mjs), the party summaries (election-domain.mjs), the
// Browse contest and party panels (site/browse/browse.js, run in a sandbox) and the
// server-rendered contest and person pages (packages/ui/src/templates/records).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import {
  candidateReturnWithoutPoll, isUncontestedResult, isUnopposedCandidate, partyHadNoPoll,
} from '../../packages/core/src/unopposed.mjs';
import { buildMainLikePartySummaryFromRawResults, buildPartySummary } from '../../packages/core/src/election-domain.mjs';
import { electionBody } from '../../packages/ui/src/templates/records/election.js';
import { personBody } from '../../packages/ui/src/templates/records/person.js';
import { toHtmlString } from '../../packages/core/src/html.js';

// Falls ward, Belfast County Borough Council, 18 September 1946, as the records database holds
// it: three candidacies with status "Elected unopposed" and no votes (data/elections-source/
// data/elections/belfast-county-borough-council/1946-09-18/falls.json says `unopposed: true`).
const FALLS = [
  { name: 'Patrick B. Gregory', party: 'Nationalist Party', firstPrefs: null, finalVotes: null, elected: true, status: 'Elected unopposed', personId: 141958 },
  { name: 'John Hopkins', party: 'Nationalist Party', firstPrefs: null, finalVotes: null, elected: true, status: 'Elected unopposed', personId: 139465 },
  { name: 'John P. Hayes', party: 'NI Labour', firstPrefs: null, finalVotes: null, elected: true, status: 'Elected unopposed', personId: 141624 },
];
const CLIFTON = [
  { name: 'John Kennedy', party: 'UUP', firstPrefs: 6148, elected: true, status: 'Elected' },
  { name: 'A. N. Other', party: 'NI Labour', firstPrefs: 2000, elected: false, status: 'Not elected' },
];

test('the rule: "Elected unopposed", unopposed: true and the Ceann Comhairle', () => {
  assert.equal(candidateReturnWithoutPoll({ status: 'Elected unopposed' }), 'unopposed');
  assert.equal(candidateReturnWithoutPoll({ Status: 'Elected', unopposed: true }), 'unopposed');
  assert.equal(candidateReturnWithoutPoll({ status: 'Elected unopposed', firstPrefs: 0 }), 'unopposed');
  assert.equal(candidateReturnWithoutPoll({ status: 'Elected (auto returned)' }), 'auto-returned');
  assert.equal(candidateReturnWithoutPoll({ status: 'Elected', autoReturnedCeannComhairle: true }), 'auto-returned');
  assert.equal(candidateReturnWithoutPoll({ status: 'Elected', firstPrefs: 6148 }), null);
  assert.equal(candidateReturnWithoutPoll({ status: 'Not elected', firstPrefs: 0 }), null);
  assert.equal(candidateReturnWithoutPoll(null), null);
  assert.equal(isUnopposedCandidate({ status: 'Elected (auto returned)' }), false);
  assert.equal(isUncontestedResult({ candidates: FALLS }), true);
  assert.equal(isUncontestedResult({ candidates: CLIFTON }), false);
  assert.equal(isUncontestedResult({ contestStatus: 'uncontested', candidates: [{ name: 'X', elected: true, status: 'Elected' }] }), true);
  assert.equal(isUncontestedResult({ contestStatus: 'uncontested', candidates: [{ name: 'X', firstPrefs: 10 }] }), false);
  assert.equal(isUncontestedResult({ candidates: [] }), false);
});

test('party summary: unopposed seats are seats, not votes, and an all-unopposed party has no share', () => {
  const rows = buildPartySummary([{ constituency: 'Falls', seatsTotal: 3, candidates: FALLS }, { constituency: 'Clifton', seatsTotal: 1, candidates: CLIFTON }]);
  const by = Object.fromEntries(rows.map((row) => [row.party, row]));
  assert.deepEqual([by['Nationalist Party'].seats, by['Nationalist Party'].stood, by['Nationalist Party'].votes, by['Nationalist Party'].unopposedSeats, by['Nationalist Party'].share], [2, 2, 0, 2, null]);
  // NI Labour: one seat unopposed (Falls), one candidate polled (Clifton): its share is of the polled votes.
  assert.equal(by['NI Labour'].unopposedSeats, 1);
  assert.equal(by['NI Labour'].votes, 2000);
  assert.equal(by['NI Labour'].share, 2000 / 8148 * 100);
  assert.equal(by.UUP.unopposedSeats, undefined, 'no key where no seat was unopposed');
  assert.equal(by.UUP.share, 6148 / 8148 * 100);
  assert.equal(partyHadNoPoll(by['Nationalist Party']), true);
  assert.equal(partyHadNoPoll(by['NI Labour']), false);
  assert.equal(partyHadNoPoll(by.UUP), false);
  // A summary row from before `unopposedSeats`: seats and no votes at all is no poll too.
  assert.equal(partyHadNoPoll({ party: 'Nat', seats: 3, stood: 3, votes: 0, share: 0 }), true);
  assert.equal(partyHadNoPoll({ party: 'Ind', seats: 0, stood: 1, votes: 0 }), false);
});

test('party summary from raw count groups (the Dail/main-like path) counts unopposed rows the same way', () => {
  const row = (name, party, votes, extra = {}) => ({ Candidate_Id: name, Count_Number: '1', Firstname: name, Surname: '', candidateName: name, Party_Name: party, Total_Votes: votes, Status: 'Elected', Occurred_On_Count: '1', ...extra });
  const { rows } = buildMainLikePartySummaryFromRawResults([
    { constituency: 'Falls', raw: { Constituency: { countInfo: { Number_Of_Seats: '2', Valid_Poll: '' }, countGroup: [row('Gregory', 'Nationalist Party', '', { unopposed: true }), row('Hopkins', 'Nationalist Party', '', { unopposed: true })] } } },
    { constituency: 'Clifton', raw: { Constituency: { countInfo: { Number_Of_Seats: '1', Valid_Poll: '100' }, countGroup: [row('Kennedy', 'UUP', '100')] } } },
  ]);
  const nat = rows.find((r) => r.party === 'Nationalist Party');
  assert.equal(nat.unopposedSeats, 2);
  assert.equal(nat.votes, 0);
  assert.equal(nat.share, null);
  assert.equal(rows.find((r) => r.party === 'UUP').share, 100);
});

async function loadBrowse() {
  const handler = {
    get: (_target, prop) => {
      if (prop === Symbol.toPrimitive) return () => '';
      if (prop === 'then') return undefined;
      if (prop === 'dataset') return {};
      if (prop === 'length') return 0;
      return inert;
    },
    apply: () => inert,
    construct: () => inert,
    set: () => true,
  };
  const inert = new Proxy(function inertElement() {}, handler);
  const ctx = {
    document: inert,
    location: { hash: '', pathname: '/browse/', search: '', href: 'https://civgraph.net/browse/' },
    history: { replaceState() {}, pushState() {} },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    fetch: () => Promise.reject(new Error('no network in tests')),
    console: { log() {}, warn() {}, error() {}, info() {} },
    setTimeout, clearTimeout, URL, URLSearchParams,
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    navigator: {}, requestAnimationFrame: () => 0, performance: { now: () => 0 },
    IntersectionObserver: class { observe() {} }, ResizeObserver: class { observe() {} }, MutationObserver: class { observe() {} },
    CustomEvent: class {}, Event: class {},
  };
  ctx.window = ctx;
  ctx.self = ctx;
  const imports = {};
  let source = readFileSync('site/browse/browse.js', 'utf8');
  for (const [, , spec] of source.matchAll(/^import\s*\{([^}]*)\}\s*from\s*'([^']+)';/gm)) {
    imports[spec] = await import(new URL(spec, new URL('../../site/browse/browse.js', import.meta.url)).href);
  }
  source = source.replace(/^import\s*\{([^}]*)\}\s*from\s*'([^']+)';/gm,
    (_match, names, spec) => `const {${names}} = __imports[${JSON.stringify(spec)}];`);
  ctx.__imports = imports;
  vm.createContext(ctx);
  vm.runInContext(source, ctx, { filename: 'browse.js' });
  return (/** @type {string} */ code) => vm.runInContext(code, ctx);
}

const browse = await loadBrowse();
/** Feed renderContestResultPanel a contest without the network. */
function stubContest(constituency, candidates) {
  browse('globalThis')['__contest'] = { constituency, candidates };
  browse('loadContestResult = async () => globalThis.__contest');
}
const cellsOf = (html) => [...html.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1].replace(/<[^>]+>/g, '').trim());

test('Browse contest panel: Falls 1946 reads Unopposed, with no 0, no share and no valid poll', async () => {
  stubContest({ constituency: 'Falls', seatsTotal: 3, electorate: 10771, validPoll: null, contestStatus: 'uncontested', votingSystem: 'block-vote' }, FALLS);
  const html = await browse('renderContestResultPanel')({ parentElectionKey: 'belfast-county-borough-council__1946-09-18', constituency: 'Falls', parentTitle: '1946 Belfast County Borough Council election' });
  const cells = cellsOf(html);
  assert.equal(cells.filter((c) => c === 'Unopposed').length, 3, html);
  assert.equal(cells.filter((c) => c === 'Elected unopposed').length, 3);
  assert.ok(!cells.includes('0'), 'no candidate shows 0 votes');
  assert.ok(!/0\.0%/.test(html), 'no 0.0% share');
  assert.match(html, /<dt>Poll<\/dt><dd>No poll: returned unopposed<\/dd>/);
  assert.doesNotMatch(html, /<dt>Valid<\/dt>/);
  assert.doesNotMatch(html, /<dt>Turnout<\/dt>/);
});

test('Browse contest panel: a contested result is unchanged', async () => {
  stubContest({ constituency: 'Clifton', seatsTotal: 1, validPoll: 8148, turnoutPct: 58.85, votingSystem: 'fptp' }, CLIFTON);
  const html = await browse('renderContestResultPanel')({ parentElectionKey: 'x', constituency: 'Clifton' });
  const cells = cellsOf(html);
  assert.ok(cells.includes('6,148') && cells.includes('75.5%') && cells.includes('Elected'), cells.join('|'));
  assert.match(html, /<dt>Valid<\/dt><dd>8,148<\/dd>/);
  assert.match(html, /<dt>Turnout<\/dt><dd>58\.85%<\/dd>/);
  assert.doesNotMatch(html, /Unopposed|No poll/);
});

test('Browse contest panel: the Ceann Comhairle reads "Returned automatically", others keep their votes', async () => {
  stubContest({ constituency: 'Kildare South', seatsTotal: 3, validPoll: 100, quota: 26, votingSystem: 'stv', countNumbers: [1, 2] }, [
    { name: 'CC', party: 'Ceann Comhairle', firstPrefs: null, elected: true, status: 'Elected (auto returned)', autoReturnedCeannComhairle: true },
    { name: 'A', party: 'FF', firstPrefs: 60, elected: true, status: 'Elected', electedAt: 1 },
    { name: 'B', party: 'FG', firstPrefs: 40, elected: true, status: 'Elected', electedAt: 2 },
  ]);
  const cells = cellsOf(await browse('renderContestResultPanel')({ parentElectionKey: 'x', constituency: 'Kildare South' }));
  assert.ok(cells.includes('Returned automatically') && cells.includes('60') && cells.includes('60.0%'), cells.join('|'));
});

test('Browse party summary: unopposed seats in their own column, no "0 votes, 0.00%", and a note', () => {
  const html = browse('renderElectionRelated')({
    entryKind: 'election',
    partySummary: [
      { party: 'UUP', stood: 36, seats: 32, votes: 134425, share: 58.92 },
      { party: 'Nationalist Party', stood: 3, seats: 3, votes: 0, share: null, unopposedSeats: 3 },
      { party: 'NI Labour', stood: 23, seats: 7, votes: 56200, share: 24.63, unopposedSeats: 1 },
    ],
    resultEntries: [],
  });
  assert.match(html, /<th scope="col">Unopposed<\/th>/);
  assert.match(html, /Seats returned unopposed are counted under Seats and Unopposed but add no votes/);
  const rows = [...html.matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map((m) => cellsOf(`<x>${m[1]}`)).filter((r) => r.length);
  const nat = rows.find((r) => r[0] === 'Nationalist Party');
  assert.deepEqual(nat.slice(1), ['3', '3', '3', '&ndash;', '&ndash;']);
  const lab = rows.find((r) => r[0] === 'NI Labour');
  assert.deepEqual(lab.slice(1), ['23', '7', '1', '56,200', '24.63%']);
});

test('Browse party summary: with no unopposed seat the table is as before (no column, no note)', () => {
  const html = browse('renderElectionRelated')({ entryKind: 'election', partySummary: [{ party: 'UUP', stood: 2, seats: 1, votes: 100, share: 100 }], resultEntries: [] });
  assert.doesNotMatch(html, /Unopposed/);
  assert.match(html, /<th scope="col">Party<\/th><th scope="col">Stood<\/th><th scope="col">Seats<\/th><th scope="col">Votes<\/th><th scope="col">Share<\/th>/);
  assert.match(html, /<td>100\.00%<\/td>/);
});

test('Browse: a person\'s contest row says Elected unopposed, and Unopposed where votes are shown', () => {
  assert.equal(browse('contestOutcome')({ status: 'Elected unopposed', elected: true }), 'Elected unopposed');
  assert.equal(browse('contestOutcome')({ status: 'Elected', elected: true }), 'Elected');
});

test('SSR contest page: Unopposed in the votes column, "No poll", and no turnout', () => {
  const page = {
    kind: 'contest',
    election: { slug: 'belfast-county-borough-council-1946-09-18', title: '1946 Belfast County Borough Council election', date: '1946-09-18', meta: {} },
    contest: { seq: 5, name: 'Falls', slug: 'falls', seatsTotal: 3, electorate: 10771, quota: null, turnoutPct: null, sourceFile: 'x', meta: JSON.stringify({ contestStatus: 'uncontested' }) },
    candidates: FALLS.map((c, ord) => ({ ord, ...c, partyAsPrinted: 'Nat.', colour: '#32CD32', elected: 1 })),
    citations: [],
  };
  const html = toHtmlString(electionBody(page, {}).body);
  assert.equal((html.match(/>Unopposed</g) || []).length, 3, html);
  assert.match(html, /No poll: returned unopposed/);
  assert.doesNotMatch(html, />0</);
});

test('SSR person page: an unopposed candidacy shows Unopposed, not 0 and 0%', () => {
  const html = toHtmlString(personBody({ name: 'Patrick B. Gregory', slug: 'patrick-b-gregory-141958', elections: [
    { key: 'belfast-county-borough-council__1946-09-18', title: '1946 Belfast County Borough Council election', date: '1946-09-18', constituency: 'Falls', party: 'Nationalist Party', status: 'Elected unopposed', elected: true, firstPrefs: 0, share: 0 },
  ] }, {}).body);
  assert.match(html, />Unopposed</);
  assert.doesNotMatch(html, /0\.0%|>0</);
});
