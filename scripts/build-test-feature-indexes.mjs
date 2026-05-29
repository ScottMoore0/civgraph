#!/usr/bin/env node
/**
 * Build compact feature-search sidecar indexes for converted /test layers.
 *
 * Layers opt in through maps-test.json with featureIndexUrl and sourceFile.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = resolve(process.cwd());
const METADATA_PATH = resolve(ROOT, 'test/metadata/maps-test.json');
const metadata = JSON.parse(readFileSync(METADATA_PATH, 'utf8'));
const layers = (metadata.layers || []).filter((layer) => layer.featureIndexUrl && layer.sourceFile);
let built = 0;
let skipped = 0;
const outputRoot = resolve(ROOT, 'test/metadata/feature-indexes');
if (existsSync(outputRoot)) {
  for (const entry of readdirSync(outputRoot, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith('.json')) rmSync(resolve(outputRoot, entry.name), { force: true });
  }
}

for (const layer of layers) {
  const sourcePath = resolve(ROOT, layer.sourceFile.replace(/^\//, ''));
  if (!existsSync(sourcePath)) {
    console.warn(`${layer.id}: skipped missing source file ${layer.sourceFile}`);
    skipped += 1;
    continue;
  }
  const indexPath = resolve(ROOT, layer.featureIndexUrl.replace(/^\//, ''));
  mkdirSync(dirname(indexPath), { recursive: true });
  const idProperty = layer.idProperty || layer.promoteId || 'id';
  const sourceInfo = getSourceInfo(sourcePath);
  const sourceFields = sourceInfo.fields;
  const sourceLayerName = layer.sourceDatasetLayer && sourceInfo.layerNames.includes(layer.sourceDatasetLayer)
    ? layer.sourceDatasetLayer
    : sourceInfo.layerNames[0] || layerNameFromSource(layer.sourceFile);
  const nameProperties = unique([
    layer.labelProperty,
    ...(layer.labelPropertyFallbacks || []),
    ...guessNameProperties(layer.popupProperties || [])
  ]).filter((key) => sourceFields.has(key));
  const effectiveIdProperty = sourceFields.has(idProperty) ? idProperty : chooseIdProperty(sourceFields);
  if (!nameProperties.length) {
    console.warn(`${layer.id}: skipped because no label/name property is configured`);
    skipped += 1;
    continue;
  }
  const propertyColumns = unique([effectiveIdProperty, ...nameProperties])
    .map((key) => `${quoteSqlIdentifier(key)} AS ${quoteSqlIdentifier(key)}`);
  const columns = [
    ...propertyColumns,
    'ST_X(ST_Centroid(geometry)) AS lon',
    'ST_Y(ST_Centroid(geometry)) AS lat'
  ].join(',');
  const result = spawnSync('ogr2ogr', [
    '-f', 'CSV',
    '/vsistdout/',
    sourcePath,
    '-dialect',
    'SQLite',
    '-sql',
    `SELECT ${columns} FROM ${quoteSqlIdentifier(sourceLayerName)}`
  ], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 96 * 1024 * 1024
  });
  if (result.status !== 0) {
    console.error(`${layer.id}: ${result.error?.message || result.stderr || result.stdout || 'ogr2ogr failed'}`);
    process.exit(result.status || 1);
  }
  const [header, ...rows] = parseCsv(result.stdout);
  const items = rows
    .map((row) => Object.fromEntries(header.map((key, index) => [key, row[index]])))
    .map((props, index) => {
      const name = nameProperties.map((key) => props[key]).find(Boolean) || String(props[idProperty] || '');
      const lon = Number(props.lon);
      const lat = Number(props.lat);
      return {
        id: props[effectiveIdProperty] || `${layer.id}-${index}`,
        name,
        aliases: nameProperties.map((key) => props[key]).filter(Boolean),
        center: Number.isFinite(lon) && Number.isFinite(lat) ? [Number(lon.toFixed(6)), Number(lat.toFixed(6))] : null
      };
    })
    .filter((item) => item.id !== undefined && item.name);
  writeFileSync(indexPath, `${JSON.stringify({ layerId: layer.id, items }, null, 2)}\n`);
  console.log(`${layer.id}: ${items.length} searchable features`);
  built += 1;
}

console.log(`Built ${built} feature index(es); skipped ${skipped}.`);

function guessNameProperties(properties) {
  return properties.filter((key) => /name|label|title|english|gaeilge|irish|county|sett|lea|district|division|region/i.test(key));
}

function getSourceInfo(sourcePath) {
  const result = spawnSync('ogrinfo', ['-json', '-so', sourcePath], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024
  });
  if (result.status !== 0) return { fields: new Set(), layerNames: [] };
  try {
    const payload = JSON.parse(result.stdout);
    return {
      fields: new Set((payload.layers?.[0]?.fields || []).map((field) => field.name).filter(Boolean)),
      layerNames: (payload.layers || []).map((layer) => layer.name).filter(Boolean)
    };
  } catch {
    return { fields: new Set(), layerNames: [] };
  }
}

function quoteSqlIdentifier(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

function chooseIdProperty(fields) {
  return ['id', 'ID', 'OBJECTID', 'OBJECTID_1', 'FID', 'fid', 'ED_ID', 'GUID', 'SMALL_AREA']
    .find((key) => fields.has(key)) || [...fields][0] || 'id';
}

function layerNameFromSource(source) {
  return basename(source).replace(extname(source), '');
}

function parseCsv(text) {
  const rows = [];
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

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}
