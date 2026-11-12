// Each fact with its original source (QA launch-readiness H5, 11 Nov 2026): results pages cite
// the newspapers, returns and books a contest's provenance names, with links where there is a
// URL, and Civgraph's own index only as a "compiled in" note. Covers the elections API's
// view=citations, the server-rendered election, contest and person pages, and Browse (its
// Sources panel and its fact references), over a records database built from the migrations.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import vm from 'node:vm';
import { migrationFiles, TableWriter, transaction } from '../../packages/loader/src/db.mjs';
import { onRequestGet as electionsApi } from '../../packages/api/src/handlers/elections/index.js';
import { loadElectionPage, loadPersonContestSources } from '../../packages/api/src/pages/election.js';
import { electionBody } from '../../packages/ui/src/templates/records/election.js';
import { personBody } from '../../packages/ui/src/templates/records/person.js';
import { toHtmlString } from '../../packages/core/src/html.js';

const PREFIX = 'data/elections-source/data/elections/';
const sqlite = new DatabaseSync(':memory:');
for (const file of migrationFiles()) sqlite.exec(readFileSync(file, 'utf8'));
const NEWS = { title: 'Belfast News-Letter, 5 September 1946, p. 5 ("Municipal elections: complete list of nominations")', publisher: 'Belfast News-Letter (via the Irish Newspaper Archives)', url: null, kind: 'news' };
const GAZETTE = { title: 'Belfast Gazette, issue 1404, 20 September 1946, p. 300', publisher: 'The Stationery Office', url: 'https://www.thegazette.co.uk/Belfast/issue/1404/page/300', kind: 'official' };
const EI = { title: null, publisher: null, url: 'https://electionsireland.org/result.cfm?election=2024&cons=85', host: 'electionsireland.org', kind: null };
transaction(sqlite, () => {
  const e = new TableWriter(sqlite, 'r_elections');
  e.add({ key: 'belfast-county-borough-council__1946-09-18', slug: 'belfast-county-borough-council-1946-09-18', body_slug: 'belfast-county-borough-council', display_title: '1946 Belfast County Borough Council election', body: 'Belfast County Borough Council', date: '1946-09-18', ord: 0, meta: '{}' });
  e.add({ key: 'dail-eireann__2024-11-29', slug: 'dail-eireann-2024-11-29', body_slug: 'dail-eireann', display_title: '2024 Irish general election', body: 'Dáil Éireann', date: '2024-11-29', ord: 1, meta: '{}' });
  const k = new TableWriter(sqlite, 'contests');
  k.add({ election_key: 'belfast-county-borough-council__1946-09-18', seq: 0, name: 'Clifton', slug: 'clifton', source_file: `${PREFIX}belfast-county-borough-council/1946-09-18/clifton.json`, meta: '{}' });
  k.add({ election_key: 'belfast-county-borough-council__1946-09-18', seq: 5, name: 'Falls', slug: 'falls', source_file: `${PREFIX}belfast-county-borough-council/1946-09-18/falls.json`, seats_total: 3, electorate: 10771, meta: JSON.stringify({ contestStatus: 'uncontested' }) });
  k.add({ election_key: 'dail-eireann__2024-11-29', seq: 3, name: 'Dublin Central', slug: 'dublin-central', source_file: `${PREFIX}dail-eireann/2024-11-29/dublin-central.json`, meta: '{}' });
  const c = new TableWriter(sqlite, 'candidacies');
  c.add({ election_key: 'belfast-county-borough-council__1946-09-18', contest_seq: 5, ord: 0, person_id: '141958', name: 'Patrick B. Gregory', party_label: 'Nationalist Party', elected: 1, status: 'Elected unopposed', meta: '{}' });
  c.add({ election_key: 'belfast-county-borough-council__1946-09-18', contest_seq: 0, ord: 0, person_id: '1', name: 'John Kennedy', party_label: 'UUP', elected: 1, first_prefs: 6148, status: 'Elected', meta: '{}' });
  const ci = new TableWriter(sqlite, 'citations');
  const cite = (file, ord, s) => ci.add({ subject_type: 'contest', subject_key: file, ord, title: s.title, publisher: s.publisher, url: s.url, host: s.host || null, kind: s.kind, citation: JSON.stringify(s) });
  cite('belfast-county-borough-council/1946-09-18/falls.json', 0, NEWS);
  cite('belfast-county-borough-council/1946-09-18/falls.json', 1, GAZETTE);
  cite('belfast-county-borough-council/1946-09-18/clifton.json', 0, NEWS);
  cite('dail-eireann/2024-11-29/dublin-central.json', 0, EI);
});

