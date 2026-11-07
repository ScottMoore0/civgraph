/**
 * The server-rendered record pages (functions/_templates/records/, step F3a) and the flag
 * that keeps them off the live routes (functions/_browse-page.js).
 *
 * D1 is node:sqlite with the browse_* columns the page reads, so the page's SQL really runs.
 * String snapshots of each template live in record-pages.test.mjs.snapshot; after an
 * intended template change, refresh them with
 *   node --test --test-update-snapshots tests/functions/record-pages.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { browsePageHandler, resolveElectionSlugAlias } from '../../functions/_browse-page.js';
import { resetDatasetVersionCache } from '../../functions/_lib/respond.js';
import { candidacyLinks, personBody } from '../../functions/_templates/records/person.js';
import { registerInterestBody } from '../../functions/_templates/records/register-interest.js';
import { sourceBody } from '../../functions/_templates/records/source.js';
import { ssrMode } from '../../functions/_templates/records/index.js';
import { migrationFiles, TableWriter, transaction } from '../../scripts/records/db.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SHELL = readFileSync(path.join(ROOT, 'browse', 'index.html'), 'utf8');

const GROUPED_NI = {
  id: 'ni-local__1946', key: 'ni-local__1946', slug: 'ni-local-1946', entryKind: 'election',
  title: '1946 Northern Ireland local elections',
  description: 'The council elections held in Northern Ireland in 1946 for which Civgraph holds results.',
  interactiveUrl: '/maps/#electionBody=Northern+Ireland+local+elections&electionDate=1946',
};
const GROUPED_IRELAND = {
  id: 'ireland-local__1911', key: 'ireland-local__1911', slug: 'ireland-local-1911', entryKind: 'election',
  title: '1911 Irish local elections', description: 'The council elections held in Ireland in 1911.',
  interactiveUrl: '/maps/#electionBody=Irish+local+elections&electionDate=1911',
};

export const PERSON = {
  id: '27771',
  slug: 'gerry-adams-27771',
  title: 'Gerry Adams',
  name: 'Gerry Adams',
  subtitle: 'Sinn Féin / 1982-2016 / 15 contests',
  parties: [{ name: 'Sinn Féin', count: 15 }],
  constituencies: [{ name: 'Belfast West', count: 12 }, { name: 'Louth', count: 2 }, { name: 'Northern Ireland', count: 1 }],
  bodies: ['House of Commons of the United Kingdom', 'Dáil Éireann', 'Northern Ireland Forum for Political Dialogue'],
  totals: { stood: 15, elected: 13, firstPrefs: 206792 },
  firstYear: 1982,
  lastYear: 2016,
  born: '1948-10-06',
  bornSource: 'Wikidata',
  wikidata: 'Q76139',
  interactiveUrl: '/maps/#layers=election-dail-eireann-2016-02-26',
  previousSlugs: ['name-gerry-adams', 'gerry-adams'],
  elections: [
    { key: 'dail-eireann__2016-02-26', title: '2016 Irish general election', date: '2016-02-26', year: 2016, party: 'Sinn Féin', constituency: 'Louth', status: 'Made Quota', elected: true, firstPrefs: 10661, share: 15.79 },
    { key: 'northern-ireland-forum-for-political-dialogue__1996-05-30', title: '1996 Northern Ireland Forum election', date: '1996-05-30', year: 1996, party: 'Sinn Féin', constituency: 'Northern Ireland', status: 'Elected', elected: true },
    { key: 'house-of-commons-of-the-united-kingdom__1983-06-09', title: '1983 UK general election in Northern Ireland', date: '1983-06-09', year: 1983, party: 'Sinn Féin', partyAsPrinted: 'Provisional Sinn Féin', constituency: 'Belfast West', status: 'Elected', elected: true, firstPrefs: 16379, share: 37.94 },
  ],
  officialProfiles: [
    { source: 'UK Parliament', label: 'UK Parliament Members API', url: 'https://members.parliament.uk/member/645/career', licence: 'Open Parliament Licence' },
    { source: 'Bad', label: 'A javascript: link is dropped', url: 'javascript:alert(1)' },
  ],
  relatives: [{ relation: 'brother', name: 'Example <Relative>', slug: 'example-relative-1' }],
};

export const SOURCE = {
  id: 'medium-priority:ambient-sound-monitoring-network:02124',
  slug: 'ambient-sound-monitoring-network-02124',
  title: 'Ambient Sound Monitoring Network DCC',
  subtitle: 'Local authority open-data layers / Dublin City Council, data.gov.ie',
  category: 'Local authority planning/property/open-data layers',
  provider: ['Dublin City Council', 'data.gov.ie'],
  description: 'Ambient Sound Monitoring Network DCC is published as a source record.',
  url: 'https://data.gov.ie/dataset/ambient-sound-monitoring-network',
  status: 'Source ready',
  statusChips: ['Source record', 'Approved'],
  sourceHierarchy: ['Books / Tables / Sources', 'Republic of Ireland', 'Ambient Sound Monitoring Network DCC'],
  viewport: { waybackUrl: 'https://web.archive.org/web/*/https://data.gov.ie/dataset/ambient-sound-monitoring-network' },
  shortCitation: 'Dublin City Council, data.gov.ie, Ambient Sound Monitoring Network DCC.',
  license: { status: 'provider-specific', note: 'Confirm the licence on the provider page.' },
  referenceCount: 4,
  keywords: ['opendata-ie', 'noise'],
  relatedRecords: [{ kind: 'browse-source', id: 'map-source', title: 'Related source' }, { kind: 'database-map', id: 'x', title: 'A map' }],
};

