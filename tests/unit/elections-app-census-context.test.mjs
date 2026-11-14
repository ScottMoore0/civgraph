/**
 * The area in the census (el-context): the figures file (site/apps/elections/census/ni-areas.json,
 * scripts/build/elections-app/census-context.mjs) names every area as its layer does and holds only
 * standard indicators; lib/census-context.js picks the census, ranks the area, gives the Northern
 * Ireland figure and the most similar areas; every word is keyed (R10).
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  INDICATOR_LABELS, areaContext, areaKey, baseOf, censusFor, contestLinker, displayName, figure, rankOf, setFor, similarAreas, totalOf,
} from '../../site/apps/elections/lib/census-context.js';
import { areaKey as buildAreaKey, parseCsv } from '../../scripts/build/elections-app/census-context.mjs';

const read = (/** @type {string} */ rel) => JSON.parse(readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8'));
/** @type {import('../../site/apps/elections/lib/census-context.js').CensusData} */
const data = read('site/apps/elections/census/ni-areas.json');

test('the figures file: its sets, layers, censuses and standard indicators only', () => {
  assert.equal(data.schemaVersion, 1);
  assert.deepEqual(data.indicators, ['residents', 'age65', 'owner', 'social', 'nocar', 'level4', 'unemployed']);
  // Standard, not sensitive: no religion, community background, national identity or health.
  assert.doesNotMatch(JSON.stringify(data.indicators), /relig|catholic|protestant|identity|health|disab/i);
  assert.deepEqual(data.sets.map((s) => s.id), ['dea-2014', 'dea-1993', 'pc-2008', 'pc-1995']);
  assert.deepEqual(data.sets.map((s) => s.censuses.map((c) => c.year)), [[2021], [2001, 2011], [2011], [2001]]);
  assert.match(data.licence, /Open Government Licence v3\.0/);
  for (const s of data.sets) {
    for (const c of s.censuses) {
      for (const id of data.indicators) assert.ok(c.tables[id]?.code, `${s.id} ${c.year} ${id}: no table code`);
      for (const [name, a] of Object.entries(c.areas)) {
        for (const id of data.indicators) {
          const f = a[id];
          assert.ok(Array.isArray(f) && f.length === (id === 'residents' ? 1 : 2), `${s.id} ${c.year} ${name} ${id}`);
          if (f.length === 2) assert.ok(f[0] >= 0 && f[0] <= f[1] && f[1] > 0, `${s.id} ${c.year} ${name} ${id}: ${f}`);
        }
      }
    }
  }
});

test('every area is a feature of its layer, and every feature has its figures', () => {
  for (const s of data.sets) {
    const idx = read(`render/metadata/feature-indexes/${s.layers[0]}.json`);
    const names = idx.items.map((/** @type {{ name: string }} */ it) => it.name).sort();
    for (const c of s.censuses) assert.deepEqual(Object.keys(c.areas).sort(), names, `${s.id} ${c.year}`);
  }
});

test('the census totals are Northern Ireland\'s (the sets cover it whole)', () => {
  const residents = (/** @type {string} */ set, /** @type {number} */ year) => totalOf(/** @type {import('../../site/apps/elections/lib/census-context.js').CensusBlock} */ (setFor(data, data.sets.find((s) => s.id === set)?.layers[0])?.censuses.find((c) => c.year === year)), 'residents');
  assert.equal(residents('pc-1995', 2001), 1685267);
  assert.equal(residents('dea-1993', 2001), 1685267);
  assert.equal(residents('pc-2008', 2011), 1810863);
  assert.equal(residents('dea-1993', 2011), 1810863);
  // The 2021 flexible table builder perturbs small cells: within a few dozen of 1,903,175.
  assert.ok(Math.abs(residents('dea-2014', 2021) - 1903175) < 100);
});

test('the census nearest the election, and the layer a set answers for', () => {
  const dea93 = /** @type {import('../../site/apps/elections/lib/census-context.js').CensusSet} */ (setFor(data, 'deas-1993-vector'));
  assert.equal(censusFor(dea93, '1993-05-19').year, 2001);
  assert.equal(censusFor(dea93, '2005-05-05').year, 2001);
  assert.equal(censusFor(dea93, '2011-05-05').year, 2011);
  assert.equal(censusFor(dea93, null).year, 2011);
  assert.equal(setFor(data, 'assembly-areas-2008-alias')?.id, 'pc-2008');
  assert.equal(setFor(data, 'pc-2023-vector'), null);
  assert.equal(setFor(data, 'roi-lea-2019-vector'), null);
});

test('figures, ranks and keys', () => {
  assert.equal(figure([5]), 5);
  assert.equal(figure([1, 4]), 25);
  assert.equal(figure([1, 0]), null);
  assert.equal(figure(undefined), null);
  assert.equal(rankOf(30, [10, 30, 50, 30, null]), 2);
  assert.equal(rankOf(50, [10, 30, 50]), 1);
  assert.equal(areaKey('Antrim Northwest'), areaKey('ANTRIM NORTH WEST'));
  assert.equal(areaKey('Newry & Armagh'), areaKey('NEWRY AND ARMAGH'));
  assert.equal(areaKey('Fermanagh and South Tyrone'), buildAreaKey('FERMANAGH AND SOUTH TYRONE'), 'the build script and the app match names alike');
  assert.equal(baseOf('level4', 2001), 'of residents aged 16 to 74 (level 4 or above)');
  assert.equal(baseOf('level4', 2011), 'of residents aged 16 and over (level 4 or above)');
  assert.equal(baseOf('unemployed', 2021), 'of economically active residents aged 16 and over');
});

test('an area in context: Belfast East at the 2017 Assembly election (Census 2011, Assembly Areas)', () => {
  const c = areaContext(data, { layerId: 'assembly-areas-2008-alias', area: 'BELFAST EAST', date: '2017-03-02' });
  assert.equal(c.status, 'shown');
  if (c.status !== 'shown') return;
  assert.equal(c.census.year, 2011);
  assert.equal(c.area, 'BELFAST EAST');
  const row = (/** @type {string} */ id) => /** @type {import('../../site/apps/elections/lib/census-context.js').IndicatorRow} */ (c.rows.find((r) => r.id === id));
  assert.equal(row('residents').value, 92221);
  assert.equal(row('residents').kind, 'count');
  assert.equal(row('owner').table.code, 'KS402NI');
  assert.ok(Math.abs(row('nocar').value - (100 * 11675) / 40918) < 1e-9);
  for (const r of c.rows) {
    assert.equal(r.of, 18);
    assert.ok(r.rank >= 1 && r.rank <= 18);
    assert.equal(r.label, INDICATOR_LABELS[r.id]);
  }
  assert.equal(c.similar.length, 5);
  assert.ok(!c.similar.some((s) => s.name === 'BELFAST EAST'), 'not similar to itself');
  assert.deepEqual(c.others, []);
});

test('similar areas are the nearest by the share indicators, nearest first', () => {
  const census = /** @type {import('../../site/apps/elections/lib/census-context.js').CensusBlock} */ (setFor(data, 'deas-2012-vector')?.censuses[0]);
  const sim = similarAreas(data, census, 'Botanic', 79);
  assert.equal(sim.length, 79);
  for (let i = 1; i < sim.length; i += 1) assert.ok(sim[i].distance >= sim[i - 1].distance);
  // A tiny synthetic set: B is the twin of A, C is far away.
  const tiny = { schemaVersion: 1, licence: '', licenceUrl: '', indicators: ['residents', 'owner'], sets: [] };
  const blk = { year: 2021, date: '2021-03-21', source: '', geography: '', tables: {}, areas: { A: { residents: [1], owner: [50, 100] }, B: { residents: [9], owner: [51, 100] }, C: { residents: [1], owner: [90, 100] } } };
  assert.deepEqual(similarAreas(tiny, blk, 'A', 2).map((s) => s.name), ['B', 'C']);
});

test('no figures: boundaries not held (the 2023 constituencies, the Republic), or an area not among them', () => {
  assert.deepEqual(areaContext(data, { layerId: 'pc-2023-vector', area: 'BELFAST EAST', date: '2024-07-04' }), { status: 'not-held' });
  assert.deepEqual(areaContext(data, { layerId: 'roi-lea-2019-vector', area: 'ARDEE LEA-6', date: '2019-05-24' }), { status: 'not-held' });
  assert.equal(areaContext(data, { layerId: 'deas-2012-vector', area: 'Atlantis', date: '2019-05-02' }).status, 'no-area');
  // The council elections of 1993 to 2011 on the 1993 DEAs, by the contest's own spelling.
  const c = areaContext(data, { layerId: 'deas-1993-vector', area: 'Antrim Northwest', date: '2011-05-05' });
  assert.equal(c.status, 'shown');
  if (c.status === 'shown') {
    assert.equal(c.area, 'ANTRIM NORTH WEST');
    assert.deepEqual(c.others, [2001]);
    assert.equal(c.rows.find((r) => r.id === 'unemployed')?.table.code, 'KS601NI');
  }
});

test('similar areas link to their contests in the same election', () => {
  const link = contestLinker('northern-ireland-assembly__2022-05-05', [
    { key: 'northern-ireland-assembly__2022-05-05::belfast-east', resultName: 'Belfast East', resultKind: 'constituency-result' },
    { key: 'northern-ireland-assembly__2022-05-05', resultName: 'Northern Ireland', resultKind: 'overall' },
  ]);
  assert.equal(link('BELFAST EAST'), '/elections/northern-ireland-assembly-2022-05-05/belfast-east/');
  assert.equal(link('NORTHERN IRELAND'), null);
  assert.equal(link('FOYLE'), null);
});

test('names in capitals read in title case; others as they are', () => {
  assert.equal(displayName('FERMANAGH AND SOUTH TYRONE'), 'Fermanagh and South Tyrone');
  assert.equal(displayName('EAST LONDONDERRY'), 'East Londonderry');
  assert.equal(displayName('NEWRY AND ARMAGH'), 'Newry and Armagh');
  assert.equal(displayName('BELFAST AREA F'), 'Belfast Area F');
  assert.equal(displayName('Lisnasharragh'), 'Lisnasharragh');
  assert.equal(displayName('The Mournes'), 'The Mournes');
});

test('the build script reads quoted CSV fields', () => {
  assert.deepEqual(parseCsv('a,b\r\n1,"x, ""y"""\n'), [['a', 'b'], ['1', 'x, "y"']]);
});

test('every word of the component is keyed for translation in en.json (R10)', async () => {
  const { AREA_STRINGS, areaContextSection } = await import('../../site/apps/elections/views/area-context.js');
  const english = new Set(Object.values(read('site/assets/i18n/en.json').strings));
  for (const s of AREA_STRINGS) assert.ok(english.has(s), `not keyed: ${s}`);
  for (const s of data.sets.flatMap((x) => x.censuses.flatMap((c) => [c.source, c.geography]))) assert.ok(english.has(s), `not keyed: ${s}`);
  assert.match(areaContextSection(), /<h2 id="el-census">The area in the census<\/h2>/);
});