function d1() {
  return {
    prepare(sql) {
      const statement = sqlite.prepare(sql);
      const bound = (...args) => ({
        async first() { return statement.get(...args) ?? null; },
        async all() { return { results: statement.all(...args) }; },
      });
      return { ...bound(), bind: bound };
    },
  };
}
const api = async (query) => (await electionsApi({ request: new Request(`https://civgraph.net/_api/elections?${query}`), env: { ELECTIONS_DB: d1() } })).json();

test('view=citations: a contest, by number or name, gives its citations in order', async () => {
  const bySeq = await api('view=citations&key=belfast-county-borough-council__1946-09-18&constituency=5');
  assert.deepEqual(bySeq.citations.map((c) => c.title), [NEWS.title, GAZETTE.title]);
  assert.equal(bySeq.citations[1].url, GAZETTE.url);
  const byName = await api('view=citations&key=belfast-county-borough-council-1946-09-18&constituencyName=falls');
  assert.deepEqual(byName.citations, bySeq.citations, 'by slug and a name in any case');
});

test('view=citations: an election gives its distinct sources, most cited first, out of its contests', async () => {
  const answer = await api('view=citations&key=belfast-county-borough-council__1946-09-18');
  assert.equal(answer.contests, 2);
  assert.deepEqual(answer.sources.map((s) => [s.title, s.contests]), [[NEWS.title, 2], [GAZETTE.title, 1]]);
});

test('view=citations: a person gives the citations of each contest they stood in', async () => {
  const answer = await api('view=citations&person=141958');
  assert.equal(answer.candidacies.length, 1);
  assert.equal(answer.candidacies[0].constituency, 'Falls');
  assert.deepEqual(answer.candidacies[0].citations.map((c) => c.kind), ['news', 'official']);
  assert.deepEqual((await api('view=citations&person=999')).candidacies, []);
});

test('SSR election, contest and person pages list the original sources, with links, and no Civgraph index', async () => {
  const election = await loadElectionPage(d1(), { slug: 'belfast-county-borough-council-1946-09-18', electionKey: 'belfast-county-borough-council__1946-09-18' });
  const electionHtml = toHtmlString(electionBody(election, {}).body);
  assert.match(electionHtml, /<h2 id="sources">Sources<\/h2>/);
  assert.match(electionHtml, /Belfast News-Letter, 5 September 1946, p\. 5[^<]*<\/[^>]+> – Belfast News-Letter \(via the Irish Newspaper Archives\); 2 of 2 contests|Belfast News-Letter, 5 September 1946/);
  assert.match(electionHtml, /href="https:\/\/www\.thegazette\.co\.uk\/Belfast\/issue\/1404\/page\/300"/);
  assert.match(electionHtml, /Compiled in Civgraph/);
  assert.doesNotMatch(electionHtml, /Browse election index/);

  const contest = await loadElectionPage(d1(), { slug: 'belfast-county-borough-council-1946-09-18-falls', electionKey: 'belfast-county-borough-council__1946-09-18', contestSeq: 5 });
  const contestHtml = toHtmlString(electionBody(contest, {}).body);
  assert.match(contestHtml, /Belfast News-Letter, 5 September 1946/);
  assert.match(contestHtml, /href="https:\/\/www\.thegazette\.co\.uk\/Belfast\/issue\/1404\/page\/300"/);

  const dublin = await loadElectionPage(d1(), { slug: 'dail-eireann-2024-11-29-dublin-central', electionKey: 'dail-eireann__2024-11-29', contestSeq: 3 });
  const dublinHtml = toHtmlString(electionBody(dublin, {}).body);
  assert.match(dublinHtml, /<a[^>]*href="https:\/\/electionsireland\.org\/result\.cfm\?election=2024&amp;cons=85"[^>]*>electionsireland\.org<\/a>/, 'a URL-only citation is named by its site');

  const contestSources = await loadPersonContestSources(d1(), '141958');
  const personHtml = toHtmlString(personBody({ name: 'Patrick B. Gregory', id: '141958', elections: [{ key: 'belfast-county-borough-council__1946-09-18', title: '1946 Belfast County Borough Council election', constituency: 'Falls' }], contestSources }, {}).body);
  assert.match(personHtml, /<h2 id="sources">Sources<\/h2>/);
  assert.match(personHtml, /href="\/browse\/elections\/belfast-county-borough-council-1946-09-18-falls">1946 Belfast County Borough Council election: Falls<\/a>/);
  assert.match(personHtml, /Belfast News-Letter, 5 September 1946/);
});