export const REGISTER = {
  id: 'ni-register-record:c57dd5a03792b6c1',
  slug: 'ni-register-record-c57dd5a03792b6c1',
  title: 'Cathal Boylan - Assembly - 2014-11-14',
  categories: ['Directorships', 'Land and Property'],
  date: '2014-11-14',
  dateStart: '2014-11-14',
  dateEnd: '2014-11-14',
  description: 'Elected/Public Office: Board of Governors. Unremunerated.',
  memberType: 'MLA',
  memberName: 'Cathal Boylan',
  personSlug: 'cathal-boylan-97831',
  electedBody: 'Assembly',
  chamber: 'Northern Ireland Assembly',
  constituency: 'Newry and Armagh',
  constituencies: ['Newry and Armagh'],
  interestCount: 13,
  nonNilInterestCount: 3,
  sourceKinds: ['historical-pdf-register', 'historical-html-register'],
  sourceCount: 23,
  isNone: false,
};

const sqlite = new DatabaseSync(':memory:');
// The records tables (person_cards, sources, register_entries and the person aliases), as the
// records loader creates them from migrations/.
for (const file of migrationFiles()) sqlite.exec(readFileSync(file, 'utf8'));
transaction(sqlite, () => {
  const card = (table, r, key) => new TableWriter(sqlite, table).add({ slug: r.slug, id: r.id, key_norm: key, ord: 0, card: JSON.stringify(r) });
  card('person_cards', PERSON, 'gerry-adams');
  new TableWriter(sqlite, 'person_cards').add({ slug: 'broken-1', id: '1', key_norm: 'broken', ord: 1, card: JSON.stringify({ id: '1', slug: 'broken-1', name: 'Broken', relatives: 'not-an-array' }) });
  card('sources', SOURCE, SOURCE.slug);
  card('register_entries', REGISTER, REGISTER.slug);
  new TableWriter(sqlite, 'person_aliases').add({ alias: 'name-gerry-adams', slug: PERSON.slug });
  // An id merged away into him (a re-stamp's retired id), as person_aliases records it.
  new TableWriter(sqlite, 'person_aliases').add({ alias: '99901', slug: PERSON.slug });
  // Two grouped local-election years: Browse cards only, no r_elections row.
  for (const [ord, year] of [[0, GROUPED_NI], [1, GROUPED_IRELAND]]) {
    new TableWriter(sqlite, 'election_cards').add({ slug: year.slug, id: year.key, key: year.key, entry_kind: 'election', election_key: year.key, title: year.title, ord, card: JSON.stringify(year) });
  }
});

