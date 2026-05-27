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
const MAX_GITHUB_BYTES = readNumberArg('--max-github-mb', 95) * 1024 * 1024;
const EXECUTE = !process.argv.includes('--report-only');
const FORCE = process.argv.includes('--force');
const NO_METADATA = process.argv.includes('--no-metadata');
const IDS = readIds();

const metadata = JSON.parse(readFileSync(METADATA_PATH, 'utf8'));
const layers = (metadata.layers || [])
  .filter((layer) => ['mvt', 'pmtiles'].includes(layer.sourceType))
  .filter((layer) => layer.sourceFile)
  .filter((layer) => !IDS.size || IDS.has(layer.id) || IDS.has(layer.sourceMapId));

const tools = {
  ogr2ogr: findCommand('ogr2ogr'),
  ogrinfo: findCommand('ogrinfo')
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
  const profile = getTileProfile(layer.sourceMapId || layer.id);
  const args = [
    '-f', 'PMTiles',
    outputPath,
    sourcePath,
    '-dsco', `MINZOOM=${Number(layer.minzoom ?? 0)}`,
    '-dsco', `MAXZOOM=${Number(layer.maxzoom ?? 12)}`,
    '-dsco', `MAX_SIZE=${profile.maxSize}`,
    '-dsco', `MAX_FEATURES=${profile.maxFeatures}`,
    '-dsco', `SIMPLIFICATION=${profile.simplification}`,
    '-dsco', `SIMPLIFICATION_MAX_ZOOM=${profile.simplificationMaxZoom}`,
    '-lco', `NAME=${layer.sourceLayer || safeLayerName(layer.id)}`,
    '-nln', layer.sourceLayer || safeLayerName(layer.id)
  ];
  const result = spawnSync(tools.ogr2ogr, args, {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024
  });
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
  const nextLayers = (metadata.layers || []).map((layer) => {
    if (!['mvt', 'pmtiles'].includes(layer.sourceType)) return layer;
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
