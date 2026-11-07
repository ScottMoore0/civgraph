/**
 * Retired election and contest slugs (functions/_lib/election-slug-aliases.js) keep working:
 * the Browse page answers a 301, the elections API answers a 301, and browse.js maps the old
 * #/ address to the new one from the same list.
 *
 * The two North Down by-elections renamed on 7 Nov 2026 (1993 Holywood, 1975 North Down Area B)
 * are checked from the data too: the index names the area, the file alias finds the contest's
 * file, the file names the area, and the old and new slugs are the ones the build gives.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { browsePageHandler, resolveElectionSlugAlias } from '../../functions/_browse-page.js';
import { ELECTION_SLUG_ALIASES, RETIRED_CONTEST_SLUGS } from '../../functions/_lib/election-slug-aliases.js';
import { slugify } from '../../functions/_lib/format.js';
import { canonicalElectionTitle } from '../../scripts/lib/election-names.mjs';
import { onRequestGet as electionsApi, retiredSlugRedirect } from '../../functions/_api/elections/index.js';
import { resetDatasetVersionCache } from '../../functions/_lib/respond.js';
import { migrationFiles, TableWriter, transaction } from '@civgraph/loader/db.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => JSON.parse(readFileSync(path.join(ROOT, rel), 'utf8'));
const SHELL = readFileSync(path.join(ROOT, 'browse', 'index.html'), 'utf8');

// The two by-elections: their election keys, the index name ARK's import code gave them, the
// area's own name, and the contest file both names point at.
const RENAMED = [
  {
    key: 'local-government-north-down__1993-10-20',
    body: 'North Down',
    date: '1993-10-20',
    oldName: 'lg93-NoD-Holywood',
    name: 'Holywood',
    file: 'lg93-nod-holywood.json',
  },
  {
    key: 'local-government-local-government-districts__1975-05-29',
    body: 'North Down',
    date: '1975-05-29',
    oldName: 'lg73-NoD-Area-B',
    name: 'North Down Area B',
    file: 'lg73-nod-area-b.json',
  },
];

test('the renamed by-elections: index, file alias and contest file all name the area', () => {
  const index = read('data/elections-source/data/elections_index.json');
  const aliases = read('data/elections/corrections/election-source-file-aliases.json').aliases;
  const flat = index.bodies.flatMap((b) => (b.dates || []).map((d) => ({ ...d, body: b.name })));
  for (const c of RENAMED) {
    const entry = flat.find((d) => d.body === c.body && d.date === c.date);
    assert.ok(entry, `${c.body} ${c.date} is in the index`);
    assert.deepEqual(entry.constituencies, [c.name], `${c.date}: the index names the area, not the import code`);
    assert.equal(aliases[c.key]?.[c.name], c.file, `${c.key}: the file alias finds the contest's file`);
    const file = `data/elections-source/data/elections/local-government/${c.date}/${c.file}`;
    assert.ok(existsSync(path.join(ROOT, file)), file);
    assert.equal(read(file).Constituency.countInfo.Constituency_Name, c.name, `${file} names the area`);
  }
  // The 1993 by-election stands alone on its day, so its title is the area's name.
  const holywood = flat.find((d) => d.body === 'North Down' && d.date === '1993-10-20');
  assert.equal(canonicalElectionTitle({ ...holywood, key: RENAMED[0].key, bodySlug: 'local-government', bodyGroup: 'local-government' }), '1993 Holywood by-election');
});

test('the old contest slugs resolve to the new ones, and nothing else moves', () => {
  for (const c of RENAMED) {
    const election = slugify(c.key);
    const old = `${election}-${slugify(c.oldName)}`;
    const now = `${election}-${slugify(c.name)}`;
    assert.equal(resolveElectionSlugAlias(old), now);
    assert.equal(resolveElectionSlugAlias(old.toUpperCase()), now, 'case does not matter');
    assert.equal(resolveElectionSlugAlias(now), now, 'the new slug is unchanged');
    assert.equal(resolveElectionSlugAlias(election), election, 'the election itself is unchanged');
    assert.equal(resolveElectionSlugAlias(`${election}-overall-results`), `${election}-overall-results`);
  }
  // The general rounds of 1973 and 1993 keep their own contests.
  assert.equal(resolveElectionSlugAlias('local-government-local-government-districts-1973-05-30-north-down-area-b'), 'local-government-local-government-districts-1973-05-30-north-down-area-b');
  assert.equal(resolveElectionSlugAlias('local-government-local-government-districts-1975-05-29-belfast-area-b'), 'local-government-local-government-districts-1975-05-29-belfast-area-b');
});

test('browse.js maps the same retired slugs for #/ addresses', () => {
  const source = readFileSync(path.join(ROOT, 'browse', 'browse.js'), 'utf8');
  const block = source.match(/const RENAMED_RECORD_PREFIXES = \[([\s\S]*?)\n\];/);
  assert.ok(block, 'browse.js has RENAMED_RECORD_PREFIXES');
  const pairs = [...block[1].matchAll(/\[\s*'([^']+)',\s*'([^']+)'\s*\]/g)].map((m) => [m[1], m[2]]);
  assert.deepEqual(pairs, ELECTION_SLUG_ALIASES, 'browse.js and functions/_lib/election-slug-aliases.js hold the same list');
  const exact = source.match(/const RETIRED_CONTEST_SLUGS = \[([\s\S]*?)\n\];/);
  assert.ok(exact, 'browse.js has RETIRED_CONTEST_SLUGS');
  const exactPairs = [...exact[1].matchAll(/\[\s*'([^']+)',\s*'([^']+)'\s*\]/g)].map((m) => [m[1], m[2]]);
  assert.deepEqual(exactPairs, RETIRED_CONTEST_SLUGS, 'browse.js and functions/_lib/election-slug-aliases.js hold the same retired contests');
});

// The contest files the November 2026 council rounds deleted, renamed or refiled (12cd5ac496,
// 22c749eecb): their published addresses answer 301 to where the content lives now.
const RETIRED = new Map([
  ['belfast-rural-district-council-1936-06-04-dundonald', 'castlereagh-rural-district-council-1936-06-04-dundonald'],
  ['dungannon-rural-district-council-1952-06-05-aughnacloy', 'dungannon-rural-district-council-1952-06-05-clonaneese'],
  ['newry-no-1-rural-district-council-1949-06-02-dromore', 'newry-no-1-rural-district-council-1949-06-02-damolly'],
  ['newry-no-1-rural-district-council-1949-06-02-glenn', 'newry-no-1-rural-district-council-1949-06-02-glen'],
  ['bangor-borough-council-1952-05-21-castle-ward', 'bangor-borough-council-1952-05-21-castle-ward-councillors'],
  ['larne-borough-council-1964-05-20-gardenmore-ward-aldermanship', 'larne-borough-council-1964-05-20-gardenmore-ward-alderman'],
  ['lisnaskea-rural-district-council-1927-05-25-springfield', 'lisnaskea-rural-district-council-1927-05-25-springtown'],
  ['dungannon-rural-district-council-1936-06-03-bernagh', 'dungannon-rural-district-council-1936-06-03'],
]);
const sitemapSlugs = () => new Set([...readFileSync(path.join(ROOT, 'sitemaps', 'browse-elections.xml'), 'utf8')
  .matchAll(/<loc>https:\/\/civgraph\.net\/browse\/elections\/([^<]+)<\/loc>/g)].map((m) => m[1]));

// The district electoral areas of the general local elections of 1973-2011 that the index
// names by ARK's import code ("lg85-NoD-Holywood"): Browse published them under those names
// (data/browse/details/elections, 7308b71203, June 2026) and they took the area's own name
// before the first sitemap. Read from the index, so a coded name added later is caught too.
const GENERAL_ROUNDS = ['1973-05-30', '1977-05-18', '1981-05-20', '1985-05-15', '1989-05-17', '1993-05-19', '1997-05-21', '2001-06-07', '2005-05-05', '2011-05-05'];
const DISTRICTS = 'local-government-local-government-districts';
function arkCodedSlugs() {
  const index = read('data/elections-source/data/elections_index.json');
  const slugs = new Set();
  for (const body of index.bodies) {
    for (const d of body.dates || []) {
      if (!GENERAL_ROUNDS.includes(d.date)) continue;
      for (const name of d.constituencies || []) {
        if (/^lg\d{2}-[a-z]{3}-/i.test(name)) slugs.add(`${DISTRICTS}-${d.date}-${slugify(name)}`);
      }
    }
  }
  return [...slugs].sort();
}
// Holywood's seven, by name.
const HOLYWOOD = [['1985-05-15', 'lg85'], ['1989-05-17', 'lg89'], ['1993-05-19', 'lg93'], ['1997-05-21', 'lg97'], ['2001-06-07', 'lg01'], ['2005-05-05', 'lg05'], ['2011-05-05', 'lg11']]
  .map(([date, code]) => [`${DISTRICTS}-${date}-${code}-nod-holywood`, `${DISTRICTS}-${date}-holywood`]);

test('the ARK-coded district electoral areas of 1973-2011 resolve to their own names, exactly', () => {
  const live = sitemapSlugs();
  const coded = arkCodedSlugs();
  assert.ok(coded.length >= 97, `${coded.length} coded names in the index`);
  const retired = new Map(RETIRED_CONTEST_SLUGS);
  for (const old of coded) {
    if (live.has(old)) {
      // Never renamed (Lg77-ANT-Area-B): its address stands.
      assert.ok(!retired.has(old), `${old} is live and not retired`);
      continue;
    }
    const now = resolveElectionSlugAlias(old);
    assert.notEqual(now, old, `${old} answered 404 and has no redirect`);
    assert.ok(live.has(now), `${old} -> ${now}, a live address`);
    assert.equal(now.slice(0, DISTRICTS.length + 11), old.slice(0, DISTRICTS.length + 11), `${old} stays in its round`);
    assert.equal(resolveElectionSlugAlias(old.toUpperCase()), now, 'case does not matter');
    assert.equal(resolveElectionSlugAlias(`${old}-x`), `${old}-x`, 'matched exactly');
  }
  for (const [old, now] of HOLYWOOD) assert.equal(resolveElectionSlugAlias(old), now, old);
  // The 1993 and 2001 Ballyholme and Groomsport ("Ballyholme-&-Groomsport") read "and".
  assert.equal(resolveElectionSlugAlias(`${DISTRICTS}-1993-05-19-lg93-nod-ballyholme-and-groomsport`), `${DISTRICTS}-1993-05-19-ballyholme-and-groomsport`);
  // The 1973-81 lettered areas carry their district's name, as the 1975 by-election does.
  assert.equal(resolveElectionSlugAlias(`${DISTRICTS}-1973-05-30-lg73-nam-area-a`), `${DISTRICTS}-1973-05-30-newry-and-mourne-area-a`);
  // Every coded entry of the list is one of the index's coded names.
  for (const [old] of RETIRED_CONTEST_SLUGS) {
    if (old.startsWith(`${DISTRICTS}-`)) assert.ok(coded.includes(old), `${old} is a coded name in the index`);
  }
});

test('retired contest slugs resolve to where the contest is now, and only those slugs', () => {
  assert.deepEqual(new Map(RETIRED_CONTEST_SLUGS.filter(([old]) => !old.startsWith(`${DISTRICTS}-`))), RETIRED);
  for (const [old, now] of RETIRED) {
    assert.equal(resolveElectionSlugAlias(old), now, old);
    assert.equal(resolveElectionSlugAlias(old.toUpperCase()), now, 'case does not matter');
    assert.equal(resolveElectionSlugAlias(now), now, `${now} is unchanged`);
  }
  // Matched exactly: the contests that continue a retired slug keep their own.
  for (const slug of [
    'bangor-borough-council-1952-05-21-castle-ward-alderman',
    'bangor-borough-council-1952-05-21-castle-ward-councillors',
    'larne-borough-council-1964-05-20-gardenmore-ward',
    'belfast-rural-district-council-1936-06-04',
    'belfast-rural-district-council-1936-06-04-ballyduff',
  ]) assert.equal(resolveElectionSlugAlias(slug), slug, slug);
});

test('every retired contest slug is gone from the sitemap and every target is in it', () => {
  const live = sitemapSlugs();
  for (const [old, now] of RETIRED) {
    assert.ok(!live.has(old), `${old} is not a live address`);
    assert.ok(live.has(now), `${now} is a live address`);
  }
  for (const [from] of ELECTION_SLUG_ALIASES) assert.ok(!live.has(from), `${from} is not a live address`);
});

// A records database with the two elections and their contests under the new names.
const sqlite = new DatabaseSync(':memory:');
for (const file of migrationFiles()) sqlite.exec(readFileSync(file, 'utf8'));
transaction(sqlite, () => {
  const elections = new TableWriter(sqlite, 'r_elections');
  const contests = new TableWriter(sqlite, 'contests');
  RENAMED.forEach((c, ord) => {
    elections.add({ key: c.key, slug: slugify(c.key), body_slug: 'local-government', body: c.body, body_group: 'local-government', display_title: `${c.date.slice(0, 4)} ${c.name} by-election`, date: c.date, year: Number(c.date.slice(0, 4)), ord, meta: '{}' });
    contests.add({ election_key: c.key, seq: 0, name: c.name, slug: slugify(c.name), seats_total: 1, meta: '{}' });
  });
  // Rounds the retired contest slugs lead to: a contest refiled under another council, a
  // retitled contest beside one that continues its old slug, and a round whose contest is held.
  [
    ['castlereagh-rural-district-council__1936-06-04', 'Castlereagh Rural District Council', ['Dundonald']],
    ['belfast-rural-district-council__1936-06-04', 'Belfast Rural District Council', ['Ballyduff']],
    ['bangor-borough-council__1952-05-21', 'Bangor Borough Council', ['Castle Ward (Alderman)', 'Castle Ward (Councillors)']],
    ['dungannon-rural-district-council__1936-06-03', 'Dungannon Rural District Council', ['Altmore']],
    ['local-government-local-government-districts__1985-05-15', 'Local Government Districts', ['Holywood', 'Abbey']],
  ].forEach(([key, body, names], i) => {
    const date = key.split('__')[1];
    elections.add({ key, slug: slugify(key), body_slug: key.split('__')[0], body, body_group: 'local-government', display_title: `${body} ${date.slice(0, 4)}`, date, year: Number(date.slice(0, 4)), ord: 10 + i, meta: '{}' });
    names.forEach((name, seq) => contests.add({ election_key: key, seq, name, slug: slugify(name), seats_total: 1, meta: '{}' }));
  });
});

function d1() {
  return {
    prepare(sql) {
      const api = (args) => ({
        async first() { return sqlite.prepare(sql).get(...args) ?? null; },
        async all() { return { results: sqlite.prepare(sql).all(...args) }; },
      });
      return { bind: (...args) => api(args), ...api([]) };
    },
  };
}

const ASSETS = {
  async fetch(request) {
    return new URL(request.url).pathname === '/browse/' ? new Response(SHELL, { status: 200 }) : new Response('nf', { status: 404 });
  },
};

async function browse(slug) {
  resetDatasetVersionCache();
  const request = new Request(`https://civgraph.net/browse/elections/${slug}`);
  return browsePageHandler('elections')({ request, env: { ELECTIONS_DB: d1(), ASSETS } });
}

test('the Browse page answers an old contest address with a 301 to the new one', async () => {
  for (const c of RENAMED) {
    const election = slugify(c.key);
    const res = await browse(`${election}-${slugify(c.oldName)}`);
    assert.equal(res.status, 301, c.key);
    assert.equal(res.headers.get('Location'), `https://civgraph.net/browse/elections/${election}-${slugify(c.name)}`);
    const now = await browse(`${election}-${slugify(c.name)}`);
    assert.equal(now.status, 200);
    assert.ok((await now.text()).includes(`<title>${c.name} - ${c.date.slice(0, 4)} ${c.name} by-election – Civgraph</title>`));
  }
});

test('the elections API answers an old contest slug with a 301 to the new one', async () => {
  const [holywood, areaB] = RENAMED;
  const byContest = retiredSlugRedirect(new URL(`https://civgraph.net/_api/elections?key=${holywood.key}&contest=lg93-nod-holywood`));
  assert.equal(byContest.status, 301);
  assert.equal(byContest.headers.get('Location'), `https://civgraph.net/_api/elections?key=${holywood.key}&contest=holywood`);
  const record = retiredSlugRedirect(new URL(`https://civgraph.net/_api/elections?view=record&slug=${slugify(areaB.key)}-lg73-nod-area-b`));
  assert.equal(record.status, 301);
  assert.equal(record.headers.get('Location'), `https://civgraph.net/_api/elections?view=record&slug=${slugify(areaB.key)}-north-down-area-b`);
  assert.equal(retiredSlugRedirect(new URL(`https://civgraph.net/_api/elections?key=${holywood.key}&contest=holywood`)), null);
  assert.equal(retiredSlugRedirect(new URL(`https://civgraph.net/_api/elections?view=record&slug=${slugify(areaB.key)}-belfast-area-b`)), null);
  assert.equal(retiredSlugRedirect(new URL(`https://civgraph.net/_api/elections?key=${holywood.key}`)), null);
  // Through the route itself, before any database read.
  const res = await electionsApi({ request: new Request(`https://civgraph.net/_api/elections?key=${holywood.key}&contest=lg93-nod-holywood`), env: {} });
  assert.equal(res.status, 301);
});

test('the Browse page answers a retired contest address with a 301 to where it is now', async () => {
  for (const [old, now] of [
    ['belfast-rural-district-council-1936-06-04-dundonald', 'castlereagh-rural-district-council-1936-06-04-dundonald'],
    ['bangor-borough-council-1952-05-21-castle-ward', 'bangor-borough-council-1952-05-21-castle-ward-councillors'],
    ['dungannon-rural-district-council-1936-06-03-bernagh', 'dungannon-rural-district-council-1936-06-03'],
  ]) {
    const res = await browse(old);
    assert.equal(res.status, 301, old);
    assert.equal(res.headers.get('Location'), `https://civgraph.net/browse/elections/${now}`);
    assert.equal((await browse(now)).status, 200, now);
  }
  // The contests beside them answer as they did.
  for (const slug of ['bangor-borough-council-1952-05-21-castle-ward-alderman', 'belfast-rural-district-council-1936-06-04-ballyduff']) {
    assert.equal((await browse(slug)).status, 200, slug);
  }
});

test('the elections API sends a retired contest within its round to the new one', () => {
  const key = 'bangor-borough-council__1952-05-21';
  const res = retiredSlugRedirect(new URL(`https://civgraph.net/_api/elections?key=${key}&contest=castle-ward`));
  assert.equal(res.status, 301);
  assert.equal(res.headers.get('Location'), `https://civgraph.net/_api/elections?key=${key}&contest=castle-ward-councillors`);
  assert.equal(retiredSlugRedirect(new URL(`https://civgraph.net/_api/elections?key=${key}&contest=castle-ward-alderman`)), null);
  const record = retiredSlugRedirect(new URL('https://civgraph.net/_api/elections?view=record&slug=dungannon-rural-district-council-1936-06-03-bernagh'));
  assert.equal(record.headers.get('Location'), 'https://civgraph.net/_api/elections?view=record&slug=dungannon-rural-district-council-1936-06-03');
});

test('the Browse page and the elections API send the ARK-coded Holywood addresses to Holywood', async () => {
  const old = `${DISTRICTS}-1985-05-15-lg85-nod-holywood`;
  const res = await browse(old);
  assert.equal(res.status, 301);
  assert.equal(res.headers.get('Location'), `https://civgraph.net/browse/elections/${DISTRICTS}-1985-05-15-holywood`);
  assert.equal((await browse(`${DISTRICTS}-1985-05-15-holywood`)).status, 200);
  assert.equal((await browse(`${DISTRICTS}-1985-05-15-abbey`)).status, 200);
  const key = `${DISTRICTS}__2011-05-05`;
  const api = retiredSlugRedirect(new URL(`https://civgraph.net/_api/elections?key=${key}&contest=lg11-nod-holywood`));
  assert.equal(api.status, 301);
  assert.equal(api.headers.get('Location'), `https://civgraph.net/_api/elections?key=${key}&contest=holywood`);
  const record = retiredSlugRedirect(new URL(`https://civgraph.net/_api/elections?view=record&slug=${DISTRICTS}-1997-05-21-lg97-nod-holywood`));
  assert.equal(record.headers.get('Location'), `https://civgraph.net/_api/elections?view=record&slug=${DISTRICTS}-1997-05-21-holywood`);
  assert.equal(retiredSlugRedirect(new URL(`https://civgraph.net/_api/elections?key=${key}&contest=holywood`)), null);
});
