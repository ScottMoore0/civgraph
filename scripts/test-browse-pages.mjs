#!/usr/bin/env node
/**
 * Offline tests for the path-style Browse pages (functions/_browse-page.js), the /404
 * status (functions/404.js) and the sitemap writer's helpers (scripts/build-sitemap.mjs).
 *
 * D1, R2 and the static-asset binding are stubbed: the D1 stub answers the handful of
 * queries the page makes from a small table of records, so these check the routing, the
 * slug rules, the head that is written and the status codes, not the live data.
 *
 *   node scripts/test-browse-pages.mjs
 */
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import {
  BROWSE_PAGE_TYPES,
  browsePageHandler,
  clip,
  lookupBrowseRecord,
  pageTitle,
  renderBrowseShell,
} from '../functions/_browse-page.js';
import { onRequestGet as notFoundPage } from '../functions/404.js';
import { BROWSE_SITEMAP_TYPES, proniRecordUrl, sitemapIndexXml, urlsetXml } from './build-sitemap.mjs';

const SHELL = readFileSync('browse/index.html', 'utf8');

let passed = 0;
const failures = [];
function check(name, condition, detail) {
  if (condition) { passed += 1; return; }
  failures.push(detail ? `${name} -- ${detail}` : name);
}

const PERSON = {
  id: '27771',
  slug: 'gerry-adams-27771',
  title: 'Gerry Adams',
  name: 'Gerry Adams',
  parties: [{ name: 'Sinn Féin', count: 15 }],
  constituencies: [{ name: 'Belfast West', count: 12 }, { name: 'Louth', count: 2 }],
  totals: { stood: 15, elected: 12 },
  firstYear: 1983,
  lastYear: 2016,
};

const ELECTIONS = [
  { key: 'dail-eireann__2024-11-29', title: '2024 Irish general election', body: 'Dáil Éireann', date: '2024-11-29', votingSystem: 'stv-hare', meta: JSON.stringify({ constituencies: ['Carlow Kilkenny', 'Cork North Central'] }) },
  { key: 'house-of-commons-of-the-united-kingdom__2024-07-04', title: '2024 UK general election in Northern Ireland', body: 'House of Commons', date: '2024-07-04', votingSystem: 'fptp', meta: '{}' },
  { key: 'northern-ireland-forum-for-political-dialogue__1996-05-30', title: '1996 Northern Ireland Forum election', body: 'Northern Ireland Forum', date: '1996-05-30', votingSystem: 'list', meta: '{}' },
];
const CONSTITUENCIES = {
  'dail-eireann__2024-11-29': [
    { seq: 0, name: 'Carlow Kilkenny', electorate: 120821, turnoutPct: 58.21, seatsTotal: 5, quota: 11627 },
    { seq: 4, name: 'Cork North Central', electorate: 103250, turnoutPct: 57.75, seatsTotal: 5, quota: 9846 },
  ],
  'house-of-commons-of-the-united-kingdom__2024-07-04': [
    { seq: 5, name: 'East Londonderry', electorate: 75707, turnoutPct: 54.73, seatsTotal: 1, quota: null },
  ],
  'northern-ireland-forum-for-political-dialogue__1996-05-30': [
    { seq: 18, name: 'Northern Ireland', electorate: null, turnoutPct: null, seatsTotal: 20, quota: null },
  ],
};
const CANDIDATES = {
  'dail-eireann__2024-11-29#4': [
    { name: "Pádraig O'Sullivan", party: 'Fianna Fáil', elected: 1 },
    { name: 'Mick Barry', party: 'People Before Profit', elected: 0 },
  ],
  'house-of-commons-of-the-united-kingdom__2024-07-04#5': [
    { name: 'Gregory Campbell', party: 'DUP', elected: 1 },
  ],
};

/**
 * D1 is SQLite, so the stub is SQLite too (node:sqlite), with the columns the page reads
 * from the live schema (data/database/elections-schema.sql and the browse_* imports). The
 * page's SQL therefore really runs: a query D1 would reject for its syntax fails here.
 * One thing SQLite allows and D1 does not: a LIKE whose pattern is a column, which D1
 * refuses as "too complex" -- so that is checked by reading the SQL.
 */
