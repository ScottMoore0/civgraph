import { test } from 'node:test';
import assert from 'node:assert/strict';
import { thumbnailMapId, thumbnailShown } from '@civgraph/core/thumbnail-shown.mjs';

test('a thumbnail is used for a shown map, a hidden map with a layer, and an image with no record', () => {
  assert.equal(thumbnailShown({}, true), true);
  assert.equal(thumbnailShown({}, false), true);
  assert.equal(thumbnailShown({ hidden: true }, true), true);
  assert.equal(thumbnailShown(undefined, false), true);
});

test('no thumbnail for a map to be added, nor for a hidden map with no layer', () => {
  assert.equal(thumbnailShown({ placeholder: true }, true), false);
  assert.equal(thumbnailShown({ placeholder: true }, false), false);
  assert.equal(thumbnailShown({ hidden: true }, false), false);
});

test('the 60 px copy names its map', () => {
  assert.equal(thumbnailMapId('plu-1901-60'), 'plu-1901');
  assert.equal(thumbnailMapId('plu-1901'), 'plu-1901');
});
