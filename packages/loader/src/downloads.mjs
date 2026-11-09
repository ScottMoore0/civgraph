#!/usr/bin/env node
/**
 * npm run records:downloads -- the bulk downloads that replace the thousands of shard files
 * (DESIGN.md 4.6), written from the local build into tmp/records/downloads/:
 *   civgraph-records-<version>.sqlite.gz and civgraph-records-latest.sqlite.gz
 *   the graph exports (civgraph.jsonld, civgraph-rdf.ndjson, civgraph-provenance.json), gzipped
 *   manifest.json: version, sizes, SHA-256, licence note
 *
 * It uploads nothing. Publishing them is a separate, approved step through the S3 path:
 *   node scripts/publish/r2-upload-tree.mjs --i-have-reviewed-this-publication ... data/downloads/
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync, mkdirSync, statSync, writeFileSync, copyFileSync } from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createGzip } from 'node:zlib';
import { openSqliteHandle } from '../../storage/src/sqlite.mjs';
import { SITE } from '../../config/src/node.mjs';
import { RECORDS_DB, recordPaths, REPO_ROOT } from './paths.mjs';

const BUILD = path.join(REPO_ROOT, 'tmp', 'records');
const DB = RECORDS_DB;
const OUT = path.join(BUILD, 'downloads');
const P = recordPaths({ CIVGRAPH_BUILD_DIR: 'tmp/records' });

/**
 * @param {string} src
 * @param {string} dest
 */
async function gzipTo(src, dest) {
  await pipeline(createReadStream(src), createGzip({ level: 6 }), createWriteStream(dest));
}

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
// The graph's shard files (exports/jsonld, exports/rdf-ndjson-shards, exports/provenance-shards and
// statement-shards), byte for byte, in one archive: the three files above are only their indexes.
// These replaced the data/graph/{exports,statement-shards}/ files on R2 (retired 9 Nov 2026).
const shardDirs = ['exports', 'statement-shards'].filter((d) => existsSync(path.join(P.GRAPH_DIR, d)));
if (shardDirs.length) {
  const archive = path.join(OUT, 'civgraph-graph-shards.tar.gz');
  // On Windows use the system's bsdtar: Git Bash's GNU tar reads "C:\..." as a remote host.
  const winTar = process.platform === 'win32' ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe') : '';
  const tarBin = winTar && existsSync(winTar) ? winTar : 'tar';
  const tar = spawnSync(tarBin, ['-czf', archive, '-C', P.GRAPH_DIR, ...shardDirs], { stdio: 'inherit' });
  if (tar.status !== 0) { console.error('tar failed: the graph shard archive was not written'); process.exit(1); }
  files.push(path.basename(archive));
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