async function loadBrowse(fetchJson) {
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
    fetch: async (url) => {
      const body = await fetchJson(String(url));
      return { ok: body !== null, status: body === null ? 404 : 200, json: async () => body };
    },
    console: { log() {}, warn() {}, error() {}, info() {} },
    setTimeout, clearTimeout, URL, URLSearchParams,
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    navigator: {}, requestAnimationFrame: () => 0, performance: { now: () => 0 },
    IntersectionObserver: class { observe() {} }, ResizeObserver: class { observe() {} }, MutationObserver: class { observe() {} },
    CustomEvent: class {}, Event: class {}, AbortController,
  };
  ctx.window = ctx;
  ctx.self = ctx;
  const imports = {};
  let source = readFileSync('site/browse/browse.js', 'utf8');
  for (const [, , spec] of source.matchAll(/^import\s*\{([^}]*)\}\s*from\s*'([^']+)';/gm)) {
    imports[spec] = await import(new URL(spec, new URL('../../site/browse/browse.js', import.meta.url)).href);
  }
  source = source.replace(/^import\s*\{([^}]*)\}\s*from\s*'([^']+)';/gm, (_m, names, spec) => `const {${names}} = __imports[${JSON.stringify(spec)}];`);
  ctx.__imports = imports;
  vm.createContext(ctx);
  vm.runInContext(source, ctx, { filename: 'browse.js' });
  return (code) => vm.runInContext(code, ctx);
}

// Browse fetches the same API the tests above answer.
const browse = await loadBrowse(async (url) => {
  const query = url.replace(/^\/_api\/elections\?/, '');
  return url.startsWith('/_api/elections?') ? api(query) : null;
});

test('Browse contest, election and person pages show a Sources panel of the original sources', async () => {
  const contest = await browse('renderOriginalSourcesPanel')('elections', { entryKind: 'election-constituency-result', parentElectionKey: 'belfast-county-borough-council__1946-09-18', constituency: 'Falls' });
  assert.match(contest, /<h2>Sources<\/h2>/);
  assert.match(contest, /Belfast News-Letter, 5 September 1946, p\. 5[\s\S]*\(newspaper\)/);
  assert.match(contest, /<a href="https:\/\/www\.thegazette\.co\.uk\/Belfast\/issue\/1404\/page\/300" target="_blank" rel="noopener noreferrer">Belfast Gazette/);
  assert.match(contest, /Compiled in Civgraph/);

  const election = await browse('renderOriginalSourcesPanel')('elections', { entryKind: 'election', key: 'belfast-county-borough-council__1946-09-18' });
  assert.match(election, /<td>2 of 2<\/td>/);
  const person = await browse('renderOriginalSourcesPanel')('persons', { id: '141958', elections: [{ key: 'belfast-county-borough-council__1946-09-18', title: '1946 Belfast County Borough Council election', date: '1946-09-18', constituency: 'Falls' }] });
  assert.match(person, /href="#\/elections\/belfast-county-borough-council-1946-09-18-falls"/);
  assert.match(person, /Belfast Gazette/);
  assert.equal(await browse('renderOriginalSourcesPanel')('persons', { id: '999' }), '');
});

test('Browse facts: the original source first and linked, Civgraph\'s index only as "compiled in"', () => {
  const html = browse('renderGraphStatement')({
    propertyLabel: 'date', valueText: '1946-09-18',
    references: [
      { sourceId: 'cg:source:civgraph-browse-election-index', sourceTitle: 'Civgraph Browse election index', sourceKind: 'generated-browse-index' },
      { sourceTitle: GAZETTE.title, sourceKind: 'official', sourceUrl: GAZETTE.url },
    ],
  });
  const gazette = html.indexOf('Belfast Gazette');
  const compiled = html.indexOf('Compiled in Civgraph Browse election index');
  assert.ok(gazette > 0 && compiled > gazette, html);
  assert.match(html, /<a href="https:\/\/www\.thegazette\.co\.uk\/Belfast\/issue\/1404\/page\/300"/);
  assert.doesNotMatch(html, /original sources under Sources/);
  // Data built before the provenance reached the graph: the index alone points to the Sources panel.
  const alone = browse('renderGraphStatement')({ propertyLabel: 'date', valueText: '1946', references: [{ sourceId: 'cg:source:civgraph-browse-person-index', sourceTitle: 'Civgraph Browse person index', sourceKind: 'generated-browse-index' }] });
  assert.match(alone, /Compiled in Civgraph Browse person index; original sources under Sources/);
  // A citation URL is data: anything but http(s) is not linked.
  const bad = browse('renderGraphStatement')({ propertyLabel: 'x', valueText: 'y', references: [{ sourceTitle: 'Bad', sourceUrl: 'javascript:alert(1)' }] });
  assert.doesNotMatch(bad, /href=/);
});
