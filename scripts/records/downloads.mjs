#!/usr/bin/env node
/**
 * npm run records:downloads -- the bulk downloads that replace the thousands of shard files
 * (DESIGN.md 4.6), written from the local build into tmp/records/downloads/:
 *   civgraph-records-<version>.sqlite.gz and civgraph-records-latest.sqlite.gz
 *   the graph exports (civgraph.jsonld, civgraph-rdf.ndjson, civgraph-provenance.json), gzipped
 *   manifest.json: version, sizes, SHA-256, licence note
 *
 * It uploads nothing. Publishing them is a separate, approved step through the S3 path:
 *   node scripts/publish/r2-upload-tree.mjs --i-have-reviewed-this-publication ... downloads/
 */
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync, mkdirSync, statSync, writeFileSync, copyFileSync } from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createGzip } from 'node:zlib';
import { openSqliteHandle } from '../lib/storage/sqlite.mjs';
import { SITE } from '../lib/config.mjs';
import { RECORDS_DB, recordPaths, REPO_ROOT } from './paths.mjs';

const BUILD = path.join(REPO_ROOT, 'tmp', 'records');
const DB = RECORDS_DB;
const OUT = path.join(BUILD, 'downloads');
const P = recordPaths({ CIVGRAPH_BUILD_DIR: 'tmp/records' });

async function gzipTo(src, dest) {
  await pipeline(createReadStream(src), createGzip({ level: 6 }), createWriteStream(dest));
}

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
const files = [];
const versioned = path.join(OUT, `civgraph-records-${version}.sqlite.gz`);
await gzipTo(DB, versioned);
copyFileSync(versioned, path.join(OUT, 'civgraph-records-latest.sqlite.gz'));
files.push(path.basename(versioned), 'civgraph-records-latest.sqlite.gz');
for (const name of ['civgraph.jsonld', 'civgraph-rdf.ndjson', 'civgraph-provenance.json']) {
  const src = path.join(P.GRAPH_DIR, 'exports', name);
  if (!existsSync(src)) continue;
  const dest = path.join(OUT, `${name}.gz`);
  await gzipTo(src, dest);
  files.push(path.basename(dest));
}
const manifest = {
  schemaVersion: 1,
  version,
  licence: `See ${SITE.origin}/pages/about.html for the licence of each source; the records cite theirs.`,
  files: /** @type {{ name: string, bytes: number, sha256: string }[]} */ ([]),
};
for (const f of files) {
  const full = path.join(OUT, f);
  manifest.files.push({ name: f, bytes: statSync(full).size, sha256: await sha256(full) });
}
writeFileSync(path.join(OUT, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`downloads for ${version} -> ${path.relative(REPO_ROOT, OUT)} (${files.length} files); nothing uploaded`);
