#!/usr/bin/env node
/**
 * Build compact feature-search sidecar indexes for converted /test layers.
 *
 * Layers opt in through maps-test.json with featureIndexUrl and sourceFile.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { centreInIreland, featureCentreColumns } from '../label-data.mjs';

const ROOT = resolve(process.cwd());
const METADATA_PATH = resolve(ROOT, 'render/metadata/maps-test.json');
const ONLY_IDS = new Set(readArgList('--ids'));
const MAX_INDEX_ITEMS = readNumberArg('--max-items', 20000);
/**
 * A layer of maps-test.json, as far as the index build reads it.
 * @typedef {{ id: string, sourceMapId?: string, name?: string, featureIndexUrl?: string, sourceFile?: string, aliasOf?: string,
 *   idProperty?: string, promoteId?: string, sourceDatasetLayer?: string, labelProperty?: string,
 *   labelPropertyFallbacks?: string[], popupProperties?: string[], featureIndexIdFromFid?: boolean, geometryType?: string }} Layer
 */
/** @typedef {Record<string, string | undefined>} Props  one CSV row of ogr2ogr's output, by column */
/** @type {{ layers?: Layer[] }} */
const metadata = JSON.parse(readFileSync(METADATA_PATH, 'utf8'));
const layers = (metadata.layers || [])
  .filter((layer) => layer.featureIndexUrl && layer.sourceFile)
  .filter((layer) => !layer.aliasOf)
  .filter((layer) => !ONLY_IDS.size || ONLY_IDS.has(layer.id) || ONLY_IDS.has(/** @type {string} */ (layer.sourceMapId)));
