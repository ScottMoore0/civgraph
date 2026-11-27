/**
 * What a catalogue row shows (packages/map/src/catalogue/row-model.mjs), after Phelim Birch's notes
 * on map actions and layout (owner-approved 19 Nov 2026): the row's actions by its shape, its maps
 * as a dated list, the "N <unit> · M editions" count from the latest complete edition, the pairs
 * Compare offers and the row's citation. Checked on made-up rows and on the catalogue itself.
 * And the names a map's Details page takes from the catalogue, not the old layer list (Phelim
 * Birch's review, owner-approved 20 Nov 2026): its name, the headings above its row, its parts.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { catalogueTrail, comparable, countEdition, datedList, detailHolders, foldList, listStyleOf, mapTitle, ownDescription, partLabel, rowActionKind, rowCitation, rowCount, rowEditions, rowMapCount } from '@civgraph/map/catalogue/row-model.mjs';
import { otherSubject } from '../../scripts/build/catalogue/records.mjs';

/** @type {Record<string, any>} */
const maps = {
  a: { date: '1977-01-01', status: 'ready', features: 32, unit: 'Counties' },
  b: { date: '1922', status: 'ready', features: 33, unit: 'Counties' },
  c: { date: '2001', status: 'incomplete', features: 10, unit: 'Counties' },
  d: { status: 'ready' },
  v: { date: '1977', status: 'ready' },
  p: { status: 'placeholder', date: '1850' },
};
const rec = (/** @type {string} */ id) => maps[id];
const row = (/** @type {any} */ extra) => ({ id: 'r', name: 'Counties', kind: 'Boundary', arrangement: 'editions', ...extra });

test('a row of several maps acts on itself, a row of one on its map, an empty row not at all', () => {
  assert.equal(rowActionKind(row({ members: [{ id: 'a', label: '1977' }, { id: 'b', label: '1922' }] })), 'row');
  // A version (`of`) is not an edition: Townlands with its 1844 Valuation is still one map.
  assert.equal(rowActionKind(row({ members: [{ id: 'a', label: '1977' }, { id: 'v', label: 'Generalised', of: 'a' }] })), 'map');
  assert.equal(rowActionKind(row({ members: [] })), 'none');
});

test('the dated list: newest first for editions, undated last, a set in its own order', () => {
  const s = row({ members: [{ id: 'b', label: '1922' }, { id: 'd', label: 'Undated' }, { id: 'a', label: '1977' }, { id: 'c', label: '2001' }] });
  assert.deepEqual(datedList(s, rec).map((m) => m.id), ['c', 'a', 'b', 'd']);
  assert.deepEqual(datedList({ ...s, arrangement: 'set' }, rec).map((m) => m.id), ['b', 'd', 'a', 'c']);
  assert.deepEqual(rowEditions(row({ members: [{ id: 'a', label: '1977' }, { id: 'v', label: 'G', of: 'a' }] })).map((m) => m.id), ['a']);
});

test('the count comes from the latest edition, or the latest complete one when the latest is incomplete', () => {
  const s = row({ members: [{ id: 'b', label: '1922' }, { id: 'a', label: '1977' }, { id: 'c', label: '2001' }] });
  assert.equal(countEdition(s, rec)?.id, 'a');
  assert.deepEqual(rowCount(s, rec), { features: 32, unit: 'Counties', editions: 3, from: 'a' });
  // No complete edition: the editions are counted, the features are not.
  const partial = row({ members: [{ id: 'c', label: '2001' }, { id: 'p', label: '1850' }, { id: 'c2', label: 'x' }] });
  maps.c2 = { date: '1990', status: 'incomplete', features: 4 };
  assert.deepEqual(rowCount(partial, rec), { features: null, unit: '', editions: 2, from: null });
  // Only rows of dated editions of one map are counted this way.
  assert.equal(rowCount({ ...s, arrangement: 'set' }, rec), null);
  assert.equal(rowCount(row({ members: [{ id: 'a', label: '1977' }] }), rec), null);
});

test('Compare offers every drawable edition and version; a row with one has nothing to compare', () => {
  const s = row({ members: [{ id: 'a', label: '1977' }, { id: 'v', label: 'Generalised', of: 'a' }, { id: 'b', label: '1922' }, { id: 'p', label: '1850' }] });
  assert.deepEqual(comparable(s, rec).map((m) => m.id), ['a', 'b', 'v']);
});

