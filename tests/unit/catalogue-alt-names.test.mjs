/**
 * A catalogue row's other names for search (scripts/build/catalogue/alt-names.mjs): its Irish name,
 * its maps' Irish names and the names it was known by before, in place of keywords (Phelim Birch's
 * notes, owner-approved 19 Nov 2026).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { altNames, catalogueIrishNames, nameFromRowId, oldIdsByRow } from '../../scripts/build/catalogue/alt-names.mjs';

test('the catalogue names English -> Irish, from the catalogue-names keys of both files', () => {
  const names = catalogueIrishNames(
    { 'catalogue-names.counties': 'Counties', 'catalogue.places': 'Places', 'catalogue-names.x': 'Same' },
    { 'catalogue-names.counties': 'Contaetha', 'catalogue.places': 'Áiteanna', 'catalogue-names.x': 'Same' },
  );
  assert.deepEqual([...names], [['Counties', 'Contaetha']]);
});

test('an old row id reads back as its old name, its subject taken off', () => {
  const subjects = ['built-heritage', 'built-heritage-and-protected-structures'];
  assert.equal(nameFromRowId('built-heritage-and-protected-structures-defence-heritage-sites', subjects), 'defence heritage sites');
  assert.equal(nameFromRowId('archaeology-sites--points', ['archaeology']), 'sites');
  assert.equal(nameFromRowId('flat-townlands', []), 'flat townlands');
});

test('redirect chains lead each old id to the row at their end', () => {
  const byRow = oldIdsByRow({ a: 'b', b: 'c', d: 'c', loop1: 'loop2', loop2: 'loop1' });
  assert.deepEqual(byRow.get('c'), ['a', 'b', 'd']);
});

test("a row's other names: its Irish name, its maps', its old names, each once and never its own", () => {
  const alt = altNames({ name: 'Counties', members: [{ id: 'c1977' }, { id: 'c1922' }], local: [{ id: 'local' }] }, {
    irishNames: new Map([['Counties', 'Contaetha']]),
    mapIrish: (id) => ({ c1977: 'Contaetha na hÉireann', c1922: 'contaetha na héireann', local: undefined })[id],
    oldIds: ['history-counties', 'history-old-shires'],
    subjectIds: ['history'],
  });
  assert.deepEqual(alt, ['Contaetha', 'Contaetha na hÉireann', 'old shires']);
});
