// The site's map figure is what the catalogue shows (owner, 11 Nov 2026): the stamped figure
// (data/database/site-stats.json, which check:site-figures holds every page to) is the number of
// maps in data/catalogue/catalogue.json, and the catalogue's sections, which count each series'
// maps and council maps (src/catalogue/index.js tabCounts), add up to the same number.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from '../../packages/config/src/node.mjs';
import { catalogueMapIds, catalogueToBeAddedIds } from '../../src/public-map.mjs';

const read = (rel) => JSON.parse(readFileSync(path.join(REPO_ROOT, rel), 'utf8'));

test('the stamped map figure is the catalogue\'s, and its sections add up to it', () => {
  const catalogue = read('data/catalogue/catalogue.json');
  const stats = read('data/database/site-stats.json').stats;
  const sections = catalogue.series.reduce((n, s) => n + s.members.length + (s.local?.length || 0), 0);
  assert.equal(catalogueMapIds(catalogue).size, sections, 'a map is listed in two places, so the sections count it twice');
  assert.equal(stats.publicMaps, sections, 'data/database/site-stats.json: run node scripts/build/build-site-stats.mjs');
  assert.equal(stats.mapsToBeAdded, catalogueToBeAddedIds(catalogue).size);
});

test('catalogueMapIds and catalogueToBeAddedIds', () => {
  const catalogue = { series: [
    { members: [{ id: 'a' }, { id: 'b' }], local: [{ id: 'c' }], todo: [{ id: 'd' }, { id: 'a' }] },
    { members: [{ id: 'e' }], todo: [{ id: 'd' }] },
    {},
  ] };
  assert.deepEqual([...catalogueMapIds(catalogue)], ['a', 'b', 'c', 'e']);
  assert.deepEqual([...catalogueToBeAddedIds(catalogue)], ['d']);
  assert.equal(catalogueMapIds(null).size, 0);
});