test("a row's citation credits its providers and gives its years and address", () => {
  const s = row({ provider: ['OSNI', 'Tailte Éireann'], years: [1915, 1977], members: [] });
  assert.equal(rowCitation(s, 'https://civgraph.net/maps/#cat=series/r', '19 Nov 2026'),
    'OSNI, Tailte Éireann. Counties (1915–1977) [map series]. Civgraph, https://civgraph.net/maps/#cat=series/r (accessed 19 Nov 2026).');
});

test('on the catalogue: every row of dated editions with a count names a complete edition it was read from', () => {
  const doc = JSON.parse(readFileSync(new URL('../../data/catalogue/catalogue.json', import.meta.url), 'utf8'));
  const of = (/** @type {string} */ id) => doc.maps[id];
  let counted = 0;
  for (const s of doc.series) {
    const n = rowCount(s, of);
    if (!n?.features) continue;
    counted += 1;
    const from = of(/** @type {string} */ (n.from));
    assert.ok(from && from.status !== 'incomplete' && from.status !== 'placeholder', `${s.id}: counted from an incomplete edition`);
    assert.equal(from.features, n.features);
  }
  assert.ok(counted > 10, `only ${counted} rows counted`);
  const counties = doc.series.find((/** @type {{ id: string }} */ s) => s.id === 'counties-counties');
  assert.deepEqual(rowCount(counties, of)?.editions, counties.members.filter((/** @type {{ of?: string }} */ m) => !m.of).length);
});

test("a map's name: its row's, with its own label when the row lists several maps or it is a council map", () => {
  const s = row({ members: [{ id: 'a', label: '1977' }, { id: 'b', label: '1922' }], local: [{ id: 'l', label: 'Fingal' }] });
  assert.equal(mapTitle(s, 'b'), 'Counties, 1922');
  assert.equal(mapTitle(s, 'l'), 'Counties, Fingal');
  assert.equal(mapTitle(row({ members: [{ id: 'a', label: '1977' }] }), 'a'), 'Counties');
  assert.equal(mapTitle(undefined, 'a'), '');
});

test('the headings above a row: its section, its shelf unless the section is flat, its subject when the shelf heads rows by it', () => {
  const r = { name: 'CSO Electoral Divisions' };
  assert.deepEqual(catalogueTrail({ section: 'Boundaries', shelf: { name: 'Government & Administration' }, subject: { name: 'Electoral Divisions' }, row: r }),
    ['Boundaries', 'Government & Administration', 'Electoral Divisions']);
  // A flat shelf lists its rows without subject headings; a subject named as its row adds nothing.
  assert.deepEqual(catalogueTrail({ section: 'Boundaries', shelf: { name: 'Historic Geographies', flat: true }, subject: { name: 'Townlands' }, row: { name: 'Townlands' } }), ['Boundaries', 'Historic Geographies']);
  assert.deepEqual(catalogueTrail({ section: 'Boundaries', shelf: { name: 'Water' }, subject: { name: 'Townlands' }, row: { name: 'Townlands' } }), ['Boundaries', 'Water']);
  // A section listed flat (Historic, Statistics) shows no shelves.
  assert.deepEqual(catalogueTrail({ section: 'Historic', flatSection: true, shelf: { name: 'Heritage & Culture' }, subject: { name: 'Printed Maps' }, row: r }), ['Historic']);
});

