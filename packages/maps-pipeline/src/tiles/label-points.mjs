#!/usr/bin/env node
/**
 * Label points for the boundary layers (styling plan OT22, decision 3: approved by Phelim Birch
 * 21 Nov and the owner 23 Nov 2026; PLAN.md section 4.4).
 *
 * A tiled polygon's label used to sit in the middle of the tile fragment in view, so it moved as
 * the map panned, fell on coasts and lines, and an area cut by many tiles could go unlabelled. A
 * label-point file gives each area of a layer one point inside it (ST_PointOnSurface of the
 * area's pieces joined) and its area, so the map puts the label there and places larger areas
 * first (packages/map/src/renderer/label-text.mjs).
 *
 * Which layers: the tiled polygon layers at a boundary level (packages/maps-pipeline/src/
 * boundary-levels.mjs), with a label property and their source file on disk. Thematic layers
 * (labels that name a class) get none. An alias shares its target's file.
 *
 * Where: one GeoJSON FeatureCollection of points per layer, in the local map mirror at
 * data/maps/labels/<layerId>.labels.geojson, uploaded to the same key on the data origin. Each
 * point has `id` (the layer's promoteId value, or the row number for civ_fid layers), `area_m2`,
 * `label_rank` (round(10 log10 area), 0 to 100) and `label_name` / `label_name_ga` (NFC), the
 * last two for native symbol labels later (plan Phase 2). data/database/label-points.json
 * records each file's level, count, size and SHA-256.
 *
 *   node packages/maps-pipeline/src/tiles/label-points.mjs [--ids a,b] [--source-root <checkout>]
 *       build the files (sources read under --source-root, default this checkout)
 *   node packages/maps-pipeline/src/tiles/label-points.mjs --apply
 *       once the files are on the data origin: give each built layer, and its aliases,
 *       labelPointsUrl in render/metadata/maps-test.json (and take it from any other layer)
 *   node packages/maps-pipeline/src/tiles/label-points.mjs --plan
 *       list the layers that would get a file, and which have no source on disk
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';
import { SITE } from '@civgraph/config/node';
import { boundaryLevelOf } from '../boundary-levels.mjs';
import { centreInIreland, labelPointColumns } from '../label-data.mjs';

const ROOT = resolve(process.cwd());
const METADATA_PATH = resolve(ROOT, 'render/metadata/maps-test.json');
const RECORD_PATH = resolve(ROOT, 'data/database/label-points.json');
const PLACE_NAME_FIELDS = resolve(ROOT, 'site/assets/i18n/place-name-fields.json');
const CATALOGUE_PATH = resolve(ROOT, 'data/database/maps.json');
/** The bucket key of the files, which the local mirror (data/maps/) repeats. */
export const LABEL_POINTS_PREFIX = 'data/maps/labels/';

const args = process.argv.slice(2);
/** @param {string} name */
const argValue = (name) => { const i = args.indexOf(name); return i >= 0 ? (args[i + 1] || '') : ''; };
const ONLY = new Set(argValue('--ids').split(',').map((s) => s.trim()).filter(Boolean));
const SOURCE_ROOT = resolve(argValue('--source-root') || ROOT);

/**
 * A layer of maps-test.json, as far as this build reads it.
 * @typedef {{ id: string, sourceMapId?: string, category?: string, geometryType?: string, sourceType?: string,
 *   sourceFile?: string, sourceDatasetLayer?: string, promoteId?: string, labelProperty?: string | null,
 *   aliasOf?: string, aliasTargetLayerId?: string, cloneOf?: string, hidden?: boolean, labelPointsUrl?: string }} Layer
 */
/** @typedef {{ level: string, features: number, bytes: number, gzipBytes: number, sha256: string }} Built */

/** @type {{ layers: Layer[] }} */
const metadata = JSON.parse(readFileSync(METADATA_PATH, 'utf8'));
/** @type {{ note?: string, layers: Record<string, Built> }} */
const record = existsSync(RECORD_PATH) ? JSON.parse(readFileSync(RECORD_PATH, 'utf8')) : { layers: {} };
record.note = 'Label points (styling plan OT22 decision 3; packages/maps-pipeline/src/tiles/label-points.mjs): the layers with a label-point file in the local map mirror (data/maps/labels/<layerId>.labels.geojson, uploaded to the same key on the data origin), with the layer\'s boundary level, the point count, the file size raw and gzipped, and its SHA-256.';

/** The published FlatGeobuf of each map (maps.json files.fgb), by map id. @type {Map<string, string>} */
const publishedFgb = new Map();
for (const map of /** @type {{ maps?: Array<{ id?: string, files?: { fgb?: string } }> }} */ (JSON.parse(readFileSync(CATALOGUE_PATH, 'utf8'))).maps || []) {
  if (map.id && typeof map.files?.fgb === 'string') publishedFgb.set(map.id, map.files.fgb);
}

