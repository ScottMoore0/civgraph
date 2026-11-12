/**
 * The export-formats registry (REG-7): every bulk download `npm run records:downloads` writes
 * (downloads.mjs), each with the files it publishes and the code that writes them. The download
 * format and its file names are a public surface (docs/ARCHITECTURE-RULES.md R13): they change
 * only by addition. A new format is one entry here; downloads.mjs writes and lists whatever the
 * registry holds, in its order (the manifest's order).
 *
 * The legacy /data/graph/ redirects (functions/data/graph/[[path]].js) point at these files by
 * name; tests/unit/loader-export-formats.test.mjs holds them together.
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, createReadStream, createWriteStream, existsSync } from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createGzip } from 'node:zlib';

/**
 * What a format's writer reads and where it writes.
 * @typedef {object} ExportContext
 * @property {string} out       the downloads folder (tmp/records/downloads)
 * @property {string} db        the records database
 * @property {string} graphDir  the semantic graph's build folder (data/graph under the build)
 * @property {string} version   the dataset's version (the dataset table's `version`)
 */

/**
 * @typedef {object} ExportFormat
 * @property {string} id
 * @property {string} label        what the download holds
 * @property {(version: string) => string[]} files  the files a full build of it publishes, in manifest order
 * @property {(ctx: ExportContext) => Promise<string[]>} write  writes them into ctx.out; the names written (none when its source is absent)
 */

/**
 * Gzips a file (level 6).
 * @param {string} src
 * @param {string} dest
 */
export async function gzipTo(src, dest) {
  await pipeline(createReadStream(src), createGzip({ level: 6 }), createWriteStream(dest));
}

/**
 * A graph export (written by the semantic graph build into exports/), gzipped under its own name.
 * @param {string} id
 * @param {string} name
 * @param {string} label
 * @returns {ExportFormat}
 */
function graphExport(id, name, label) {
  return {
    id,
    label,
    files: () => [`${name}.gz`],
    async write({ out, graphDir }) {
      const src = path.join(graphDir, 'exports', name);
      if (!existsSync(src)) return [];
      const dest = path.join(out, `${name}.gz`);
      await gzipTo(src, dest);
      return [path.basename(dest)];
    }
  };
}

/** The graph shard folders the archive holds, under the graph build. */
const SHARD_DIRS = Object.freeze(['exports', 'statement-shards']);
const SHARD_ARCHIVE = 'civgraph-graph-shards.tar.gz';
const LATEST_DB = 'civgraph-records-latest.sqlite.gz';

/** @type {readonly ExportFormat[]} */
export const EXPORT_FORMATS = Object.freeze([
  {
    id: 'sqlite',
    label: 'the records database (SQLite), gzipped: this version, and the same file as latest',
    files: (version) => [`civgraph-records-${version}.sqlite.gz`, LATEST_DB],
    async write({ out, db, version }) {
      const versioned = path.join(out, `civgraph-records-${version}.sqlite.gz`);
      await gzipTo(db, versioned);
      copyFileSync(versioned, path.join(out, LATEST_DB));
      return [path.basename(versioned), LATEST_DB];
    }
  },
  graphExport('jsonld', 'civgraph.jsonld', 'the semantic graph as JSON-LD (the index of its jsonld shards), gzipped'),
  graphExport('rdf-ndjson', 'civgraph-rdf.ndjson', 'the semantic graph as RDF statements, one per line (the index of its shards), gzipped'),
  graphExport('provenance', 'civgraph-provenance.json', 'the provenance of the graph\'s statements (the index of its shards), gzipped'),
  {
    // The graph's shard files (exports/jsonld, exports/rdf-ndjson-shards, exports/provenance-shards and
    // statement-shards), byte for byte, in one archive: the three files above are only their indexes.
    // These replaced the data/graph/{exports,statement-shards}/ files on R2 (retired 9 Nov 2026).
    id: 'graph-shards',
    label: 'the graph\'s shard files, byte for byte, in one tar.gz',
    files: () => [SHARD_ARCHIVE],
    async write({ out, graphDir }) {
      const shardDirs = SHARD_DIRS.filter((d) => existsSync(path.join(graphDir, d)));
      if (!shardDirs.length) return [];
      const archive = path.join(out, SHARD_ARCHIVE);
      // On Windows use the system's bsdtar: Git Bash's GNU tar reads "C:\..." as a remote host.
      const winTar = process.platform === 'win32' ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe') : '';
      const tarBin = winTar && existsSync(winTar) ? winTar : 'tar';
      const tar = spawnSync(tarBin, ['-czf', archive, '-C', graphDir, ...shardDirs], { stdio: 'inherit' });
      if (tar.status !== 0) throw new ExportFailed('tar failed: the graph shard archive was not written');
      return [path.basename(archive)];
    }
  }
]);

/** A writer that could not finish; downloads.mjs prints the message and exits 1. */
export class ExportFailed extends Error {}

/**
 * The format with this id, or null.
 * @param {string} id
 * @returns {ExportFormat | null}
 */
export function exportFormat(id) {
  return EXPORT_FORMATS.find((format) => format.id === id) || null;
}

/**
 * Every file a full set of downloads for `version` holds, in manifest order (manifest.json itself aside).
 * @param {string} version
 * @returns {string[]}
 */
export function downloadFileNames(version) {
  return EXPORT_FORMATS.flatMap((format) => format.files(version));
}
