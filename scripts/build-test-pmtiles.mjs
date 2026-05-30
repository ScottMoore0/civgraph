#!/usr/bin/env node
/**
 * Build PMTiles archives for converted /test vector layers.
 *
 * The constrained path is GDAL's writable PMTiles driver. We deliberately keep
 * directory MVT as a fallback in metadata so a bad or oversized archive cannot
 * strand a layer.
 */

import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { getTileProfile } from './test-tile-profiles.mjs';

const ROOT = resolve(process.cwd());
const METADATA_PATH = resolve(ROOT, 'test/metadata/maps-test.json');
const REPORT_PATH = resolve(ROOT, 'test/metadata/pmtiles-build-report.json');
const OUTPUT_DIR = resolve(ROOT, 'test/pmtiles/generated');
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
const MAX_GITHUB_BYTES = readNumberArg('--max-github-mb', 95) * 1024 * 1024;
const EXECUTE = !process.argv.includes('--report-only');
const FORCE = process.argv.includes('--force');
const NO_METADATA = process.argv.includes('--no-metadata');
const IDS = readIds();

const metadata = JSON.parse(readFileSync(METADATA_PATH, 'utf8'));
const layers = (metadata.layers || [])
  .filter((layer) => ['mvt', 'pmtiles'].includes(layer.sourceType))
  .filter((layer) => !layer.aliasOf)
  .filter((layer) => layer.sourceFile)
  .filter((layer) => !IDS.size || IDS.has(layer.id) || IDS.has(layer.sourceMapId));

const tools = {
  ogr2ogr: findCommand('ogr2ogr'),
  ogrinfo: findCommand('ogrinfo'),
  sqlite3: findCommand('sqlite3')
};
const pmtilesDriver = tools.ogr2ogr ? hasGdalPmtilesDriver(tools.ogr2ogr) : false;
const converted = [];
const skipped = [];
const failed = [];

mkdirSync(OUTPUT_DIR, { recursive: true });

for (const layer of layers) {
  const outputPath = resolve(OUTPUT_DIR, `${layer.id}.pmtiles`);
  const sourcePath = resolve(ROOT, layer.sourceFile.replace(/^\//, ''));
  if (!existsSync(sourcePath)) {
    skipped.push(row(layer, 'missing-source', { sourceFile: layer.sourceFile }));
    continue;
  }
  if (!tools.ogr2ogr || !tools.ogrinfo || !pmtilesDriver) {
    skipped.push(row(layer, 'missing-gdal-pmtiles-driver', { sourceFile: layer.sourceFile }));
    continue;
  }
  if (existsSync(outputPath) && !FORCE) {
    converted.push(row(layer, 'already-exists', describeArchive(outputPath)));
    continue;
  }
  if (!EXECUTE) {
    skipped.push(row(layer, 'report-only', { output: relative(outputPath), sourceFile: layer.sourceFile }));
    continue;
  }

  rmSync(outputPath, { force: true });
  rmSync(`${outputPath}.tmp.mbtiles`, { force: true });
  rmSync(`${outputPath}.tmp.mbtiles.temp.db`, { force: true });
  const profile = getTileProfile(layer.sourceMapId || layer.id);
  const srsOptions = getSourceSrsOptions(layer.sourceMapId || layer.id);
  const result = buildArchive(layer, sourcePath, outputPath, profile, srsOptions);
  if (result.status !== 0 || !existsSync(outputPath)) {
    failed.push(row(layer, 'ogr2ogr-failed', {
      sourceFile: layer.sourceFile,
      output: relative(outputPath),
      stderr: trim(result.stderr),
      stdout: trim(result.stdout)
    }));
    continue;
  }
  const verify = spawnSync(tools.ogrinfo, [outputPath], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024
  });
  if (verify.status !== 0) {
    failed.push(row(layer, 'ogrinfo-failed', {
      sourceFile: layer.sourceFile,
      output: relative(outputPath),
      stderr: trim(verify.stderr),
      stdout: trim(verify.stdout)
    }));
    continue;
  }
  converted.push(row(layer, 'converted', { profile, ...describeArchive(outputPath) }));
}

const report = {
  schemaVersion: 2,
  generatedAt: new Date().toISOString(),
  mode: EXECUTE ? 'execute' : 'report-only',
  tools,
  constrainedPath: 'GDAL PMTiles driver',
  pmtilesDriver,
  outputDirectory: relative(OUTPUT_DIR),
  maxGithubBytes: MAX_GITHUB_BYTES,
  totals: {
    candidates: layers.length,
    converted: converted.filter((item) => item.status === 'converted' || item.status === 'already-exists').length,
    skipped: skipped.length,
    failed: failed.length,
    metadataPreferred: 0,
    oversizedArchives: 0
  },
  converted,
  skipped,
  failed,
  notes: [
    'Archives at or above the configured GitHub size budget are generated but not preferred in maps-test.json.',
    'Each PMTiles metadata entry keeps tilesFallback and metadataUrl pointing at the directory MVT output.',
    'Use --force to rebuild existing archives and --ids <id,id> to constrain a rebuild.'
  ]
};

if (!NO_METADATA) {
  const sync = syncMetadata(report);
  report.totals.metadataPreferred = sync.preferred;
  report.totals.oversizedArchives = sync.oversized;
}

mkdirSync(dirname(REPORT_PATH), { recursive: true });
writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);

