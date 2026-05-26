#!/usr/bin/env node
/**
 * Headless regression checks for chunked-layer fit behavior.
 *
 * This protects the Civil Parishes failure mode: a chunked map must never
 * auto-fit to the partial Leaflet group created by the currently rendered
 * viewport chunks.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { validateChunkedMapBounds } from './validate-chunked-map-bounds.mjs';

const ROOT = resolve(process.cwd());
const CONTROLLER_PATH = resolve(ROOT, 'js/map-controller.js');

function sliceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `Missing source marker: ${startMarker}`);
  const end = source.indexOf(endMarker, start);
  assert.notEqual(end, -1, `Missing source marker after ${startMarker}: ${endMarker}`);
  return source.slice(start, end);
}

function chooseFitSource(state) {
  const hasFullBounds = !!state.fullBounds;
  const isChunked = !!(state.useSpatial || state.chunked);
  if (isChunked) return hasFullBounds ? 'full-bounds' : 'skip';
  if (state.groupBounds) return 'rendered-group';
  return hasFullBounds ? 'full-bounds' : 'none';
}

const validation = validateChunkedMapBounds();
assert.deepEqual(validation.errors, [], 'Chunked map bounds validation must pass');

const source = readFileSync(CONTROLLER_PATH, 'utf8');
const fitToLayer = sliceBetween(source, 'fitToLayer(id)', '\n    _getFullFitBounds(state)');
const fitToLayers = sliceBetween(source, 'fitToLayers(ids)', '\n    getLayerState(id)');

assert.ok(
  fitToLayer.includes("this._recordLoadMetric('chunked-fit-bounds-missing'"),
  'fitToLayer should record missing full bounds for chunked layers'
);
assert.ok(
  fitToLayers.includes("this._recordLoadMetric('chunked-fit-bounds-missing'"),
  'fitToLayers should record missing full bounds for chunked layers'
);
assert.ok(
  !source.includes('if ((state.useSpatial || state.config?.chunked) && cfgBounds)'),
  'chunked fit must not only special-case the cfgBounds-present path'
);

const singleChunkedBranch = fitToLayer.slice(
  fitToLayer.indexOf('if (state.useSpatial || state.config?.chunked)'),
  fitToLayer.indexOf('try {')
);
assert.ok(
  singleChunkedBranch.includes('return;'),
  'fitToLayer chunked branch must return before rendered group bounds are read'
);

const combinedChunkedBranch = fitToLayers.slice(
  fitToLayers.indexOf('if (state.useSpatial || state.config?.chunked)'),
  fitToLayers.indexOf('try {')
);
assert.ok(
  combinedChunkedBranch.includes('return;'),
  'fitToLayers chunked branch must return before rendered group bounds are read'
);

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
