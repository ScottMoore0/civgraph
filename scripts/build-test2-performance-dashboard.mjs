#!/usr/bin/env node
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { writeStableGeneratedJson } from './lib/stable-generated-json.mjs';

const ROOT = resolve(process.cwd());
const OUT_PATH = resolve(ROOT, 'test2/build/performance-dashboard.json');
const VALIDATE = process.argv.includes('--validate');
const BUDGETS = {
  entryJsBytes: Number(process.env.TEST2_BUDGET_ENTRY_JS || 80 * 1024),
  entryCssBytes: Number(process.env.TEST2_BUDGET_ENTRY_CSS || 160 * 1024),
  chunkJsBytes: Number(process.env.TEST2_BUDGET_CHUNK_JS || 1800 * 1024),
  largestLazyChunkBytes: Number(process.env.TEST2_BUDGET_LARGEST_LAZY_CHUNK || 1200 * 1024),
  metadataIndexBytes: Number(process.env.TEST2_BUDGET_METADATA_INDEX || 3500 * 1024),
  sourceMapCount: 0
};

const checks = [
  fileBudget('Entry JS', 'test2/build/test2.bundle.js', BUDGETS.entryJsBytes),
  fileBudget('Entry CSS', 'test2/build/test2.bundle.css', BUDGETS.entryCssBytes),
  sumBudget('Split JS chunks', 'test2/build/chunks', (name) => name.endsWith('.js'), BUDGETS.chunkJsBytes),
  largestChunkBudget('Largest lazy JS chunk', 'test2/build/chunks', BUDGETS.largestLazyChunkBytes),
  splitRuntimeCheck(),
  fileBudget('Startup metadata index', 'test/metadata/maps-test-index.json', BUDGETS.metadataIndexBytes, { normalizeTextEol: true }),
  existsCheck('Scoped service worker', 'test2/sw.js'),
  sourceMapCheck(),
  pmtilesCoverageCheck()
];

const failed = checks.filter((check) => check.status === 'fail').length;
const warnings = checks.filter((check) => check.status === 'warn').length;
const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  summary: failed ? 'Performance budget failures present' : (warnings ? 'Performance budget warnings present' : 'Performance budgets pass'),
  budgets: BUDGETS,
  totals: {
    checks: checks.length,
    failed,
    warnings,
    passed: checks.filter((check) => check.status === 'pass').length
  },
  assets: buildAssetInventory(),
  checks
};

mkdirSync(resolve(ROOT, 'test2/build'), { recursive: true });
writeStableGeneratedJson(OUT_PATH, report);
console.log('Civgraph /test2 Performance Dashboard');
console.log(`- output: test2/build/performance-dashboard.json`);
console.log(`- checks: ${checks.length}`);
console.log(`- failed: ${failed}`);
console.log(`- warnings: ${warnings}`);
for (const check of checks) {
  console.log(`- ${check.status.toUpperCase()}: ${check.name} (${check.valueLabel})`);
}
if (VALIDATE && failed) process.exit(1);

function fileBudget(name, relativePath, maxBytes, options = {}) {
  const fullPath = resolve(ROOT, relativePath);
  if (!existsSync(fullPath)) {
    return { name, status: 'fail', value: 0, maxBytes, valueLabel: 'missing', path: relativePath };
  }
  const bytes = options.normalizeTextEol
    ? Buffer.byteLength(readFileSync(fullPath, 'utf8').replace(/\r\n/g, '\n'), 'utf8')
    : statSync(fullPath).size;
  return {
    name,
    status: bytes <= maxBytes ? 'pass' : 'fail',
    value: bytes,
    maxBytes,
    valueLabel: `${formatBytes(bytes)} / ${formatBytes(maxBytes)}`,
    path: relativePath
  };
}

function sumBudget(name, relativeDir, predicate, maxBytes) {
  const fullDir = resolve(ROOT, relativeDir);
  if (!existsSync(fullDir)) return { name, status: 'pass', value: 0, maxBytes, valueLabel: `0 B / ${formatBytes(maxBytes)}`, path: relativeDir };
  const files = readdirSync(fullDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && predicate(entry.name))
    .map((entry) => resolve(fullDir, entry.name));
  const bytes = files.reduce((sum, file) => sum + statSync(file).size, 0);
  return {
    name,
    status: bytes <= maxBytes ? 'pass' : 'fail',
    value: bytes,
    maxBytes,
    valueLabel: `${formatBytes(bytes)} / ${formatBytes(maxBytes)}`,
    path: relativeDir
  };
}

function largestChunkBudget(name, relativeDir, maxBytes) {
  const chunks = listFiles(relativeDir, (entryName) => entryName.endsWith('.js'));
  const largest = chunks[0] || null;
  const bytes = largest?.bytes || 0;
  return {
    name,
    status: bytes <= maxBytes ? 'pass' : 'fail',
    value: bytes,
    maxBytes,
    valueLabel: `${largest?.name || 'none'} ${formatBytes(bytes)} / ${formatBytes(maxBytes)}`,
    path: largest?.path || relativeDir
  };
}

