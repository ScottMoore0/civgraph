/**
 * Where the record build writes, in one place.
 *
 * Every generator that used to write into render/metadata/elections-test2*,
 * render/metadata/election-provenance, data/database/election-provenance.json, data/browse
 * or data/graph takes its location from here, so the whole chain can be pointed at a build
 * directory without editing each script again.
 *
 *   CIVGRAPH_BUILD_DIR unset    everything under tmp/records, where records:build puts it (since
 *                               the stage G cutover: these trees are no longer tracked)
 *   CIVGRAPH_BUILD_DIR=<dir>    everything under <dir>
 *   CIVGRAPH_BUILD_DIR=legacy   the old locations (render/metadata/..., data/browse, ...)
 *
 * These are file paths. The URLs the files used to be served at (/render/metadata/...,
 * /data/browse/...) are public addresses and stay as they are wherever they are written into
 * a document; the compatibility Functions answer them from D1.
 *
 * scripts/records/paths.py holds the same names for the Python scripts.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export const DEFAULT_BUILD_DIR = 'tmp/records';

export function buildDir(env = process.env) {
  const value = String(env.CIVGRAPH_BUILD_DIR || '').trim() || DEFAULT_BUILD_DIR;
  return value === 'legacy' ? null : path.resolve(REPO_ROOT, value);
}

/** The constants for a given environment (the exports below are this for process.env). */
export function recordPaths(env = process.env) {
  const BUILD = buildDir(env);
  const at = (built, legacy) => (BUILD ? path.join(BUILD, built) : path.join(REPO_ROOT, legacy));
  return {
    BUILD_DIR: BUILD,
    ELECTION_BUNDLE_DIR: at('elections', 'render/metadata/elections-test2'),
    ELECTION_MANIFEST: at('elections-test2.json', 'render/metadata/elections-test2.json'),
    ELECTION_REPORT: at('elections-test2-report.json', 'render/metadata/elections-test2-report.json'),
    ELECTION_SUMMARY_DIR: at('elections-summaries', 'render/metadata/elections-test2-summaries'),
    PROVENANCE_FILE: at('election-provenance.json', 'data/database/election-provenance.json'),
    PROVENANCE_SHARD_DIR: at('election-provenance', 'render/metadata/election-provenance'),
    BROWSE_DIR: at('browse', 'data/browse'),
    GRAPH_DIR: at('graph', 'data/graph'),
    RECORDS_DB: path.join(REPO_ROOT, 'tmp/records/civgraph-records.sqlite'),
  };
}

const P = recordPaths();
export const BUILD_DIR = P.BUILD_DIR;
export const ELECTION_BUNDLE_DIR = P.ELECTION_BUNDLE_DIR;
export const ELECTION_MANIFEST = P.ELECTION_MANIFEST;
export const ELECTION_REPORT = P.ELECTION_REPORT;
export const ELECTION_SUMMARY_DIR = P.ELECTION_SUMMARY_DIR;
export const PROVENANCE_FILE = P.PROVENANCE_FILE;
export const PROVENANCE_SHARD_DIR = P.PROVENANCE_SHARD_DIR;
export const BROWSE_DIR = P.BROWSE_DIR;
export const GRAPH_DIR = P.GRAPH_DIR;
export const RECORDS_DB = P.RECORDS_DB;

/**
 * The file behind a public URL that a generator wrote, wherever this build writes it.
 * `/render/metadata/elections-test2/<key>.json` is a URL in the manifest (resultUrl); the
 * file is under ELECTION_BUNDLE_DIR. Anything not produced by the record build resolves
 * under the repository root, as before. Returns null for absolute http(s) URLs.
 */
export function localPathForUrl(url, paths = P) {
  if (!url || /^https?:\/\//i.test(url)) return null;
  const clean = String(url).split('?')[0].replace(/^\/+/, '');
  const prefixes = [
    ['render/metadata/elections-test2.json', paths.ELECTION_MANIFEST, true],
    ['render/metadata/elections-test2-report.json', paths.ELECTION_REPORT, true],
    ['render/metadata/elections-test2-summaries/', paths.ELECTION_SUMMARY_DIR],
    ['render/metadata/elections-test2/', paths.ELECTION_BUNDLE_DIR],
    ['render/metadata/election-provenance/', paths.PROVENANCE_SHARD_DIR],
    ['data/database/election-provenance.json', paths.PROVENANCE_FILE, true],
    ['data/browse/', paths.BROWSE_DIR],
    ['data/graph/', paths.GRAPH_DIR],
  ];
  for (const [prefix, target, exact] of prefixes) {
    if (exact ? clean === prefix : clean.startsWith(prefix)) {
      return exact ? target : path.join(target, ...clean.slice(prefix.length).split('/'));
    }
  }
  return path.join(REPO_ROOT, ...clean.split('/'));
}

/**
 * A repository-relative path as the record build places it: 'data/browse/elections.json'
 * is BROWSE_DIR/elections.json when CIVGRAPH_BUILD_DIR is set, and itself otherwise.
 */
export function recordPath(relative, paths = P) {
  return localPathForUrl(`/${String(relative).replace(/^\/+/, '')}`, paths);
}

/** A path relative to the repository root, with forward slashes, for messages. */
export function rel(p) {
  return path.relative(REPO_ROOT, p).split(path.sep).join('/');
}