console.log(`PMTiles candidates: ${report.totals.candidates}`);
console.log(`Converted/existing: ${report.totals.converted}`);
console.log(`Metadata preferred: ${report.totals.metadataPreferred}`);
console.log(`Skipped: ${report.totals.skipped}`);
console.log(`Failed: ${report.totals.failed}`);
console.log(`Wrote ${relative(REPORT_PATH)}`);

if (failed.length) process.exit(1);

function syncMetadata(report) {
  let preferred = 0;
  let oversized = 0;
  const successfulLayerIds = new Set(report.converted
    .filter((item) => item.status === 'converted' || item.status === 'already-exists')
    .map((item) => item.layerId));
  const failedLayerIds = new Set(report.failed.map((item) => item.layerId));
  const nextLayers = (metadata.layers || []).map((layer) => {
    if (!['mvt', 'pmtiles'].includes(layer.sourceType)) return layer;
    if (IDS.size && failedLayerIds.has(layer.id)) {
      return {
        ...layer,
        sourceType: 'mvt',
        tiles: layer.tilesFallback || layer.tiles,
        tileUrl: undefined,
        tilesFallback: undefined,
        tilePackage: undefined,
        warning: unique([...(layer.warning ? [layer.warning] : []), 'PMTiles archive failed validation; directory MVT remains preferred.']).join(' ')
      };
    }
    if (IDS.size && !successfulLayerIds.has(layer.id)) return layer;
    const archivePath = resolve(OUTPUT_DIR, `${layer.id}.pmtiles`);
    if (!existsSync(archivePath)) return layer;
    const size = statSync(archivePath).size;
    const pmtilesUrl = `/test/pmtiles/generated/${layer.id}.pmtiles`;
    const archive = {
      preferred: size < MAX_GITHUB_BYTES,
      localPath: relative(archivePath),
      url: pmtilesUrl,
      bytes: size,
      maxGithubBytes: MAX_GITHUB_BYTES,
      generatedAt: report.generatedAt,
      fallback: layer.tilesFallback || layer.tiles || null
    };
    if (!archive.preferred) {
      oversized += 1;
      return {
        ...layer,
        tilePackage: archive,
        warning: unique([...(layer.warning ? [layer.warning] : []), 'PMTiles archive exceeds Git hosting budget; directory MVT remains preferred.']).join(' ')
      };
    }
    preferred += 1;
    return {
      ...layer,
      sourceType: 'pmtiles',
      tileUrl: pmtilesUrl,
      tilesFallback: layer.tilesFallback || layer.tiles || null,
      tilePackage: archive
    };
  });
  writeFileSync(METADATA_PATH, `${JSON.stringify({ ...metadata, layers: nextLayers }, null, 2)}\n`);
  return { preferred, oversized };
}