test('the headings end with the row\'s name when the row holds more than one map, never twice, never for a row of one', () => {
  // Phelim Birch, 20 Nov 2026: "Boundaries › Historic Geographies › Townlands".
  const flat = { name: 'Historic Geographies', flat: true };
  assert.deepEqual(catalogueTrail({ section: 'Boundaries', shelf: flat, subject: { name: 'Townlands' }, row: { name: 'Townlands', maps: 6 } }), ['Boundaries', 'Historic Geographies', 'Townlands']);
  assert.deepEqual(catalogueTrail({ section: 'Boundaries', shelf: flat, row: { name: 'Polities', maps: 1 } }), ['Boundaries', 'Historic Geographies']);
  // A subject heading named as the row comes once; a flat section gets the row's name after its tab.
  assert.deepEqual(catalogueTrail({ section: 'Boundaries', shelf: { name: 'Government & Administration' }, subject: { name: 'Counties' }, row: { name: 'Counties', maps: 6 } }), ['Boundaries', 'Government & Administration', 'Counties']);
  assert.deepEqual(catalogueTrail({ section: 'Statistics', flatSection: true, shelf: { name: 'Census' }, row: { name: 'Median age', maps: 1 } }), ['Statistics']);
  // A row of one main map and its council maps: the main map's line does not end with its own
  // name; a council map's ends with the map it copies (Phelim Birch, 26 Nov 2026).
  const md = { section: 'Boundaries', shelf: { name: 'Government & Administration' }, subject: { name: 'Current' } };
  assert.deepEqual(catalogueTrail({ ...md, row: { name: 'Municipal Districts', maps: 3, title: 'Municipal Districts' } }), ['Boundaries', 'Government & Administration', 'Current']);
  assert.deepEqual(catalogueTrail({ ...md, row: { name: 'Municipal Districts', maps: 3, title: 'Municipal Districts, Westmeath (2019)' } }), ['Boundaries', 'Government & Administration', 'Current', 'Municipal Districts']);
  assert.deepEqual(catalogueTrail({ section: 'Statistics', flatSection: true, shelf: { name: 'Census' }, row: { name: 'Population density', maps: 4 } }), ['Statistics', 'Population density']);
  // Maps, versions and council maps count; maps to be added and parts do not.
  assert.equal(rowMapCount(/** @type {any} */ ({ members: [{ id: 'a' }, { id: 'v', of: 'a' }], local: [{ id: 'l' }], todo: [{ id: 't' }] })), 3);
  assert.equal(rowMapCount(/** @type {any} */ ({ members: [{ id: 'a' }] })), 1);
});

test('a page of its own: a part opens the map its row lists it under, a map in no row the map the catalogue links it to', () => {
  const doc = /** @type {any} */ ({
    series: [{ id: 'town', members: [{ id: 'all' }, { id: 'osni', of: 'all' }], local: [{ id: 'dlr' }] }, { id: 'eds', members: [{ id: 'eds-2022' }, { id: 'conn' }] }],
    maps: { all: { parts: [{ id: 'ni' }], counties: [{ id: 'cork' }] }, 'eds-2022': { parts: [{ id: 'conn' }, { id: 'lein' }] } },
    mapLinks: { 'townlands-1844': { series: 'town', map: 'all' }, later: { series: 'town', todo: true }, results: { route: 'elections/irish-local' }, gone: { series: 'x', map: 'nowhere' }, poll: { series: 'eds', map: 'eds-2022' } },
    ownDetails: ['poll'],
  });
  const h = detailHolders(doc);
  assert.equal(h.get('ni'), 'all');
  assert.equal(h.get('cork'), 'all');
  assert.equal(h.get('lein'), 'eds-2022');
  assert.equal(h.get('townlands-1844'), 'all');
  // A map a row lists keeps its own page, as does one the catalogue links to no map.
  // A map a row lists keeps its own page, as does one the catalogue links to no map, and one whose
  // link opens a map on another subject (ownDetails).
  for (const id of ['conn', 'all', 'osni', 'dlr', 'later', 'results', 'gone', 'poll']) assert.equal(h.has(id), false, id);
});

test("a copy of another map's areas shows another subject when its category differs (records.mjs otherSubject)", () => {
  assert.equal(otherSubject({ category: 'referendums' }, { category: 'parliamentary' }), true);
  assert.equal(otherSubject({ category: 'counties' }, { category: 'counties' }), false);
  assert.equal(otherSubject({}, { category: 'counties' }), false);
  assert.equal(otherSubject(undefined, undefined), false);
});

test('on the catalogue: Townlands 1844, in no row, opens the Townlands page', () => {
  const doc = JSON.parse(readFileSync(new URL('../../data/catalogue/catalogue.json', import.meta.url), 'utf8'));
  assert.equal(detailHolders(doc).get('ni-townlands-1844'), 'all-ireland-townlands');
});