function splitRuntimeCheck() {
  const entryPath = resolve(ROOT, 'test2/build/test2.bundle.js');
  const chunks = listFiles('test2/build/chunks', (entryName) => entryName.endsWith('.js'));
  const entry = existsSync(entryPath) ? readFileSync(entryPath, 'utf8') : '';
  const hasDynamicImport = /import\(["'][./]*chunks\//.test(entry) || /import\(`\.\/chunks\//.test(entry);
  const hasRuntimeChunk = chunks.some((chunk) => /app|maplibre|election|chunk/i.test(chunk.name));
  return {
    name: 'Startup runtime split',
    status: hasDynamicImport && hasRuntimeChunk ? 'pass' : 'fail',
    value: { hasDynamicImport, lazyChunkCount: chunks.length },
    valueLabel: `${chunks.length} lazy JS chunk(s); dynamic import ${hasDynamicImport ? 'present' : 'missing'}`
  };
}

function buildAssetInventory() {
  const entryJs = fileInfo('test2/build/test2.bundle.js');
  const entryCss = fileInfo('test2/build/test2.bundle.css');
  const jsChunks = listFiles('test2/build/chunks', (name) => name.endsWith('.js'));
  const cssChunks = listFiles('test2/build/chunks', (name) => name.endsWith('.css'));
  const allOutputs = [
    entryJs,
    entryCss,
    ...jsChunks,
    ...cssChunks
  ].filter(Boolean).sort((a, b) => b.bytes - a.bytes);
  return {
    entry: { js: entryJs, css: entryCss },
    lazy: {
      jsCount: jsChunks.length,
      cssCount: cssChunks.length,
      jsBytes: jsChunks.reduce((sum, item) => sum + item.bytes, 0),
      cssBytes: cssChunks.reduce((sum, item) => sum + item.bytes, 0)
    },
    largestOutputs: allOutputs.slice(0, 12)
  };
}

function fileInfo(relativePath) {
  const fullPath = resolve(ROOT, relativePath);
  if (!existsSync(fullPath)) return null;
  const bytes = statSync(fullPath).size;
  return {
    name: relativePath.split(/[\\/]/).pop(),
    path: relativePath,
    bytes,
    label: formatBytes(bytes)
  };
}

function listFiles(relativeDir, predicate) {
  const fullDir = resolve(ROOT, relativeDir);
  if (!existsSync(fullDir)) return [];
  return readdirSync(fullDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && predicate(entry.name))
    .map((entry) => {
      const relativePath = `${relativeDir}/${entry.name}`;
      const bytes = statSync(resolve(ROOT, relativePath)).size;
      return {
        name: entry.name,
        path: relativePath,
        bytes,
        label: formatBytes(bytes)
      };
    })
    .sort((a, b) => b.bytes - a.bytes);
}

function existsCheck(name, relativePath) {
  const ok = existsSync(resolve(ROOT, relativePath));
  return {
    name,
    status: ok ? 'pass' : 'fail',
    value: ok,
    valueLabel: ok ? 'present' : 'missing',
    path: relativePath
  };
}

function sourceMapCheck() {
  const count = countFiles('test2/build', (name) => name.endsWith('.map'));
  return {
    name: 'Production source maps disabled',
    status: count <= BUDGETS.sourceMapCount ? 'pass' : 'fail',
    value: count,
    maxCount: BUDGETS.sourceMapCount,
    valueLabel: `${count} map file(s)`,
    path: 'test2/build'
  };
}

function pmtilesCoverageCheck() {
  const metadataPath = resolve(ROOT, 'test/metadata/maps-test-index.json');
  if (!existsSync(metadataPath)) return { name: 'PMTiles metadata coverage', status: 'fail', value: 0, valueLabel: 'metadata missing' };
  const metadata = JSON.parse(readFileSync(metadataPath, 'utf8'));
  const layers = Array.isArray(metadata.layers) ? metadata.layers : [];
  const pmtiles = layers.filter((layer) => layer.sourceType === 'pmtiles');
  const remote = pmtiles.filter((layer) => /^https:\/\/data\.civgraph\.net\/.+\.pmtiles(?:[?#].*)?$/i.test(layer.tileUrl || ''));
  return {
    name: 'PMTiles metadata coverage',
    status: pmtiles.length === remote.length ? 'pass' : 'warn',
    value: remote.length,
    total: pmtiles.length,
    valueLabel: `${remote.length}/${pmtiles.length} PMTiles layers use CDN URLs`
  };
}

function countFiles(relativeDir, predicate) {
  const fullDir = resolve(ROOT, relativeDir);
  if (!existsSync(fullDir)) return 0;
  let count = 0;
  for (const entry of readdirSync(fullDir, { withFileTypes: true })) {
    const fullPath = resolve(fullDir, entry.name);
    if (entry.isDirectory()) count += countFiles(`${relativeDir}/${entry.name}`, predicate);
    else if (predicate(entry.name)) count += 1;
  }
  return count;
}

function formatBytes(bytes) {
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = Number(bytes || 0);
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}