const sqlite = new DatabaseSync(':memory:');
sqlite.exec(`
  CREATE TABLE browse_persons (id TEXT, slug TEXT, key_norm TEXT, record TEXT);
  CREATE TABLE browse_sources (id TEXT, slug TEXT, key_norm TEXT, record TEXT);
  CREATE TABLE browse_register_interests (id TEXT, slug TEXT, key_norm TEXT, record TEXT);
  CREATE TABLE elections (key TEXT PRIMARY KEY, display_title TEXT, body TEXT, date TEXT, voting_system TEXT, meta TEXT);
  CREATE TABLE constituencies (election_key TEXT, seq INTEGER, name TEXT, electorate INTEGER, turnout_pct REAL, seats_total INTEGER, quota INTEGER);
  CREATE TABLE candidates (election_key TEXT, constituency_seq INTEGER, name TEXT, party TEXT, elected INTEGER, first_prefs INTEGER);
`);
sqlite.prepare('INSERT INTO browse_persons VALUES (?, ?, ?, ?)').run(PERSON.id, PERSON.slug, 'gerry-adams', JSON.stringify(PERSON));
for (const row of ELECTIONS) {
  sqlite.prepare('INSERT INTO elections VALUES (?, ?, ?, ?, ?, ?)').run(row.key, row.title, row.body, row.date, row.votingSystem, row.meta);
}
for (const [key, rows] of Object.entries(CONSTITUENCIES)) {
  for (const row of rows) {
    sqlite.prepare('INSERT INTO constituencies VALUES (?, ?, ?, ?, ?, ?, ?)').run(key, row.seq, row.name, row.electorate, row.turnoutPct, row.seatsTotal, row.quota);
  }
}
for (const [id, rows] of Object.entries(CANDIDATES)) {
  const [key, seq] = id.split('#');
  rows.forEach((row, i) => {
    sqlite.prepare('INSERT INTO candidates VALUES (?, ?, ?, ?, ?, ?)').run(key, Number(seq), row.name, row.party, row.elected, 1000 - i);
  });
}

function fakeDb({ fail = false } = {}) {
  return {
    prepare(sql) {
      if (/\bLIKE\b[^']*\b(?:key|REPLACE)\b/i.test(sql)) throw new Error(`D1 refuses a LIKE pattern built from a column: ${sql}`);
      return {
        bind(...args) {
          const statement = sqlite.prepare(sql);
          return {
            async first() {
              if (fail) throw new Error('D1 unavailable');
              return statement.get(...args) ?? null;
            },
            async all() {
              if (fail) throw new Error('D1 unavailable');
              return { results: statement.all(...args) };
            },
          };
        },
      };
    },
  };
}

function fakeBucket(files) {
  return {
    async get(key) {
      return key in files ? { text: async () => JSON.stringify(files[key]) } : null;
    },
  };
}

const ASSETS = {
  async fetch(request) {
    const { pathname } = new URL(request.url);
    if (pathname === '/browse/') return new Response(SHELL, { status: 200, headers: { 'Content-Type': 'text/html' } });
    return new Response('not found', { status: 404 });
  },
};

const env = {
  ELECTIONS_DB: fakeDb(),
  MAPS_BUCKET: fakeBucket({
    'data/browse/details/maps/wards-1984.json': { item: { slug: 'wards-1984', title: '1984 council wards', description: 'Northern Ireland council wards, 1984.' } },
  }),
  ASSETS,
};

async function get(type, path, environment = env) {
  const handler = browsePageHandler(type);
  return handler({ request: new Request(`https://civgraph.net${path}`), env: environment });
}

const titleOf = (html) => /<title>([^<]*)<\/title>/.exec(html)?.[1];
const canonicalOf = (html) => [...html.matchAll(/<link rel="canonical" href="([^"]*)">/g)].map((m) => m[1]);
const descriptionOf = (html) => /<meta name="description" content="([^"]*)">/.exec(html)?.[1];