function d1({ fail = false } = {}) {
  return {
    prepare(sql) {
      const run = (args) => {
        if (fail) throw new Error('D1 unavailable');
        return sqlite.prepare(sql);
      };
      const api = (args) => ({
        async first() { return run(args).get(...args) ?? null; },
        async all() { return { results: run(args).all(...args) }; },
      });
      return { bind: (...args) => api(args), ...api([]) };
    },
  };
}

const ASSETS = {
  async fetch(request) {
    const { pathname } = new URL(request.url);
    if (pathname === '/browse/') return new Response(SHELL, { status: 200 });
    // The grouped years' committed static files, as Pages serves them.
    if (/^\/render\/metadata\/(ni-local\/\d{4}|ni-local-coverage)\.json$/.test(pathname)) {
      try { return new Response(readFileSync(path.join(ROOT, pathname.slice(1)), 'utf8'), { status: 200 }); } catch { /* absent */ }
    }
    return new Response('nf', { status: 404 });
  },
};

async function get(type, pathAndQuery, env = {}, headers = {}) {
  resetDatasetVersionCache();
  const request = new Request(`https://civgraph.net/browse/${type}/${pathAndQuery}`, { headers });
  return browsePageHandler(type)({ request, env: { ELECTIONS_DB: d1(), ASSETS, ...env } });
}

const ON = { CIVGRAPH_SSR_RECORDS: 'persons,sources,register-interests' };

test('without a flag the live route is unchanged: the Browse shell with the record head', async () => {
  const res = await get('persons', PERSON.slug);
  assert.equal(res.status, 200);
  const body = await res.text();
  assert.ok(body.includes('id="browseHero"'), 'the Browse app shell');
  assert.ok(body.includes('<title>Gerry Adams – Person – Civgraph</title>'));
  assert.ok(!body.includes('cg-record-header'));
});

test('?ssr=1 is ignored unless previews are enabled', async () => {
  const body = await (await get('persons', `${PERSON.slug}?ssr=1`)).text();
  assert.ok(body.includes('id="browseHero"'));
});

test('with the flag each type renders completely on the server', async () => {
  for (const [type, record, heading] of [['persons', PERSON, 'Gerry Adams'], ['sources', SOURCE, SOURCE.title], ['register-interests', REGISTER, REGISTER.title]]) {
    const res = await get(type, record.slug, ON);
    assert.equal(res.status, 200, type);
    assert.equal(res.headers.get('Content-Type'), 'text/html; charset=utf-8');
    assert.equal(res.headers.get('Cache-Control'), 'public, max-age=300');
    assert.match(res.headers.get('ETag'), /^"records-1-files-[0-9a-f]{20}"$/);
    const body = await res.text();
    assert.ok(body.startsWith('<!DOCTYPE html>'), type);
    assert.ok(body.includes(`<h1>${heading}</h1>`), type);
    assert.ok(body.includes(`<link rel="canonical" href="https://civgraph.net/browse/${type}/${record.slug}">`), type);
    assert.ok(body.includes('<main id="main-content"'), type);
    assert.ok(body.includes('<nav class="cg-section-nav" aria-label="Breadcrumb">'), type);
    assert.ok(body.includes('application/ld+json'), type);
    assert.ok(!body.includes('noindex'), type);
    assert.ok(!body.includes('browse.js'), `${type}: needs no client app`);
  }
});

