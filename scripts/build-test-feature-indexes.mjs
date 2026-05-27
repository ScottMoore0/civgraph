#!/usr/bin/env node
/**
 * Build compact feature-search sidecar indexes for converted /test layers.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const ROOT = resolve(process.cwd());
const OUTPUT_DIR = resolve(ROOT, 'test/metadata/feature-indexes');
const INDEXES = [
  {
    layerId: 'civil-parishes-vector-test',
    source: 'data/maps/baronies-parishes/Civil_Parishes_Ireland_v2.fgb',
    nameProperties: ['name_en', 'name_ga'],
    idProperty: 'id'
  }
];

mkdirSync(OUTPUT_DIR, { recursive: true });

for (const config of INDEXES) {
  const columns = [
    config.idProperty,
    ...config.nameProperties,
    'ST_X(ST_Centroid(geometry)) AS lon',
    'ST_Y(ST_Centroid(geometry)) AS lat'
  ].join(',');
  const result = spawnSync('ogr2ogr', [
    '-f', 'CSV',
    '/vsistdout/',
    config.source,
    '-dialect',
    'SQLite',
    '-sql',
    `SELECT ${columns} FROM ${config.layerName || layerNameFromSource(config.source)}`
  ], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024
  });
  if (result.status !== 0) {
    console.error(result.error?.message || result.stderr || result.stdout || 'ogr2ogr failed');
    process.exit(result.status || 1);
  }
  const [header, ...rows] = parseCsv(result.stdout);
  const items = rows
    .map((row) => Object.fromEntries(header.map((key, index) => [key, row[index]])))
    .map((props) => {
      const name = config.nameProperties.map((key) => props[key]).find(Boolean) || String(props[config.idProperty] || '');
      const lon = Number(props.lon);
      const lat = Number(props.lat);
      return {
        id: props[config.idProperty],
        name,
        aliases: config.nameProperties.map((key) => props[key]).filter(Boolean),
        center: Number.isFinite(lon) && Number.isFinite(lat) ? [Number(lon.toFixed(6)), Number(lat.toFixed(6))] : null
      };
    })
    .filter((item) => item.id !== undefined && item.name);
  const output = resolve(OUTPUT_DIR, `${config.layerId}.json`);
  writeFileSync(output, `${JSON.stringify({ layerId: config.layerId, items }, null, 2)}\n`);
  console.log(`${config.layerId}: ${items.length} searchable features`);
}

function layerNameFromSource(source) {
  return source.split(/[\\/]/).pop().replace(/\.[^.]+$/, '');
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
