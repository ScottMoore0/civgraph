// Map layer draw order (packages/map/src/app/layer-order.mjs, seam A1 of the frontend plan): the pure
// parsing and normalising moved out of packages/map/app/app.js.
//
//   node --test tests/unit/layer-order.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  LAYER_ORDER_STORAGE_KEY,
  layerOrderForAddress,
  layerOrderToRestore,
  normalizeLoadedLayerOrder,
  parseLayerOrder,
  rowOrderToLoadedIds,
  serializeSavedLayerOrder
} from '../../packages/map/src/app/layer-order.mjs';

test('the storage key is unchanged', () => {
  assert.equal(LAYER_ORDER_STORAGE_KEY, 'civgraph:maplibre:layer-order');
});

test('parseLayerOrder reads arrays, JSON and comma lists', () => {
  assert.deepEqual(parseLayerOrder(null), []);
  assert.deepEqual(parseLayerOrder('   '), []);
  assert.deepEqual(parseLayerOrder(['a', ' b ', '', 'a', null]), ['a', 'b']);
  assert.deepEqual(parseLayerOrder('["wards-2014","counties-ni"]'), ['wards-2014', 'counties-ni']);
  assert.deepEqual(parseLayerOrder('wards-2014, counties-ni,,wards-2014'), ['wards-2014', 'counties-ni']);
  // A bracketed string that is not JSON falls back to commas.
  assert.deepEqual(parseLayerOrder('[a,b'), ['[a', 'b']);
  // An empty JSON array also falls back, to the text itself.
  assert.deepEqual(parseLayerOrder('[]'), ['[]']);
});

test('serializeSavedLayerOrder saves two or more layers, otherwise clears', () => {
  assert.equal(serializeSavedLayerOrder('a,b,a'), '["a","b"]');
  assert.equal(serializeSavedLayerOrder(['only']), null);
  assert.equal(serializeSavedLayerOrder(''), null);
});

test('normalizeLoadedLayerOrder keeps loaded ids in order, then the rest in load order', () => {
  assert.deepEqual(normalizeLoadedLayerOrder('c,x,a,c', ['a', 'b', 'c']), ['c', 'a', 'b']);
  assert.deepEqual(normalizeLoadedLayerOrder('', ['a', 'b']), ['a', 'b']);
  assert.deepEqual(normalizeLoadedLayerOrder('a,b'), []);
});

test('layerOrderToRestore prefers the URL, falls back to the saved order, needs two layers', () => {
  const loaded = () => ['a', 'b', 'c'];
  let savedReads = 0;
  const readSaved = () => {
    savedReads += 1;
    return ['b', 'a'];
  };
  assert.deepEqual(layerOrderToRestore(new URLSearchParams('layerOrder=c,a'), readSaved, loaded), ['c', 'a', 'b']);
  assert.equal(savedReads, 0);
  assert.deepEqual(layerOrderToRestore(new URLSearchParams(''), readSaved, loaded), ['b', 'a', 'c']);
  assert.equal(savedReads, 1);
  assert.deepEqual(layerOrderToRestore(new URLSearchParams(''), () => [], loaded), []);
  assert.deepEqual(layerOrderToRestore(new URLSearchParams('layerOrder=a'), readSaved, () => ['a']), []);
  assert.deepEqual(layerOrderToRestore(null), []);
});

test('layerOrderForAddress writes the draw order whenever two or more listed layers are drawn', () => {
  // Even when it matches the layers list: a link opened elsewhere stacks its layers as they
  // arrive, so the list is no draw order (and a drag back to it was lost from the link).
  assert.equal(layerOrderForAddress(['a', 'b'], ['a', 'b']), 'a,b');
  assert.equal(layerOrderForAddress(['b', 'a'], ['a', 'b']), 'b,a');
  // Only the listed layers, in the draw order.
  assert.equal(layerOrderForAddress(['c', 'b', 'a'], ['a', 'b']), 'b,a');
  assert.equal(layerOrderForAddress(['a'], ['a']), null);
  assert.equal(layerOrderForAddress(['a', 'b'], ['a']), null);
  assert.equal(layerOrderForAddress([], []), null);
  assert.equal(layerOrderForAddress(null), null);
});

test('rowOrderToLoadedIds maps Active layers rows back to the ids the layers were loaded under', () => {
  const rowIdOf = (id) => ({ 'lgd-2012-vector': 'lgd-2012' })[id] || id;
  // An address loaded lgd-2012-vector; its row is the catalogue's lgd-2012.
  assert.deepEqual(rowOrderToLoadedIds(['lgd-2012', 'pc-2023'], ['pc-2023', 'lgd-2012-vector'], rowIdOf), ['lgd-2012-vector', 'pc-2023']);
  // Rows that are loaded ids pass through.
  assert.deepEqual(rowOrderToLoadedIds(['b', 'a'], ['a', 'b'], rowIdOf), ['b', 'a']);
  // A row id that is itself loaded is not redirected to the alias.
  assert.deepEqual(rowOrderToLoadedIds(['lgd-2012', 'lgd-2012-vector'], ['lgd-2012', 'lgd-2012-vector'], rowIdOf), ['lgd-2012', 'lgd-2012-vector']);
  // Unknown ids pass through, for normalising to drop.
  assert.deepEqual(rowOrderToLoadedIds(['x', 'a'], ['a'], rowIdOf), ['x', 'a']);
  assert.deepEqual(rowOrderToLoadedIds(null, ['a']), []);
  // Normalised against the loaded ids, both rows survive (the alias row used to be dropped).
  assert.deepEqual(
    normalizeLoadedLayerOrder(rowOrderToLoadedIds(['lgd-2012', 'pc-2023'], ['pc-2023', 'lgd-2012-vector'], rowIdOf), ['pc-2023', 'lgd-2012-vector']),
    ['lgd-2012-vector', 'pc-2023']
  );
});
