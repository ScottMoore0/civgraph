#!/usr/bin/env node
/**
 * Writes data/registries/layer-types.json: the map layer types (a layer record's sourceType), the
 * fields every published layer of a type carries, and how the map app treats each type.
 *
 *   node registries/seed/layer-types.mjs           write the file
 *   node registries/seed/layer-types.mjs --check   exit 1 if it differs from a fresh seed
 *
 * Fields, geometry types and renderers are read from render/metadata/maps-test.json (the
 * published layer index): `requiredFields` are the fields every layer of the type has there.
 * The behaviour flags are the map app's branches on sourceType (src/map/renderer/
 * map-controller.js), each cited by the anchor tests/unit/registries-layers.test.mjs finds them
 * by. Two types never appear in the index: `mvt`, the z/x/y fallback the app builds for a
 * PMTiles layer, and `unconverted`, a catalogue entry with no tiles yet.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from '../index.mjs';

const OUT = 'data/registries/layer-types.json';
const CONTROLLER = 'src/map/renderer/map-controller.js';

/** The map app's branches: flag -> [anchor text that finds the line, what the flag means]. */
export const BEHAVIOUR_FLAGS = {
  threeD: ['const is3d = (r) =>', 'a 3D layer: terrain or a point cloud; turns on the 3D gesture handlers and terrain'],
  rasterSource: ["if (layer?.sourceType === 'raster' ||", 'drawn from raster tiles or an image, so it has no features to pick'],
  noFeatureState: ['featureId === undefined || featureId === null ||', 'feature-state (hover, selection) is never set on it'],
  noLabels: ['!record.config?.labelProperty ||', 'never gets a label layer']
};

const RUNTIME_ONLY = {
  mvt: { note: 'Built by the app as the z/x/y.pbf fallback of a PMTiles layer (tilesFallback) or when promote-layers finds no PMTiles archive; never in the published index.', sources: ['src/map/renderer/map-controller.js', 'scripts/build/tiles/promote-layers.mjs', 'app/src/maplibre-main-adapter.js'] },
  unconverted: { note: 'A catalogue entry with no tiles yet (metadata-service.js); the map refuses to load it, as it does any layer with loadable false.', sources: ['src/map/renderer/metadata-service.js', 'src/map/renderer/map-controller.js'] }
};

const TILE_FORMAT = {
  pmtiles: 'vector tiles (MVT) in a PMTiles archive (tileUrl), with a z/x/y.pbf fallback (tilesFallback)',
  mvt: 'vector tiles (MVT) at z/x/y.pbf',
  raster: 'raster tiles at z/x/y (tiles)',
  'raster-dem': 'terrain-RGB raster tiles (tiles, demEncoding) with hillshade tiles',
  image: 'one georeferenced image (imageUrl, bounds)',
  'point-cloud': '3D Tiles point cloud (tilesetUrl)',
  unconverted: 'none'
};

/** Quoted sourceType values on the first line of `text` containing `anchor`. */
export function typesOnAnchorLine(text, anchor) {
  const line = text.split('\n').find((l) => l.includes(anchor));
  if (!line) return null;
  return [...new Set([...line.matchAll(/sourceType === '([a-z-]+)'/g)].map((m) => m[1]))].sort();
}

export function seedLayerTypes(root = REPO_ROOT) {
  const index = JSON.parse(readFileSync(path.join(root, 'render/metadata/maps-test.json'), 'utf8'));
  const controller = readFileSync(path.join(root, CONTROLLER), 'utf8');
  const byType = new Map();
  for (const layer of index.layers) {
    if (!byType.has(layer.sourceType)) byType.set(layer.sourceType, []);
    byType.get(layer.sourceType).push(layer);
  }
  const flagTypes = Object.fromEntries(Object.entries(BEHAVIOUR_FLAGS).map(([flag, [anchor]]) => {
    const types = typesOnAnchorLine(controller, anchor);
    if (!types) throw new Error(`${CONTROLLER}: anchor not found: ${anchor}`);
    return [flag, new Set(types)];
  }));
  const types = {};
  for (const type of [...byType.keys(), ...Object.keys(RUNTIME_ONLY)].sort()) {
    const layers = byType.get(type) || [];
    const entry = { tileFormat: TILE_FORMAT[type] };
    if (layers.length) {
      const counts = new Map();
      for (const l of layers) for (const k of Object.keys(l)) counts.set(k, (counts.get(k) || 0) + 1);
      entry.requiredFields = [...counts].filter(([, n]) => n === layers.length).map(([k]) => k).sort();
      entry.geometryTypes = [...new Set(layers.map((l) => l.geometryType))].sort();
      entry.renderers = [...new Set(layers.map((l) => l.renderer))].sort();
    } else {
      entry.runtimeOnly = true;
      entry.note = RUNTIME_ONLY[type].note;
      entry.sources = RUNTIME_ONLY[type].sources;
    }
    const flags = Object.keys(BEHAVIOUR_FLAGS).filter((f) => flagTypes[f].has(type));
    if (flags.length) entry.behaviour = flags;
    types[type] = entry;
  }
  // An alias edition is a pmtiles layer that draws another layer's tiles: these fields come together.
  const aliases = index.layers.filter((l) => l.aliasOf);
  const aliasFields = ['aliasOf', 'aliasTargetLayerId', 'cloneOf', 'categoryId', 'conversionStatus']
    .filter((k) => aliases.every((l) => k in l));
  return {
    schemaVersion: 1,
    description: 'Map layer types: the sourceType of a layer record, the fields every published layer of the type carries (render/metadata/maps-test.json), its tile format, and how the map app treats it (behaviour: src/map/renderer/map-controller.js). Schema: registries/schemas/layer-types.schema.json; views: registries/layers.mjs.',
    behaviourFlags: Object.fromEntries(Object.entries(BEHAVIOUR_FLAGS).map(([flag, [anchor, meaning]]) => [flag, { meaning, source: `${CONTROLLER}: ${anchor}` }])),
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

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
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
