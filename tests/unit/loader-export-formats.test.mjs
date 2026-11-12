/**
 * REG-7: the export-formats registry (packages/loader/src/export-formats.mjs). The download format
 * is a public surface (R13): the file names are pinned here, the writers are run on a fixture, and
 * the legacy /data/graph/ redirects name files the registry writes.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { EXPORT_FORMATS, downloadFileNames, exportFormat } from '../../packages/loader/src/export-formats.mjs';

const ROOT = path.resolve(import.meta.dirname, '../..');

test('export formats: the published file names, in manifest order, are unchanged', () => {
  assert.deepEqual(EXPORT_FORMATS.map((f) => f.id), ['sqlite', 'jsonld', 'rdf-ndjson', 'provenance', 'graph-shards']);
  assert.deepEqual(downloadFileNames('2026-11-12'), [
    'civgraph-records-2026-11-12.sqlite.gz',
    'civgraph-records-latest.sqlite.gz',
    'civgraph.jsonld.gz',
    'civgraph-rdf.ndjson.gz',
    'civgraph-provenance.json.gz',
    'civgraph-graph-shards.tar.gz'
  ]);
  assert.equal(exportFormat('jsonld')?.id, 'jsonld');
  assert.equal(exportFormat('csv'), null);
});

test('export formats: each writer writes the files it lists, and skips a source that is absent', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'civgraph-export-formats-'));
  try {
    const out = path.join(dir, 'downloads');
    const graphDir = path.join(dir, 'graph');
    const db = path.join(dir, 'records.sqlite');
    mkdirSync(out);
    mkdirSync(path.join(graphDir, 'exports', 'jsonld'), { recursive: true });
    mkdirSync(path.join(graphDir, 'statement-shards'));
    writeFileSync(db, 'a database');
    writeFileSync(path.join(graphDir, 'exports', 'civgraph.jsonld'), '{"@graph":[]}\n');
    writeFileSync(path.join(graphDir, 'exports', 'civgraph-rdf.ndjson'), 'a b c .\n');
    writeFileSync(path.join(graphDir, 'exports', 'jsonld', 'part-001.json'), '[]');
    writeFileSync(path.join(graphDir, 'statement-shards', 'statements-000.json'), '{}');
    const ctx = { out, db, graphDir, version: 'v1' };
    /** @type {string[]} */
    const written = [];
    for (const format of EXPORT_FORMATS) written.push(...await format.write(ctx));
    // No civgraph-provenance.json in this graph: its format writes nothing.
    assert.deepEqual(written, downloadFileNames('v1').filter((name) => name !== 'civgraph-provenance.json.gz'));
    assert.deepEqual(readdirSync(out).sort(), [...written].sort());
    assert.equal(gunzipSync(readFileSync(path.join(out, 'civgraph-records-v1.sqlite.gz'))).toString(), 'a database');
    assert.deepEqual(readFileSync(path.join(out, 'civgraph-records-latest.sqlite.gz')), readFileSync(path.join(out, 'civgraph-records-v1.sqlite.gz')));
    assert.equal(gunzipSync(readFileSync(path.join(out, 'civgraph-rdf.ndjson.gz'))).toString(), 'a b c .\n');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('export formats: the legacy graph redirects point at files the registry writes', () => {
  const fn = readFileSync(path.join(ROOT, 'functions/data/graph/[[path]].js'), 'utf8');
  const match = fn.match(/const DOWNLOAD_FILES = new Set\(\[([^\]]*)\]\)/);
  assert.ok(match, 'functions/data/graph/[[path]].js DOWNLOAD_FILES');
  const names = [...match[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  const files = downloadFileNames('any');
  for (const name of names) assert.ok(files.includes(`${name}.gz`), `${name}.gz is a download`);
  for (const archive of fn.matchAll(/(civgraph-[a-z-]+\.tar\.gz)/g)) assert.ok(files.includes(archive[1]), `${archive[1]} is a download`);
});
