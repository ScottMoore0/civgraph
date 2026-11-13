/**
 * Retired election and contest slugs (packages/core/src/election-slug-aliases.js) keep working:
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
import { ELECTION_SLUG_ALIASES, RETIRED_CONTEST_SLUGS } from '../../packages/core/src/election-slug-aliases.js';
import { slugify } from '../../packages/core/src/format.js';
import { canonicalElectionTitle } from '../../scripts/lib/election-names.mjs';
import { onRequestGet as electionsApi, retiredSlugRedirect } from '../../packages/api/src/handlers/elections/index.js';
import { resetDatasetVersionCache } from '../../packages/api/src/respond.js';
import { migrationFiles, TableWriter, transaction } from '../../packages/loader/src/db.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => JSON.parse(readFileSync(path.join(ROOT, rel), 'utf8'));
const SHELL = readFileSync(path.join(ROOT, 'site', 'browse', 'index.html'), 'utf8');

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
  const source = readFileSync(path.join(ROOT, 'site', 'browse', 'browse.js'), 'utf8');
  const block = source.match(/const RENAMED_RECORD_PREFIXES = \[([\s\S]*?)\n\];/);
  assert.ok(block, 'browse.js has RENAMED_RECORD_PREFIXES');
  const pairs = [...block[1].matchAll(/\[\s*'([^']+)',\s*'([^']+)'\s*\]/g)].map((m) => [m[1], m[2]]);
  assert.deepEqual(pairs, ELECTION_SLUG_ALIASES, 'browse.js and packages/core/src/election-slug-aliases.js hold the same list');
  const exact = source.match(/const RETIRED_CONTEST_SLUGS = \[([\s\S]*?)\n\];/);
  assert.ok(exact, 'browse.js has RETIRED_CONTEST_SLUGS');
  const exactPairs = [...exact[1].matchAll(/\[\s*'([^']+)',\s*'([^']+)'\s*\]/g)].map((m) => [m[1], m[2]]);
  assert.deepEqual(exactPairs, RETIRED_CONTEST_SLUGS, 'browse.js and packages/core/src/election-slug-aliases.js hold the same retired contests');
});

// Council divisions filed under a misprint or garbled reading in one round, renamed on 12 Nov 2026
// to the name the cited page prints and the other rounds file (w8-redirects): body, date, the
// old name, the new.
const RENAMED_DIVISIONS = [
  ['castlereagh-rural-district-council', '1964-06-04', 'Holywood', 'Holywood Rural'],
  ['ballymena-rural-district-council', '1946-10-03', 'Ballykullion', 'Ballyscullion'],
  ['south-down-rural-district-council', '1936-06-04', 'Lismore', 'Lisnacree'],
  ['south-down-rural-district-council', '1936-06-04', 'Maghereagh', 'Maghera'],
  ['coleraine-rural-district-council', '1967-06-01', 'Slaughtneil', 'Slaght'],
  ['limavady-rural-district-council', '1964-06-04', 'Ballyrena', 'Bellarena'],
  ['castlederg-rural-district-council', '1936-06-03', 'Clue', 'Clare'],
  ['castlederg-rural-district-council', '1936-06-03', 'Lisnacicon', 'Lisnacloon'],
  ['castlederg-rural-district-council', '1967-06-01', 'Lisnagloch', 'Lisnacloon'],
  ['omagh-rural-district-council', '1933-05-31', 'Groenan', 'Greenan'],
  ['omagh-rural-district-council', '1933-05-31', 'Moyroe', 'Moyle'],
];
/** @returns {[string, string][]} each renamed division's old contest slug and its new one */
function renamedDivisionSlugs() {
  return RENAMED_DIVISIONS.map(([body, date, old, now]) => [`${body}-${date}-${slugify(old)}`, `${body}-${date}-${slugify(now)}`]);
}

test('the renamed council divisions: the file, its name and the index all carry the new name', () => {
  const index = read('data/elections-source/data/elections_index.json');
  for (const [body, date, old, now] of RENAMED_DIVISIONS) {
    const dir = `data/elections-source/data/elections/${body}/${date}`;
    assert.ok(!existsSync(path.join(ROOT, dir, `${slugify(old)}.json`)), `${dir}/${slugify(old)}.json is gone`);
    const file = `${dir}/${slugify(now)}.json`;
    assert.ok(existsSync(path.join(ROOT, file)), file);
    const contest = read(file);
    assert.equal(contest.Constituency.countInfo.Constituency_Name, now, `${file} names the division`);
    assert.match(contest.correctionNote, new RegExp(`Renamed from '${old}' to ${now}`), `${file} records the rename`);
    const entry = index.bodies.find((b) => b.slug === body)?.dates?.find((d) => d.date === date);
    assert.ok(entry, `${body} ${date} is in the index`);
    assert.ok(entry.constituencies.includes(now) && !entry.constituencies.includes(old), `${body} ${date}: the index names ${now}, not ${old}`);
  }
});

