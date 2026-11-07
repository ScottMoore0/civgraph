/**
 * The layer-types registry (data/registries/layer-types.json) is valid, every published layer
 * record conforms to its type, and the behaviour flags are the map app's own sourceType branches.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadRegistry, registryErrors } from '../../registries/index.mjs';
import { BEHAVIOUR_FLAGS, seedLayerTypes, typesOnAnchorLine } from '../../registries/seed/layer-types.mjs';
import { hasBehaviour, layerRecordErrors, typesWithBehaviour } from '../../registries/layers.mjs';

const registry = loadRegistry('layers');
const read = (rel) => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');
const clone = () => structuredClone(registry);

test('layers: valid, and exactly what the layer index and the map app give', () => {
  assert.deepEqual(registryErrors('layers', registry), []);
  assert.deepEqual(seedLayerTypes(), registry);
});

test('layers: every published layer record conforms to its type', () => {
  const index = JSON.parse(read('render/metadata/maps-test.json'));
  const errors = index.layers.flatMap((layer) => layerRecordErrors(registry, layer));
  assert.deepEqual(errors, []);
  assert.ok(index.layers.length > 1000);
});

test('layers: each behaviour flag is the set of types the map-controller branch tests', () => {
  const controller = read('src/map/renderer/map-controller.js');
  for (const [flag, [anchor]] of Object.entries(BEHAVIOUR_FLAGS)) {
    const inCode = typesOnAnchorLine(controller, anchor);
    assert.ok(inCode, `map-controller.js no longer has "${anchor}": re-check ${flag} in data/registries/layer-types.json`);
    assert.deepEqual(typesWithBehaviour(registry, flag), inCode, flag);
  }
  assert.ok(hasBehaviour(registry, 'raster-dem', 'threeD'));
  assert.ok(!hasBehaviour(registry, 'pmtiles', 'noLabels'));
});

test('layers: records and registries that break the rules are refused', () => {
  const layer = { id: 'x', sourceType: 'pmtiles', geometryType: 'polygon', renderer: 'maplibre' };
  assert.ok(layerRecordErrors(registry, layer).some((e) => /without tileUrl/.test(e)));
  assert.match(layerRecordErrors(registry, { id: 'y', sourceType: 'geojson' })[0], /not registered/);
  assert.match(layerRecordErrors(registry, { id: 'z', sourceType: 'mvt' })[0], /never published/);
  const full = Object.fromEntries(registry.types.raster.requiredFields.map((f) => [f, 1]));
  Object.assign(full, { id: 'r', sourceType: 'raster', geometryType: 'raster', renderer: 'maplibre', aliasOf: 'other' });
  assert.ok(layerRecordErrors(registry, full).some((e) => /alias edition must be pmtiles/.test(e)));

  const badFlag = clone();
  badFlag.types.image.behaviour.push('flying');
  assert.ok(registryErrors('layers', badFlag).some((e) => /flying is not declared/.test(e)));
  const badGeom = clone();
  badGeom.types.raster.geometryTypes.push('blob');
  assert.ok(registryErrors('layers', badGeom).some((e) => /geometryTypes/.test(e)));
});