// --- the shell rewrite ----------------------------------------------------------------
{
  const html = renderBrowseShell(SHELL, {
    title: 'Gerry Adams – Person – Civgraph',
    description: 'A "quoted" <description> & more',
    canonical: 'https://civgraph.net/browse/persons/gerry-adams-27771',
    heading: 'Gerry Adams',
  });
  check('shell: title replaced', titleOf(html) === 'Gerry Adams – Person – Civgraph', titleOf(html));
  check('shell: description replaced and escaped', descriptionOf(html) === 'A &quot;quoted&quot; &lt;description&gt; &amp; more', descriptionOf(html));
  const canonicals = canonicalOf(html);
  check('shell: exactly one canonical, the record', canonicals.length === 1 && canonicals[0].endsWith('/browse/persons/gerry-adams-27771'), JSON.stringify(canonicals));
  check('shell: og:url written', html.includes('<meta property="og:url" content="https://civgraph.net/browse/persons/gerry-adams-27771">'));
  check('shell: heading in the hero for crawlers without JavaScript', /<div id="browseHero" class="browse-hero"><p class="browse-kicker">Browse<\/p><h1 class="browse-title">Gerry Adams<\/h1>/.test(html));
  check('shell: assets are site-root paths, so /browse/<type>/<slug> can load them',
    !/(?:src|href)="(?!\/|https?:|#|mailto:|data:)[^"]+\.(?:js|css|woff2|svg)/.test(SHELL));
}

check('title: elections carry no type', pageTitle('elections', '2024 Irish general election') === '2024 Irish general election – Civgraph');
check('title: persons carry their type', pageTitle('persons', 'Gerry Adams') === 'Gerry Adams – Person – Civgraph');
check('clip: cuts at a word and marks it', clip('word '.repeat(100), 50).endsWith('…') && clip('word '.repeat(100), 50).length <= 50);
check('types: the sitemap and the pages route the same types',
  JSON.stringify([...BROWSE_SITEMAP_TYPES].sort()) === JSON.stringify(Object.keys(BROWSE_PAGE_TYPES).sort()));

// --- lookups ---------------------------------------------------------------------------
{
  const person = await lookupBrowseRecord(env, 'persons', 'gerry-adams-27771');
  check('lookup: person by slug', person?.title === 'Gerry Adams' && person.slug === 'gerry-adams-27771');
  check('lookup: person description names parties and places', /Sinn Féin/.test(person?.description) && /Belfast West/.test(person?.description), person?.description);
  check('lookup: absent person is null (404)', (await lookupBrowseRecord(env, 'persons', 'nobody-1')) === null);

  const election = await lookupBrowseRecord(env, 'elections', 'dail-eireann-2024-11-29');
  check('lookup: election by slug', election?.title === '2024 Irish general election' && election.slug === 'dail-eireann-2024-11-29', JSON.stringify(election));
  const byKey = await lookupBrowseRecord(env, 'elections', 'dail-eireann__2024-11-29');
  check('lookup: election by key canonicalises to the slug', byKey?.slug === 'dail-eireann-2024-11-29');

  const contest = await lookupBrowseRecord(env, 'elections', 'dail-eireann-2024-11-29-cork-north-central');
  check('lookup: Dáil contest', contest?.title === 'Cork North Central - 2024 Irish general election', JSON.stringify(contest));
  check('lookup: contest description has the count summary and who was elected',
    /electorate 103,250/.test(contest?.description) && /quota 9,846/.test(contest?.description) && /Elected: Pádraig O'Sullivan\./.test(contest?.description) && /29 November 2024/.test(contest?.description) && !/Mick Barry/.test(contest?.description),
    contest?.description);

  const seat = await lookupBrowseRecord(env, 'elections', 'house-of-commons-of-the-united-kingdom-2024-07-04-east-londonderry');
  check('lookup: Westminster seat', seat?.title === 'East Londonderry - 2024 UK general election in Northern Ireland' && /Elected: Gregory Campbell\./.test(seat.description) && !/quota/.test(seat.description), JSON.stringify(seat));

  const overall = await lookupBrowseRecord(env, 'elections', 'dail-eireann-2024-11-29-overall-results');
  check('lookup: overall results', overall?.slug === 'dail-eireann-2024-11-29-overall-results');

  const regional = await lookupBrowseRecord(env, 'elections', 'northern-ireland-forum-for-political-dialogue-1996-05-30-regional-list');
  check('lookup: NI Forum regional list', regional?.title === 'Regional List - 1996 Northern Ireland Forum election', JSON.stringify(regional));

  check('lookup: absent contest is null (404)', (await lookupBrowseRecord(env, 'elections', 'dail-eireann-2024-11-29-atlantis')) === null);
  check('lookup: absent election is null (404)', (await lookupBrowseRecord(env, 'elections', 'no-such-body-1900-01-01')) === null);

  const map = await lookupBrowseRecord(env, 'maps', 'wards-1984');
  check('lookup: map from its R2 detail file', map?.title === '1984 council wards');
  check('lookup: map without a detail file is unknown, not absent', (await lookupBrowseRecord(env, 'maps', 'some-map-id')) === undefined);
  check('lookup: no binding is unknown, not absent', (await lookupBrowseRecord({}, 'persons', 'gerry-adams-27771')) === undefined);
}