// Divisions spelt two or three ways across rounds, given one name each on 13 Nov 2026 by the
// owner's rule (the official or DED-map name where there is one, otherwise the spelling most
// rounds use): body, the name now, and each round filed under another spelling.
const SPELLING_FAMILIES = [
  ['north-down-rural-district-council', 'Quintin', [['1946-10-03', 'Quinton']]],
  ['dungannon-rural-district-council', 'Bernagh', [['1930-06-04', 'Beragh']]],
  ['dungannon-rural-district-council', 'Crossdernot', [['1924-05-28', 'Crossdernott'], ['1927-06-01', 'Crossdernott'], ['1930-06-04', 'Crowdernott'], ['1933-05-31', 'Crossdernott'], ['1936-06-03', 'Crossdernott'], ['1939-05-31', 'Crossdernott'], ['1949-06-02', 'Crossdernott'], ['1952-06-05', 'Crossdernott'], ['1964-06-04', 'Crossdernott'], ['1967-06-01', 'Crossdernott']]],
  ['dungannon-rural-district-council', 'Aghnahoe', [['1924-05-28', 'Anahoe'], ['1930-06-04', 'Anahoe'], ['1933-05-31', 'Anahoe'], ['1936-06-03', 'Anahoe'], ['1946-10-03', 'Anahoe'], ['1949-06-02', 'Anahoe'], ['1961-06-01', 'Anahoe'], ['1964-06-04', 'Anahoe'], ['1967-06-01', 'Anahoe']]],
  ['coleraine-rural-district-council', 'Lislea', [['1949-06-02', 'Lislen']]],
  ['coleraine-rural-district-council', 'Ballylagan', [['1924-05-30', 'Ballylaggan'], ['1927-05-27', 'Ballylaggan'], ['1930-06-05', 'Ballylaggan'], ['1933-06-02', 'Ballylaggan'], ['1939-06-02', 'Ballylaggan'], ['1946-10-31', 'Ballylaggan'], ['1949-06-02', 'Ballylaggan'], ['1952-06-05', 'Ballylaggan'], ['1955-06-02', 'Ballylaggan'], ['1958-06-05', 'Ballylaggan']]],
  ['coleraine-rural-district-council', 'Bovagh', [['1946-10-31', 'Boveagh']]],
  ['coleraine-rural-district-council', 'Drumcroon', [['1946-10-31', 'Drumacroon'], ['1961-06-01', 'Drumcrow']]],
  ['coleraine-rural-district-council', 'Slaght', [['1958-06-05', 'Slaught'], ['1961-06-01', 'Slight']]],
  ['coleraine-rural-district-council', 'The Grove', [['1924-05-30', 'Grove'], ['1933-06-02', 'Grove'], ['1939-06-02', 'Grove'], ['1949-06-02', 'Grove']]],
  ['coleraine-rural-district-council', 'Portstewart Rural', [['1924-05-30', 'Portstewart'], ['1949-06-02', 'Portstewart']]],
  ['limavady-rural-district-council', 'Ballyharigan', [['1924-05-30', 'Ballyhargan'], ['1927-05-27', 'Ballyhargan'], ['1933-06-02', 'Ballyhargan'], ['1939-06-02', 'Ballyharrigan'], ['1946-10-31', 'Ballyharrigan'], ['1949-06-02', 'Ballyharrigan'], ['1952-06-05', 'Ballyharrigan'], ['1955-06-02', 'Ballyharrigan']]],
  ['limavady-rural-district-council', 'Drumraighland', [['1924-05-30', 'Drumreighland'], ['1927-05-27', 'Drumreighland'], ['1930-06-05', 'Drumreighland'], ['1933-06-02', 'Drumreighland'], ['1936-06-02', 'Drumreighland'], ['1939-06-02', 'Drumreighland'], ['1946-10-31', 'Drumreighland'], ['1952-06-05', 'Drumreighland'], ['1961-06-01', 'Drumreighland']]],
  ['limavady-rural-district-council', 'Gelvin', [['1924-05-30', 'Galvin']]],
  ['limavady-rural-district-council', 'The Highlands', [['1939-06-02', 'Highlands']]],
  ['londonderry-rural-district-council', 'Liberties Lower', [['1927-05-27', 'Lower Liberties'], ['1930-06-05', 'Lower Liberties'], ['1933-06-02', 'Lower Liberties'], ['1936-06-02', 'Lower Liberties'], ['1946-10-31', 'Lower Liberties'], ['1949-06-02', 'Lower Liberties'], ['1952-06-05', 'Lower Liberties'], ['1958-06-05', 'Lower Liberties'], ['1961-06-01', 'Lower Liberties'], ['1964-06-04', 'Lower Liberties']]],
  ['londonderry-rural-district-council', 'Liberties Middle', [['1927-05-27', 'Middle Liberties'], ['1930-06-05', 'Middle Liberties'], ['1933-06-02', 'Middle Liberties'], ['1936-06-02', 'Middle Liberties'], ['1946-10-31', 'Middle Liberties'], ['1949-06-02', 'Middle Liberties'], ['1952-06-05', 'Middle Liberties'], ['1958-06-05', 'Middle Liberties'], ['1961-06-01', 'Middle Liberties'], ['1964-06-04', 'Middle Liberties'], ['1967-06-01', 'Middle Liberties']]],
  ['londonderry-rural-district-council', 'Liberties Upper', [['1927-05-27', 'Upper Liberties'], ['1930-06-05', 'Upper Liberties'], ['1933-06-02', 'Upper Liberties'], ['1936-06-02', 'Upper Liberties'], ['1946-10-31', 'Upper Liberties'], ['1949-06-02', 'Upper Liberties'], ['1952-06-05', 'Upper Liberties'], ['1958-06-05', 'Upper Liberties'], ['1961-06-01', 'Upper Liberties'], ['1964-06-04', 'Upper Liberties']]],
  ['londonderry-rural-district-council', 'Ballymullins', [['1927-05-27', 'Ballymullan'], ['1930-06-05', 'Ballymullan'], ['1933-06-02', 'Ballymullan'], ['1939-06-02', 'Ballymullan'], ['1952-06-05', 'Ballymullan'], ['1961-06-01', 'Ballymullan'], ['1964-06-04', 'Ballymullan']]],
  ['londonderry-rural-district-council', 'Waterside', [['1961-06-01', 'Waterside Rural']]],
];
/** @returns {[string, string][]} each respelt division's old contest slug and its new one */
function spellingFamilySlugs() {
  return SPELLING_FAMILIES.flatMap(([body, now, rounds]) => rounds.map(([date, old]) => /** @type {[string, string]} */ ([`${body}-${date}-${slugify(old)}`, `${body}-${date}-${slugify(now)}`])));
}
// Two 1979 Dublin Corporation contests filed under ElectionsIreland's later area names, renamed to
// the areas of the time (S.I. No. 41/1979) on 13 Nov 2026.
const DUBLIN_1979 = [
  ['ireland-local-1979-06-07-north-inner-city', 'ireland-local-1979-06-07-area-no-6-ballybough-drumcondra-south-north-dock'],
  ['ireland-local-1979-06-07-pembroke', 'ireland-local-1979-06-07-area-no-10-mansion-house-pembroke'],
];