let built = 0;
let skipped = 0;
const outputRoot = resolve(ROOT, 'render/metadata/feature-indexes');
if (existsSync(outputRoot)) {
  for (const entry of readdirSync(outputRoot, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    if (!ONLY_IDS.size || layers.some((layer) => entry.name === basename(/** @type {string} */ (layer.featureIndexUrl)))) {
      rmSync(resolve(outputRoot, entry.name), { force: true });
    }
  }
}

for (const layer of layers) {
  const sourcePath = resolve(ROOT, /** @type {string} */ (layer.sourceFile).replace(/^\//, ''));
  if (!existsSync(sourcePath)) {
    console.warn(`${layer.id}: skipped missing source file ${layer.sourceFile}`);
    skipped += 1;
    continue;
  }
  const indexPath = resolve(ROOT, /** @type {string} */ (layer.featureIndexUrl).replace(/^\//, ''));
  mkdirSync(dirname(indexPath), { recursive: true });
  const idProperty = layer.idProperty || layer.promoteId || 'id';
  const sourceInfo = getSourceInfo(sourcePath);
  const sourceFields = sourceInfo.fields;
  const sourceLayerName = layer.sourceDatasetLayer && sourceInfo.layerNames.includes(layer.sourceDatasetLayer)
    ? layer.sourceDatasetLayer
    : sourceInfo.layerNames[0] || layerNameFromSource(/** @type {string} */ (layer.sourceFile));
  const nameProperties = unique([
    layer.labelProperty,
    ...(layer.labelPropertyFallbacks || []),
    ...guessNameProperties(layer.popupProperties || [])
  ]).filter((key) => sourceFields.has(/** @type {string} */ (key)));
  const effectiveIdProperty = sourceFields.has(idProperty) ? idProperty : chooseIdProperty(sourceFields);
  if (!nameProperties.length) {
    console.warn(`${layer.id}: skipped because no label/name property is configured`);
    skipped += 1;
    continue;
  }
  // A layer whose own ids repeat or are missing draws its tiles with promoteId=civ_fid, the
  // feature's row number (build-test-pmtiles injects it). Opted in with featureIndexIdFromFid,
  // its index takes the same row number, so a matched result colours that one feature.
  const fidId = layer.featureIndexIdFromFid === true && layer.promoteId === 'civ_fid';
  const propertyColumns = [
    ...(fidId ? ['rowid AS "civ_fid"'] : []),
    ...unique([...(fidId ? [] : [effectiveIdProperty]), ...nameProperties, ...featureRepairProperties(layer)])
      .map((key) => `${quoteSqlIdentifier(key)} AS ${quoteSqlIdentifier(key)}`)
  ];
  const where = featureIndexWhere(layer);
  const runQuery = (/** @type {number | null} */ epsg, withMetrics = true) => spawnSync('ogr2ogr', [
    '-f', 'CSV',
    '/vsistdout/',
    sourcePath,
    '-dialect',
    'SQLite',
    '-sql',
    `SELECT ${featureIndexColumns(layer, propertyColumns, epsg, withMetrics)} FROM ${quoteSqlIdentifier(sourceLayerName)}${where}`
  ], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 96 * 1024 * 1024
  });
  let result = runQuery(sourceInfo.epsg);
  // The whole-feature measurement is extra; a source it cannot handle still gets its index
  // (with its centres still transformed to lon/lat).
  if (result.status !== 0 && wholeFeatureMetricColumns(layer, sourceInfo.epsg).length) {
    console.warn(`${layer.id}: whole-feature area not measurable; building the index without it`);
    result = runQuery(sourceInfo.epsg, false);
  }
  if (result.status !== 0) {
    console.error(`${layer.id}: ${result.error?.message || result.stderr || result.stdout || 'ogr2ogr failed'}`);
    process.exit(result.status || 1);
  }
  const [header, ...rows] = /** @type {[string[], ...string[][]]} */ (parseCsv(result.stdout));
  const items = rows
    .map((row) => Object.fromEntries(header.map((key, index) => [key, row[index]])))
    .map((props, index) => {
      const repairedProps = repairFeatureIndexProperties(layer, props);
      const name = nameProperties
        .map((key) => cleanIndexValue(repairedProps[key]))
        .find(Boolean) || fallbackFeatureName(layer, repairedProps, index);
      const lon = Number(props['lon']);
      const lat = Number(props['lat']);
      const areaM2 = props['area_m2'] === '' ? NaN : Number(props['area_m2']);
      const perimeterM = props['perimeter_m'] === '' ? NaN : Number(props['perimeter_m']);
      return {
        id: fidId ? Number(props['civ_fid']) : (cleanIndexValue(repairedProps[effectiveIdProperty]) || `${layer.id}-${index}`),
        name,
        aliases: nameProperties.map((key) => cleanIndexValue(repairedProps[key])).filter(Boolean),
        center: Number.isFinite(lon) && Number.isFinite(lat) ? [Number(lon.toFixed(6)), Number(lat.toFixed(6))] : null,
        ...(areaM2 > 0 ? { areaM2: Math.round(areaM2) } : {}),
        ...(perimeterM > 0 ? { perimeterM: Math.round(perimeterM) } : {})
      };
    })
    .filter((item) => item.id !== undefined && item.name);
  // Centres are lon/lat on the island of Ireland. Most centres outside it means the source's
  // coordinates are not lon/lat (an SRID-0 projected file): refuse to write the index. A few
  // outside are degenerate features (a zero-area ring's centroid comes back as 0,0 or worse):
  // those items keep their name but lose the centre, as a feature with no geometry would.
  const outside = items.filter((item) => item.center && !centreInIreland(item.center));
  if (outside.length && outside.length * 2 > items.length) {
    console.error(`${layer.id}: ${outside.length} of ${items.length} centres are not lon/lat on the island of Ireland (source EPSG ${sourceInfo.epsg ?? 'unknown'}), e.g. ${JSON.stringify(/** @type {(typeof outside)[number]} */ (outside[0]).center)}. Give the source a CRS.`);
    process.exit(1);
  }
  for (const item of outside) {
    console.warn(`${layer.id}: dropped the centre of ${item.id} (${item.name}), ${JSON.stringify(item.center)}: not on the island of Ireland`);
    item.center = null;
  }
  const cappedItems = items.slice(0, MAX_INDEX_ITEMS);
  writeFileSync(indexPath, `${JSON.stringify({
    layerId: layer.id,
    itemLimit: MAX_INDEX_ITEMS,
    totalItems: items.length,
    truncated: items.length > cappedItems.length,
    items: cappedItems
  })}\n`);
  console.log(`${layer.id}: ${cappedItems.length}${items.length > cappedItems.length ? ` of ${items.length}` : ''} searchable features`);
  built += 1;
}

console.log(`Built ${built} feature index(es); skipped ${skipped}.`);

/** @param {string[]} properties */
function guessNameProperties(properties) {
  return properties.filter((key) => /name|label|title|english|gaeilge|irish|county|sett|lea|district|division|region/i.test(key));
}

/** @param {Layer} layer @param {string[]} propertyColumns @param {number | null} epsg */
function featureIndexColumns(layer, propertyColumns, epsg, withMetrics = true) {
  if (layer.sourceMapId === 'dcc-dcc-public-cycle-parking-stands') {
    return [
      ...propertyColumns,
      'Latitude AS lon',
      'Longitude AS lat'
    ].join(',');
  }
  return [
    ...propertyColumns,
    ...featureCentreColumns(epsg),
    ...(withMetrics ? wholeFeatureMetricColumns(layer, epsg) : [])
  ].join(',');
}

// A click on a tiled polygon only ever sees the piece in one tile: MapLibre returns a
// single fragment per promoted id, so the details pane could only say "Part area" (1920
// Down read 711 km2 of about 2,615). The whole feature's geodesic area and perimeter are
// measured here from the source instead, and the pane uses them when the clicked
// geometry is clipped. ST_MakeValid because a self-intersecting ring measures wrongly.
// Only for a source whose CRS is a known EPSG code: geodesic measurement needs lon/lat,
// and ST_Transform on an SRID-0 source throws and aborts the whole run (ni-1921 did).
/** @param {Layer} layer @param {number | null} epsg */
function wholeFeatureMetricColumns(layer, epsg) {
  const geom = String(layer.geometryType || '').toLowerCase();
  if (geom !== 'polygon' && geom !== 'multipolygon') return [];
  if (!Number.isInteger(epsg) || /** @type {number} */ (epsg) <= 0) return [];
  const valid = epsg === 4326 ? 'ST_MakeValid(geometry)' : `ST_Transform(ST_MakeValid(geometry), 4326)`;
  return [`ST_Area(${valid}, 1) AS area_m2`, `ST_Perimeter(${valid}, 1) AS perimeter_m`];
}

/** @param {Layer} layer */
function featureIndexWhere(layer) {
  if (layer.sourceMapId === 'dcc-dcc-public-cycle-parking-stands') {
    return ' WHERE Latitude BETWEEN -11 AND -4 AND Longitude BETWEEN 51 AND 56';
  }
  return '';
}

/** @param {Layer} layer */
function featureRepairProperties(layer) {
  if (layer.sourceMapId === 'deas-1972' || layer.id === 'deas-1972-vector') return ['Area_SqKM', 'OBJECTID'];
  return [];
}

/** @param {Layer} layer @param {Props} props @param {number} index */
function fallbackFeatureName(layer, props, index) {
  if (layer.sourceMapId === 'dcc-dcc-public-cycle-parking-stands') {
    const lon = Number(props['lon']);
    const lat = Number(props['lat']);
    const suffix = Number.isFinite(lon) && Number.isFinite(lat)
      ? ` (${lat.toFixed(5)}, ${lon.toFixed(5)})`
      : '';
    return `Cycle parking stand ${index + 1}${suffix}`;
  }
  const id = cleanIndexValue(props[layer.idProperty || layer.promoteId || 'id']);
  return id ? `Feature ${id}` : `${layer.name || layer.id} feature ${index + 1}`;
}

// NFC, so a name stored decomposed (eds-ulster-1912..1921 carried "u" + U+0301) is indexed,
// searched and shown as the precomposed letter.
/** @param {unknown} value */
function cleanIndexValue(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim().normalize('NFC');
}

/** @param {Layer} layer @param {Props} [props] @returns {Props} */
function repairFeatureIndexProperties(layer, props = {}) {
  if (layer.sourceMapId !== 'deas-1972' && layer.id !== 'deas-1972-vector') return props;
  const repairedName = deas1972RepairedName(props);
  if (!repairedName) return props;
  return {
    ...props,
    NAME: repairedName,
    name: props['name'] || repairedName,
    label_name: props['label_name'] || repairedName
  };
}

/** @param {Props} [props] */
function deas1972RepairedName(props = {}) {
  if (isBlank(props['NAME']) && nearly(props['Area_SqKM'], 13.1719213882566)) return 'ARMAGH AREA D';
  if (String(props['OBJECTID'] ?? '').trim() === '1624' && normalizeText(props['NAME']) === 'DUNGANNON AREA D') return 'DUNGANNON AREA C';
  if (isBlank(props['NAME']) && nearly(props['Area_SqKM'], 8.44105398081151)) return 'LIMAVADY AREA C';
  return '';
}

/** @param {unknown} value */
function isBlank(value) {
  return value === undefined || value === null || String(value).trim() === '';
}

/** @param {unknown} value @param {number} expected */
function nearly(value, expected) {
  const number = Number(value);
  return Number.isFinite(number) && Math.abs(number - expected) < 0.0001;
}

/** @param {unknown} value */
function normalizeText(value) {
  return String(value ?? '').trim().toUpperCase();
}

/**
 * @param {string} sourcePath
 * @returns {{ fields: Set<string>, layerNames: string[], epsg: number | null }}
 */
function getSourceInfo(sourcePath) {
  const result = spawnSync('ogrinfo', ['-json', '-so', sourcePath], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024
  });
  if (result.status !== 0) return { fields: new Set(), layerNames: [], epsg: null };
  try {
    const payload = JSON.parse(result.stdout);
    const crsId = payload.layers?.[0]?.geometryFields?.[0]?.coordinateSystem?.projjson?.id;
    return {
      fields: new Set((payload.layers?.[0]?.fields || []).map((/** @type {{ name?: string }} */ field) => field.name).filter(Boolean)),
      layerNames: (payload.layers || []).map((/** @type {{ name?: string }} */ layer) => layer.name).filter(Boolean),
      epsg: crsId?.authority === 'EPSG' ? Number(crsId.code) : null
    };
  } catch {
    return { fields: new Set(), layerNames: [], epsg: null };
  }
}

/** @param {unknown} value */
function quoteSqlIdentifier(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

/** @param {Set<string>} fields */
function chooseIdProperty(fields) {
  return ['id', 'ID', 'OBJECTID', 'OBJECTID_1', 'FID', 'fid', 'ED_ID', 'GUID', 'SMALL_AREA']
    .find((key) => fields.has(key)) || [...fields][0] || 'id';
}

/** @param {string} source */
function layerNameFromSource(source) {
  return basename(source).replace(extname(source), '');
}

/** @param {string} name */
function readArgList(name) {
  /** @type {string[]} */
  const values = [];
  for (let index = 0; index < process.argv.length; index += 1) {
    const arg = /** @type {string} */ (process.argv[index]);
    if (arg === name && process.argv[index + 1]) {
      values.push(.../** @type {string} */ (process.argv[index + 1]).split(','));
      index += 1;
    } else if (arg.startsWith(`${name}=`)) {
      values.push(...arg.slice(name.length + 1).split(','));
    }
  }
  return values.map((value) => value.trim()).filter(Boolean);
}

/** @param {string} name @param {number} fallback */
function readNumberArg(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index < 0) return fallback;
  const value = Number(process.argv[index + 1]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

/** @param {string} text */
function parseCsv(text) {
  /** @type {string[][]} */
  const rows = [];
  /** @type {string[]} */
  let row = [];
  let value = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (quoted) {
      if (char === '"' && next === '"') {
        value += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        value += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(value);
      value = '';
    } else if (char === '\n') {
      row.push(value);
      if (row.some((cell) => cell !== '')) rows.push(row);
      row = [];
      value = '';
    } else if (char !== '\r') {
      value += char;
    }
  }
  if (value || row.length) {
    row.push(value);
    if (row.some((cell) => cell !== '')) rows.push(row);
  }
  return rows;
}

/** @param {Array<string | undefined>} values */
function unique(values) {
  return [...new Set(/** @type {string[]} */ (values.filter(Boolean)))];
}
