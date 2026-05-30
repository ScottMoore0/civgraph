#!/usr/bin/env node
/**
 * Report and optionally convert feasible main-site vector sources into GDAL MVT
 * directories for the /test rewrite.
 *
 * Default mode is a dry inventory. Use --execute --limit N after reviewing the
 * report; this avoids blindly generating hundreds of large tile pyramids.
 */

import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, extname, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { getTileProfile } from './test-tile-profiles.mjs';

const ROOT = resolve(process.cwd());
const PLAN_PATH = resolve(ROOT, 'test/metadata/main-site-port-plan.json');
const REPORT_PATH = resolve(ROOT, 'test/metadata/vector-conversion-report.json');
const OUTPUT_ROOT = resolve(ROOT, 'test/tiles/generated');
const SOURCE_CACHE_MANIFEST_PATH = resolve(ROOT, 'test/source-cache/vector-intake/manifest.json');
const DECIDUOUS_LOD0_SOURCE = 'data/maps/biodiversity/habitat-deciduous-woodland-lod0.fgb';
const DECIDUOUS_LOD1_SOURCE = 'data/maps/biodiversity/habitat-deciduous-woodland-lod1.fgb';
const WGS84_UNKNOWN_SRS_IDS = new Set([
  'ireland-island',
  'ni-1921',
  'roi-1938',
  'historic-bullaun-stones',
  'historic-crannog',
  'historic-ringfort-cashel',
  'historic-ringfort-rath',
  'historic-ringfort-unclassified',
  'historic-rock-scribing',
  'historic-standing-stones',
  'historic-wedge-tomb',
  'transport-lines-road-rail',
  'dcc-dcc-public-cycle-parking-stands'
]);
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
    const srsOptions = getSourceSrsOptions(candidate.sourceMapId);
    const result = buildMvtOutput(candidate, sourcePath, outputPath, layerName, profile, srsOptions);
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
  const preferredFallback = localFallbackSource(row.sourceMapId);
  if (preferredFallback?.prefer) return preferredFallback;
  const cached = cachedSourceById.get(row.sourceMapId);
  if (cached?.localPath && FORMATS.has(extname(cached.localPath).toLowerCase())) {
    return { file: cached.localPath, cachedFrom: cached.url };
  }
  const fallback = preferredFallback;
  if (fallback) return fallback;
  return (row.sourceFiles || []).find((source) => {
    const file = source.file || '';
    return !/^https?:\/\//i.test(file) && FORMATS.has(extname(file).toLowerCase());
  }) || null;
}

