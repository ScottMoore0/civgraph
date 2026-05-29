#!/usr/bin/env node
/**
 * Report and optionally convert feasible main-site vector sources into GDAL MVT
 * directories for the /test rewrite.
 *
 * Default mode is a dry inventory. Use --execute --limit N after reviewing the
 * report; this avoids blindly generating hundreds of large tile pyramids.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, extname, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { getTileProfile } from './test-tile-profiles.mjs';

const ROOT = resolve(process.cwd());
const PLAN_PATH = resolve(ROOT, 'test/metadata/main-site-port-plan.json');
const REPORT_PATH = resolve(ROOT, 'test/metadata/vector-conversion-report.json');
const OUTPUT_ROOT = resolve(ROOT, 'test/tiles/generated');
const SOURCE_CACHE_MANIFEST_PATH = resolve(ROOT, 'test/source-cache/vector-intake/manifest.json');
const EXECUTE = process.argv.includes('--execute');
const LIMIT = readNumberArg('--limit', Infinity);
const MAX_SOURCE_MB = readNumberArg('--max-source-mb', Infinity);
const ONLY_IDS = new Set(readStringArg('--ids', '').split(',').map((value) => value.trim()).filter(Boolean));
const FORMATS = new Set(['.fgb', '.geojson', '.json', '.gpkg', '.shp', '.zip']);
const FORCE = process.argv.includes('--force');
const PER_LAYER_TIMEOUT_MS = readNumberArg('--per-layer-timeout-ms', 10 * 60 * 1000);

const plan = JSON.parse(readFileSync(PLAN_PATH, 'utf8'));
const sourceCache = existsSync(SOURCE_CACHE_MANIFEST_PATH)
  ? JSON.parse(readFileSync(SOURCE_CACHE_MANIFEST_PATH, 'utf8'))
  : { sources: [] };
const cachedSourceById = new Map((sourceCache.sources || []).map((source) => [source.sourceMapId, source]));
const candidates = [];
const skipped = [];

for (const row of plan.rows || []) {
  if (row.conversionStatus !== 'needsVectorTileConversion' && row.conversionStatus !== 'converted') continue;
  if (ONLY_IDS.size && !ONLY_IDS.has(row.sourceMapId)) continue;
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
const skippedExisting = [];

if (EXECUTE) {
  mkdirSync(OUTPUT_ROOT, { recursive: true });
  for (const candidate of selected) {
    const sourcePath = resolve(ROOT, candidate.sourceFile.replace(/^\//, ''));
    const outputPath = resolve(ROOT, candidate.outputDirectory);
    assertInsideOutputRoot(outputPath);
    if (!FORCE) {
      const existing = verifyMvtDirectory(outputPath);
      if (existing.ok) {
        skippedExisting.push({ ...candidate, reason: 'existing verified generated output', sourceLayer: existing.sourceLayer, ...existing.stats });
        writeReport();
        continue;
      }
    }
    rmSync(outputPath, { recursive: true, force: true });
    mkdirSync(dirname(outputPath), { recursive: true });
    const layerName = slugify(candidate.sourceMapId).replace(/-/g, '_');
    const profile = getTileProfile(candidate.sourceMapId);
    const result = spawnSync('ogr2ogr', [
      '-f', 'MVT',
      outputPath,
      sourcePath,
      '-dsco', 'FORMAT=DIRECTORY',
      '-dsco', 'MINZOOM=0',
      '-dsco', 'MAXZOOM=12',
      '-dsco', 'TILE_EXTENSION=pbf',
      '-dsco', 'COMPRESS=NO',
      '-dsco', `NAME=${candidate.name || candidate.sourceMapId}`,
      '-dsco', `MAX_SIZE=${profile.maxSize}`,
      '-dsco', `MAX_FEATURES=${profile.maxFeatures}`,
      '-dsco', `SIMPLIFICATION=${profile.simplification}`,
      '-dsco', `SIMPLIFICATION_MAX_ZOOM=${profile.simplificationMaxZoom}`,
      '-lco', `NAME=${layerName}`,
      '-nln', layerName
    ], { cwd: ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, timeout: PER_LAYER_TIMEOUT_MS });
    if (result.status === 0) {
      const verification = verifyMvtDirectory(outputPath);
      if (verification.ok) {
        converted.push({ ...candidate, profile, sourceLayer: verification.sourceLayer, ...verification.stats });
      } else {
        failed.push({ ...candidate, error: verification.error });
      }
    } else {
      failed.push({ ...candidate, error: (result.error?.message || result.stderr || result.stdout || '').trim() });
    }
    writeReport();
  }
}

const report = buildReport();
writeReport();
console.log(`Wrote ${REPORT_PATH.replace(`${ROOT}\\`, '')}`);
console.log(`Mode: ${report.mode}`);
console.log(`Feasible local candidates: ${report.totals.feasibleLocalCandidates}`);
console.log(`Skipped: ${report.totals.skipped}`);
console.log(`Skipped existing generated: ${report.totals.skippedExisting}`);
console.log(`Converted: ${report.totals.converted}`);
if (!EXECUTE) console.log('Dry run only. Re-run with --execute --limit N after reviewing the report.');
if (failed.length) process.exit(1);

function buildReport() {
  return {
  schemaVersion: 1,
  mode: EXECUTE ? 'execute' : 'dry-run',
  generatedAt: new Date().toISOString(),
  tool: 'ogr2ogr GDAL MVT',
  tippecanoeAvailable: commandAvailable('tippecanoe'),
  perLayerTimeoutMs: PER_LAYER_TIMEOUT_MS,
  totals: {
    vectorRows: (plan.rows || []).filter((row) => row.conversionStatus === 'needsVectorTileConversion').length,
    feasibleLocalCandidates: candidates.length,
    skipped: skipped.length,
    selected: selected.length,
    converted: converted.length,
    skippedExisting: skippedExisting.length,
    failed: failed.length
  },
  notes: [
    'This report does not promote generated tile directories into maps-test.json automatically.',
    'Run npm run build:test:promote after reviewing converted outputs to register verified layers in /test metadata.',
    'PMTiles output is data-gated by the local availability of a PMTiles-capable CLI; see npm run build:test:pmtiles.'
  ],
  candidates,
  selected,
  skippedExisting,
  converted,
  failed,
  skipped
  };
}

function writeReport() {
  mkdirSync(dirname(REPORT_PATH), { recursive: true });
  writeFileSync(REPORT_PATH, `${JSON.stringify(buildReport(), null, 2)}\n`);
}

function chooseSource(row) {
  const cached = cachedSourceById.get(row.sourceMapId);
  if (cached?.localPath && FORMATS.has(extname(cached.localPath).toLowerCase())) {
    return { file: cached.localPath, cachedFrom: cached.url };
  }
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

function verifyMvtDirectory(outputPath) {
  const metadataPath = resolve(outputPath, 'metadata.json');
  if (!existsSync(metadataPath)) return { ok: false, error: 'metadata.json was not created' };
  let metadata;
  try {
    metadata = JSON.parse(readFileSync(metadataPath, 'utf8'));
  } catch (err) {
    return { ok: false, error: `metadata.json is invalid JSON: ${err.message}` };
  }
  let vectorLayers = [];
  try {
    vectorLayers = JSON.parse(metadata.json || '{}').vector_layers || [];
  } catch {
    vectorLayers = [];
  }
  const sourceLayer = vectorLayers[0]?.id;
  if (!sourceLayer) return { ok: false, error: 'metadata.json has no vector_layers[0].id' };
  const stats = directoryStats(outputPath);
  if (stats.pbfFiles === 0) return { ok: false, error: 'no pbf tiles were generated' };
  return { ok: true, sourceLayer, stats };
}

function directoryStats(outputPath) {
  const stack = [outputPath];
  let files = 0;
  let pbfFiles = 0;
  let bytes = 0;
  let maxTileBytes = 0;
  while (stack.length) {
    const current = stack.pop();
    for (const entry of safeReadDir(current)) {
      const child = resolve(current, entry.name);
      if (entry.isDirectory()) stack.push(child);
      if (entry.isFile()) {
        const size = statSync(child).size;
        files += 1;
        bytes += size;
        if (/\.pbf$/i.test(entry.name)) {
          pbfFiles += 1;
          maxTileBytes = Math.max(maxTileBytes, size);
        }
      }
    }
  }
  return { files, pbfFiles, bytes, maxTileBytes };
}

function safeReadDir(path) {
  try {
    return readdirSync(path, { withFileTypes: true });
  } catch {
    return [];
  }
}

function assertInsideOutputRoot(outputPath) {
  const rel = relative(OUTPUT_ROOT, outputPath);
  if (rel === '' || rel.startsWith('..') || /^[a-z]:/i.test(rel)) {
    throw new Error(`Refusing to write outside ${OUTPUT_ROOT}: ${outputPath}`);
  }
}

function statSize(path) {
  try {
    return statSync(path).size;
  } catch {
    return 0;
  }
}

function readStringArg(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index < 0) return fallback;
  return process.argv[index + 1] || fallback;
}

function slugify(value) {
  return String(value || 'layer').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}
