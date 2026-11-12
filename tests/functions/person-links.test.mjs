/**
 * Fast links (12 Nov 2026, site QA): a contest page links each candidate to the person's own
 * page, /browse/persons/<slug>, which answers 200, not to /browse/persons/<id>, which answers a
 * 301 to it (an extra hop and an extra D1 read a click). The id address still redirects, for old
 * links. The contest's link to its election names the election's slug, not its key (a 301 too).
 *
 * The records database is the migrations' schema in node:sqlite, so the API's, the page
 * handler's and Browse's code and SQL really run: Browse (site/browse/browse.js) in a sandbox
 * whose fetch is the API handler, the person and election pages through their Function.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import vm from 'node:vm';
import { migrationFiles, TableWriter, transaction } from '../../packages/loader/src/db.mjs';
import { onRequestGet as electionsApi } from '../../packages/api/src/handlers/elections/index.js';
import { onRequestGet as personsApi } from '../../packages/api/src/handlers/persons/index.js';
import { resetDatasetVersionCache } from '../../packages/api/src/respond.js';
import { browsePageHandler } from '../../functions/_browse-page.js';

const SHELL = readFileSync('site/browse/index.html', 'utf8');
const KEY = 'dail-eireann__2024-11-29';
const CONTEST = 'dail-eireann-2024-11-29-cork-north-central';

// Two people: one whose candidacy spells the name as the record does, one whose candidacy does
// not ("R. V. Campbell", the record "Robert Campbell"), so a slug made from the candidacy's
// spelling would miss; and a candidate with no person.
const PEOPLE = [
  { id: '102046', slug: 'padraig-o-sullivan-102046', name: 'Pádraig O\'Sullivan', candidacy: 'Pádraig O\'Sullivan' },
  { id: '47167', slug: 'robert-campbell-47167', name: 'Robert Campbell', candidacy: 'R. V. Campbell' },
];

const sqlite = new DatabaseSync(':memory:');
for (const file of migrationFiles()) sqlite.exec(readFileSync(file, 'utf8'));
transaction(sqlite, () => {
  new TableWriter(sqlite, 'r_elections').add({ key: KEY, slug: 'dail-eireann-2024-11-29', body_slug: 'dail-eireann', display_title: '2024 Irish general election', body: 'Dáil Éireann', date: '2024-11-29', ord: 0, meta: '{}' });
  new TableWriter(sqlite, 'contests').add({ election_key: KEY, seq: 0, name: 'Cork North Central', slug: 'cork-north-central', seats_total: 4, meta: '{}' });
  const c = new TableWriter(sqlite, 'candidacies');
  PEOPLE.forEach((p, ord) => c.add({ election_key: KEY, contest_seq: 0, ord, person_id: p.id, name: p.candidacy, party_label: 'Independent', first_prefs: 9000 - ord, elected: 1, status: 'Elected', meta: '{}' }));
  c.add({ election_key: KEY, contest_seq: 0, ord: 2, person_id: null, name: 'A. Nobody', party_label: 'Independent', first_prefs: 10, elected: 0, status: 'Excluded', meta: '{}' });
  const cards = new TableWriter(sqlite, 'person_cards');
  PEOPLE.forEach((p, ord) => cards.add({ slug: p.slug, id: p.id, key_norm: p.slug, ord, card: JSON.stringify({ id: p.id, slug: p.slug, title: p.name, name: p.name }) }));
});

function d1() {
  return {
    prepare(sql) {
      const statement = sqlite.prepare(sql);
      const bound = (/** @type {unknown[]} */ ...args) => ({
        async first() { return statement.get(...args) ?? null; },
        async all() { return { results: statement.all(...args) }; },
      });
      return { ...bound(), bind: bound };
    },
  };
}
const env = (extra = {}) => ({ ELECTIONS_DB: d1(), ASSETS: { fetch: async (r) => new Response(new URL(r.url).pathname === '/browse/' ? SHELL : 'nf', { status: new URL(r.url).pathname === '/browse/' ? 200 : 404 }) }, ...extra });

/** A Browse record page's answer, as the Function gives it. @param {string} address  /browse/<type>/<slug> */
async function page(address, extra = {}) {
  resetDatasetVersionCache();
  const type = address.split('/')[2];
  return browsePageHandler(type)({ request: new Request(`https://civgraph.net${address}`), env: env(extra) });
}
const apiJson = async (handler, query) => (await handler({ request: new Request(`https://civgraph.net/_api/x?${query}`), env: env() })).json();

