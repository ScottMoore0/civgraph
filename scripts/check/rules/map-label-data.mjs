#!/usr/bin/env node
/**
 * The map's names and anchor points are sound: centres on the island of Ireland in lon/lat, and
 * label and name text with no U+FFFD and in Unicode NFC.
 *
 * WHAT THIS GUARDS
 *
 * - Feature-index centres (render/metadata/feature-indexes/*.json) and election seat-circle
 *   anchors (render/metadata/election-anchors-test2/*.json) are lon/lat inside
 *   IRELAND_LONLAT_BOUNDS. dail-1998-vector shipped Irish Grid metres for both until 11 Nov 2026
 *   (its source is EPSG:29902 and nothing transformed it), so search, fly-to and the 1997/2002
 *   Dáil seat circles pointed into the Atlantic. A null centre is allowed: a feature with no usable
 *   geometry has none.
 * - Label and name text carries no U+FFFD (what a wrong-encoding decode leaves where a fada was:
 *   "Oile�n Bhaile Choit�n") and is NFC ("ú", not "u" + U+0301, which searches and renders as a
 *   different string). Checked in the feature indexes, the anchors, the spatial index and places
 *   list, and the category samples of every label or name field in render/metadata/maps-test.json.
 *
 * With --sources it also reads every local source FlatGeobuf named by maps-test.json (slow: a
 * few minutes) and checks the same text in its label and name fields. A damaged source value
 * passes only while data/database/label-text-repairs.json holds its repair (applied by
 * packages/maps-pipeline/src/tiles/repair-label-text.mjs before the tiles are rebuilt) or lists
 * it for review. Sources that are not on this machine are counted, not checked.
 *
 * Offline, so it belongs to `check:` rather than `verify:`.
 *
 *   node scripts/check/rules/map-label-data.mjs [--sources] [--root <dir>]
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { deserialize } from 'flatgeobuf/lib/mjs/geojson.js';
import { IRELAND_LONLAT_BOUNDS, centreInIreland, hasReplacementChar, notNfc } from '../../../packages/maps-pipeline/src/label-data.mjs';

const args = process.argv.slice(2);
const rootAt = args.indexOf('--root');
const ROOT = resolve(rootAt >= 0 ? args[rootAt + 1] : '.');
const SOURCES = args.includes('--sources');
const FEATURE_INDEXES = 'render/metadata/feature-indexes';
const ANCHORS = 'render/metadata/election-anchors-test2';
const RENDER = 'render/metadata/maps-test.json';
const SPATIAL = ['data/database/spatial-index.json', 'data/database/spatial-index/_names.json'];
const SPATIAL_DIR = 'data/database/spatial-index';
const PLACES = 'data/catalogue/places.json';
const REPAIRS = 'data/database/label-text-repairs.json';
// A property holding a name (not a code, a description or a measurement).
const NAME_FIELD = /name|label|title|gaeilge|irish|english|ainm|contae|county/i;

/** @type {string[]} */
const centreFaults = [];
/** @type {string[]} */
const textFaults = [];
const counts = { indexes: 0, centres: 0, anchors: 0, names: 0, samples: 0, sources: 0, sourcesAbsent: 0 };

/** @param {string} where @param {unknown} value */
function checkText(where, value) {
  if (typeof value !== 'string') return;
  counts.names += 1;
  if (hasReplacementChar(value)) textFaults.push(`${where}: U+FFFD in ${JSON.stringify(value)}`);
  else if (notNfc(value)) textFaults.push(`${where}: not NFC: ${JSON.stringify(value)}`);
}
/** @param {string} where @param {unknown} center */
function checkCentre(where, center) {
  if (center === null || center === undefined) return;
  counts.centres += 1;
  if (!centreInIreland(center)) centreFaults.push(`${where}: ${JSON.stringify(center)}`);
}
/** @param {string} path */
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));

for (const file of readdirSync(FEATURE_INDEXES).filter((name) => name.endsWith('.json')).sort()) {
  counts.indexes += 1;
  const index = readJson(join(FEATURE_INDEXES, file));
  for (const item of index.items || []) {
    const where = `${file} ${item.id}`;
    checkCentre(where, item.center);
    checkText(where, item.name);
    for (const alias of item.aliases || []) checkText(where, alias);
  }
}

if (existsSync(ANCHORS)) {
  for (const file of readdirSync(ANCHORS).filter((name) => name.endsWith('.json')).sort()) {
    counts.anchors += 1;
    const anchors = readJson(join(ANCHORS, file));
    for (const item of anchors.items || []) {
      const where = `${ANCHORS}/${file} ${item.id ?? item.name}`;
      checkCentre(where, item.center);
      if (JSON.stringify(item.anchor?.center) !== JSON.stringify(item.center)) checkCentre(`${where} anchor`, item.anchor?.center);
      checkText(where, item.name);
      for (const alias of item.aliases || []) checkText(where, alias);
    }
  }
}

