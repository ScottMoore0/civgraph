#!/usr/bin/env node
/**
 * Writes data/registries/layer-types.json: the map layer types (a layer record's sourceType), the
 * fields every published layer of a type carries, and how the map app treats each type.
 *
 *   node packages/registries/src/seed/layer-types.mjs           write the file
 *   node packages/registries/src/seed/layer-types.mjs --check   exit 1 if it differs from a fresh seed
 *
 * Fields, geometry types and renderers are read from render/metadata/maps-test.json (the
 * published layer index): `requiredFields` are the fields every layer of the type has there.
 * The behaviour flags say how the map app treats each type. They were first read from its
 * branches on sourceType (packages/map/src/renderer/map-controller.js); since 8 Nov 2026 the app reads them
 * (registries/browser/layer-types.json, one Set per flag), so the file itself is their source and a
 * fresh seed keeps each flag's types as the file has them. tests/unit/registries-layers.test.mjs
 * checks that the app builds each flag's Set from the registry. Two types never appear in the index: `mvt`, the z/x/y fallback the app builds for a
 * PMTiles layer, and `unconverted`, a catalogue entry with no tiles yet.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from '../index.mjs';

/** @typedef {import('../../../types/index.js').LayerTypesRegistry} LayerTypesRegistry */
/** @typedef {LayerTypesRegistry['types'][string]} LayerType */
/** @typedef {import('../../../types/index.js').LayerEntry} LayerEntry */

const OUT = 'data/registries/layer-types.json';
const CONTROLLER = 'packages/map/src/renderer/map-controller.js';

/** The map app's flags: flag -> [the Set map-controller.js builds from it, what the flag means]. */
/** @type {{ [flag: string]: [string, string] }} */
export const BEHAVIOUR_FLAGS = {
  threeD: ['THREE_D_TYPES', 'a 3D layer: terrain or a point cloud; turns on the 3D gesture handlers and terrain'],
  rasterSource: ['RASTER_SOURCE_TYPES', 'drawn from raster tiles or an image, so it has no features to pick'],
  noFeatureState: ['NO_FEATURE_STATE_TYPES', 'feature-state (hover, selection) is never set on it'],
  noLabels: ['NO_LABEL_TYPES', 'never gets a label layer']
};

/**
 * Flags read in more places than one map-controller.js Set: flag -> [what the flag means, who reads it].
 * vectorTiles (12 Nov 2026, architecture rule R6): the map app, the tile pipeline and the map-tile
 * checks each wrote its types out as ['mvt', 'pmtiles'].
 */
/** @type {{ [flag: string]: [string, string] }} */
export const SHARED_BEHAVIOUR_FLAGS = {
  vectorTiles: [
    'drawn from vector tiles (MVT, at z/x/y or in a PMTiles archive), which clip each feature at the tile edges: a picked polygon is put back together from its pieces, and the tile pipeline and its checks treat the layer as tiled vector data',
    `${CONTROLLER}: TILED_VECTOR_SOURCE_TYPES; packages/maps-pipeline/src/tiles/pmtiles.mjs; scripts/check/rules/test-app.mjs and tile-budgets.mjs`
  ]
};
const ALL_FLAGS = [...Object.keys(BEHAVIOUR_FLAGS), ...Object.keys(SHARED_BEHAVIOUR_FLAGS)];

/** The line of map-controller.js that builds a flag's Set of source types from the registry. */
export const behaviourLine = (/** @type {string} */ flag) => `const ${BEHAVIOUR_FLAGS[flag][0]} = new Set(layerTypes.behaviour.${flag});`;

/** @type {{ [type: string]: { note: string, sources: string[] } }} */
const RUNTIME_ONLY = {
  mvt: { note: 'Built by the app as the z/x/y.pbf fallback of a PMTiles layer (tilesFallback) or when promote-layers finds no PMTiles archive; never in the published index.', sources: ['packages/map/src/renderer/map-controller.js', 'packages/maps-pipeline/src/tiles/promote-layers.mjs', 'packages/map/app/maplibre-main-adapter.js'] },
  unconverted: { note: 'A catalogue entry with no tiles yet (metadata-service.js); the map refuses to load it, as it does any layer with loadable false.', sources: ['packages/map/src/renderer/metadata-service.js', 'packages/map/src/renderer/map-controller.js'] }
};

/** @type {{ [type: string]: string }} */
const TILE_FORMAT = {
  pmtiles: 'vector tiles (MVT) in a PMTiles archive (tileUrl), with a z/x/y.pbf fallback (tilesFallback)',
  mvt: 'vector tiles (MVT) at z/x/y.pbf',
  raster: 'raster tiles at z/x/y (tiles)',
  'raster-dem': 'terrain-RGB raster tiles (tiles, demEncoding) with hillshade tiles',
  image: 'one georeferenced image (imageUrl, bounds)',
  'point-cloud': '3D Tiles point cloud (tilesetUrl)',
  unconverted: 'none'
};

/**
 * The layer-types registry as the map index and the current file give it.
 * @param {string} [root]
 * @returns {LayerTypesRegistry}
 */
