#!/usr/bin/env node
/**
 * Regenerate the /test Civil Parishes vector-tile pilot.
 *
 * Requires GDAL/ogr2ogr on PATH.
 */

import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = resolve(process.cwd());
const SOURCE = resolve(ROOT, 'data/maps/baronies-parishes/Civil_Parishes_Ireland_v2.fgb');
const OUTPUT = resolve(ROOT, 'test/tiles/civil-parishes-v3');
const LABEL_DIAG_SQL = `SQRT(
  (ST_MaxX(geometry) - ST_MinX(geometry)) * (ST_MaxX(geometry) - ST_MinX(geometry)) +
  (ST_MaxY(geometry) - ST_MinY(geometry)) * (ST_MaxY(geometry) - ST_MinY(geometry))
)`;
const CIVIL_PARISH_LABEL_SQL = `
SELECT
  *,
  COALESCE(name_en, name_ga, '') AS label_name,
  CAST(ROUND(${LABEL_DIAG_SQL} * 1000000) AS INTEGER) AS label_rank,
  CASE
    WHEN ${LABEL_DIAG_SQL} >= 0.50 THEN 8
    WHEN ${LABEL_DIAG_SQL} >= 0.35 THEN 9
    WHEN ${LABEL_DIAG_SQL} >= 0.20 THEN 10
    ELSE 11
  END AS label_minzoom
FROM Civil_Parishes_Ireland_v2
`.trim();

if (!existsSync(SOURCE)) {
  console.error(`Missing source FGB: ${SOURCE}`);
  process.exit(1);
}

rmSync(OUTPUT, { recursive: true, force: true });
mkdirSync(dirname(OUTPUT), { recursive: true });

const args = [
  '-f', 'MVT',
  OUTPUT,
  SOURCE,
  '-dialect', 'SQLite',
  '-sql', CIVIL_PARISH_LABEL_SQL,
  '-dsco', 'FORMAT=DIRECTORY',
  '-dsco', 'MINZOOM=0',
  '-dsco', 'MAXZOOM=12',
  '-dsco', 'TILE_EXTENSION=pbf',
  '-dsco', 'COMPRESS=NO',
  '-dsco', 'NAME=Civil Parishes',
  '-dsco', 'MAX_SIZE=10000000',
  '-dsco', 'MAX_FEATURES=10000000',
  '-dsco', 'SIMPLIFICATION=0.5',
  '-dsco', 'SIMPLIFICATION_MAX_ZOOM=0',
  '-lco', 'NAME=civil_parishes',
  '-nln', 'civil_parishes'
];

const result = spawnSync('ogr2ogr', args, {
  cwd: ROOT,
  stdio: 'inherit',
  shell: false
});

if (result.status !== 0) process.exit(result.status || 1);

const stats = summarize(OUTPUT);
console.log(`Civil Parishes vector tiles: ${stats.files} files, ${(stats.bytes / 1024 / 1024).toFixed(1)} MB`);

function summarize(root) {
  let files = 0;
  let bytes = 0;
  const stack = [root];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = resolve(current, entry.name);
      if (entry.isDirectory()) stack.push(path);
      if (entry.isFile()) {
        files += 1;
        bytes += statSync(path).size;
      }
    }
  }
  return { files, bytes };
}
