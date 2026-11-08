// Map layer draw order (packages/map/src/app/layer-order.mjs, seam A1 of the frontend plan): the pure
// parsing and normalising moved out of packages/map/app/app.js.
//
//   node --test tests/unit/layer-order.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  LAYER_ORDER_STORAGE_KEY,
  layerOrderToRestore,
  normalizeLoadedLayerOrder,
  parseLayerOrder,
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
