#!/usr/bin/env node
/**
 * Headless regression checks for chunked-layer fit behavior.
 *
 * This protects the Civil Parishes failure mode: a chunked map must never
 * auto-fit to the partial Leaflet group created by the currently rendered
 * viewport chunks.
 */

import assert from 'node:assert/strict';
import { validateChunkedMapBounds } from './validate-chunked-map-bounds.mjs';

function chooseFitSource(state) {
  const hasFullBounds = !!state.fullBounds;
  const isChunked = !!(state.useSpatial || state.chunked);
  if (isChunked) return hasFullBounds ? 'full-bounds' : 'skip';
  if (state.groupBounds) return 'rendered-group';
  return hasFullBounds ? 'full-bounds' : 'none';
}

const validation = validateChunkedMapBounds();
assert.deepEqual(validation.errors, [], 'Chunked map bounds validation must pass');

// The source-level checks on the retired Leaflet map controller
// (archive/leaflet/js/map-controller.js) went when archive/ left the repository;
// see ARCHIVE.md. The fit policy below and the bounds validation above remain.

assert.equal(
  chooseFitSource({ chunked: true, fullBounds: false, groupBounds: true }),
  'skip',
  'chunked map without full bounds must not fit to rendered group bounds'
);
assert.equal(
  chooseFitSource({ useSpatial: true, fullBounds: true, groupBounds: true }),
  'full-bounds',
  'spatial map with full bounds should fit to full bounds'
);
assert.equal(
  chooseFitSource({ chunked: false, fullBounds: false, groupBounds: true }),
  'rendered-group',
  'non-chunked maps may still fit to rendered group bounds'
);

console.log('PASS: chunked fit regression checks passed.');
