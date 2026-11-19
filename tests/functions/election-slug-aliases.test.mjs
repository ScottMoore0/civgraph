/**
 * Retired election and contest slugs (packages/core/src/election-slug-aliases.js) keep working:
 * the Browse page answers a 301, the elections API answers a 301, and the sources API answers a 301
 * for an election's source page. browse.js keeps no copy of the list: an old #/ address asks the
 * API for its record like any other, follows the 301 and shows the record's own address
 * (tests/browser/browse-share-urls.spec.cjs walks one in the browser).
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
import { ELECTION_SLUG_ALIASES, ELECTION_SOURCE_PREFIX, RETIRED_CONTEST_SLUGS, resolveElectionSourceSlugAlias } from '@civgraph/core/election-slug-aliases.js';
import { slugify } from '@civgraph/core/format.js';
import { canonicalElectionTitle } from '../../scripts/lib/election-names.mjs';
import { onRequestGet as electionsApi, retiredSlugRedirect } from '@civgraph/api/handlers/elections/index.js';
import { onRequestGet as sourcesApi, retiredSourceRedirect } from '@civgraph/api/handlers/sources/index.js';
import { resetDatasetVersionCache } from '@civgraph/api/respond.js';
import { migrationFiles, TableWriter, transaction } from '@civgraph/loader/db.mjs';

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

test('browse.js holds no copy of the retired slugs: the server resolves them', () => {
  const source = readFileSync(path.join(ROOT, 'site', 'browse', 'browse.js'), 'utf8');
  assert.doesNotMatch(source, /RENAMED_RECORD_PREFIXES|RETIRED_CONTEST_SLUGS|ELECTION_SLUG_ALIASES/);
  for (const [from] of [...ELECTION_SLUG_ALIASES, ...RETIRED_CONTEST_SLUGS]) {
    assert.ok(!source.includes(`'${from}'`), `browse.js does not list ${from}`);
  }
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

// Divisions filed under two spellings, given their official DED names on 19 Nov 2026 (w19-merges, the
// owner's decision 4; the rest of the NI council divisions by w19-tidy): body, the name now, and each
// round filed under another spelling, which the contest keeps as Constituency_Name_As_Printed (or, where
// the filed spelling was an OCR shape, the third element: the form the page prints).
const OFFICIAL_DED_NAMES = [
  ['omagh-rural-district-council', 'Mountjoy Forest East', [['1930-06-04', 'Mountjoy East'], ['1936-06-03', 'Mountjoy East'], ['1939-05-31', 'Mountjoy East'], ['1946-10-03', 'Mountjoy East'], ['1955-06-02', 'Mountjoy East'], ['1958-06-05', 'Mountjoy East'], ['1961-06-01', 'Mountjoy East'], ['1964-06-04', 'Mountjoy East'], ['1967-06-01', 'Mountjoy East']]],
  ['omagh-rural-district-council', 'Mountjoy Forest West', [['1930-06-04', 'Mountjoy West'], ['1936-06-03', 'Mountjoy West'], ['1946-10-03', 'Mountjoy West'], ['1955-06-02', 'Mountjoy West'], ['1958-06-05', 'Mountjoy West'], ['1961-06-01', 'Mountjoy West'], ['1964-06-04', 'Mountjoy West'], ['1967-06-01', 'Mountjoy West']]],
  ['omagh-rural-district-council', 'Rahony', [['1924-05-28', 'Rahoney'], ['1930-06-04', 'Rahoney'], ['1933-05-31', 'Rahoney'], ['1936-06-03', 'Rahoney'], ['1939-05-31', 'Rahoney'], ['1946-10-03', 'Rahoney'], ['1949-06-02', 'Rahoney'], ['1952-06-05', 'Rahoney'], ['1955-06-02', 'Rahoney'], ['1958-06-05', 'Rahoney'], ['1961-06-01', 'Rahoney'], ['1964-06-04', 'Rahoney'], ['1967-06-01', 'Rahoney']]],
  ['strabane-rural-district-council', 'Dunnamanagh', [['1924-05-28', 'Dunamanagh'], ['1927-06-01', 'Donemana'], ['1930-06-04', 'Donemana'], ['1933-05-31', 'Dunamanagh'], ['1936-06-03', 'Dunamanagh'], ['1939-05-31', 'Donemana'], ['1946-10-03', 'Donemana'], ['1949-06-02', 'Donemana'], ['1952-06-05', 'Donemana'], ['1955-06-02', 'Donemana'], ['1958-06-05', 'Donemana'], ['1961-06-01', 'Donemana'], ['1964-06-04', 'Donemana'], ['1967-06-01', 'Donemana']]],
  ['enniskillen-rural-district-council', 'Drummee', [['1927-05-25', 'Drumee']]],
  ['lisnaskea-rural-district-council', 'Rosslea', [['1936-06-03', 'Roslea'], ['1939-05-31', 'Roslea'], ['1949-06-02', 'Roslea'], ['1952-06-05', 'Roslea'], ['1955-06-02', 'Roslea'], ['1958-06-05', 'Roslea']]],
  ['hillsborough-rural-district-council', 'Glasdrumman', [['1924-06-05', 'Glassdrumman'], ['1927-06-02', 'Glassdrummond'], ['1930-05-30', 'Glassdrummond'], ['1936-06-04', 'Glassdrummond'], ['1939-06-01', 'Glassdrummond'], ['1946-10-03', 'Glassdrummond'], ['1949-06-02', 'Glassdrumman'], ['1952-06-05', 'Glassdrumman'], ['1955-06-02', 'Glassdrumman'], ['1958-06-05', 'Glassdrumman'], ['1961-06-01', 'Glassdrumman'], ['1964-06-04', 'Glassdrumman'], ['1967-06-01', 'Glassdrummond']]],
  ['fermanagh-county-council', 'Rosslea', [['1949-06-02', 'Roslea'], ['1952-06-05', 'Roslea'], ['1955-06-02', 'Roslea'], ['1958-06-05', 'Roslea'], ['1961-06-01', 'Roslea'], ['1964-06-04', 'Roslea'], ['1967-06-01', 'Roslea']]],
  ['ballycastle-rural-district-council', 'Glenmakeeran', [['1924-06-05', 'Glenmakeirnan'], ['1930-06-05', 'Glenmakeiran'], ['1946-10-03', 'Glenmaccn', 'Glenmacen']]],
  ['ballymoney-rural-district-council', 'Ballycregagh', [['1946-10-03', 'Ballyeraigagh', 'Ballycraigagh'], ['1949-06-02', 'Ballybregagh']]],
  ['hillsborough-rural-district-council', 'Annahilt', [['1924-06-05', 'Anahilt'], ['1927-06-02', 'Anahilt'], ['1936-06-04', 'Anahilt'], ['1939-06-01', 'Anahilt'], ['1946-10-03', 'Anahilt'], ['1952-06-05', 'Anahilt'], ['1955-06-02', 'Anahilt'], ['1961-06-01', 'Anahilt'], ['1964-06-04', 'Anahilt']]],
  ['hillsborough-rural-district-council', 'Ballyworfy', [['1927-06-02', 'Ballyworphy'], ['1936-06-04', 'Ballyworphy'], ['1939-06-01', 'Ballyworphy'], ['1946-10-03', 'Ballyworphy'], ['1958-06-05', 'Ballyworphy'], ['1961-06-01', 'Ballyworphy'], ['1964-06-04', 'Ballyworphy']]],
  ['hillsborough-rural-district-council', 'Ouley', [['1927-06-02', 'Oughley'], ['1930-05-30', 'Ougley'], ['1933-05-25', 'Ougley'], ['1967-06-01', 'Ougley']]],
  ['north-down-rural-district-council', 'Ballymaglaff', [['1933-05-25', 'Ballymaglass'], ['1946-10-03', 'Ballymeglaff']]],
  ['south-down-rural-district-council', 'Glasdrumman', [['1924-06-05', 'Glassdrummond'], ['1933-05-25', 'Glassdrumman'], ['1939-06-01', 'Glassdrummond'], ['1946-10-03', 'Glassdrumman'], ['1949-06-02', 'Glassdrumman'], ['1952-06-05', 'Glasdrummond'], ['1955-06-02', 'Glassdrumman'], ['1958-06-05', 'Glassdrumman']]],
  ['antrim-rural-district-council', 'Antrim Rural', [['1936-06-04', 'Antrim']]],
  ['antrim-rural-district-council', 'Ballynadrentagh', [['1927-06-02', 'Ballynadrenta'], ['1930-06-05', 'Ballynadrenta'], ['1939-06-01', 'Ballynadrenta'], ['1946-10-03', 'Ballynadrenta'], ['1958-06-05', 'Ballynadrenta'], ['1964-06-04', 'Ballynadrenta']]],
  ['antrim-rural-district-council', 'Cargin', [['1933-06-01', 'Cargan'], ['1936-06-04', 'Cargan'], ['1939-06-01', 'Cargan']]],
  ['antrim-rural-district-council', 'Cranfield', [['1930-06-05', 'Carnfield']]],
  ['antrim-rural-district-council', 'Coggrey', [['1927-06-02', 'Cogry'], ['1933-06-01', 'Cogry'], ['1936-06-04', 'Cogry'], ['1939-06-01', 'Cogry'], ['1946-10-03', 'Cogry']]],
  ['antrim-rural-district-council', 'Sharvogues', [['1930-06-05', 'Shanoogues']]],
  ['antrim-rural-district-council', 'Shilvodan', [['1927-06-02', 'Shilvoden'], ['1939-06-01', 'Shilvoden'], ['1946-10-03', 'Shilvoden'], ['1952-06-05', 'Shilvoden'], ['1958-06-05', 'Shilvoden'], ['1961-06-01', 'Shilvoden'], ['1964-06-04', 'Shilvoden']]],
  ['armagh-rural-district-council', 'Clady', [['1927-05-26', 'Cladybeg']]],
  ['ballycastle-rural-district-council', 'Croagh', [['1946-10-03', 'Creagh']]],
  ['ballycastle-rural-district-council', 'Dunseverick', [['1946-10-03', 'Dunservick']]],
  ['ballycastle-rural-district-council', 'The Fair Head', [['1924-06-05', 'Fair Head'], ['1927-06-02', 'Fair Head'], ['1930-06-05', 'Fair Head'], ['1933-06-01', 'Fair Head'], ['1936-06-04', 'Fair Head'], ['1939-06-01', 'Fair Head'], ['1946-10-03', 'Fairhead'], ['1949-06-02', 'Fair Head'], ['1955-06-02', 'Fairhead']]],
  ['ballycastle-rural-district-council', 'Glenaan', [['1927-06-02', 'Glenann'], ['1930-06-05', 'Glenann'], ['1939-06-01', 'Glenan'], ['1946-10-03', 'Glenane']]],
  ['ballycastle-rural-district-council', 'Glenariff', [['1924-06-05', 'Glenariffe'], ['1933-06-01', 'Glenariffe'], ['1936-06-04', 'Glenariffe'], ['1939-06-01', 'Glenariffe']]],
  ['ballycastle-rural-district-council', 'Rathlin', [['1930-06-05', 'Rathlin Island'], ['1933-06-01', 'Rathlin Island'], ['1936-06-04', 'Rathlin Island'], ['1939-06-01', 'Rathlin Island'], ['1946-10-03', 'Rathlin Island'], ['1961-06-01', 'Rathlin Island']]],
  ['ballymena-rural-district-council', 'Ballyconnelly', [['1927-06-02', 'Ballyconnolly'], ['1930-06-05', 'Ballyconnolly'], ['1933-06-01', 'Ballyconnolly'], ['1936-06-04', 'Ballyconnolly'], ['1939-06-01', 'Ballyconnolly'], ['1946-10-03', 'Ballyconnolly'], ['1949-06-02', 'Ballyconnolly'], ['1952-06-05', 'Ballyconnolly'], ['1955-06-02', 'Ballyconnolly'], ['1958-06-05', 'Ballyconnolly'], ['1961-06-01', 'Ballyconnolly'], ['1964-06-04', 'Ballyconnolly'], ['1967-06-01', 'Ballyconnolly']]],
  ['ballymena-rural-district-council', 'Cloghogue', [['1924-06-05', 'Cloughogue'], ['1927-06-02', 'Cloughogue'], ['1930-06-05', 'Cloughogue'], ['1933-06-01', 'Cloughogue'], ['1936-06-04', 'Cloughogue'], ['1939-06-01', 'Cloughogue'], ['1946-10-03', 'Cloughogue'], ['1961-06-01', 'Cloughogue']]],
  ['ballymena-rural-district-council', 'Cromkill', [['1924-06-05', 'Crumkill'], ['1927-06-02', 'Crumkill'], ['1930-06-05', 'Crumkill'], ['1933-06-01', 'Crumkill'], ['1936-06-04', 'Crumkill']]],
  ['ballymena-rural-district-council', 'Dunminning', [['1924-06-05', 'Dunmining']]],
  ['ballymena-rural-district-council', 'Tullaghgarley', [['1924-06-05', 'Tullygrawley'], ['1927-06-02', 'Tullygarley'], ['1930-06-05', 'Tullygarley'], ['1933-06-01', 'Tullygarley'], ['1936-06-04', 'Tullygarley'], ['1939-06-01', 'Tullygarley'], ['1946-10-03', 'Tullygarley'], ['1949-06-02', 'Tullygarley'], ['1952-06-05', 'Tullygarley'], ['1955-06-02', 'Tullygarley'], ['1958-06-05', 'Tullygarley'], ['1961-06-01', 'Tullygarley'], ['1964-06-04', 'Tullygarley']]],
  ['ballymoney-rural-district-council', 'Dirraw', [['1924-06-05', 'Birraw']]],
  ['ballymoney-rural-district-council', 'The Vow', [['1933-06-01', 'Vow'], ['1949-06-02', 'Vow'], ['1961-06-01', 'Vow']]],
  ['banbridge-rural-district-council', 'Balloolymore', [['1930-05-30', 'Ballooleymore'], ['1952-06-05', 'Ballyoolmore'], ['1958-06-05', 'Ballooleymore'], ['1967-06-01', 'Ballooleymore']]],
  ['banbridge-rural-district-council', 'Crossgar', [['1930-05-30', 'Crossgare'], ['1964-06-04', 'Crossgare'], ['1967-06-01', 'Crossgare']]],
  ['banbridge-rural-district-council', 'Skeagh', [['1930-05-30', 'Skeogh'], ['1933-05-25', 'Skeogh'], ['1936-06-04', 'Skeogh'], ['1939-06-01', 'Skeogh'], ['1964-06-04', 'Skeogh'], ['1967-06-01', 'Skeogh']]],
  ['banbridge-rural-district-council', 'Tirkelly', [['1924-06-05', 'Tierkelly'], ['1927-06-02', 'Tierkelly'], ['1930-05-30', 'Tierkelly'], ['1933-05-25', 'Tierkelly'], ['1936-06-04', 'Tierkelly'], ['1939-06-01', 'Tierkelly'], ['1949-06-02', 'Tierkelly'], ['1964-06-04', 'Tierkelly'], ['1967-06-01', 'Tierkelly']]],
  ['castlederg-rural-district-council', 'Ardarver', [['1939-05-31', 'Ardaver']]],
  ['castlederg-rural-district-council', 'Killen', [['1964-06-04', 'Killeen']]],
  ['castlederg-rural-district-council', 'Longfield', [['1967-06-01', 'Langfield']]],
  ['castlederg-rural-district-council', 'Magheracreggan', [['1967-06-01', 'Magheracregga']]],
  ['castlereagh-rural-district-council', 'Ballyhackamore', [['1927-06-02', 'Ballyhackmore']]],
  ['castlereagh-rural-district-council', 'Holywood Rural', [['1933-05-25', 'Holywood']]],
  ['clogher-rural-district-council', 'Aghintain', [['1899-04-06', 'Aughentaine'], ['1902-06-04', 'Aughentaine'], ['1905-05-31', 'Aughentaine'], ['1908-05-27', 'Aughentaine'], ['1911-05-25', 'Aughentaine'], ['1924-05-28', 'Aughentain'], ['1927-06-01', 'Aughentaine'], ['1930-06-04', 'Aughentaine'], ['1933-05-31', 'Aughentaine'], ['1936-06-03', 'Aughentaine'], ['1939-05-31', 'Aughentaine'], ['1946-10-03', 'Aughentaine'], ['1949-06-02', 'Aughentaine'], ['1952-06-05', 'Aughentaine'], ['1955-06-02', 'Aughentaine'], ['1958-06-05', 'Aughentaine'], ['1961-06-01', 'Aughentaine'], ['1964-06-04', 'Aughentaine'], ['1967-06-01', 'Aughentaine']]],
  ['clogher-rural-district-council', 'Favor Royal', [['1964-06-04', 'Favour Royal']]],
  ['coleraine-rural-district-council', 'Hervey Hill', [['1955-06-02', 'Hervey Hill (Kilrea)']]],
  ['cookstown-rural-district-council', 'Killycolpy', [['1930-06-04', 'Killycoply']]],
  ['cookstown-rural-district-council', 'Lissan Lower', [['1930-06-04', 'Lissin'], ['1933-05-31', 'Lissan'], ['1946-10-03', 'Lissan'], ['1952-06-05', 'Lissan'], ['1955-06-02', 'Lissan'], ['1958-06-05', 'Lissan']]],
  ['cookstown-rural-district-council', 'Mullanahoe', [['1930-06-04', 'Mullinahoe'], ['1933-05-31', 'Mullinahoe'], ['1964-06-04', 'Mullinahoe']]],
  ['cookstown-rural-district-council', 'Munterevlin', [['1939-05-31', 'Munterevelin']]],
  ['cookstown-rural-district-council', 'Slate Quarry', [['1927-06-01', 'Slatequarry'], ['1930-06-04', 'Slatequarry'], ['1936-06-03', 'Slatequarry'], ['1939-05-31', 'Slatequarry'], ['1946-10-03', 'Slatequarry'], ['1949-06-02', 'Slatequarry'], ['1952-06-05', 'Slatequarry'], ['1955-06-02', 'Slatequarry'], ['1958-06-05', 'Slatequarry'], ['1961-06-01', 'Slatequarry'], ['1967-06-01', 'Slatequarry']]],
  ['down-county-council', 'Rathfriland', [['1955-06-02', 'Rathfryland'], ['1958-06-05', 'Rathfryland'], ['1961-06-01', 'Rathfryland'], ['1967-06-01', 'Rathfryland']]],
  ['east-down-rural-district-council', 'Downpatrick Rural', [['1955-06-02', 'Downpatrick'], ['1967-06-01', 'Downpatrick']]],
  ['enniskillen-rural-district-council', 'Corraglass', [['1924-05-28', 'Corryglass'], ['1927-05-25', 'Corryglass'], ['1936-06-03', 'Corryglass'], ['1949-06-02', 'Conyglass'], ['1952-06-05', 'Corryglass'], ['1955-06-02', 'Corrygloss'], ['1958-06-05', 'Corrygloss']]],
  ['enniskillen-rural-district-council', 'Coolyermer', [['1924-05-28', 'Coolyermor'], ['1927-05-25', 'Cooleyermor'], ['1930-06-04', 'Coolyermor'], ['1933-05-31', 'Coolyermor'], ['1936-06-03', 'Coolyermor'], ['1939-05-31', 'Coolyermor'], ['1946-10-03', 'Coolyermor'], ['1949-06-02', 'Coolyermor'], ['1955-06-02', 'Coolyermor'], ['1958-06-05', 'Coolyermor'], ['1961-06-01', 'Coolyermor'], ['1964-06-04', 'Coolyermore']]],
  ['enniskillen-rural-district-council', 'Derrybrusk', [['1927-05-25', 'Derrybrush']]],
  ['enniskillen-rural-district-council', 'Drumderg', [['1927-05-25', 'Drumberg']]],
  ['enniskillen-rural-district-council', 'Old Barr', [['1927-05-25', 'Oldbar'], ['1930-06-04', 'Oldbarr'], ['1933-05-31', 'Oldbar'], ['1936-06-03', 'Oldbarr'], ['1939-05-31', 'Oldbarr'], ['1946-10-03', 'Oldbarr'], ['1955-06-02', 'Oldbar'], ['1964-06-04', 'Oldbar']]],
  ['enniskillen-rural-district-council', 'Rahalton', [['1955-06-02', 'Rahaltan'], ['1958-06-05', 'Rahaltan']]],
  ['fermanagh-county-council', 'Holywell', [['1939-05-31', 'Hollywell']]],
  ['fermanagh-county-council', 'Inishmacsaint', [['1927-05-25', 'Innismacsaint'], ['1930-06-04', 'Innishmacsaint'], ['1933-05-31', 'Innishmacsaint'], ['1936-06-03', 'Innishmacsaint'], ['1939-05-31', 'Innishmacsaint'], ['1949-06-02', 'Innismacsaint'], ['1952-06-05', 'Innismacsaint'], ['1955-06-02', 'Innismacsaint'], ['1958-06-05', 'Innismacsaint'], ['1961-06-01', 'Innismacsaint'], ['1964-06-04', 'Innismacsaint'], ['1967-06-01', 'Innismacsaint']]],
  ['irvinestown-rural-district-council', 'Church Hill', [['1924-05-28', 'Churchhill'], ['1927-05-25', 'Churchhill'], ['1930-06-04', 'Churchhill'], ['1933-05-31', 'Churchill'], ['1936-06-03', 'Churchhill'], ['1939-05-31', 'Churchhill'], ['1946-10-03', 'Churchhill'], ['1949-06-02', 'Churchill'], ['1952-06-05', 'Churchill'], ['1955-06-02', 'Churchill'], ['1958-06-05', 'Churchill'], ['1961-06-01', 'Churchhill'], ['1964-06-04', 'Churchhill']]],
  ['irvinestown-rural-district-council', 'Clonelly', [['1939-05-31', 'Clonnelly'], ['1946-10-03', 'Clonnelly']]],
  ['irvinestown-rural-district-council', 'Inishmacsaint', [['1927-05-25', 'Innishmacsaint'], ['1930-06-04', 'Innishmacsaint'], ['1933-05-31', 'Innishmacsaint'], ['1936-06-03', 'Innishmacsaint'], ['1939-05-31', 'Innismacsaint'], ['1946-10-03', 'Innismacsaint'], ['1949-06-02', 'Innismacsaint'], ['1952-06-05', 'Innismacsaint'], ['1961-06-01', 'Innishmacsaint'], ['1964-06-04', 'Innishmacsaint']]],
  ['irvinestown-rural-district-council', 'Lattone', [['1949-06-02', 'Lattoon'], ['1952-06-05', 'Lattoone']]],
  ['irvinestown-rural-district-council', 'Magheraculmoney', [['1927-05-25', 'Magheracumoney']]],
  ['larne-rural-district-council', 'Ardclinis', [['1927-06-02', 'Ardclinis (Carnlough)']]],
  ['lisburn-rural-district-council', 'Ballyscolly', [['1927-06-02', 'Ballyscally'], ['1958-06-05', 'Ballyscully']]],
  ['lisburn-rural-district-council', 'Lissue', [['1927-06-02', 'Lissae']]],
  ['lisnaskea-rural-district-council', 'Aghakillymaud', [['1930-06-04', 'Aghakillymaude'], ['1933-05-31', 'Aghakillymaude'], ['1936-06-03', 'Aghakillymaude'], ['1939-05-31', 'Aghakillymaude'], ['1949-06-02', 'Aughakillymaude'], ['1952-06-05', 'Aughakillymaude'], ['1955-06-02', 'Aghakillymaude'], ['1958-06-05', 'Aghakillymaude'], ['1961-06-01', 'Aghakillymaude'], ['1964-06-04', 'Aghakillymaude']]],
  ['lisnaskea-rural-district-council', 'Aghyoule', [['1952-06-05', 'Aughyoule']]],
  ['lisnaskea-rural-district-council', 'Armagh Manor', [['1933-05-31', 'Armaghmanor']]],
  ['lisnaskea-rural-district-council', 'Ballindarragh', [['1927-05-25', 'Ballinadarragh'], ['1949-06-02', 'Ballindarra']]],
  ['lisnaskea-rural-district-council', 'Castlebalfour', [['1955-06-02', 'Castle Balfour'], ['1958-06-05', 'Castle Balfour']]],
  ['lisnaskea-rural-district-council', 'Colebrook', [['1927-05-25', 'Colebrooke'], ['1930-06-04', 'Colebrooke'], ['1933-05-31', 'Colebrooke'], ['1936-06-03', 'Colebrooke'], ['1939-05-31', 'Colebrooke'], ['1949-06-02', 'Colebrooke'], ['1952-06-05', 'Colebrooke'], ['1955-06-02', 'Colebrooke'], ['1958-06-05', 'Colebrooke'], ['1961-06-01', 'Colebrooke']]],
  ['lisnaskea-rural-district-council', 'Corralongford', [['1924-05-28', 'Corrylongford'], ['1927-05-25', 'Corrylongford'], ['1936-06-03', 'Corrylongford'], ['1949-06-02', 'Corrylongford'], ['1952-06-05', 'Corrylongford']]],
  ['lisnaskea-rural-district-council', 'Dresternan', [['1952-06-05', 'Dresterhan']]],
  ['lisnaskea-rural-district-council', 'Drummully', [['1927-05-25', 'Drumully'], ['1939-05-31', 'Drumully'], ['1949-06-02', 'Drumully']]],
  ['lisnaskea-rural-district-council', 'Drumshimuck', [['1927-05-25', 'Drumshemuck'], ['1930-06-04', 'Drumshemuck'], ['1933-05-31', 'Drumshemuck'], ['1936-06-03', 'Drumshemuck'], ['1939-05-31', 'Drumshamuck'], ['1949-06-02', 'Drumshemuck'], ['1952-06-05', 'Drumshemuck'], ['1955-06-02', 'Drumshemuck'], ['1961-06-01', 'Drumshemuck'], ['1964-06-04', 'Drumshemuck']]],
  ['lisnaskea-rural-district-council', 'Kilmore', [['1955-06-02', 'Kulmore'], ['1958-06-05', 'Kulmore']]],
  ['lisnaskea-rural-district-council', 'Magheraveely', [['1933-05-31', 'Magheraveeley'], ['1952-06-05', 'Magheraveeley']]],
  ['lisnaskea-rural-district-council', 'Mullynagowan', [['1949-06-02', 'Mullynagoan']]],
  ['lurgan-rural-district-council', 'Cornakinnegar', [['1899-04-06', 'Cornakinegar']]],
  ['magherafelt-rural-district-council', 'Aghagaskin', [['1927-05-27', 'Aughagaskin'], ['1939-06-02', 'Aughagaskin'], ['1946-10-31', 'Aughagaskin'], ['1949-06-02', 'Aughagaskin'], ['1952-06-05', 'Aughagaskin'], ['1961-06-01', 'Aughagaskin'], ['1964-06-04', 'Aughagaskin'], ['1967-06-01', 'Aughagaskin']]],
  ['magherafelt-rural-district-council', 'Brackagh Slieve Gallion', [['1927-05-27', 'Brackaghslievegallion'], ['1930-06-05', 'Brackaslievegallion'], ['1933-06-02', 'Brackaslievegallion'], ['1936-06-02', 'Brackaghslievegallion'], ['1939-06-02', 'Brackaslievegallion'], ['1946-10-31', 'Brackaghslievegallion'], ['1949-06-02', 'Brackaghslievegallion'], ['1952-06-05', 'Brackaghslievegallion'], ['1955-06-02', 'Brackaghslievegallion'], ['1958-06-05', 'Brackaghslievegallon'], ['1961-06-01', 'Brackaghslievegallion'], ['1964-06-04', 'Brackaghslievegallion'], ['1967-06-01', 'Brackaghslievegallion']]],
  ['magherafelt-rural-district-council', 'Gulladuff', [['1949-06-02', 'Guladuff']]],
  ['magherafelt-rural-district-council', 'Iniscarn', [['1924-05-30', 'Inniscarn'], ['1927-05-27', 'Inniscarn'], ['1930-06-05', 'Inniscarn'], ['1933-06-02', 'Inniscarn'], ['1939-06-02', 'Inniscarn'], ['1946-10-31', 'Inniscarn'], ['1952-06-05', 'Inniscarn'], ['1961-06-01', 'Inniscarn'], ['1964-06-04', 'Inniscarn'], ['1967-06-01', 'Inniscarn']]],
  ['magherafelt-rural-district-council', 'The Loop', [['1927-05-27', 'The Loup'], ['1946-10-31', 'The Loup'], ['1949-06-02', 'The Loup'], ['1952-06-05', 'Loup'], ['1955-06-02', 'The Loup'], ['1958-06-05', 'The Loup'], ['1961-06-01', 'The Loup'], ['1964-06-04', 'Loup'], ['1967-06-01', 'The Loup']]],
  ['moira-rural-district-council', 'Ballyleny', [['1927-06-02', 'Ballyleney'], ['1933-05-25', 'Ballyleney'], ['1946-10-03', 'Ballyleney'], ['1949-06-02', 'Ballyleney'], ['1952-06-05', 'Ballyleney'], ['1955-06-02', 'Ballyleney'], ['1958-06-05', 'Ballyleney']]],
  ['moira-rural-district-council', 'Donaghcloney', [['1899-04-06', 'Donacloney'], ['1927-06-02', 'Donacloney'], ['1930-05-30', 'Donacloney'], ['1936-06-04', 'Donacloney'], ['1946-10-03', 'Donacloney'], ['1949-06-02', 'Donacloney'], ['1952-06-05', 'Donacloney'], ['1955-06-02', 'Donacloney'], ['1958-06-05', 'Donacloney'], ['1961-06-01', 'Donacloney'], ['1967-06-01', 'Donacloney']]],
  ['moira-rural-district-council', 'Magheralin', [['1930-05-30', 'Marlin'], ['1949-06-02', 'Maralin'], ['1952-06-05', 'Maralin'], ['1961-06-01', 'Maralin'], ['1964-06-04', 'Maralin'], ['1967-06-01', 'Marlin']]],
  ['newry-no-1-rural-district-council', 'Ballycoshone', [['1927-06-02', 'Ballycashone'], ['1939-06-01', 'Ballycashone'], ['1946-10-03', 'Ballycashone'], ['1949-06-02', 'Ballycashone']]],
  ['newry-no-1-rural-district-council', 'Carrickcrossan', [['1961-06-01', 'Carrickerossan']]],
  ['newry-no-1-rural-district-council', 'Clonallan', [['1927-06-02', 'Clonallon'], ['1930-05-30', 'Clonallon'], ['1933-05-25', 'Clonallon'], ['1936-06-04', 'Clonallon'], ['1939-06-01', 'Clonallion'], ['1946-10-03', 'Clonallon'], ['1949-06-02', 'Clonallon'], ['1952-06-05', 'Clonallon'], ['1955-06-02', 'Clonallon'], ['1958-06-05', 'Clonallon'], ['1961-06-01', 'Clonallon'], ['1964-06-04', 'Clonallon'], ['1967-06-01', 'Clonallon']]],
  ['newry-no-1-rural-district-council', 'Crobane', [['1939-06-01', 'Corbane'], ['1946-10-03', 'Corbane']]],
  ['newry-no-1-rural-district-council', 'Glen', [['1958-06-05', 'Glenn']]],
  ['north-down-rural-district-council', 'Donaghadee Rural', [['1924-06-05', 'Donaghadee'], ['1927-06-02', 'Donaghadee'], ['1930-05-30', 'Donaghadee'], ['1933-05-25', 'Donaghadee'], ['1946-10-03', 'Donaghadee'], ['1952-06-05', 'Donaghadee'], ['1958-06-05', 'Donaghadee']]],
  ['north-down-rural-district-council', 'Grey Abbey', [['1924-06-05', 'Greyabbey'], ['1927-06-02', 'Greyabbey'], ['1930-05-30', 'Greyabbey'], ['1933-05-25', 'Greyabbey'], ['1939-06-01', 'Greyabbey'], ['1952-06-05', 'Greyabbey'], ['1958-06-05', 'Greyabbey']]],
  ['north-down-rural-district-council', 'Kircubbin', [['1924-06-05', 'Kirkcubbin']]],
  ['north-down-rural-district-council', 'Moneyreagh', [['1930-05-30', 'Moneyrea'], ['1946-10-03', 'Moneyrea']]],
  ['omagh-rural-district-council', 'Dervaghroy', [['1924-05-28', 'Dervaghray'], ['1930-06-04', 'Dernaghray']]],
  ['omagh-rural-district-council', 'Drumharvey', [['1967-06-01', 'Dromharvey']]],
  ['omagh-rural-district-council', 'Edenderry', [['1933-05-31', 'Edendorry']]],
  ['omagh-rural-district-council', 'Fallaghearn', [['1933-05-31', 'Fallaghhearn']]],
  ['omagh-rural-district-council', 'Moorfield', [['1949-06-02', 'Moorefield']]],
  ['omagh-rural-district-council', 'Moyle', [['1967-06-01', 'Moyle Hill']]],
  ['omagh-rural-district-council', 'Mullaghslin', [['1967-06-01', 'Mullaslin']]],
  ['omagh-rural-district-council', 'Omagh Rural', [['1967-06-01', 'Omagh']]],
  ['south-down-rural-district-council', 'Attical', [['1939-06-01', 'Atticall'], ['1946-10-03', 'Atticall']]],
  ['strabane-rural-district-council', 'Balix', [['1927-06-01', 'Belix'], ['1936-06-03', 'Belix']]],
  ['strabane-rural-district-council', 'Ballyfatten', [['1927-06-01', 'Ballyfatton'], ['1930-06-04', 'Ballyfatton'], ['1933-05-31', 'Ballyfatton'], ['1936-06-03', 'Ballyfatton'], ['1939-05-31', 'Ballyfatton'], ['1946-10-03', 'Ballyfatton'], ['1949-06-02', 'Ballyfatton'], ['1952-06-05', 'Ballyfatton'], ['1955-06-02', 'Ballyfatton'], ['1958-06-05', 'Ballyfatton'], ['1961-06-01', 'Ballyfatton'], ['1964-06-04', 'Ballyfatton'], ['1967-06-01', 'Ballyfatton']]],
  ['strabane-rural-district-council', 'Birnaghs', [['1939-05-31', 'Birnaughs']]],
  ['strabane-rural-district-council', 'Doorat', [['1927-06-01', 'Dooratt'], ['1946-10-03', 'Deoratt']]],
  ['strabane-rural-district-council', 'Douglas', [['1949-06-02', 'Douglas Bridge']]],
  ['strabane-rural-district-council', 'Glenmornan', [['1936-06-03', 'Glenmorning']]],
  ['strabane-rural-district-council', 'Lislea', [['1930-06-04', 'Lislea (Plumbridge)']]],
  ['strabane-rural-district-council', 'Sperrin', [['1927-06-01', 'Speerin'], ['1936-06-03', 'Speerin']]],
  ['omagh-rural-district-council', 'Bancran', [['1924-05-28', 'Bencran'], ['1927-06-01', 'Bencran'], ['1930-06-04', 'Bencran'], ['1933-05-31', 'Bencran'], ['1936-06-03', 'Bencran'], ['1939-05-31', 'Bencran'], ['1946-10-03', 'Bencran'], ['1949-06-02', 'Bencran'], ['1952-06-05', 'Benchran'], ['1955-06-02', 'Bencran'], ['1958-06-05', 'Bencran'], ['1961-06-01', 'Bencran'], ['1964-06-04', 'Bencran'], ['1967-06-01', 'Bencran']]],
];
/** @returns {[string, string][]} each renamed division's old contest slug and its new one */
function officialDedSlugs() {
  return OFFICIAL_DED_NAMES.flatMap(([body, now, rounds]) => rounds.map(([date, old]) => /** @type {[string, string]} */ ([`${body}-${date}-${slugify(old)}`, `${body}-${date}-${slugify(now)}`])));
}