function localFallbackSource(sourceMapId) {
  if (sourceMapId === 'habitat-deciduous-woodland' && existsSync(resolve(ROOT, DECIDUOUS_LOD1_SOURCE))) {
    return {
      file: DECIDUOUS_LOD1_SOURCE,
      prefer: true,
      note: 'Fallback to available LOD1 habitat-deciduous-woodland source; conversion uses LOD0 for low zooms and LOD1 for detail zooms when both are present.'
    };
  }
  if (sourceMapId === 'habitat-wetland-grouped' && existsSync(resolve(ROOT, 'data/maps/biodiversity/habitat-wetland-grouped-lod1.fgb'))) {
    return {
      file: 'data/maps/biodiversity/habitat-wetland-grouped-lod1.fgb',
      prefer: true,
      note: 'Fallback to available LOD1 habitat-wetland-grouped source so conversion remains bounded and mobile-safe.'
    };
  }
  if (sourceMapId === 'wards-1993-50k' && existsSync(resolve(ROOT, 'data/maps/local-government/Wards_1993.fgb'))) {
    return {
      file: 'data/maps/local-government/Wards_1993.fgb',
      note: 'Fallback to available Wards_1993.fgb when Wards_1993_50k.fgb is not present in the checkout.'
    };
  }
  return null;
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

function buildMvtOutput(candidate, sourcePath, outputPath, layerName, profile, srsOptions) {
  if (candidate.sourceMapId === 'habitat-deciduous-woodland'
    && existsSync(resolve(ROOT, DECIDUOUS_LOD0_SOURCE))
    && existsSync(resolve(ROOT, DECIDUOUS_LOD1_SOURCE))) {
    return buildDeciduousMultiZoomMvt(outputPath, layerName, candidate.name || candidate.sourceMapId, profile);
  }
  return spawnSync('ogr2ogr', [
    '-f', 'MVT',
    outputPath,
    sourcePath,
    ...srsOptions,
    ...getSourceQueryOptions(candidate.sourceMapId),
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
}

function buildDeciduousMultiZoomMvt(outputPath, layerName, name, profile) {
  const lowPath = `${outputPath}.__lod0`;
  const highPath = `${outputPath}.__lod1`;
  rmSync(lowPath, { recursive: true, force: true });
  rmSync(highPath, { recursive: true, force: true });
  const low = spawnSync('ogr2ogr', mvtArgs({
    outputPath: lowPath,
    sourcePath: resolve(ROOT, DECIDUOUS_LOD0_SOURCE),
    layerName,
    name,
    minzoom: 0,
    maxzoom: 7,
    profile
  }), { cwd: ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, timeout: PER_LAYER_TIMEOUT_MS });
  if (low.status !== 0) {
    rmSync(lowPath, { recursive: true, force: true });
    rmSync(highPath, { recursive: true, force: true });
    return low;
  }
  const high = spawnSync('ogr2ogr', mvtArgs({
    outputPath: highPath,
    sourcePath: resolve(ROOT, DECIDUOUS_LOD1_SOURCE),
    layerName,
    name,
    minzoom: 8,
    maxzoom: 12,
    profile
  }), { cwd: ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, timeout: PER_LAYER_TIMEOUT_MS });
  if (high.status !== 0) {
    rmSync(lowPath, { recursive: true, force: true });
    rmSync(highPath, { recursive: true, force: true });
    return high;
  }

  rmSync(outputPath, { recursive: true, force: true });
  cpSync(lowPath, outputPath, { recursive: true });
  cpSync(highPath, outputPath, { recursive: true, force: true });
  normalizeMergedMvtMetadata(outputPath, 0, 12);
  rmSync(lowPath, { recursive: true, force: true });
  rmSync(highPath, { recursive: true, force: true });
  return { status: 0, stdout: `${name} generated from LOD0 z0-z7 and LOD1 z8-z12.`, stderr: '' };
}

function mvtArgs({ outputPath, sourcePath, layerName, name, minzoom, maxzoom, profile }) {
  return [
    '-f', 'MVT',
    outputPath,
    sourcePath,
    '-dsco', 'FORMAT=DIRECTORY',
    '-dsco', `MINZOOM=${minzoom}`,
    '-dsco', `MAXZOOM=${maxzoom}`,
    '-dsco', 'TILE_EXTENSION=pbf',
    '-dsco', 'COMPRESS=NO',
    '-dsco', `NAME=${name}`,
    '-dsco', `MAX_SIZE=${profile.maxSize}`,
    '-dsco', `MAX_FEATURES=${profile.maxFeatures}`,
    '-dsco', `SIMPLIFICATION=${profile.simplification}`,
    '-dsco', `SIMPLIFICATION_MAX_ZOOM=${profile.simplificationMaxZoom}`,
    '-lco', `NAME=${layerName}`,
    '-nln', layerName
  ];
}

function normalizeMergedMvtMetadata(outputPath, minzoom, maxzoom) {
  const metadataPath = resolve(outputPath, 'metadata.json');
  if (!existsSync(metadataPath)) return;
  const metadata = JSON.parse(readFileSync(metadataPath, 'utf8'));
  metadata.minzoom = minzoom;
  metadata.maxzoom = maxzoom;
  let json = {};
  try {
    json = JSON.parse(metadata.json || '{}');
  } catch {
    json = {};
  }
  for (const layer of json.vector_layers || []) {
    layer.minzoom = minzoom;
    layer.maxzoom = maxzoom;
  }
  metadata.json = `${JSON.stringify(json, null, 2)}\n`;
  writeFileSync(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`);
}

function slugify(value) {
  return String(value || 'layer').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function getSourceSrsOptions(sourceMapId) {
  const id = String(sourceMapId || '').toLowerCase();
  if (id === 'pc-1995' || id === 'ni-townlands-1844' || WGS84_UNKNOWN_SRS_IDS.has(id)) {
    return ['-a_srs', 'EPSG:4326'];
  }
  if (id.startsWith('wq-rwq-')) {
    return ['-a_srs', 'EPSG:29903'];
  }
  return [];
}

function getSourceQueryOptions(sourceMapId) {
  const id = String(sourceMapId || '').toLowerCase();
  if (id === 'dcc-dcc-public-cycle-parking-stands') {
    return [
      '-dialect', 'SQLite',
      '-sql', 'SELECT id, Name, description, Latitude, Longitude, MakePoint(Latitude, Longitude) AS geometry FROM Map_Coordinates WHERE Latitude BETWEEN -11 AND -4 AND Longitude BETWEEN 51 AND 56'
    ];
  }
  return [];
}