// The spatial index and places list: names only, wherever they sit.
/** @param {string} where @param {unknown} node */
function walkNames(where, node) {
  if (Array.isArray(node)) {
    // places.json rows are [name, rank, west, south, east, north].
    if (typeof node[0] === 'string' && node.length >= 2 && typeof node[1] === 'number') checkText(where, node[0]);
    for (const child of node) walkNames(where, child);
  } else if (node && typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) {
      if ((key === 'name' || key === 'names' || NAME_FIELD.test(key)) && typeof value === 'string') checkText(where, value);
      else walkNames(where, value);
    }
  }
}
for (const file of [...SPATIAL, PLACES]) if (existsSync(file)) walkNames(file, readJson(file));
if (existsSync(SPATIAL_DIR)) {
  for (const file of readdirSync(SPATIAL_DIR).filter((name) => name.endsWith('.json') && !name.startsWith('_')).sort()) {
    walkNames(`${SPATIAL_DIR}/${file}`, readJson(join(SPATIAL_DIR, file)));
  }
}

// Category samples of label and name fields in the render metadata.
const render = readJson(RENDER);
for (const layer of render.layers || []) {
  const labelFields = new Set([layer.labelProperty, ...(layer.labelPropertyFallbacks || [])].filter(Boolean));
  for (const [field, values] of Object.entries(layer.categoricalValues || {})) {
    if (!labelFields.has(field) && !NAME_FIELD.test(field)) continue;
    for (const value of Array.isArray(values) ? values : []) { counts.samples += 1; checkText(`${RENDER} ${layer.id} categoricalValues.${field}`, value); }
  }
}

if (SOURCES) await checkSources();

if (centreFaults.length || textFaults.length) {
  if (centreFaults.length) {
    const b = IRELAND_LONLAT_BOUNDS;
    console.error(`FAIL: ${centreFaults.length} centre(s) are not lon/lat on the island of Ireland (${b.west}..${b.east} E, ${b.south}..${b.north} N):`);
    for (const line of centreFaults.slice(0, 20)) console.error(`  - ${line}`);
    if (centreFaults.length > 20) console.error(`  ... and ${centreFaults.length - 20} more`);
    console.error('  A source in a projected CRS needs its centres transformed (packages/maps-pipeline/src/label-data.mjs featureCentreColumns).');
  }
  if (textFaults.length) {
    console.error(`FAIL: ${textFaults.length} label or name value(s) are damaged:`);
    for (const line of textFaults.slice(0, 30)) console.error(`  - ${line}`);
    if (textFaults.length > 30) console.error(`  ... and ${textFaults.length - 30} more`);
    console.error(`  Restore the characters at the source (${REPAIRS}, applied by packages/maps-pipeline/src/tiles/repair-label-text.mjs) and rebuild what is derived from it.`);
  }
  process.exit(1);
}
console.log(`PASS: ${counts.centres} centre(s) in ${counts.indexes} feature index(es) and ${counts.anchors} anchor file(s) are lon/lat on the island of Ireland; ${counts.names} name value(s) (${counts.samples} category samples) carry no U+FFFD and are NFC${SOURCES ? `; ${counts.sources} local source file(s) checked (${counts.sourcesAbsent} not on this machine)` : ''}.`);

async function checkSources() {
  const repairs = readJson(REPAIRS);
  /** @type {Set<string>} layer \u0000 field \u0000 damaged value, covered by a repair or under review */
  const covered = new Set();
  const key = (/** @type {string} */ layer, /** @type {string} */ field, /** @type {string} */ value) => `${layer}\u0000${field}\u0000${value}`;
  for (const [layer, spec] of Object.entries(repairs.keyed || {})) for (const r of spec.records) covered.add(key(layer, spec.field, r.damaged));
  for (const [layer, spec] of Object.entries(repairs.byValue || {})) for (const value of Object.keys(spec.values)) covered.add(key(layer, spec.field, value));
  for (const r of repairs.review || []) covered.add(key(r.layer, r.field, r.value));
  const nfcLayers = new Set(Object.keys(repairs.nfc?.layers || {}));
  const seen = new Set();
  for (const layer of render.layers || []) {
    if (!layer.sourceFile || layer.aliasOf || !/\.fgb$/i.test(layer.sourceFile) || seen.has(layer.sourceFile)) continue;
    seen.add(layer.sourceFile);
    const path = resolve(ROOT, layer.sourceFile);
    if (!existsSync(path)) { counts.sourcesAbsent += 1; continue; }
    counts.sources += 1;
    const mapId = layer.sourceMapId || String(layer.id).replace(/-vector$/, '');
    const labelFields = new Set([layer.labelProperty, ...(layer.labelPropertyFallbacks || [])].filter(Boolean));
    for await (const feature of deserialize(new Uint8Array(readFileSync(path)))) {
      for (const [field, value] of Object.entries(feature.properties || {})) {
        if (typeof value !== 'string' || (!labelFields.has(field) && !NAME_FIELD.test(field))) continue;
        if (!hasReplacementChar(value) && !notNfc(value)) continue;
        if (covered.has(key(mapId, field, value))) continue;
        if (!hasReplacementChar(value) && nfcLayers.has(mapId)) continue;
        textFaults.push(`${layer.sourceFile} ${field}: ${hasReplacementChar(value) ? 'U+FFFD in' : 'not NFC:'} ${JSON.stringify(value)}`);
      }
    }
  }
}