test('the double-spelled divisions take their official DED names: every round renamed, the printed spelling kept', () => {
  const index = read('data/elections-source/data/elections_index.json');
  for (const [body, now, renamed] of OFFICIAL_DED_NAMES) {
    const olds = new Set(renamed.map(([, old]) => old));
    for (const entry of index.bodies.find((b) => b.slug === body)?.dates || []) {
      for (const name of entry.constituencies || []) assert.ok(!olds.has(name), `${body} ${entry.date} still names ${name}`);
    }
    for (const [date, old, printed] of renamed) {
      const dir = `data/elections-source/data/elections/${body}/${date}`;
      assert.ok(!existsSync(path.join(ROOT, dir, `${slugify(old)}.json`)), `${dir}/${slugify(old)}.json is gone`);
      const file = `${dir}/${slugify(now)}.json`;
      const info = read(file).Constituency.countInfo;
      assert.equal(info.Constituency_Name, now, `${file} names the division`);
      assert.equal(info.Constituency_Name_As_Printed, printed ?? old, `${file} keeps the spelling it was filed under`);
      assert.ok(String(read(file).correctionNote).includes(`Renamed from '${old}' to ${now}`), `${file} records the rename`);
    }
  }
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
  ['carrickfergus-borough-council-1967-05-17-west-ward', 'carrickfergus-borough-council-1967-05-17-west-ward-alderman'],
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
  // The double-spelled divisions of 19 Nov 2026 (OFFICIAL_DED_NAMES).
  ...officialDedSlugs(),
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

function d1(db = sqlite) {
  return {
    prepare(sql) {
      const api = (args) => ({
        async first() { return db.prepare(sql).get(...args) ?? null; },
        async all() { return { results: db.prepare(sql).all(...args) }; },
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

async function browse(slug, db = sqlite) {
  resetDatasetVersionCache();
  const request = new Request(`https://civgraph.net/browse/elections/${slug}`);
  return browsePageHandler('elections')({ request, env: { ELECTIONS_DB: d1(db), ASSETS } });
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

// Every retired slug of the list, each against a records database holding every target: the
// elections and contests the old addresses lead to, under their current slugs.
const EVERY_RETIRED = [
  ...RETIRED_CONTEST_SLUGS,
  ...ELECTION_SLUG_ALIASES,
  // A prefix rule moves what continues the old slug too: the round's overall results.
  ...ELECTION_SLUG_ALIASES.filter(([from]) => /\d{4}-\d{2}-\d{2}$/.test(from)).map(([from, to]) => [`${from}-overall-results`, `${to}-overall-results`]),
];
const targets = new DatabaseSync(':memory:');
for (const file of migrationFiles()) targets.exec(readFileSync(file, 'utf8'));
transaction(targets, () => {
  const elections = new TableWriter(targets, 'r_elections');
  const contests = new TableWriter(targets, 'contests');
  /** @type {Map<string, Set<string>>} each target election's key and its contests' slugs */
  const rounds = new Map();
  for (const [, to] of EVERY_RETIRED) {
    const match = /^(.+?)-(\d{4}-\d{2}-\d{2})(?:-(.+))?$/.exec(to);
    assert.ok(match, `${to} names its round`);
    const key = `${match[1]}__${match[2]}`;
    if (!rounds.has(key)) rounds.set(key, new Set());
    if (match[3] && match[3] !== 'overall-results') rounds.get(key).add(match[3]);
  }
  [...rounds].forEach(([key, slugs], ord) => {
    const [body, date] = key.split('__');
    elections.add({ key, slug: slugify(key), body_slug: body, body, body_group: 'local-government', display_title: `${body} ${date}`, date, year: Number(date.slice(0, 4)), ord, meta: '{}' });
    [...slugs].forEach((slug, seq) => contests.add({ election_key: key, seq, name: slug, slug, seats_total: 1, meta: '{}' }));
  });
});

test('every retired slug answers 301 from the Browse page, to its current address', async () => {
  assert.ok(EVERY_RETIRED.length > 700, `${EVERY_RETIRED.length} retired slugs`);
  for (const [old, now] of EVERY_RETIRED) {
    const res = await browse(old, targets);
    assert.equal(res.status, 301, old);
    assert.equal(res.headers.get('Location'), `https://civgraph.net/browse/elections/${now}`, old);
  }
});

test('every in-app old route resolves through the API: the record view and the source page answer 301', async () => {
  for (const [old, now] of EVERY_RETIRED) {
    // browse.js loadElectionRecord asks /_api/elections?view=record&slug=<the address's slug>.
    const record = await electionsApi({ request: new Request(`https://civgraph.net/_api/elections?view=record&slug=${old}`), env: {} });
    assert.equal(record.status, 301, old);
    assert.equal(new URL(record.headers.get('Location')).searchParams.get('slug'), now, old);
    // browse.js fetchIndexRecord asks /_api/sources?slug=<the address's slug> for #/sources/.
    const source = await sourcesApi({ request: new Request(`https://civgraph.net/_api/sources?slug=${ELECTION_SOURCE_PREFIX}${old}`), env: {} });
    assert.equal(source.status, 301, old);
    assert.equal(new URL(source.headers.get('Location')).searchParams.get('slug'), `${ELECTION_SOURCE_PREFIX}${now}`, old);
  }
});

test('the sources API moves only retired election sources, keeping the rest of the request', () => {
  const moved = retiredSourceRedirect(new URL('https://civgraph.net/_api/sources?slug=election-source-bangor-urban-district-council-1920-01-15&view=detail'));
  assert.equal(moved.status, 301);
  assert.equal(moved.headers.get('Location'), 'https://civgraph.net/_api/sources?slug=election-source-bangor-borough-council-1920-01-15&view=detail');
  for (const slug of ['election-source-bangor-borough-council-1920-01-15', 'ark-elections', 'bangor-urban-district-council-1920-01-15', '']) {
    assert.equal(retiredSourceRedirect(new URL(`https://civgraph.net/_api/sources?slug=${slug}`)), null, slug);
    assert.equal(resolveElectionSourceSlugAlias(slug), slug, slug);
  }
  assert.equal(retiredSourceRedirect(new URL('https://civgraph.net/_api/sources?q=bangor')), null);
});