test('the respelt council divisions: one name per division, every round renamed, the index and note agree', () => {
  const index = read('data/elections-source/data/elections_index.json');
  let rounds = 0;
  for (const [body, now, renamed] of SPELLING_FAMILIES) {
    const olds = new Set(renamed.map(([, old]) => old));
    for (const entry of index.bodies.find((b) => b.slug === body)?.dates || []) {
      for (const name of entry.constituencies || []) assert.ok(!olds.has(name), `${body} ${entry.date} still names ${name}`);
    }
    for (const [date, old] of renamed) {
      rounds += 1;
      const dir = `data/elections-source/data/elections/${body}/${date}`;
      assert.ok(!existsSync(path.join(ROOT, dir, `${slugify(old)}.json`)), `${dir}/${slugify(old)}.json is gone`);
      const file = `${dir}/${slugify(now)}.json`;
      const contest = read(file);
      assert.equal(contest.Constituency.countInfo.Constituency_Name, now, `${file} names the division`);
      assert.ok(String(contest.correctionNote).includes(`Renamed from '${old}' to ${now}`), `${file} records the spelling it was filed under`);
    }
  }
  assert.equal(rounds, 101);
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
  ['bangor-borough-council-1938-05-16-bangor-7-seats', 'bangor-borough-council-1938-05-16'],
  // Belfast 1961, filed under the year until its poll date (17 May 1961) was found: the election,
  // its overall results and each ward's contest, councillors and aldermen.
  ...[['belfast-county-borough-council', ['clifton', 'court', 'cromac', 'dock', 'duncairn', 'falls', 'ormeau', 'pottinger', 'shankill',
    'smithfield', 'st-anne-s', 'st-george-s', 'victoria', 'windsor', 'woodvale']],
  ['belfast-county-borough-council-aldermen', ['clifton', 'dock', 'duncairn', 'falls', 'shankill', 'st-anne-s', 'woodvale']]]
    .flatMap(([body, wards]) => ['', '-overall-results', ...wards.map((w) => `-${w}`)]
      .map((rest) => /** @type {[string, string]} */ ([`${body}-1961${rest}`, `${body}-1961-05-17${rest}`]))),
  // The council divisions renamed on 12 Nov 2026 (RENAMED_DIVISIONS below).
  ...renamedDivisionSlugs(),
  // North Down Rural 1964's Ards Peninsula, recorded as Quintin by dc67fd1eb3 (its file keeps the
  // old name; the contest's slug follows Constituency_Name).
  ['north-down-rural-district-council-1964-06-04-ards-peninsula', 'north-down-rural-district-council-1964-06-04-quintin'],
  // The spelling families and the two Dublin areas of 13 Nov 2026.
  ...spellingFamilySlugs(),
  ...DUBLIN_1979,
]);
const sitemapSlugs = () => new Set([...readFileSync(path.join(ROOT, 'site', 'sitemaps', 'browse-elections.xml'), 'utf8')
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
    // Belfast 1961: the round's new slugs and the 29 June 1961 Shankill by-election continue the
    // old election slug and keep their own.
    'belfast-county-borough-council-1961-05-17',
    'belfast-county-borough-council-1961-05-17-clifton',
    'belfast-county-borough-council-aldermen-1961-05-17-falls',
    'belfast-county-borough-council-1961-06-29',
    'belfast-county-borough-council-1961-06-29-shankill',
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
    ['castlederg-rural-district-council__1936-06-03', 'Castlederg Rural District Council', ['Clare', 'Clunahill', 'Lisnacloon']],
    ['castlereagh-rural-district-council__1964-06-04', 'Castlereagh Rural District Council', ['Craigavad', 'Holywood Rural']],
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
    assert.ok((await now.text()).includes(`<title>${c.name} – ${c.date.slice(0, 4)} ${c.name} by-election – Civgraph</title>`));
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

test('the Browse page and the elections API send the old address of a renamed division to the new one', async () => {
  for (const [old, now] of [
    ['castlederg-rural-district-council-1936-06-03-clue', 'castlederg-rural-district-council-1936-06-03-clare'],
    ['castlederg-rural-district-council-1936-06-03-lisnacicon', 'castlederg-rural-district-council-1936-06-03-lisnacloon'],
    ['castlereagh-rural-district-council-1964-06-04-holywood', 'castlereagh-rural-district-council-1964-06-04-holywood-rural'],
  ]) {
    const res = await browse(old);
    assert.equal(res.status, 301, old);
    assert.equal(res.headers.get('Location'), `https://civgraph.net/browse/elections/${now}`);
    assert.equal((await browse(now)).status, 200, now);
  }
  // The divisions beside them answer as they did.
  assert.equal((await browse('castlederg-rural-district-council-1936-06-03-clunahill')).status, 200);
  const key = 'castlederg-rural-district-council__1936-06-03';
  const api = retiredSlugRedirect(new URL(`https://civgraph.net/_api/elections?key=${key}&contest=clue`));
  assert.equal(api.status, 301);
  assert.equal(api.headers.get('Location'), `https://civgraph.net/_api/elections?key=${key}&contest=clare`);
  assert.equal(retiredSlugRedirect(new URL(`https://civgraph.net/_api/elections?key=${key}&contest=clare`)), null);
  // Holywood Rural continues the old slug: only the old one itself moves.
  assert.equal(resolveElectionSlugAlias('castlereagh-rural-district-council-1964-06-04-holywood-rural'), 'castlereagh-rural-district-council-1964-06-04-holywood-rural');
});