/**
 * A layer's source on disk: its sourceFile, else its map's published FlatGeobuf in the local map
 * mirror (data/maps/ repeats the data origin's keys). Null when neither is there.
 * @param {Layer} layer
 * @returns {string | null}
 */
function sourceOnDisk(layer) {
  const own = layer.sourceFile ? resolve(SOURCE_ROOT, String(layer.sourceFile).replace(/^\//, '')) : '';
  if (own && existsSync(own)) return own;
  const url = publishedFgb.get(String(layer.sourceMapId || '')) || '';
  const origin = `${SITE.dataOrigin}/`;
  const mirrored = url.startsWith(origin) ? resolve(SOURCE_ROOT, url.slice(origin.length)) : '';
  return mirrored && existsSync(mirrored) ? mirrored : null;
}

/** @param {Layer} layer */
const isAlias = (layer) => Boolean(layer.aliasOf || layer.aliasTargetLayerId || layer.cloneOf);

/** The layers that get a label-point file. */
function selectedLayers() {
  return metadata.layers.filter((layer) => layer.sourceType === 'pmtiles'
    && /polygon/i.test(String(layer.geometryType || ''))
    && !isAlias(layer)
    && layer.labelProperty
    && boundaryLevelOf(layer) !== 'other'
    && (!ONLY.size || ONLY.has(layer.id)));
}

/** @param {string} id */
const fileFor = (id) => resolve(ROOT, `${LABEL_POINTS_PREFIX}${id}.labels.geojson`);
/** @param {string} id */
export const labelPointsUrl = (id) => `${SITE.dataOrigin}/${LABEL_POINTS_PREFIX}${id}.labels.geojson`;
/** @param {unknown} v */
const q = (v) => `"${String(v).replace(/"/g, '""')}"`;

/**
 * The source's layer names, field names and EPSG code (null when it has none).
 * @param {string} file
 * @returns {{ layerNames: string[], fields: Set<string>, epsg: number | null }}
 */
function sourceInfo(file) {
  const r = spawnSync('ogrinfo', ['-json', '-so', file], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  try {
    const payload = JSON.parse(r.stdout);
    const first = payload.layers?.[0];
    const crs = first?.geometryFields?.[0]?.coordinateSystem?.projjson?.id;
    return {
      layerNames: /** @type {string[]} */ ((payload.layers || []).map((/** @type {{ name?: string }} */ l) => l.name).filter(Boolean)),
      fields: new Set(/** @type {string[]} */ ((first?.fields || []).map((/** @type {{ name?: string }} */ f) => f.name).filter(Boolean))),
      epsg: crs?.authority === 'EPSG' ? Number(crs.code) : null
    };
  } catch {
    return { layerNames: [], fields: /** @type {Set<string>} */ (new Set()), epsg: null };
  }
}

if (args.includes('--apply')) {
  const built = new Set(Object.keys(record.layers));
  let set = 0;
  let cleared = 0;
  for (const layer of metadata.layers) {
    const target = isAlias(layer) ? (layer.aliasTargetLayerId || layer.aliasOf || layer.cloneOf || '') : layer.id;
    const wanted = built.has(target) ? labelPointsUrl(target) : undefined;
    if (wanted && layer.labelPointsUrl !== wanted) { layer.labelPointsUrl = wanted; set += 1; }
    if (!wanted && layer.labelPointsUrl) { delete layer.labelPointsUrl; cleared += 1; }
  }
  writeFileSync(METADATA_PATH, `${JSON.stringify(metadata, null, 2)}\n`);
  console.log(`labelPointsUrl set on ${set} layer(s), cleared on ${cleared}.`);
  process.exit(0);
}

const layers = selectedLayers();
if (args.includes('--plan')) {
  const missing = layers.filter((l) => !sourceOnDisk(l));
  console.log(`${layers.length} layer(s) at a boundary level; ${missing.length} without a source under ${SOURCE_ROOT}:`);
  for (const l of missing) console.log(`  ${l.id} (${l.sourceFile || 'no sourceFile'})`);
  process.exit(0);
}

/** @type {Record<string, string>} */
const irishFields = existsSync(PLACE_NAME_FIELDS) ? (JSON.parse(readFileSync(PLACE_NAME_FIELDS, 'utf8')).layers || {}) : {};
mkdirSync(resolve(ROOT, LABEL_POINTS_PREFIX), { recursive: true });
let built = 0;
/** @type {string[]} */
const skipped = [];
for (const layer of layers) {
  const source = sourceOnDisk(layer);
  if (!source) { skipped.push(`${layer.id}: no source on disk`); continue; }
  const info = sourceInfo(source);
  const layerName = layer.sourceDatasetLayer && info.layerNames.includes(layer.sourceDatasetLayer) ? layer.sourceDatasetLayer : info.layerNames[0];
  const fid = layer.promoteId === 'civ_fid';
  const idField = layer.promoteId || 'id';
  if (!layerName || (!fid && !info.fields.has(idField)) || !info.fields.has(String(layer.labelProperty))) {
    skipped.push(`${layer.id}: the source lacks ${!layerName ? 'a layer' : (!fid && !info.fields.has(idField) ? `the id field ${idField}` : `the label field ${layer.labelProperty}`)}`);
    continue;
  }
  const irish = irishFields[layer.id] || irishFields[String(layer.sourceMapId)] || '';
  const idColumn = fid ? 'rowid' : q(idField);
  const sql = [
    `SELECT ${idColumn} AS id,`,
    `MIN(${q(layer.labelProperty)}) AS label_name,`,
    irish && info.fields.has(irish) ? `MIN(${q(irish)}) AS label_name_ga,` : '',
    labelPointColumns(info.epsg).join(', '),
    `FROM ${q(layerName)}`,
    `WHERE geometry IS NOT NULL AND ${idColumn} IS NOT NULL GROUP BY ${idColumn}`
  ].filter(Boolean).join(' ');
  const tmp = resolve(ROOT, LABEL_POINTS_PREFIX, `${layer.id}.tmp.geojson`);
  rmSync(tmp, { force: true });
  const r = spawnSync('ogr2ogr', ['-f', 'GeoJSON', tmp, source, '-dialect', 'SQLite', '-sql', sql,
    '-lco', 'COORDINATE_PRECISION=5', '-lco', 'RFC7946=YES'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0 || !existsSync(tmp)) { skipped.push(`${layer.id}: ogr2ogr failed: ${(r.stderr || '').trim().split('\n').pop()}`); continue; }
  /** @type {{ features?: Array<{ type: string, properties: Record<string, unknown>, geometry: { coordinates?: number[] } | null }> }} */
  const doc = JSON.parse(readFileSync(tmp, 'utf8'));
  rmSync(tmp, { force: true });
  const features = (doc.features || []).filter((f) => Array.isArray(f.geometry?.coordinates));
  const outside = features.filter((f) => !centreInIreland(/** @type {number[]} */ (f.geometry?.coordinates)));
  if (!features.length) { skipped.push(`${layer.id}: no feature has an id (${idField})`); delete record.layers[layer.id]; rmSync(fileFor(layer.id), { force: true }); continue; }
  if (outside.length * 2 > features.length) { skipped.push(`${layer.id}: ${outside.length} of ${features.length} points are not lon/lat on the island (source EPSG ${info.epsg ?? 'none'})`); continue; }
  const points = features.filter((f) => !outside.includes(f)).map((f) => {
    const area = Number(f.properties['area_m2']) || 0;
    /** @type {Record<string, unknown>} */
    const properties = {
      id: f.properties['id'],
      area_m2: Math.round(area),
      label_rank: area > 0 ? Math.max(0, Math.min(100, Math.round(10 * Math.log10(area)))) : 0,
      label_name: String(f.properties['label_name'] ?? '').trim().normalize('NFC')
    };
    const ga = f.properties['label_name_ga'];
    if (typeof ga === 'string' && ga.trim()) properties['label_name_ga'] = ga.trim().normalize('NFC');
    return { type: 'Feature', properties, geometry: f.geometry };
  });
  const body = `${JSON.stringify({ type: 'FeatureCollection', features: points })}\n`;
  writeFileSync(fileFor(layer.id), body);
  record.layers[layer.id] = {
    level: boundaryLevelOf(layer),
    features: points.length,
    bytes: statSync(fileFor(layer.id)).size,
    gzipBytes: gzipSync(body).length,
    sha256: createHash('sha256').update(body).digest('hex')
  };
  built += 1;
  console.log(`${layer.id}: ${points.length} label points${outside.length ? ` (${outside.length} off the island left out)` : ''}`);
}
record.layers = Object.fromEntries(Object.entries(record.layers).sort(([a], [b]) => a.localeCompare(b)));
writeFileSync(RECORD_PATH, `${JSON.stringify(record, null, 1)}\n`);
const total = Object.values(record.layers).reduce((sum, b) => sum + b.gzipBytes, 0);
console.log(`Built ${built} label-point file(s); ${Object.keys(record.layers).length} on record, ${(total / 1048576).toFixed(1)} MB gzipped. Skipped ${skipped.length}.`);
for (const line of skipped) console.log(`  skipped ${line}`);
