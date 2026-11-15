// The European shelf of the catalogue's Elections tab shows each year's two records (the elections
// in the Republic and in Northern Ireland, ireland-european__ and european-parliament__) as one
// grouped row (Phelim Birch's catalogue review #105): a display change only, the records stay two.
// The shelf's yearGroupTitle (data/registries/election-bodies.json) turns it on.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from '../../packages/registries/src/index.mjs';
import { BODY_GROUPS, shelfRows, shelvesOf } from '../../packages/map/src/catalogue/view-elections.js';

/** @typedef {import('../../packages/map/src/catalogue/catalogue-types.d.ts').CatalogueRowElection} CatalogueRowElection */
/** @param {string} key @param {string} date @returns {CatalogueRowElection} */
const row = (key, date) => /** @type {CatalogueRowElection} */ (/** @type {unknown} */ ({ key, date, bodySlug: key.split('__')[0], title: key }));

test('shelfRows: a year with two or more elections is one row under the title; a lone one stays a row', () => {
  const es = [row('ireland-european__2019-05-24', '2019-05-24'), row('european-parliament__2019-05-23', '2019-05-23'), row('ireland-european__2014-05-23', '2014-05-23')];
  const rows = shelfRows(es, '{year} European Parliament election');
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], { year: '2019', title: '2019 European Parliament election', es: es.slice(0, 2) });
  assert.deepEqual(rows[1], { e: es[2] });
  // A shelf without a yearGroupTitle lists every election as its own row.
  assert.deepEqual(shelfRows(es), es.map((e) => ({ e })));
  // An undated election is never grouped.
  assert.deepEqual(shelfRows([row('a__', ''), row('b__', '')], '{year} X'), [{ e: row('a__', '') }, { e: row('b__', '') }]);
});

test('the European shelf groups each year of the committed catalogue, and only it does', () => {
  assert.deepEqual(BODY_GROUPS.filter((g) => g.yearGroupTitle).map((g) => g.id), ['european']);
  const catalogue = JSON.parse(readFileSync(path.join(REPO_ROOT, 'data/catalogue/catalogue.json'), 'utf8'));
  const european = shelvesOf(catalogue.elections).find(({ g }) => g.id === 'european');
  assert.ok(european);
  const rows = shelfRows(european.es, european.g.yearGroupTitle);
  const groups = rows.flatMap((r) => ('es' in r ? [r] : []));
  // Every election year from 1979 to 2019 holds one election in each jurisdiction; 2024, after the
  // UK left the EU, the Republic's alone, a row of its own.
  assert.ok(groups.length >= 9, `${groups.length} grouped years`);
  assert.ok(rows.some((r) => 'e' in r && r.e.key === 'ireland-european__2024-06-07'));
  for (const g of groups) assert.deepEqual(g.es.map((e) => e.bodySlug).sort(), ['european-parliament', 'ireland-european'], g.year);
  // Nothing is lost or repeated: the rows hold every election of the shelf once.
  assert.equal(rows.reduce((n, r) => n + ('es' in r ? r.es.length : 1), 0), european.es.length);
});