test('the person page carries the candidacies, links and escaped data', async () => {
  const body = await (await get('persons', PERSON.slug, ON)).text();
  assert.ok(body.includes('<a href="/browse/elections/dail-eireann-2016-02-26">2016 Irish general election</a>'));
  assert.ok(body.includes('<a href="/browse/elections/dail-eireann-2016-02-26-louth">Louth</a>'));
  assert.ok(body.includes('href="/browse/elections/northern-ireland-forum-for-political-dialogue-1996-05-30-regional-list"'));
  assert.ok(body.includes('(printed: Provisional Sinn Féin)'));
  assert.ok(body.includes('<td class="cg-num">10,661</td><td class="cg-num">15.8%</td>'));
  assert.ok(body.includes('Example &lt;Relative&gt;'));
  assert.ok(!body.includes('href="javascript:'), 'unsafe URLs never reach an href');
  assert.ok(body.includes('"birthDate":"1948-10-06"'));
});

test('an old address redirects to the canonical slug and keeps the query', async () => {
  const res = await get('persons', '27771?ssr=1', { CIVGRAPH_SSR_PREVIEW: '1' });
  assert.equal(res.status, 301);
  assert.equal(res.headers.get('Location'), `https://civgraph.net/browse/persons/${PERSON.slug}?ssr=1`);
  const aliased = await get('persons', 'name-gerry-adams', ON);
  assert.equal(aliased.status, 301);
});

test('a person slug whose id was retired or whose name changed redirects through its id', async () => {
  // A merged-away id's published slug: the id is an alias of the person it joined.
  const merged = await get('persons', 'g-adams-99901', ON);
  assert.equal(merged.status, 301);
  assert.equal(merged.headers.get('Location'), `https://civgraph.net/browse/persons/${PERSON.slug}`);
  // The same id under an earlier form of the name.
  const renamed = await get('persons', 'gerard-adams-27771?ssr=1', ON);
  assert.equal(renamed.status, 301);
  assert.equal(renamed.headers.get('Location'), `https://civgraph.net/browse/persons/${PERSON.slug}?ssr=1`);
  // An id that is no one's stays a 404.
  assert.equal((await get('persons', 'nobody-424242', ON)).status, 404);
});

test('a preview is noindex and uncached', async () => {
  const res = await get('sources', `${SOURCE.slug}?ssr=1`, { CIVGRAPH_SSR_PREVIEW: '1' });
  assert.equal(res.headers.get('Cache-Control'), 'private, no-store');
  assert.ok((await res.text()).includes('<meta name="robots" content="noindex">'));
});

test('a missing record is a 404 shell and an outage the generic shell, as before', async () => {
  const missing = await get('persons', 'nobody-0', ON);
  assert.equal(missing.status, 404);
  assert.ok((await missing.text()).includes('id="browseHero"'));
  resetDatasetVersionCache();
  const down = await browsePageHandler('persons')({ request: new Request(`https://civgraph.net/browse/persons/${PERSON.slug}`), env: { ELECTIONS_DB: d1({ fail: true }), ASSETS, ...ON } });
  assert.equal(down.status, 200);
  assert.ok((await down.text()).includes('<title>Browse – Civgraph</title>'));
});

test('a record the template cannot render falls back to the shell', async () => {
  const res = await get('persons', 'broken-1', ON);
  assert.equal(res.status, 200);
  assert.ok((await res.text()).includes('id="browseHero"'));
});

test('a matching If-None-Match gets a 304', async () => {
  const first = await get('register-interests', REGISTER.slug, ON);
  const etag = first.headers.get('ETag');
  const again = await get('register-interests', REGISTER.slug, ON, { 'If-None-Match': etag });
  assert.equal(again.status, 304);
  assert.equal(await again.text(), '');
});

test('ssrMode reads the flags', () => {
  const url = new URL('https://civgraph.net/browse/persons/x?ssr=1');
  assert.deepEqual(ssrMode({}, 'persons', url), { ssr: false, preview: false });
  assert.deepEqual(ssrMode({ CIVGRAPH_SSR_RECORDS: 'all' }, 'sources', url), { ssr: true, preview: false });
  // Elections and parties have templates since phase 2 (records tables); maps do not yet.
  assert.deepEqual(ssrMode({ CIVGRAPH_SSR_RECORDS: 'all' }, 'elections', url), { ssr: true, preview: false });
  assert.deepEqual(ssrMode({ CIVGRAPH_SSR_RECORDS: 'all' }, 'maps', url), { ssr: false, preview: false });
  assert.deepEqual(ssrMode({ CIVGRAPH_SSR_PREVIEW: '1' }, 'persons', url), { ssr: true, preview: true });
});