function buildArchive(layer, sourcePath, outputPath, profile, srsOptions) {
  if ((layer.sourceMapId || layer.id) === 'habitat-deciduous-woodland'
    && existsSync(resolve(ROOT, DECIDUOUS_LOD0_SOURCE))
    && existsSync(resolve(ROOT, DECIDUOUS_LOD1_SOURCE))) {
    return buildDeciduousMultiZoomArchive(layer, outputPath, profile);
  }
  if (usesMbtilesIntermediate(layer)) {
    const mbtilesPath = outputPath.replace(/\.pmtiles$/i, '.mbtiles');
    rmSync(mbtilesPath, { force: true });
    const mbtilesResult = spawnSync(tools.ogr2ogr, [
      '-f', 'MBTiles',
      mbtilesPath,
      sourcePath,
      ...getFailureOptions(layer.sourceMapId || layer.id),
      ...srsOptions,
      ...getSourceQueryOptions(layer.sourceMapId || layer.id),
      '-dsco', `MINZOOM=${Number(layer.minzoom ?? 0)}`,
      '-dsco', `MAXZOOM=${Number(layer.maxzoom ?? 12)}`,
      '-dsco', `MAX_SIZE=${profile.maxSize}`,
      '-dsco', `MAX_FEATURES=${profile.maxFeatures}`,
      '-dsco', `SIMPLIFICATION=${profile.simplification}`,
      '-dsco', `SIMPLIFICATION_MAX_ZOOM=${profile.simplificationMaxZoom}`,
      '-lco', `NAME=${layer.sourceLayer || safeLayerName(layer.id)}`,
      '-nln', layer.sourceLayer || safeLayerName(layer.id)
    ], {
      cwd: ROOT,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024
    });
    if (mbtilesResult.status !== 0 || !existsSync(mbtilesPath)) return mbtilesResult;
    const layerName = layer.sourceLayer || safeLayerName(layer.id);
    const metadataResult = ensureMbtilesVectorMetadata(mbtilesPath, layerName);
    if (metadataResult.status !== 0) return metadataResult;
    const pmtilesResult = spawnSync(tools.ogr2ogr, [
      '-f', 'PMTiles',
      outputPath,
      mbtilesPath
    ], {
      cwd: ROOT,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024
    });
    rmSync(mbtilesPath, { force: true });
    return pmtilesResult;
  }

  return spawnSync(tools.ogr2ogr, [
    '-f', 'PMTiles',
    outputPath,
    sourcePath,
    ...getFailureOptions(layer.sourceMapId || layer.id),
    ...srsOptions,
    ...getSourceQueryOptions(layer.sourceMapId || layer.id),
    '-dsco', `MINZOOM=${Number(layer.minzoom ?? 0)}`,
    '-dsco', `MAXZOOM=${Number(layer.maxzoom ?? 12)}`,
    '-dsco', `MAX_SIZE=${profile.maxSize}`,
    '-dsco', `MAX_FEATURES=${profile.maxFeatures}`,
    '-dsco', `SIMPLIFICATION=${profile.simplification}`,
    '-dsco', `SIMPLIFICATION_MAX_ZOOM=${profile.simplificationMaxZoom}`,
    '-lco', `NAME=${layer.sourceLayer || safeLayerName(layer.id)}`,
    '-nln', layer.sourceLayer || safeLayerName(layer.id)
  ], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024
  });
}

