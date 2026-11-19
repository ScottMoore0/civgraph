/**
 * REG-5: the layer-type code registry (packages/map/src/renderer/layer-kinds/) against the data
 * registry (data/registries/layer-types.json drawnBy), and its renderers against the map
 * controller's branches on sourceType they replaced (map-controller.js before 12 Nov 2026,
 * restated below as the reference).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadRegistry, REPO_ROOT } from '@civgraph/registries/index.mjs';
import { drawnLayerTypes } from '@civgraph/registries/layers.mjs';
import { RENDERERS, layerRenderer, renderedLayerKinds } from '@civgraph/map/renderer/layer-kinds/index.mjs';
import { absoluteTileTemplate, boundsToFlatBbox, boundsToImageCoordinates, tileSourceRange } from '@civgraph/map/renderer/utils.js';
import { hillshadeSource } from '@civgraph/map/renderer/layer-kinds/terrain.mjs';

const registry = loadRegistry('layers');
/** @type {any} */ (globalThis).location ??= { origin: 'https://civgraph.example' };

test('layer kinds: the code registry draws exactly the types the data registry names a module for', () => {
  assert.deepEqual(renderedLayerKinds(), drawnLayerTypes(registry));
  for (const [renderer, file] of RENDERERS) {
    assert.equal(registry.types[renderer.kind]?.drawnBy, `packages/map/src/renderer/layer-kinds/${file}`, `${renderer.kind}: drawnBy names its module`);
  }
  for (const [type, entry] of Object.entries(registry.types)) {
    if (!entry.drawnBy) assert.equal(layerRenderer(type), null, `${type} has no renderer`);
  }
  assert.equal(layerRenderer('vector'), null);
  assert.equal(layerRenderer(undefined), null);
});

test('layer kinds: each drawnBy module exports its renderer', async () => {
  for (const [type, entry] of Object.entries(registry.types)) {
    if (!entry.drawnBy) continue;
    const mod = await import(pathToFileURL(path.join(REPO_ROOT, entry.drawnBy)).href);
    assert.ok(Object.values(mod).includes(layerRenderer(type)), `${entry.drawnBy} exports the ${type} renderer`);
  }
});

test('layer kinds: the controller resolves every layer through the registry', () => {
  const controller = readFileSync(path.join(REPO_ROOT, 'packages/map/src/renderer/map-controller.js'), 'utf8');
  assert.ok(controller.includes("import { layerRenderer } from './layer-kinds/index.mjs';"));
  // No branch on a drawn type's name is left in the controller's drawing code.
  const drawing = controller.slice(controller.indexOf('  async addLayerToMap('), controller.indexOf('  addRasterLayer('));
  const building = controller.slice(controller.indexOf('  buildSource(layer) {'), controller.indexOf('  installSourceHealthWatch('));
  for (const type of renderedLayerKinds()) {
    assert.ok(!drawing.includes(`'${type}'`) && !building.includes(`'${type}'`), `no '${type}' literal in addLayerToMap or buildSource`);
  }
});

/**
 * The controller's buildSource before REG-5, as the reference.
 * @param {any} layer
 * @param {Map<string, string>} archives
 */
