#!/usr/bin/env node
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { writeStableGeneratedJson } from './lib/stable-generated-json.mjs';

const ROOT = resolve(process.cwd());
const OUT_PATH = resolve(ROOT, 'test2/build/performance-dashboard.json');
const VALIDATE = process.argv.includes('--validate');
const BUDGETS = {
  entryJsBytes: Number(process.env.TEST2_BUDGET_ENTRY_JS || 700 * 1024),
  entryCssBytes: Number(process.env.TEST2_BUDGET_ENTRY_CSS || 160 * 1024),
  chunkJsBytes: Number(process.env.TEST2_BUDGET_CHUNK_JS || 1800 * 1024),
  metadataIndexBytes: Number(process.env.TEST2_BUDGET_METADATA_INDEX || 3500 * 1024),
  sourceMapCount: 0
};

const checks = [
  fileBudget('Entry JS', 'test2/build/test2.bundle.js', BUDGETS.entryJsBytes),
  fileBudget('Entry CSS', 'test2/build/test2.bundle.css', BUDGETS.entryCssBytes),
  sumBudget('Split JS chunks', 'test2/build/chunks', (name) => name.endsWith('.js'), BUDGETS.chunkJsBytes),
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