function buildDeciduousMultiZoomArchive(layer, outputPath, profile) {
  if (!tools.sqlite3) {
    return { status: 1, stderr: 'sqlite3 is required to merge low/high zoom MBTiles before PMTiles packaging.', stdout: '' };
  }
  const lowMbtiles = outputPath.replace(/\.pmtiles$/i, '.lod0.mbtiles');
  const highMbtiles = outputPath.replace(/\.pmtiles$/i, '.lod1.mbtiles');
  rmSync(lowMbtiles, { force: true });
  rmSync(highMbtiles, { force: true });
  const layerName = layer.sourceLayer || safeLayerName(layer.id);
  const low = spawnSync(tools.ogr2ogr, mbtilesArgs({
    outputPath: lowMbtiles,
    sourcePath: resolve(ROOT, DECIDUOUS_LOD0_SOURCE),
    minzoom: 0,
    maxzoom: 7,
    profile,
    layerName
  }), { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (low.status !== 0 || !existsSync(lowMbtiles)) {
    rmSync(lowMbtiles, { force: true });
    rmSync(highMbtiles, { force: true });
    return low;
  }
  const high = spawnSync(tools.ogr2ogr, mbtilesArgs({
    outputPath: highMbtiles,
    sourcePath: resolve(ROOT, DECIDUOUS_LOD1_SOURCE),
    minzoom: 8,
    maxzoom: 12,
    profile,
    layerName
  }), { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (high.status !== 0 || !existsSync(highMbtiles)) {
    rmSync(lowMbtiles, { force: true });
    rmSync(highMbtiles, { force: true });
    return high;
  }
  const merge = spawnSync(tools.sqlite3, [
    lowMbtiles,
    `ATTACH '${escapeSqlitePath(highMbtiles)}' AS high; INSERT OR REPLACE INTO tiles SELECT * FROM high.tiles; UPDATE metadata SET value='0' WHERE name='minzoom'; UPDATE metadata SET value='12' WHERE name='maxzoom'; UPDATE metadata SET value='${escapeSqliteValue(layer.name || layer.id)}' WHERE name='name'; DETACH high;`
  ], { cwd: ROOT, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  if (merge.status !== 0) {
    rmSync(lowMbtiles, { force: true });
    rmSync(highMbtiles, { force: true });
    return merge;
  }
  const pmtiles = spawnSync(tools.ogr2ogr, [
    '-f', 'PMTiles',
    outputPath,
    lowMbtiles
  ], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  rmSync(lowMbtiles, { force: true });
  rmSync(highMbtiles, { force: true });
  return pmtiles;
}

function mbtilesArgs({ outputPath, sourcePath, minzoom, maxzoom, profile, layerName }) {
  return [
    '-f', 'MBTiles',
    outputPath,
    sourcePath,
    '-dsco', `MINZOOM=${minzoom}`,
    '-dsco', `MAXZOOM=${maxzoom}`,
    '-dsco', `MAX_SIZE=${profile.maxSize}`,
    '-dsco', `MAX_FEATURES=${profile.maxFeatures}`,
    '-dsco', `SIMPLIFICATION=${profile.simplification}`,
    '-dsco', `SIMPLIFICATION_MAX_ZOOM=${profile.simplificationMaxZoom}`,
    '-lco', `NAME=${layerName}`,
    '-nln', layerName
  ];
}

function usesMbtilesIntermediate(layer) {
  return new Set([
    'habitat-wetland-grouped',
    'habitat-wetland-grouped-vector-test'
  ]).has(layer.sourceMapId || layer.id);
}

function describeArchive(outputPath) {
  const bytes = statSync(outputPath).size;
  return {
    output: relative(outputPath),
    bytes,
    exceedsGithubBudget: bytes >= MAX_GITHUB_BYTES
  };
}

function row(layer, status, extra = {}) {
  return {
    layerId: layer.id,
    sourceMapId: layer.sourceMapId,
    name: layer.name,
    sourceType: layer.sourceType,
    status,
    ...extra
  };
}

function findCommand(command) {
  const result = spawnSync(process.platform === 'win32' ? 'where.exe' : 'which', [command], {
    cwd: ROOT,
    encoding: 'utf8'
  });
  if (result.status !== 0) return '';
  return result.stdout.split(/\r?\n/).find(Boolean) || '';
}

function hasGdalPmtilesDriver(ogr2ogr) {
  const result = spawnSync(ogr2ogr, ['--formats'], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024
  });
  return result.status === 0 && /\bPMTiles\b.*\(rw\+?v?\)/i.test(result.stdout);
}

function readIds() {
  const index = process.argv.indexOf('--ids');
  if (index < 0) return new Set();
  return new Set(String(process.argv[index + 1] || '').split(',').map((item) => item.trim()).filter(Boolean));
}

function readNumberArg(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index < 0) return fallback;
  const value = Number(process.argv[index + 1]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function relative(path) {
  return path.replace(`${ROOT}\\`, '').replaceAll('\\', '/');
}

function trim(value) {
  const text = String(value || '').trim();
  return text.length > 2000 ? `${text.slice(0, 2000)}...` : text;
}

function safeLayerName(value) {
  return String(value || 'layer').replace(/[^a-z0-9_]+/gi, '_').replace(/^_+|_+$/g, '').toLowerCase() || 'layer';
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
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

function getFailureOptions(sourceMapId) {
  if (String(sourceMapId || '').toLowerCase() === 'roi-national-planning-applications') {
    return ['-skipfailures'];
  }
  return [];
}

function ensureMbtilesVectorMetadata(mbtilesPath, layerName) {
  if (!tools.sqlite3) return { status: 0, stderr: '', stdout: '' };
  const vectorLayers = JSON.stringify({
    vector_layers: [{
      id: layerName,
      fields: {}
    }]
  });
  return spawnSync(tools.sqlite3, [
    mbtilesPath,
    [
      "CREATE TABLE IF NOT EXISTS metadata (name text, value text);",
      `INSERT OR REPLACE INTO metadata(name, value) VALUES('json', '${escapeSqliteValue(vectorLayers)}');`
    ].join('')
  ], { cwd: ROOT, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
}

function escapeSqlitePath(value) {
  return String(value || '').replaceAll('\\', '/').replaceAll("'", "''");
}

function escapeSqliteValue(value) {
  return String(value || '').replaceAll("'", "''");
}