function referenceSource(layer, archives) {
  if (layer.sourceType === 'pmtiles') {
    if (!layer.tileUrl) throw new Error('missing PMTiles URL');
    archives.set(layer.tileUrl, layer.tileUrl);
    return { type: 'vector', url: `pmtiles://${layer.tileUrl}`, minzoom: layer.minzoom, maxzoom: layer.maxzoom, promoteId: layer.promoteId };
  }
  if (layer.sourceType === 'mvt') {
    if (!layer.tiles) throw new Error('missing vector tile URL template');
    return { type: 'vector', tiles: [absoluteTileTemplate(layer.tiles)], minzoom: layer.minzoom, maxzoom: layer.maxzoom, bounds: boundsToFlatBbox(layer.bounds), promoteId: layer.promoteId };
  }
  if (layer.sourceType === 'raster') {
    if (!layer.tiles && !layer.tileUrl) throw new Error('missing raster tiles URL template');
    return { type: 'raster', tiles: [absoluteTileTemplate(layer.tiles || layer.tileUrl)], tileSize: layer.tileSize || 256, minzoom: layer.minzoom, maxzoom: layer.maxzoom, bounds: boundsToFlatBbox(layer.bounds) };
  }
  if (layer.sourceType === 'raster-dem') {
    if (!layer.tiles && !layer.tileUrl) throw new Error('missing raster-dem tiles URL template');
    return { type: 'raster-dem', tiles: [absoluteTileTemplate(layer.tiles || layer.tileUrl)], tileSize: layer.tileSize || 256, encoding: layer.demEncoding || 'terrarium', minzoom: layer.minzoom, maxzoom: layer.maxzoom, bounds: boundsToFlatBbox(layer.bounds) };
  }
  if (layer.sourceType === 'image') {
    const coordinates = boundsToImageCoordinates(layer.bounds);
    if (!coordinates) throw new Error('missing image bounds');
    if (!layer.imageUrl && !layer.url) throw new Error('missing image URL');
    return { type: 'image', url: layer.imageUrl || layer.url, coordinates };
  }
  throw new Error(`unsupported sourceType ${layer.sourceType}`);
}

/**
 * The controller's buildSource now: the renderer's source, or the same error.
 * @param {any} layer
 * @param {Map<string, string>} archives
 */
function registrySource(layer, archives) {
  const renderer = layerRenderer(layer.sourceType);
  if (!renderer?.source) throw new Error(`unsupported sourceType ${layer.sourceType}`);
  return renderer.source(layer, { openPmtilesArchive: (url) => { archives.set(url, url); } });
}

/**
 * A reference source without the minzoom, maxzoom and bounds keys it set to undefined.
 * @param {any} source
 */
function withoutUndefinedRange(source) {
  const copy = { ...source };
  for (const key of ['minzoom', 'maxzoom', 'bounds']) if (copy[key] === undefined) delete copy[key];
  return copy;
}

/** @param {() => unknown} fn */
const outcome = (fn) => { try { return { value: fn() }; } catch (error) { return { error: /** @type {Error} */ (error).message }; } };

test('layer kinds: every published layer gets the source it got before, and broken ones the same error', () => {
  /** @type {{ layers: any[] }} */
  const index = JSON.parse(readFileSync(path.join(REPO_ROOT, 'render/metadata/maps-test.json'), 'utf8'));
  const bounds = [[51.4, -10.7], [55.4, -5.4]];
  const samples = [
    ...index.layers,
    // The runtime-only and broken cases the index never holds.
    { id: 'mvt-fallback', sourceType: 'mvt', tiles: '/tiles/x/{z}/{x}/{y}.pbf', bounds, minzoom: 4, maxzoom: 12, promoteId: 'civ_fid' },
    { id: 'mvt-none', sourceType: 'mvt' },
    { id: 'pm-none', sourceType: 'pmtiles' },
    { id: 'raster-url', sourceType: 'raster', tileUrl: 'https://t.example/{z}/{x}/{y}.png', bounds },
    { id: 'raster-none', sourceType: 'raster' },
    { id: 'dem-none', sourceType: 'raster-dem' },
    { id: 'image-url', sourceType: 'image', url: '/img.png', bounds },
    { id: 'image-no-bounds', sourceType: 'image', imageUrl: '/img.png' },
    { id: 'image-no-url', sourceType: 'image', bounds },
    { id: 'cloud', sourceType: 'point-cloud', tilesetUrl: '/x/tileset.json' },
    { id: 'unconverted', sourceType: 'unconverted' },
    { id: 'unknown', sourceType: 'geojson' },
    { id: 'none' }
  ];
  const published = new Set(index.layers);
  let compared = 0;
  for (const layer of samples) {
    const before = new Map();
    const after = new Map();
    const want = outcome(() => referenceSource(layer, before));
    // Every published layer gets exactly the source it got before. A runtime-only sample's zoom or
    // bounds it does not give is now left out, where the reference set it to undefined.
    if (!published.has(layer) && 'value' in want) want.value = withoutUndefinedRange(want.value);
    // A terrain layer with a DEM tile index (w19-dem-fallback, 19 Nov 2026: ireland-terrain-3d and
    // -grey) asks the indexed-tiles protocol for its DEM tiles; every other key stays as before.
    if (layer.demTileIndex && 'value' in want) want.value = { ...want.value, tiles: [`civgraph-tiles://${layer.id}/dem/{z}/{x}/{y}`] };
    assert.deepEqual(outcome(() => registrySource(layer, after)), want, layer.id);
    assert.deepEqual([...after], [...before], `${layer.id}: the same PMTiles archive is opened`);
    compared += 1;
  }
  assert.ok(compared > 1000, `compared ${compared} layers`);
});