test('candidacy links follow the election and contest slug rules', () => {
  assert.deepEqual(candidacyLinks({ key: 'dail-eireann__2024-11-29', constituency: 'Cork North-Central' }),
    { election: '/browse/elections/dail-eireann-2024-11-29', contest: '/browse/elections/dail-eireann-2024-11-29-cork-north-central' });
  assert.deepEqual(candidacyLinks({}), { election: '', contest: '' });
});

test('template snapshots', (t) => {
  const canonical = 'https://civgraph.net/browse/x';
  t.assert.snapshot(String(personBody(PERSON, { canonical }).body));
  t.assert.snapshot(String(sourceBody(SOURCE, { canonical }).body));
  t.assert.snapshot(String(registerInterestBody(REGISTER, { canonical }).body));
});

test('a grouped local-election year renders from its card and year file, server-side', async () => {
  const res = await get('elections', 'ni-local-1946');
  assert.equal(res.status, 200);
  const body = await res.text();
  assert.ok(body.includes('<title>1946 Northern Ireland local elections – Civgraph</title>'));
  assert.ok(body.includes('<link rel="canonical" href="https://civgraph.net/browse/elections/ni-local-1946">'));
  const year = JSON.parse(readFileSync(path.join(ROOT, 'render/metadata/ni-local/1946.json'), 'utf8'));
  // Every round links to its own page; the partial ones say so.
  for (const round of year.rounds) assert.ok(body.includes(`href="/browse/elections/${round.key.replace('__', '-')}"`), round.key);
  assert.match(body, /\d+ council rounds, [\d,]+ contests; \d+ complete, \d+ partial/);
  // A partial round carries its completeness line (data/elections/round-completeness.json), read
  // from the year file so the test follows the data as rounds are filled.
  const partial = year.rounds.find((round) => round.status === 'partial' && round.note);
  assert.ok(partial, 'the 1946 year file has a partial round with a note');
  assert.ok(body.includes(`(partial: ${partial.note.split('. ')[0]}`), 'a partial round carries its note');
  assert.match(body, /Hatched on the map, where results are not available or incomplete: [\d,]+ of [\d,]+ wards and DEDs/);
  assert.ok(body.includes('href="/maps/#electionBody=Northern+Ireland+local+elections&amp;electionDate=1946">Open the year on the map</a>'));
  assert.equal((body.match(/id="browseHero"/g) || []).length, 1);

  const before = await get('elections', 'ireland-local-1911');
  assert.equal(before.status, 200);
  const text = await before.text();
  assert.ok(text.includes('<h1 class="browse-title">1911 Irish local elections</h1>'));
  assert.ok(text.includes('Council rounds'));
});

test('a grouped year by its key redirects to its slug; a year that is not there is a 404', async () => {
  const res = await get('elections', 'ni-local__1946');
  assert.equal(res.status, 301);
  assert.equal(res.headers.get('location'), 'https://civgraph.net/browse/elections/ni-local-1946');
  assert.equal((await get('elections', 'ni-local-1800')).status, 404);
});

test('the Carrickfergus 1955 aldermanic contests keep their published "-2" addresses', () => {
  const base = 'carrickfergus-borough-council-1955-05-18';
  assert.equal(resolveElectionSlugAlias(`${base}-east-central-ward-2`), `${base}-east-central-ward-alderman`);
  assert.equal(resolveElectionSlugAlias(`${base}-west-ward-2`), `${base}-west-ward-alderman`);
  assert.equal(resolveElectionSlugAlias(`${base}-east-central-ward`), `${base}-east-central-ward`, 'the councillor contest is unchanged');
});
