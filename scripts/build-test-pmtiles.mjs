#!/usr/bin/env node
/**
 * Constrained PMTiles build hook for /test.
 *
 * The browser app already supports pmtiles:// sources. This script records
 * whether a local PMTiles-capable build path is available and, when a CLI is
 * supplied, gives the project a single deterministic entry point for producing
 * PMTiles archives without changing app code.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = resolve(process.cwd());
const REPORT_PATH = resolve(ROOT, 'test/metadata/pmtiles-build-report.json');
const PMTILES_CLI = process.env.TEST_PMTILES_CLI || findCommand('pmtiles');
const TIPPECANOE = process.env.TEST_TIPPECANOE || findCommand('tippecanoe');
const MODE = PMTILES_CLI || TIPPECANOE ? 'available' : 'missing-tools';

const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  mode: MODE,
  tools: {
    pmtilesCli: PMTILES_CLI || null,
    tippecanoe: TIPPECANOE || null
  },
  supportedPaths: [
    {
      name: 'tippecanoe-direct-pmtiles',
      available: Boolean(TIPPECANOE),
      description: 'Use tippecanoe to build PMTiles directly from newline-delimited GeoJSON or GeoJSON sources.'
    },
    {
      name: 'pmtiles-cli-convert',
      available: Boolean(PMTILES_CLI),
      description: 'Use a PMTiles CLI to convert a compatible MBTiles/vector-tile archive into a .pmtiles file.'
    }
  ],
  notes: [
    'No PMTiles archive is generated unless a supported CLI is installed or TEST_PMTILES_CLI/TEST_TIPPECANOE points to one.',
    'The /test runtime can load pmtiles sourceType entries through the pmtiles protocol once archives are generated and registered in maps-test.json.',
    'GDAL directory MVT remains the active local conversion path in this Windows environment.'
  ]
};

mkdirSync(dirname(REPORT_PATH), { recursive: true });
writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
console.log(`Wrote ${REPORT_PATH.replace(`${ROOT}\\`, '')}`);
console.log(`PMTiles build mode: ${MODE}`);

function findCommand(command) {
  const result = spawnSync(process.platform === 'win32' ? 'where.exe' : 'which', [command], {
    cwd: ROOT,
    encoding: 'utf8'
  });
  if (result.status !== 0) return '';
  return result.stdout.split(/\r?\n/).find(Boolean) || '';
}
