#!/usr/bin/env node
/**
 * npm run records:downloads -- the bulk downloads that replace the thousands of shard files
 * (DESIGN.md 4.6), written from the local build into tmp/records/downloads/:
 *   the formats of the export-formats registry (export-formats.mjs), in its order:
 *     civgraph-records-<version>.sqlite.gz and civgraph-records-latest.sqlite.gz
 *     the graph exports (civgraph.jsonld, civgraph-rdf.ndjson, civgraph-provenance.json), gzipped
 *     civgraph-graph-shards.tar.gz, the graph's shard files
 *   manifest.json: version, sizes, SHA-256, licence note
 *
 * It uploads nothing. Publishing them is a separate, approved step through the S3 path, which
 * keeps every snapshot version and never overwrites one (packages/loader/src/downloads-guard.mjs):
 *   node scripts/publish/r2-upload-downloads.mjs
 */
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { openSqliteHandle } from '../../storage/src/sqlite.mjs';
import { SITE } from '../../config/src/node.mjs';
import { RECORDS_DB, recordPaths, REPO_ROOT } from './paths.mjs';
import { EXPORT_FORMATS, ExportFailed } from './export-formats.mjs';

const BUILD = path.join(REPO_ROOT, 'tmp', 'records');
const DB = RECORDS_DB;
const OUT = path.join(BUILD, 'downloads');
const P = recordPaths({ CIVGRAPH_BUILD_DIR: 'tmp/records' });

/**
 * @param {string} file
 */
async function sha256(file) {
  const h = createHash('sha256');
  await pipeline(createReadStream(file), h);
  return h.digest('hex');
}

if (!existsSync(DB)) {
  console.error('no build: run npm run records:build first');
  process.exit(1);
}
mkdirSync(OUT, { recursive: true });
const version = openSqliteHandle(DB, { readOnly: true }).prepare("SELECT value FROM dataset WHERE key = 'version'").get()?.value || 'unversioned';
// Each download the export-formats registry holds, in its order (export-formats.mjs).
const files = [];
for (const format of EXPORT_FORMATS) {
  try {
    files.push(...await format.write({ out: OUT, db: DB, graphDir: P.GRAPH_DIR, version: String(version) }));
  } catch (error) {
    if (!(error instanceof ExportFailed)) throw error;
    console.error(error.message);
    process.exit(1);
  }
}
const manifest = {
  schemaVersion: 1,
  version,
  // The Licence page (owner decision PG17, 13 Nov 2026), from the next approved upload.
  licence: `See ${SITE.origin}/pages/licence for the licence of Civgraph's own data and of each source; the records cite theirs.`,
  files: /** @type {{ name: string, bytes: number, sha256: string }[]} */ ([]),
};
for (const f of files) {
  const full = path.join(OUT, f);
  manifest.files.push({ name: f, bytes: statSync(full).size, sha256: await sha256(full) });
}
writeFileSync(path.join(OUT, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`downloads for ${version} -> ${path.relative(REPO_ROOT, OUT)} (${files.length} files); nothing uploaded`);
