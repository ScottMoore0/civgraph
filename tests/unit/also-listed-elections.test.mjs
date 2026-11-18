// An election listed under a second body besides the one it is filed under, the record staying one
// (data/registries/election-bodies.json groups.alsoListed; Phelim Birch's catalogue review #97): the
// 1918 election, filed under the Dáil, is on the Westminster shelf of the catalogue's Elections tab
// and on the House of Commons' page of the Elections app as well as on the Dáil's.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { REPO_ROOT, loadRegistry } from '@civgraph/registries/index.mjs';
import { checkElectionBodies } from '@civgraph/registries/election-bodies.mjs';
import { alsoListedUnder } from '@civgraph/registries/browser/body-groups.mjs';
import { alsoListedUnderBody } from '@civgraph/registries/browser/election-group-lists.mjs';
import { BODY_GROUPS, shelvesOf } from '@civgraph/map/catalogue/view-elections.js';
import { alsoListedSources, bodyListing, bodySummaries } from '../../site/apps/elections/lib/body-list.js';

const registry = loadRegistry('election-bodies');
const KEY_1918 = 'dail-eireann__1918-12-14';
const COMMONS = 'house-of-commons-of-the-united-kingdom';

test('every election the registry also lists is one the elections index holds, under another body', () => {
  const index = JSON.parse(readFileSync(path.join(REPO_ROOT, 'data/elections-source/data/elections_index.json'), 'utf8'));
  const keys = new Set(index.bodies.flatMap((/** @type {{ slug: string, dates: { date: string }[] }} */ b) => b.dates.map((d) => `${b.slug}__${d.date}`)));
  const listed = registry.groups.alsoListed || [];
  assert.ok(listed.some((entry) => entry.election === KEY_1918 && entry.body === COMMONS));
  for (const entry of listed) assert.ok(keys.has(entry.election), entry.election);
});

test('checkElectionBodies rejects an election listed under its own body, a shelfless body, or twice', () => {
  /** @param {{ election: string, body: string, why: string }[]} alsoListed */
  const errorsWith = (alsoListed) => checkElectionBodies({ ...registry, groups: { ...registry.groups, alsoListed } });
  const why = 'test';
  assert.deepEqual(errorsWith([{ election: KEY_1918, body: COMMONS, why }]), []);
  assert.match(errorsWith([{ election: KEY_1918, body: 'dail-eireann', why }]).join('\n'), /filed under dail-eireann already/);
  assert.match(errorsWith([{ election: KEY_1918, body: 'no-such-body', why }]).join('\n'), /no-such-body \(for dail-eireann__1918-12-14\) is on no catalogue shelf/);
  assert.match(errorsWith([{ election: KEY_1918, body: COMMONS, why }, { election: KEY_1918, body: COMMONS, why }]).join('\n'), /twice/);
});

test('alsoListedUnder: the keys listed under any of the bodies, once each', () => {
  const listed = [{ election: 'a__2000-01-01', body: 'b' }, { election: 'a__2000-01-01', body: 'c' }, { election: 'd__2001-01-01', body: 'e' }];
  assert.deepEqual(alsoListedUnder(listed, ['b', 'c']), ['a__2000-01-01']);
  assert.deepEqual(alsoListedUnder(listed, ['x']), []);
  assert.deepEqual(alsoListedUnder(undefined, ['b']), []);
  assert.deepEqual(alsoListedUnderBody(COMMONS), [KEY_1918]);
  assert.deepEqual(alsoListedUnderBody('dail-eireann'), []);
});

test('the catalogue lists the 1918 election on the Dáil and Westminster shelves, the rest on their own', () => {
  assert.deepEqual(BODY_GROUPS.find((g) => g.id === 'westminster')?.also, [KEY_1918]);
  /** @param {string} key @param {string} bodySlug @param {string} date */
  const row = (key, bodySlug, date) => /** @type {import('@civgraph/map/catalogue/catalogue-types.d.ts').CatalogueRowElection} */ (/** @type {unknown} */ ({ key, bodySlug, date, title: key }));
  const list = [
    row('house-of-commons-of-the-united-kingdom__1922-11-15', COMMONS, '1922-11-15'),
    row('dail-eireann__1921-05-24', 'dail-eireann', '1921-05-24'),
    row(KEY_1918, 'dail-eireann', '1918-12-14'),
    row('house-of-commons-of-the-united-kingdom__1910-12-03', COMMONS, '1910-12-03'),
  ];
  const shelves = Object.fromEntries(shelvesOf(list).map(({ g, es }) => [g.id, es.map((e) => e.key)]));
  assert.deepEqual(shelves.dail, ['dail-eireann__1921-05-24', KEY_1918]);
  // Newest first, as on its own shelf: the cross-listed election falls in date order.
  assert.deepEqual(shelves.westminster, ['house-of-commons-of-the-united-kingdom__1922-11-15', KEY_1918, 'house-of-commons-of-the-united-kingdom__1910-12-03']);
});

test('the Elections app lists the 1918 election on the House of Commons page too, and counts it there', () => {
  /** @param {string} key @param {string} kind */
  const row = (key, kind = 'general') => /** @type {import('../../site/apps/elections/lib/api.js').ElectionRow} */ (/** @type {unknown} */ ({
    key, kind, bodySlug: key.split('__')[0], body: key.startsWith('dail') ? 'Dáil Éireann' : 'House of Commons of the United Kingdom', date: key.split('__')[1]
  }));
  const commons = [row(`${COMMONS}__1922-11-15`), row(`${COMMONS}__1910-12-03`)];
  const dail = [row('dail-eireann__1921-05-24'), row(KEY_1918), row('dail-eireann__1925-03-11', 'by-election')];
  assert.deepEqual([...alsoListedSources([KEY_1918], COMMONS)], [['dail-eireann', [KEY_1918]]]);
  assert.deepEqual([...alsoListedSources([`${COMMONS}__1922-11-15`], COMMONS)], []);
  assert.deepEqual(bodyListing(commons, dail, [KEY_1918]).map((e) => e.key), [`${COMMONS}__1922-11-15`, KEY_1918, `${COMMONS}__1910-12-03`]);
  // Listed once, however often it is offered.
  assert.equal(bodyListing([...commons, row(KEY_1918)], dail, [KEY_1918]).filter((e) => e.key === KEY_1918).length, 1);
  const summaries = bodySummaries([...commons, ...dail], (slug) => (slug === COMMONS ? [KEY_1918] : []));
  assert.deepEqual(summaries.get(COMMONS), { slug: COMMONS, name: 'House of Commons of the United Kingdom', n: 3, by: 0, from: '1910-12-03', to: '1922-11-15' });
  assert.deepEqual(summaries.get('dail-eireann'), { slug: 'dail-eireann', name: 'Dáil Éireann', n: 3, by: 1, from: '1918-12-14', to: '1925-03-11' });
});
