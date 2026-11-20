/**
 * Parts of maps have no details pages of their own (Phelim Birch's review, owner-approved 20 Nov
 * 2026): map-relations.mjs partParentId finds the map a part belongs to, so a link or an old
 * address naming a part opens that map's page (data-service.js detailPageId).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { partParentId } from '@civgraph/map/map-relations.mjs';

const maps = [
  { id: 'all-ireland-townlands', variants: [{ id: 'ni-townlands' }, 'roi-townlands', { id: 'townlands-cities-and-islands' }] },
  { id: 'legacy-group', members: ['member-a'] },
  { id: 'dobih-v18-4-munros', parentId: 'dobih-v18-4' },
  { id: 'dobih-v18-4' },
  { id: 'self', variants: ['self'] },
];

test('a part (variants, either shape, or legacy members) resolves to its map', () => {
  assert.equal(partParentId(maps, 'ni-townlands'), 'all-ireland-townlands');
  assert.equal(partParentId(maps, 'roi-townlands'), 'all-ireland-townlands');
  assert.equal(partParentId(maps, 'townlands-cities-and-islands'), 'all-ireland-townlands');
  assert.equal(partParentId(maps, 'member-a'), 'legacy-group');
});

test('a map that is no part keeps its own page; a record\'s own parentId does not make it a part', () => {
  assert.equal(partParentId(maps, 'all-ireland-townlands'), null);
  assert.equal(partParentId(maps, 'dobih-v18-4-munros'), null);
  assert.equal(partParentId(maps, 'self'), null);
  assert.equal(partParentId(maps, ''), null);
  assert.equal(partParentId(null, 'ni-townlands'), null);
});

test('every part the catalogue lists belongs to a map it can open, in maps.json or the catalogue', () => {
  const doc = JSON.parse(readFileSync(new URL('../../data/database/maps.json', import.meta.url), 'utf8'));
  const catalogue = JSON.parse(readFileSync(new URL('../../data/catalogue/catalogue.json', import.meta.url), 'utf8'));
  const known = new Set(doc.maps.map((/** @type {{ id: string }} */ m) => m.id));
  for (const [id, rec] of Object.entries(catalogue.maps)) {
    for (const p of [...(rec.parts || []), ...(rec.counties || [])]) {
      const parent = partParentId(doc.maps, p.id);
      if (parent) assert.ok(known.has(parent), `${p.id} -> ${parent}`);
      // The catalogue's holder (data-service.js setPartHolders) is the row's map itself.
      assert.notEqual(id, p.id);
    }
  }
});