test('layer kinds: each type is drawn, made interactive and watched as before', () => {
  /** @type {string[]} */
  let calls = [];
  const host = {
    addRasterLayer: () => { calls.push('raster'); },
    addTerrainLayer: () => { calls.push('terrain'); return { layerIds: ['hillshade'], sourceIds: ['hs'] }; },
    addGeometryLayers: () => { calls.push('geometry'); },
    addInteractionOverlayLayers: () => { calls.push('overlay'); return { layerIds: ['o1'], sourceIds: ['os'] }; },
    addApproximateSegmentLayers: () => { calls.push('approximate'); return { layerIds: ['a1'], sourceIds: ['as'] }; }
  };
  const ids = { sourceId: 's', fillId: 'f', lineId: 'l', rasterId: 'r', hoverId: 'h', selectedFillId: 'sf', selectedId: 'sel' };
  // The old branches: point-cloud drew itself; raster-dem was terrain; raster and image one raster
  // layer; anything else fills, lines, overlays and approximate stretches. Interactions were bound
  // for every type but those four, and only pmtiles was watched for its fallback.
  /** @type {Record<string, { calls: string[], overlays?: unknown }>} */
  const expected = {
    'point-cloud': { calls: [] },
    'raster-dem': { calls: ['terrain'], overlays: { layerIds: ['hillshade'], sourceIds: ['hs'] } },
    raster: { calls: ['raster'], overlays: { layerIds: [], sourceIds: [] } },
    image: { calls: ['raster'], overlays: { layerIds: [], sourceIds: [] } },
    pmtiles: { calls: ['geometry', 'overlay', 'approximate'], overlays: { layerIds: ['o1', 'a1'], sourceIds: ['os', 'as'] } },
    mvt: { calls: ['geometry', 'overlay', 'approximate'], overlays: { layerIds: ['o1', 'a1'], sourceIds: ['os', 'as'] } }
  };
  assert.deepEqual(Object.keys(expected).sort(), renderedLayerKinds());
  for (const [type, want] of Object.entries(expected)) {
    const renderer = /** @type {import('@civgraph/map/renderer/layer-kinds/types.mjs').LayerRenderer} */ (layerRenderer(type));
    calls = [];
    assert.equal(Boolean(renderer.customLayer), type === 'point-cloud', `${type}: custom layer`);
    if (!renderer.customLayer) assert.deepEqual(/** @type {Function} */ (renderer.draw)(host, { id: type }, ids), want.overlays, `${type}: overlays`);
    assert.deepEqual(calls, want.calls, `${type}: draw`);
    assert.equal(Boolean(renderer.interactive), !['raster', 'image', 'raster-dem', 'point-cloud'].includes(type), `${type}: interactive`);
    assert.equal(Boolean(renderer.archiveFallback), type === 'pmtiles', `${type}: fallback watch`);
  }
});

test('layer kinds: the data registry refuses a published type without a renderer module', async () => {
  const { registryErrors } = await import('@civgraph/registries/index.mjs');
  const broken = structuredClone(registry);
  delete broken.types.raster.drawnBy;
  assert.ok(registryErrors('layers', broken).some((e) => e.includes('raster: a published type needs drawnBy')));
});