export function seedLayerTypes(root = REPO_ROOT) {
  /** @type {{ layers: LayerEntry[] }} */
  const index = JSON.parse(readFileSync(path.join(root, 'render/metadata/maps-test.json'), 'utf8'));
  /** @type {LayerTypesRegistry} */
  const current = JSON.parse(readFileSync(path.join(root, OUT), 'utf8'));
  /** @type {Map<string, LayerEntry[]>} */
  const byType = new Map();
  for (const layer of index.layers) {
    if (!byType.has(layer.sourceType)) byType.set(layer.sourceType, []);
    /** @type {LayerEntry[]} */ (byType.get(layer.sourceType)).push(layer); // set above
  }
  const flagTypes = Object.fromEntries(ALL_FLAGS.map((flag) => [flag, new Set(
    Object.entries(current.types).filter(([, entry]) => entry.behaviour?.includes(flag)).map(([type]) => type)
  )]));
  /** @type {LayerTypesRegistry['types']} */
  const types = {};
  for (const type of [...byType.keys(), ...Object.keys(RUNTIME_ONLY)].sort()) {
    const layers = byType.get(type) || [];
    /** @type {LayerType} */
    const entry = { tileFormat: TILE_FORMAT[type] };
    // The renderer module (the layer-type code registry, packages/map/src/renderer/layer-kinds/) is
    // kept as the file has it, as the behaviour flags are: tests/unit/map-layer-kinds.test.mjs holds
    // it to the code.
    const drawnBy = current.types[type]?.drawnBy;
    if (drawnBy) entry.drawnBy = drawnBy;
    if (layers.length) {
      /** @type {Map<string, number>} */
      const counts = new Map();
      for (const l of layers) for (const k of Object.keys(l)) counts.set(k, (counts.get(k) || 0) + 1);
      entry.requiredFields = [...counts].filter(([, n]) => n === layers.length).map(([k]) => k).sort();
      entry.geometryTypes = /** @type {LayerType['geometryTypes']} */ ([...new Set(layers.map((l) => l.geometryType))].sort());
      entry.renderers = [...new Set(layers.map((l) => l.renderer))].sort();
    } else {
      entry.runtimeOnly = true;
      entry.note = RUNTIME_ONLY[type].note;
      entry.sources = RUNTIME_ONLY[type].sources;
    }
    const flags = ALL_FLAGS.filter((f) => flagTypes[f].has(type));
    if (flags.length) entry.behaviour = flags;
    types[type] = entry;
  }
  // An alias edition is a pmtiles layer that draws another layer's tiles: these fields come together.
  const aliases = index.layers.filter((l) => l.aliasOf);
  const aliasFields = ['aliasOf', 'aliasTargetLayerId', 'cloneOf', 'categoryId', 'conversionStatus']
    .filter((k) => aliases.every((l) => k in l));
  return {
    schemaVersion: 1,
    description: 'Map layer types: the sourceType of a layer record, the fields every published layer of the type carries (render/metadata/maps-test.json), its tile format, the renderer module that draws it (drawnBy: the layer-type code registry, packages/map/src/renderer/layer-kinds/), and how the map app treats it (behaviour: packages/map/src/renderer/map-controller.js). Schema: packages/registries/schemas/layer-types.schema.json; views: packages/registries/src/layers.mjs.',
    behaviourFlags: {
      ...Object.fromEntries(Object.entries(BEHAVIOUR_FLAGS).map(([flag, [name, meaning]]) => [flag, { meaning, source: `${CONTROLLER}: ${name}` }])),
      ...Object.fromEntries(Object.entries(SHARED_BEHAVIOUR_FLAGS).map(([flag, [meaning, source]]) => [flag, { meaning, source }])),
    },
    types,
    variants: {
      alias: {
        of: [...new Set(aliases.map((l) => l.sourceType))].sort(),
        marker: 'aliasOf',
        requiredFields: aliasFields,
        note: 'An alias edition (another date or name for a layer already drawn) carries the target layer\'s tiles; the layer-id rename (REFACTOR-PLAN.md section 10.2) keeps these links.'
      }
    }
  };
}

// Also run through the re-export at packages/registries/src/seed/layer-types.mjs (kept until 8 Dec 2026).
const isMain = Boolean(process.argv[1]) && /registries[\\/](?:src[\\/])?seed[\\/]layer-types\.mjs$/.test(path.resolve(process.argv[1]));
if (isMain) {
  const out = `${JSON.stringify(seedLayerTypes(), null, 1)}\n`;
  const file = path.join(REPO_ROOT, OUT);
  if (process.argv.includes('--check')) {
    let current = '';
    try { current = readFileSync(file, 'utf8'); } catch { /* missing */ }
    if (current !== out) { console.error(`${OUT} differs from a fresh seed`); process.exit(1); }
    console.log(`${OUT} matches a fresh seed`);
  } else {
    writeFileSync(file, out);
    console.log(`wrote ${OUT}`);
  }
}
