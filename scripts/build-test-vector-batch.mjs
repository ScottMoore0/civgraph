#!/usr/bin/env node
/**
 * Report and optionally convert feasible main-site vector sources into GDAL MVT
 * directories for the /test rewrite.
 *
 * Default mode is a dry inventory. Use --execute --limit N after reviewing the
 * report; this avoids blindly generating hundreds of large tile pyramids.
 */

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, extname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = resolve(process.cwd());
const PLAN_PATH = resolve(ROOT, 'test/metadata/main-site-port-plan.json');
const REPORT_PATH = resolve(ROOT, 'test/metadata/vector-conversion-report.json');
const OUTPUT_ROOT = resolve(ROOT, 'test/tiles/generated');
const EXECUTE = process.argv.includes('--execute');
const LIMIT = readNumberArg('--limit', EXECUTE ? 10 : Infinity);
const MAX_SOURCE_MB = readNumberArg('--max-source-mb', Infinity);
const FORMATS = new Set(['.fgb', '.geojson', '.json', '.gpkg', '.shp']);

const plan = JSON.parse(readFileSync(PLAN_PATH, 'utf8'));
const candidates = [];
const skipped = [];

for (const row of plan.rows || []) {
  if (row.conversionStatus !== 'needsVectorTileConversion') continue;
  const source = chooseSource(row);
  if (!source) {
    skipped.push({ sourceMapId: row.sourceMapId, reason: 'no local vector source file in supported format' });
    continue;
  }
  const localPath = resolve(ROOT, source.file.replace(/^\//, ''));
  if (!existsSync(localPath)) {
    skipped.push({ sourceMapId: row.sourceMapId, reason: 'source file missing locally', file: source.file });
    continue;
  }
  candidates.push({
    sourceMapId: row.sourceMapId,
    name: row.name,
    category: row.category,
    sourceFile: source.file,
    sourceBytes: statSize(localPath),
    outputDirectory: `test/tiles/generated/${slugify(row.sourceMapId)}`
  });
}

const selected = candidates.filter((candidate) => candidate.sourceBytes / 1024 / 1024 <= MAX_SOURCE_MB).slice(0, LIMIT);
const converted = [];
const failed = [];

if (EXECUTE) {
  mkdirSync(OUTPUT_ROOT, { recursive: true });
  for (const candidate of selected) {
    const sourcePath = resolve(ROOT, candidate.sourceFile.replace(/^\//, ''));
    const outputPath = resolve(ROOT, candidate.outputDirectory);
    mkdirSync(dirname(outputPath), { recursive: true });
    const result = spawnSync('ogr2ogr', [
      '-f', 'MVT',
      outputPath,
      sourcePath,
      '-dsco', 'MINZOOM=0',
      '-dsco', 'MAXZOOM=12',
    '-dsco', 'SIMPLIFICATION=1',
      '-dsco', 'SIMPLIFICATION_MAX_ZOOM=0',
      '-lco', `NAME=${slugify(candidate.sourceMapId).replace(/-/g, '_')}`,
      '-nln', slugify(candidate.sourceMapId).replace(/-/g, '_')
    ], { cwd: ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
    if (result.status === 0) {
      converted.push(candidate);
    } else {
      failed.push({ ...candidate, error: (result.stderr || result.stdout || '').trim() });
    }
  }
}

const report = {
  schemaVersion: 1,
  mode: EXECUTE ? 'execute' : 'dry-run',
  generatedAt: new Date().toISOString(),
  tool: 'ogr2ogr GDAL MVT',
  tippecanoeAvailable: commandAvailable('tippecanoe'),
  totals: {
    vectorRows: (plan.rows || []).filter((row) => row.conversionStatus === 'needsVectorTileConversion').length,
    feasibleLocalCandidates: candidates.length,
    skipped: skipped.length,
    selected: selected.length,
    converted: converted.length,
    failed: failed.length
  },
  notes: [
    'This report does not promote generated tile directories into maps-test.json automatically.',
    'Each generated layer still needs metadata, source-layer verification, styling, and smoke testing before it should become loadable in /test.',
    'PMTiles output is not generated because tippecanoe is not installed in this environment.'
  ],
  candidates,
  selected,
  converted,
  failed,
  skipped
};

mkdirSync(dirname(REPORT_PATH), { recursive: true });
writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
console.log(`Wrote ${REPORT_PATH.replace(`${ROOT}\\`, '')}`);
console.log(`Mode: ${report.mode}`);
console.log(`Feasible local candidates: ${report.totals.feasibleLocalCandidates}`);
console.log(`Skipped: ${report.totals.skipped}`);
console.log(`Converted: ${report.totals.converted}`);
if (!EXECUTE) console.log('Dry run only. Re-run with --execute --limit N after reviewing the report.');
if (failed.length) process.exit(1);

function chooseSource(row) {
  return (row.sourceFiles || []).find((source) => {
    const file = source.file || '';
    return !/^https?:\/\//i.test(file) && FORMATS.has(extname(file).toLowerCase());
  }) || null;
}

function readNumberArg(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index < 0) return fallback;
  const value = Number(process.argv[index + 1]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function commandAvailable(command) {
  const result = spawnSync(process.platform === 'win32' ? 'where.exe' : 'which', [command], {
    cwd: ROOT,
    encoding: 'utf8'
  });
  return result.status === 0;
}

function statSize(path) {
  try {
    return statSync(path).size;
  } catch {
    return 0;
  }
}

function slugify(value) {
  return String(value || 'layer').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}