/** Browse in a sandbox: the API handlers answer its fetches. */
async function loadBrowse() {
  const handler = {
    get: (_t, prop) => (prop === Symbol.toPrimitive ? () => '' : prop === 'then' ? undefined : prop === 'dataset' ? {} : prop === 'length' ? 0 : inert),
    apply: () => inert, construct: () => inert, set: () => true,
  };
  const inert = new Proxy(function inertElement() {}, handler);
  const answer = async (url) => {
    const query = url.replace(/^[^?]*\?/, '');
    if (url.startsWith('/_api/elections?')) return electionsApi({ request: new Request(`https://civgraph.net${url}`), env: env() });
    if (url.startsWith('/_api/persons?')) return personsApi({ request: new Request(`https://civgraph.net/_api/persons?${query}`), env: env() });
    return new Response('nf', { status: 404 });
  };
  const ctx = {
    document: inert,
    location: { hash: '', pathname: '/browse/', search: '', href: 'https://civgraph.net/browse/' },
    history: { replaceState() {}, pushState() {} },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    fetch: async (url) => answer(String(url)),
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
const browse = await loadBrowse();

test('the contest API names each candidate\'s own page slug (personSlug, from person_cards)', async () => {
  const answer = await apiJson(electionsApi, `key=${KEY}&constituencyName=Cork%20North%20Central`);
  assert.deepEqual(answer.candidates.map((c) => [c.name, c.personId, c.personSlug]), [
    ['Pádraig O\'Sullivan', '102046', 'padraig-o-sullivan-102046'],
    ['R. V. Campbell', '47167', 'robert-campbell-47167'],
    ['A. Nobody', null, null],
  ]);
});

test('Browse\'s contest page links each candidate to their page, which answers 200 directly', async () => {
  const panel = await browse('renderContestResultPanel')({ entryKind: 'election-constituency-result', parentElectionKey: KEY, constituency: 'Cork North Central' });
  const routes = [...panel.matchAll(/href="(#\/persons\/[^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(routes, PEOPLE.map((p) => `#/persons/${p.slug}`), 'one link a person, by slug; none for the candidate with no person');
  assert.match(panel, />A\. Nobody</);
  for (const route of routes) {
    // The address the app shows and "Copy link address" gives (shareableRecordLinks).
    const address = browse('addressForRoute')(route);
    assert.match(address, /^\/browse\/persons\/[a-z0-9-]+$/);
    const res = await page(address);
    assert.equal(res.status, 200, `${address} answers directly`);
    assert.equal(res.headers.get('Location'), null);
    // In the app the same slug is one API read that finds the record.
    assert.equal((await apiJson(personsApi, `slug=${address.split('/').pop()}`)).record?.id, PEOPLE[routes.indexOf(route)].id);
  }
});

test('the id address still redirects to the slug, for old links', async () => {
  const res = await page('/browse/persons/47167');
  assert.equal(res.status, 301);
  assert.equal(res.headers.get('Location'), 'https://civgraph.net/browse/persons/robert-campbell-47167');
  // Why Browse links by the record's slug, never one made from the candidacy's spelling: in the
  // app that slug is not a record (the page itself would still find it by the id and redirect).
  assert.equal((await personsApi({ request: new Request('https://civgraph.net/_api/persons?slug=r-v-campbell-47167'), env: env() })).status, 404);
  assert.equal((await page('/browse/persons/r-v-campbell-47167')).status, 301);
});

test('the server-rendered contest page links each candidate to a page that answers 200', async () => {
  const res = await page(`/browse/elections/${CONTEST}`, { CIVGRAPH_SSR_RECORDS: 'elections' });
  assert.equal(res.status, 200);
  const body = await res.text();
  const links = [...body.matchAll(/href="(\/browse\/persons\/[^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(links, PEOPLE.map((p) => `/browse/persons/${p.slug}`));
  for (const address of links) assert.equal((await page(address)).status, 200, address);
});

test('a contest links its election by the election\'s slug, which answers 200 (its key answers 301)', async () => {
  const html = browse('renderElectionRelated')({ entryKind: 'election-constituency-result', parentElectionKey: KEY, parentBrowseUrl: `/browse/elections/${KEY}`, parentTitle: '2024 Irish general election', date: '2024-11-29' });
  const route = /href="(#\/elections\/[^"]+)"/.exec(html)?.[1];
  assert.equal(route, '#/elections/dail-eireann-2024-11-29');
  const address = browse('addressForRoute')(route);
  assert.equal((await page(address)).status, 200, address);
  assert.equal((await page(`/browse/elections/${KEY}`)).status, 301, 'the key form still redirects');
});