// --- the handler ---------------------------------------------------------------------
{
  const page = await get('persons', '/browse/persons/gerry-adams-27771');
  const html = await page.text();
  check('page: found record answers 200', page.status === 200, String(page.status));
  check('page: found record has its title', titleOf(html) === 'Gerry Adams – Person – Civgraph', titleOf(html));
  check('page: canonical is the path URL', canonicalOf(html)[0] === 'https://civgraph.net/browse/persons/gerry-adams-27771');

  const byId = await get('persons', '/browse/persons/27771');
  check('page: a person by number redirects to the slug (301)', byId.status === 301 && byId.headers.get('Location') === 'https://civgraph.net/browse/persons/gerry-adams-27771', `${byId.status} ${byId.headers.get('Location')}`);

  const contest = await get('elections', '/browse/elections/dail-eireann-2024-11-29-cork-north-central');
  const contestHtml = await contest.text();
  check('page: contest has its title', contest.status === 200 && titleOf(contestHtml) === 'Cork North Central - 2024 Irish general election – Civgraph', `${contest.status} ${titleOf(contestHtml)}`);

  const missing = await get('persons', '/browse/persons/nobody-1');
  const missingHtml = await missing.text();
  check('page: absent record answers 404', missing.status === 404, String(missing.status));
  check('page: the 404 still serves the app shell', missingHtml.includes('id="browseHero"'));

  const down = await get('persons', '/browse/persons/gerry-adams-27771', { ...env, ELECTIONS_DB: fakeDb({ fail: true }) });
  check('page: a failed lookup is a 200 with the generic head, never a 404', down.status === 200 && titleOf(await down.text()) === 'Browse - Civgraph', String(down.status));

  const bare = await get('persons', '/browse/persons/');
  check('page: no slug goes to the list', bare.status === 302 && bare.headers.get('Location') === 'https://civgraph.net/browse/#/persons', `${bare.status} ${bare.headers.get('Location')}`);

  const encoded = await get('elections', '/browse/elections/dail-eireann__2024-11-29');
  check('page: an election by key redirects to its slug', encoded.status === 301 && encoded.headers.get('Location').endsWith('/browse/elections/dail-eireann-2024-11-29'), `${encoded.status} ${encoded.headers.get('Location')}`);
}

// --- /404 ------------------------------------------------------------------------------
{
  const res = await notFoundPage({
    request: new Request('https://civgraph.net/404'),
    next: async () => new Response('<h1>Page not found</h1>', { status: 200, headers: { 'Content-Type': 'text/html' } }),
  });
  check('/404 answers 404', res.status === 404, String(res.status));
  check('/404 keeps the page', (await res.text()).includes('Page not found'));
}

// --- sitemap helpers ---------------------------------------------------------------------
{
  const xml = urlsetXml(['https://civgraph.net/browse/sources/a&b']);
  check('sitemap: URLs are XML-escaped', xml.includes('<loc>https://civgraph.net/browse/sources/a&amp;b</loc>'));
  check('sitemap: urlset namespace', xml.includes('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'));
  check('sitemap: index lists absolute sitemap URLs', sitemapIndexXml(['sitemaps/pages.xml']).includes('<loc>https://civgraph.net/sitemaps/pages.xml</loc>'));
  check('sitemap: PRONI references keep their slashes as path segments', proniRecordUrl('D/1234/A B') === 'https://civgraph.net/proni/D/1234/A%20B');
}

if (failures.length) {
  console.error(`FAIL: ${failures.length} of ${passed + failures.length} browse page checks failed:`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log(`PASS: ${passed} browse page, /404 and sitemap checks.`);