test('on the catalogue: a hidden copy, version or part opens the map it links to; a referendum keeps its own page', () => {
  // Owner, 21 Nov 2026 ("limit the redirect"): the five referendums link to the constituency or
  // Northern Ireland map whose areas they were counted in, but are another subject.
  /** @type {import('@civgraph/map/catalogue/catalogue-types.d.ts').CatalogueDoc} */
  const doc = JSON.parse(readFileSync(new URL('../../data/catalogue/catalogue.json', import.meta.url), 'utf8'));
  const h = detailHolders(doc);
  const dropped = ['av-turnout-2011', 'belfast-agreement-1998', 'border-poll-1973', 'common-market-1975', 'eu-referendum-2016'];
  assert.deepEqual(doc.ownDetails, dropped);
  for (const id of dropped) {
    assert.ok(doc.mapLinks?.[id]?.map, `${id} still links to a map (#layers=)`);
    assert.equal(h.has(id), false, id);
  }
  /** @type {[string, string][]} */
  const kept = [
    ['civil-parishes', 'civil-parishes-by-province'], ['provinces', 'provinces-1955'], ['hsct-2007', 'ni-health-trust-boundaries'],
    ['pc-1884', 'pc-1885-ireland'], ['pc-1918-26-counties', 'pc-1918-ireland'], ['townland-boundaries', 'all-ireland-townlands'],
    ['hed-listed-buildings', 'ni-listed-buildings'], ['ni-250k-geology', 'gsni-bedrock-geology-lines-250k'],
    ['eds-roi-1921-06-28', 'eds-1926'],
  ];
  for (const [id, to] of kept) assert.equal(h.get(id), to, id);
  // Every map in no row that a link sends elsewhere: 21 followed, the 5 referendums not.
  const linked = Object.entries(doc.mapLinks || {}).filter(([id, l]) => l.map && l.map !== id && !doc.series.some((s) => [...s.members, ...(s.local || [])].some((m) => m.id === id)));
  assert.equal(linked.length, 26);
  assert.equal(linked.filter(([id]) => h.has(id)).length, 21);
});

test("a map's own description: a census statistic's, as its record has it; none for other maps", () => {
  assert.equal(ownDescription({ isDataEntry: true, description: ' Usual resident population by DEA. ' }), 'Usual resident population by DEA.');
  assert.equal(ownDescription({ description: 'A record text the catalogue does not show.' }), '');
  assert.equal(ownDescription({ isDataEntry: true }), '');
  assert.equal(ownDescription(null), '');
});

test("a part's name is the catalogue's; a part it does not list has none", () => {
  const r = { parts: [{ id: 'ni', label: 'Northern Ireland' }], counties: [{ id: 'cork', label: 'Cork' }] };
  assert.equal(partLabel(r, 'ni'), 'Northern Ireland');
  assert.equal(partLabel(r, 'cork'), 'Cork');
  assert.equal(partLabel(r, 'x'), '');
  assert.equal(partLabel(undefined, 'ni'), '');
});

test('on the catalogue: the Townlands map is named as its row, not as the old layer list named it ("Ireland")', () => {
  const doc = JSON.parse(readFileSync(new URL('../../data/catalogue/catalogue.json', import.meta.url), 'utf8'));
  const s = doc.series.find((/** @type {{ id: string }} */ x) => x.id === 'townlands-townlands');
  const title = mapTitle(s, 'all-ireland-townlands');
  assert.ok(title.startsWith('Townlands'), title);
  assert.notEqual(title, doc.maps['all-ireland-townlands'].name);
  assert.equal(partLabel(doc.maps['all-ireland-townlands'], 'ni-townlands'), 'Northern Ireland');
});

test('listStyleOf: ?lists=a and ?lists=b are honoured; anything else is the live site list', () => {
  assert.equal(listStyleOf(''), 'current');
  assert.equal(listStyleOf(null), 'current');
  assert.equal(listStyleOf('?lists=a'), 'a');
  assert.equal(listStyleOf('lists=b&x=1'), 'b');
  assert.equal(listStyleOf('?lists=zzz'), 'current');
});

test('foldList: first five lines, all when unfolded, when one line would hide, or when the open line is past the fold', () => {
  const ten = [...Array(10).keys()];
  assert.deepEqual(foldList(ten), { shown: [0, 1, 2, 3, 4], hidden: 5 });
  assert.deepEqual(foldList(ten, { all: true }), { shown: ten, hidden: 0 });
  assert.deepEqual(foldList(ten, { keep: 7 }), { shown: ten, hidden: 0 });
  assert.deepEqual(foldList(ten, { keep: 2 }), { shown: [0, 1, 2, 3, 4], hidden: 5 });
  assert.deepEqual(foldList([1, 2, 3, 4, 5, 6]), { shown: [1, 2, 3, 4, 5, 6], hidden: 0 });
  assert.deepEqual(foldList([1, 2, 3]), { shown: [1, 2, 3], hidden: 0 });
});