test('layer kinds: a tiled source sets minzoom, maxzoom and bounds only when the layer gives them', () => {
  const bounds = [[51.4, -10.7], [55.4, -5.4]];
  assert.deepEqual(tileSourceRange(5, 16, bounds), { minzoom: 5, maxzoom: 16, bounds: [-10.7, 51.4, -5.4, 55.4] });
  assert.deepEqual(tileSourceRange(0, 22), { minzoom: 0, maxzoom: 22 }, 'zoom 0 is a value');
  for (const [min, max, b] of [[undefined, undefined, undefined], [null, NaN, null], ['5', Infinity, [1, 2, 3]]]) {
    assert.deepEqual(tileSourceRange(min, max, b), {}, `${String(min)} ${String(max)} ${JSON.stringify(b)}`);
  }
  // MapLibre copies a key that is present but undefined over its default: no renderer may emit one.
  const bare = [
    { id: 'raster', sourceType: 'raster', tiles: '/r/{z}/{x}/{y}.png' },
    { id: 'dem', sourceType: 'raster-dem', tiles: '/d/{z}/{x}/{y}.png' },
    { id: 'pmtiles', sourceType: 'pmtiles', tileUrl: '/p.pmtiles' },
    { id: 'mvt', sourceType: 'mvt', tiles: '/m/{z}/{x}/{y}.pbf' }
  ];
  for (const layer of bare) {
    const source = /** @type {Record<string, unknown>} */ (registrySource(layer, new Map()));
    for (const key of ['minzoom', 'maxzoom', 'bounds']) assert.ok(!(key in source), `${layer.id}: no ${key} key`);
  }
});

test('layer kinds: the hillshade drape takes its own zooms, else the layer zooms, and never an undefined key', () => {
  const bounds = [[51.2, -10.9], [55.7, -5.2]];
  const base = { id: 't', sourceType: 'raster-dem', tiles: '/dem/{z}/{x}/{y}.png', hillshadeTiles: '/hs/{z}/{x}/{y}.png', tileSize: 256 };
  assert.equal(hillshadeSource({ id: 'no-drape', sourceType: 'raster-dem' }), null);
  assert.deepEqual(hillshadeSource({ ...base, minzoom: 5, maxzoom: 16, hillshadeMinzoom: 6, hillshadeMaxzoom: 12, bounds }),
    { type: 'raster', tiles: [absoluteTileTemplate('/hs/{z}/{x}/{y}.png')], tileSize: 256, minzoom: 6, maxzoom: 12, bounds: [-10.9, 51.2, -5.2, 55.7] });
  assert.deepEqual(hillshadeSource({ ...base, minzoom: 5, maxzoom: 16 }),
    { type: 'raster', tiles: [absoluteTileTemplate('/hs/{z}/{x}/{y}.png')], tileSize: 256, minzoom: 5, maxzoom: 16 });
  const bare = /** @type {Record<string, unknown>} */ (hillshadeSource(base));
  for (const key of ['minzoom', 'maxzoom', 'bounds']) assert.ok(!(key in bare), `no ${key} key`);
  // Every published terrain layer's drape keeps a full range, as before.
  /** @type {{ layers: any[] }} */
  const index = JSON.parse(readFileSync(path.join(REPO_ROOT, 'render/metadata/maps-test.json'), 'utf8'));
  const terrain = index.layers.filter((layer) => layer.hillshadeTiles);
  assert.ok(terrain.length > 0);
  for (const layer of terrain) {
    const source = /** @type {import('maplibre-gl').RasterSourceSpecification} */ (hillshadeSource(layer));
    assert.equal(source.minzoom, layer.hillshadeMinzoom ?? layer.minzoom, layer.id);
    assert.equal(source.maxzoom, layer.hillshadeMaxzoom ?? layer.maxzoom, layer.id);
    assert.deepEqual(source.bounds, boundsToFlatBbox(layer.bounds), layer.id);
  }
});
