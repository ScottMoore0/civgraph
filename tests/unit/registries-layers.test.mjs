/**
 * The layer-types registry (data/registries/layer-types.json) is valid, every published layer
 * record conforms to its type, and the behaviour flags are the map app's own sourceType branches.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadRegistry, registryErrors } from '../../packages/registries/src/index.mjs';
import { BEHAVIOUR_FLAGS, behaviourLine, seedLayerTypes } from '../../packages/registries/src/seed/layer-types.mjs';
import { hasBehaviour, layerRecordErrors, typesWithBehaviour } from '../../packages/registries/src/layers.mjs';

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

test('layers: the map app builds each behaviour flag set of types from the registry', () => {
  const controller = read('packages/map/src/renderer/map-controller.js');
  assert.ok(controller.includes("import layerTypes from '../../../registries/src/browser/layer-types.mjs';"));
  for (const flag of Object.keys(BEHAVIOUR_FLAGS)) {
    assert.ok(controller.includes(behaviourLine(flag)), `map-controller.js no longer builds ${flag}: ${behaviourLine(flag)}`);
    assert.ok(registry.behaviourFlags[flag], flag);
  }
  // The types each flag held when it was read off the branches (7 Nov 2026), so a change shows here.
  assert.deepEqual(typesWithBehaviour(registry, 'threeD'), ['point-cloud', 'raster-dem']);
  assert.deepEqual(typesWithBehaviour(registry, 'rasterSource'), ['image', 'raster']);
  assert.deepEqual(typesWithBehaviour(registry, 'noFeatureState'), ['raster']);
  assert.deepEqual(typesWithBehaviour(registry, 'noLabels'), ['image', 'raster']);
  // vectorTiles (12 Nov 2026, rf8-registries): the lists the map app, the tile pipeline and the
  // map-tile checks wrote out as ['mvt', 'pmtiles'], and whose complement they wrote as
  // ['raster', 'image', 'raster-dem', 'point-cloud'] (rasterSource and threeD together).
  assert.deepEqual(typesWithBehaviour(registry, 'vectorTiles'), ['mvt', 'pmtiles']);
  assert.deepEqual([...typesWithBehaviour(registry, 'rasterSource'), ...typesWithBehaviour(registry, 'threeD')].sort(), ['image', 'point-cloud', 'raster', 'raster-dem']);
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
