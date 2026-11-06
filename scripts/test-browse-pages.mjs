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
import { migrationFiles, TableWriter, transaction } from './records/db.mjs';
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
// The records schema itself (migrations/), filled through the loader's own writer, so the page's
// SQL runs against the tables and columns production will have.
for (const file of migrationFiles()) sqlite.exec(readFileSync(file, 'utf8'));
const slugOf = (value) => String(value).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  .replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const PARTY = { id: 'party:sinn-fein', slug: 'sinn-fein', type: 'party', title: 'Sinn Féin', subtitle: 'Party label', firstYear: 1918, lastYear: 2024 };
transaction(sqlite, () => {
  new TableWriter(sqlite, 'person_cards').add({ slug: PERSON.slug, id: PERSON.id, title: PERSON.title, title_norm: 'gerry adams', key_norm: 'gerry-adams', search_norm: 'gerry adams', ord: 0, card: JSON.stringify(PERSON) });
  new TableWriter(sqlite, 'party_cards').add({ slug: PARTY.slug, id: PARTY.id, title: PARTY.title, ord: 0, card: JSON.stringify(PARTY), detail: JSON.stringify(PARTY) });
  // A ballot-paper label folded into its party (batch 4c): the records build turns the party's
  // record written under the label's old slug into a party_aliases row.
  const UUP = { slug: 'uup', title: 'Ulster Unionist Party', subtitle: 'UUP / 1899-2024' };
  new TableWriter(sqlite, 'party_cards').add({ slug: UUP.slug, id: 'party:uup', title: UUP.title, ord: 1, card: JSON.stringify(UUP), detail: JSON.stringify(UUP) });
  const aliases = new TableWriter(sqlite, 'party_aliases');
  aliases.add({ alias: 'sinn-fein-sinn-fein', slug: PARTY.slug });
  aliases.add({ alias: 'uup-farmer', slug: UUP.slug });
  // An office page (the facts model), from office_cards.
  const OFFICE = { slug: 'alliance-chair', title: 'Chair of the Alliance Party', subtitle: 'Alliance Party / 3 holder records / 1970–1975' };
  new TableWriter(sqlite, 'office_cards').add({ slug: OFFICE.slug, id: `office:${OFFICE.slug}`, title: OFFICE.title, ord: 0, card: JSON.stringify(OFFICE), detail: JSON.stringify(OFFICE) });
  const e = new TableWriter(sqlite, 'r_elections');
  ELECTIONS.forEach((row, ord) => e.add({ key: row.key, slug: slugOf(row.key), body_slug: row.key.split('__')[0], display_title: row.title, body: row.body, date: row.date, voting_system: row.votingSystem, ord, meta: row.meta }));
  const k = new TableWriter(sqlite, 'contests');
  for (const [key, rows] of Object.entries(CONSTITUENCIES)) {
    for (const row of rows) {
      const slug = /^northern-ireland-forum/.test(key) && slugOf(row.name) === 'northern-ireland' ? 'regional-list' : slugOf(row.name);
      k.add({ election_key: key, seq: row.seq, name: row.name, slug, electorate: row.electorate, turnout_pct: row.turnoutPct, seats_total: row.seatsTotal, quota: row.quota, meta: '{}' });
    }
  }
  const c = new TableWriter(sqlite, 'candidacies');
  for (const [id, rows] of Object.entries(CANDIDATES)) {
    const [key, seq] = id.split('#');
    rows.forEach((row, i) => c.add({ election_key: key, contest_seq: Number(seq), ord: i, name: row.name, party_label: row.party, elected: row.elected, first_prefs: 1000 - i, meta: '{}' }));
  }
});

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
  const party = await lookupBrowseRecord(env, 'parties', 'sinn-fein');
  check('lookup: party from D1 party_cards', party?.title === 'Sinn Féin' && party?.slug === 'sinn-fein', JSON.stringify(party));
  const retired = await lookupBrowseRecord(env, 'parties', 'sinn-fein-sinn-fein');
  check('lookup: retired party slug resolves to its party (301)', retired?.slug === 'sinn-fein', JSON.stringify(retired));
  check('lookup: absent party is null (404)', (await lookupBrowseRecord(env, 'parties', 'no-such-party')) === null);
  const ssrContest = await (await import('../functions/_templates/records/election.js')).loadElectionPage(env.ELECTIONS_DB, await lookupBrowseRecord(env, 'elections', 'dail-eireann-2024-11-29-cork-north-central'));
  check('ssr: contest page loads its candidates from candidacies', ssrContest?.kind === 'contest' && ssrContest.candidates.length === 2, JSON.stringify(ssrContest?.kind));
  const { electionBody } = await import('../functions/_templates/records/election.js');
  const { toHtmlString } = await import('../functions/_lib/html.js');
  const contestHtml = toHtmlString(electionBody(ssrContest, {}).body);
  check('ssr: contest body lists the candidates, escaped', contestHtml.includes('Pádraig O&#39;Sullivan') || contestHtml.includes("Pádraig O&#x27;Sullivan") || contestHtml.includes('Pádraig O'), contestHtml.slice(0, 200));

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
  check('page: a failed lookup is a 200 with the generic head, never a 404', down.status === 200 && titleOf(await down.text()) === 'Browse – Civgraph', String(down.status));

  const bare = await get('persons', '/browse/persons/');
  check('page: no slug goes to the list', bare.status === 302 && bare.headers.get('Location') === 'https://civgraph.net/browse/#/persons', `${bare.status} ${bare.headers.get('Location')}`);

  const encoded = await get('elections', '/browse/elections/dail-eireann__2024-11-29');
  check('page: an election by key redirects to its slug', encoded.status === 301 && encoded.headers.get('Location').endsWith('/browse/elections/dail-eireann-2024-11-29'), `${encoded.status} ${encoded.headers.get('Location')}`);

  const party = await get('parties', '/browse/parties/uup');
  check('page: a party answers 200 with its title', party.status === 200 && titleOf(await party.text()) === 'Ulster Unionist Party – Party / label – Civgraph', String(party.status));
  const folded = await get('parties', '/browse/parties/uup-farmer');
  check('page: a folded ballot-paper label redirects to its party (301)', folded.status === 301 && folded.headers.get('Location') === 'https://civgraph.net/browse/parties/uup', `${folded.status} ${folded.headers.get('Location')}`);

  const office = await get('offices', '/browse/offices/alliance-chair');
  check('page: an office answers 200 with its title, from D1', office.status === 200 && titleOf(await office.text()) === 'Chair of the Alliance Party – Office – Civgraph', String(office.status));
  const noOffice = await get('offices', '/browse/offices/no-such-office');
  check('page: an absent office answers 404', noOffice.status === 404, String(noOffice.status));
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
