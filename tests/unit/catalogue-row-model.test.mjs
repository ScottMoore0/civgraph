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
import { catalogueTrail, comparable, countEdition, datedList, mapTitle, partLabel, rowActionKind, rowCitation, rowCount, rowEditions } from '@civgraph/map/catalogue/row-model.mjs';

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
