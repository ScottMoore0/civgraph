// The dry-run comparison for the publish chain's S3 scripts (stream rf9-s3, 13 Nov 2026): each
// script runs in a throwaway copy of the repository (its import closure and the fixture files a
// case writes), under register.mjs, so '@aws-sdk/client-s3' is the recording stand-in
// (client-s3.mjs) and nothing can reach the network. A run gives the S3 calls in order, the exit
// code, stdout and stderr (temporary paths and timings normalised) and any file the script wrote.
//
// The unit test publish-s3-dry-run.test.mjs runs every case on the working tree's scripts and
// compares with golden/<case>.json, which was recorded from main's scripts before they moved
// onto packages/storage/src/s3.mjs. From the command line, run this file with node:
//
//   harness.mjs --record <rev> [case ...]   write golden/ from <rev>'s scripts (<rev> 'worktree':
//                                           the working tree's, for a case whose change is intended)
//   harness.mjs --compare <rev> [case ...]  run <rev>'s and the working tree's, report differences
//
// Credentials: each run gets made-up R2_* values and none of the caller's R2_*, AWS_* or
// CLOUDFLARE_* variables; there is no .env.local in the copy, so none is ever read.
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, realpathSync, rmSync, writeFileSync, ftruncateSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { SITE } from '../../../packages/config/src/config.js';
import { FILES, PINNED, r2KeyOf } from '../../../scripts/build/elections-app/vendor.mjs';
import { OLD_PMTILES_PREFIX, renamePmtilesKey } from '../../../packages/core/src/layer-renames.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO = path.resolve(HERE, '..', '..', '..');
export const GOLDEN = path.join(HERE, 'golden');
const REGISTER = pathToFileURL(path.join(HERE, 'register.mjs')).href;

/** Made-up credentials; client-s3.mjs logs only whether a client got these. */
export const TEST_ENV = Object.freeze({
  R2_S3_ENDPOINT: 'http://127.0.0.1:9',
  R2_ACCESS_KEY_ID: 'test-access-key-id',
  R2_SECRET_ACCESS_KEY: 'test-secret-access-key',
});

const sha256 = (/** @type {string | Buffer} */ b) => createHash('sha256').update(b).digest('hex');

// ---------------------------------------------------------------------------------------------
// The copy of the repository a run uses.

const IMPORT = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(['"])(\.{1,2}\/[^'"]+)\1/g;

/**
 * A repository file's text at `rev`, or in the working tree when `rev` is null.
 * @param {string} rel
 * @param {string | null} rev
 */
function source(rel, rev) {
  if (rev === null) return readFileSync(path.join(REPO, rel), 'utf8');
  return execFileSync('git', ['show', `${rev}:${rel}`], { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
}

/**
 * `entry` and every module it imports by a relative path, at `rev`, as repository paths.
 * @param {string[]} entries
 * @param {string | null} rev
 * @returns {Map<string, string>}
 */
export function importClosure(entries, rev) {
  /** @type {Map<string, string>} */
  const files = new Map();
  const queue = [...entries];
  while (queue.length) {
    const rel = /** @type {string} */ (queue.shift());
    if (files.has(rel)) continue;
    let text;
    try { text = source(rel, rev); } catch { continue; }  // a JSDoc type import of a file the revision lacks
    files.set(rel, text);
    for (const m of text.matchAll(IMPORT)) {
      const next = path.posix.normalize(path.posix.join(path.posix.dirname(rel), /** @type {string} */ (m[2])));
      if (!files.has(next)) queue.push(next);
    }
  }
  return files;
}

/** The fixture helpers a case's setup gets. */
function fixtureRoot() {
  const root = realpathSync.native(mkdtempSync(path.join(os.tmpdir(), 'civgraph-s3-fake-')));
  const abs = (/** @type {string} */ rel) => path.join(root, ...rel.split('/'));
  return {
    root,
    abs,
    /** @param {string} rel @param {string | Buffer} content */
    write(rel, content) {
      mkdirSync(path.dirname(abs(rel)), { recursive: true });
      writeFileSync(abs(rel), content);
    },
    /** A file of `bytes` zero bytes, made without writing them. @param {string} rel @param {number} bytes */
    big(rel, bytes) {
      mkdirSync(path.dirname(abs(rel)), { recursive: true });
      const fd = openSync(abs(rel), 'w');
      try { ftruncateSync(fd, bytes); } finally { closeSync(fd); }
    },
    /** @param {string[]} args */
    git(args) { execFileSync('git', ['-c', 'init.defaultBranch=main', '-c', 'core.autocrlf=false', ...args], { cwd: root, stdio: 'ignore' }); },
  };
}

/** The allowlist every copy carries: the gate's file format, with the prefixes the cases use. */
const ALLOWLIST = {
  schemaVersion: 1,
  prefixes: ['assets/thumbnails/', 'data/maps/', 'data/graph/', 'data/oireachtas/', 'data/elections-app/'].map((prefix) => ({ prefix, rationale: 'fixture' })),
};

// ---------------------------------------------------------------------------------------------
// Normalising a run's output, so two runs in different folders at different speeds compare.

/**
 * @param {string} text
 * @param {string} root
 */
export function normaliseOutput(text, root) {
  let out = text.replace(/\r\n/g, '\n');
  for (const form of [pathToFileURL(root).href, root, root.replace(/\\/g, '/')]) out = out.split(form).join('<root>');
  out = out.replace(/\\/g, '/');
  out = out.replace(/Done in [\d.]+s/g, 'Done in <secs>s').replace(/ [\d.]+\/s /g, ' <rate>/s ');
  if (/\nNode\.js v[\d.]+\s*$/.test(out)) {
    // An uncaught error: Node prints the throwing source line (which moved) and a stack (whose
    // frames moved). Keep the error itself and its properties.
    const lines = out.split('\n');
    const at = lines.findIndex((l) => /^(<root>|file:|node:).*:\d+$/.test(l));
    if (at >= 0) lines.splice(at, Math.max(1, lines.indexOf('', at) - at + 1));
    out = `${lines.filter((l) => !/^\s+at /.test(l) && !/^Node\.js v/.test(l)).join('\n').trim()}\n[uncaught]\n`;
  }
  return out;
}

// R2's old PMTiles prefix (data/maps/<test>/pmtiles/generated/, spelt here as the recorded runs
// spell it) holds a "test" segment, which check:dir-names counts as a reference to a repository
// folder. A recorded run writes that one segment as "<test>" (both sides of a comparison alike,
// and nothing else contains it), so the golden files add no such reference.
const OLD_PREFIX_RECORDED = OLD_PMTILES_PREFIX.replace(/\/test\//, '/<test>/');
/** @param {Run} run @returns {Run} */
const recorded = (run) => JSON.parse(JSON.stringify(run).split(OLD_PMTILES_PREFIX).join(OLD_PREFIX_RECORDED));

const VOLATILE = new Set(['generatedAt', 'finishedAt', 'retainOldUntil']);
/** @param {unknown} value */
const stripVolatile = (value) => JSON.parse(JSON.stringify(value, (k, v) => (VOLATILE.has(k) ? '<volatile>' : v)));

// ---------------------------------------------------------------------------------------------
// Running one case.

/**
 * @typedef {object} Fixture
 * @property {string} root
 * @property {(rel: string) => string} abs
 * @property {(rel: string, content: string | Buffer) => void} write
 * @property {(rel: string, bytes: number) => void} big
 * @property {(args: string[]) => void} git
 *
 * @typedef {object} Case
 * @property {string} id
 * @property {string} script            under scripts/publish/
 * @property {string[]} [args]
 * @property {boolean} [credentials]    false: no R2_* variables at all (default true)
 * @property {string[]} [extras]        repository files the script reads besides its imports
 * @property {(fx: Fixture) => (object | void)} [setup]  writes the fixture files; returns the bucket's state
 * @property {string[]} [files]         files the script writes, compared too
 *
 * @typedef {object} Run
 * @property {string} id
 * @property {number | null} exit
 * @property {string} stdout
 * @property {string} stderr
 * @property {object[]} calls
 * @property {Record<string, unknown>} files
 */

/**
 * Run a case on the scripts at `rev` (null: the working tree).
 * @param {Case} c
 * @param {{ rev?: string | null }} [options]
 * @returns {Run}
 */
export function runCase(c, { rev = null } = {}) {
  const fx = fixtureRoot();
  try {
    const script = `scripts/publish/${c.script}.mjs`;
    for (const [rel, text] of importClosure([script], rev)) fx.write(rel, text);
    for (const rel of c.extras || []) fx.write(rel, source(rel, rev));
    fx.write('data/database/r2-publication-allowlist.json', `${JSON.stringify(ALLOWLIST, null, 2)}\n`);
    const state = (c.setup && c.setup(fx)) || {};
    const stateFile = path.join(fx.root, '.s3-fake-state.json');
    const logFile = path.join(fx.root, '.s3-fake-log.jsonl');
    writeFileSync(stateFile, JSON.stringify(state));
    writeFileSync(logFile, '');
    /** @type {Record<string, string | undefined>} */
    const env = {};
    for (const [k, v] of Object.entries(process.env)) if (!/^(R2_|AWS_|CLOUDFLARE_|S3_FAKE_)/.test(k) && k !== 'NODE_OPTIONS') env[k] = v;
    Object.assign(env, c.credentials === false ? {} : TEST_ENV, { S3_FAKE_STATE: stateFile, S3_FAKE_LOG: logFile, NODE_NO_WARNINGS: '1' });
    const res = spawnSync(process.execPath, ['--import', REGISTER, fx.abs(script), ...(c.args || [])], {
      cwd: fx.root, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 120000,
    });
    if (res.error) throw res.error;
    const calls = readFileSync(logFile, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    /** @type {Record<string, unknown>} */
    const files = {};
    for (const rel of c.files || []) {
      const file = fx.abs(rel);
      files[rel] = existsSync(file) ? stripVolatile(JSON.parse(normaliseOutput(readFileSync(file, 'utf8'), fx.root))) : null;
    }
    return recorded({ id: c.id, exit: res.status, stdout: normaliseOutput(res.stdout, fx.root), stderr: normaliseOutput(res.stderr, fx.root), calls, files });
  } finally {
    rmSync(fx.root, { recursive: true, force: true, maxRetries: 5 });
  }
}

// ---------------------------------------------------------------------------------------------
// The cases. File and folder names are lower-case letters, digits, '-' and '.', so a directory
// walk lists them in the same order on Windows and Linux.

const fgb = (/** @type {string} */ name) => `fixture geometry ${name}\n`;

/** @type {Case[]} */
export const CASES = [];

// r2-upload-files: FlatGeobuf files to their keys, one PUT each.
CASES.push(
  { id: 'upload-files-usage', script: 'r2-upload-files', args: [] },
  { id: 'upload-files-not-fgb', script: 'r2-upload-files', args: ['a.fgb=data/maps/a.json'] },
  {
    id: 'upload-files-missing-local', script: 'r2-upload-files', args: ['a.fgb=data/maps/a.fgb', 'gone.fgb=data/maps/gone.fgb'],
    setup: (fx) => { fx.write('a.fgb', fgb('a')); },
  },
  {
    id: 'upload-files-dry-run', script: 'r2-upload-files', args: ['a.fgb=data/maps/a.fgb', 'b.fgb=/data/maps/b.fgb', '--dry-run'],
    setup: (fx) => { fx.write('a.fgb', fgb('a')); fx.write('b.fgb', fgb('bb')); },
  },
  {
    id: 'upload-files-send', script: 'r2-upload-files', args: ['a.fgb=data/maps/a.fgb', 'sub/b.fgb=/data/maps/b.fgb'],
    setup: (fx) => { fx.write('a.fgb', fgb('a')); fx.write('sub/b.fgb', fgb('bb')); return { objects: { 'data/maps/a.fgb': { body: 'old' } } }; },
  },
  {
    id: 'upload-files-no-credentials', script: 'r2-upload-files', args: ['a.fgb=data/maps/a.fgb'], credentials: false,
    setup: (fx) => { fx.write('a.fgb', fgb('a')); },
  },
);

// r2-orphans: list a prefix, keep the keys a pattern picks that are gone locally, delete with --delete.
/** @param {Fixture} fx */
function orphanFixture(fx) {
  fx.write('data/graph/indexes/shards/s-001.json', '{}');
  fx.write('data/graph/indexes/shards/s-003.json', '{}');
  /** @type {Record<string, { body: string }>} */
  const objects = {};
  for (const name of ['s-001.json', 's-001.json.br', 's-002.json', 's-002.json.br', 's-003.json.gz', 'other.json', 's-1234.json']) objects[`data/graph/indexes/shards/${name}`] = { body: name };
  for (let i = 10; i < 17; i += 1) objects[`data/graph/indexes/shards/s-0${i}.json`] = { body: String(i) };
  objects['data/graph/elsewhere/s-002.json'] = { body: 'outside the prefix' };
  return { pageSize: 4, objects };
}
const ORPHAN_ARGS = ['--prefix', 'data/graph/indexes/', '--match', 'shards/s-\\d{3}\\.json$'];
CASES.push(
  { id: 'orphans-usage', script: 'r2-orphans', args: ['--prefix', 'data/graph/'] },
  { id: 'orphans-list', script: 'r2-orphans', args: ORPHAN_ARGS, setup: orphanFixture },
  { id: 'orphans-delete', script: 'r2-orphans', args: [...ORPHAN_ARGS, '--delete'], setup: orphanFixture },
  {
    id: 'orphans-none', script: 'r2-orphans', args: [...ORPHAN_ARGS, '--delete'],
    setup: (fx) => { fx.write('data/graph/indexes/shards/s-001.json', '{}'); return { objects: { 'data/graph/indexes/shards/s-001.json': { body: 'x' } } }; },
  },
  {
    // More than one DeleteObjects request (1,000 keys each).
    id: 'orphans-delete-batches', script: 'r2-orphans', args: ['--prefix', 'data/graph/many/', '--match', '\\.json$', '--delete'],
    setup: () => {
      /** @type {Record<string, { size: number }>} */
      const objects = {};
      for (let i = 0; i < 2003; i += 1) objects[`data/graph/many/k-${String(i).padStart(5, '0')}.json`] = { size: i };
      return { pageSize: 1000, objects };
    },
  },
  {
    // Two keys the bucket refuses to delete (owner-approved change, 13 Nov 2026: each failure is
    // printed and counted, and the run exits 1); one error has no message.
    id: 'orphans-delete-fails', script: 'r2-orphans', args: [...ORPHAN_ARGS, '--delete'],
    setup: (fx) => ({
      ...orphanFixture(fx),
      deleteErrors: [
        { key: 'data/graph/indexes/shards/s-002.json.br', code: 'AccessDenied', message: 'Access Denied' },
        { key: 'data/graph/indexes/shards/s-014.json', code: 'InternalError', message: '' },
      ],
    }),
  },
  {
    // A refusal in the second of three DeleteObjects requests.
    id: 'orphans-delete-batches-fails', script: 'r2-orphans', args: ['--prefix', 'data/graph/many/', '--match', '\\.json$', '--delete'],
    setup: () => {
      /** @type {Record<string, { size: number }>} */
      const objects = {};
      for (let i = 0; i < 2003; i += 1) objects[`data/graph/many/k-${String(i).padStart(5, '0')}.json`] = { size: i };
      return { pageSize: 1000, objects, deleteErrors: [{ key: 'data/graph/many/k-01500.json', code: 'SlowDown', message: 'Reduce your request rate.' }] };
    },
  },
);

// elections-app-r2-upload: the vendored WebAssembly and the extracts, skipping what the bucket holds.
/** @param {Fixture} fx */
function electionsFixture(fx) {
  /** @type {Array<Record<string, unknown>>} */
  const files = [];
  /** @type {Record<string, string>} */
  const content = {};
  for (const f of FILES) {
    const body = `fixture ${f.to}\n`;
    fx.write(f.to, body);
    content[f.to] = body;
    files.push({ path: f.to, host: f.host, bytes: Buffer.byteLength(body), sha256: sha256(body), ...(f.host === 'r2' ? { r2Key: r2KeyOf(f.to) } : {}) });
  }
  const packages = Object.fromEntries(Object.entries(PINNED).map(([pkg, version]) => [pkg, { version }]));
  fx.write('src/libs/elections-app-vendor.json', JSON.stringify({ schemaVersion: 1, packages, files }, null, 1));
  const extracts = ['dail-0123456789ab.parquet', 'seanad-ba9876543210.parquet', 'turnout-000000000000.csv', 'index.json'];
  for (const name of extracts) fx.write(`site/apps/elections/extracts/${name}`, `fixture extract ${name}\n`);
  fx.write('site/apps/elections/extracts/manifest.json', JSON.stringify({ files: extracts.map((name) => ({ name })) }));
  fx.write('scripts/build/elections-app/data.mjs', "console.log('fixture: the extracts are current and publishable');\n");
  const wasm = /** @type {{ to: string }} */ (FILES.find((f) => f.host === 'r2'));
  const dail = 'site/apps/elections/extracts/dail-0123456789ab.parquet';
  const dailBody = readFileSync(fx.abs(dail));
  return {
    objects: {
      // Already there with the same SHA-256, size and Cache-Control: skipped.
      [r2KeyOf(wasm.to)]: { body: content[wasm.to], cacheControl: 'public, max-age=31536000, immutable', metadata: { sha256: sha256(/** @type {string} */ (content[wasm.to])) } },
      // Same content, a different Cache-Control: sent again.
      'data/elections-app/v1/extracts/dail-0123456789ab.parquet': { body: dailBody.toString(), cacheControl: 'public, max-age=60', metadata: { sha256: sha256(dailBody) } },
      // Different content: sent.
      'data/elections-app/v1/extracts/index.json': { body: 'old index', cacheControl: 'public, max-age=300, must-revalidate', metadata: { sha256: 'old' } },
    },
  };
}
const ELECTIONS_EXTRAS = ['scripts/build/elections-app/vendor-deps/duckdb-extensions.json'];
CASES.push(
  { id: 'elections-plan', script: 'elections-app-r2-upload', extras: ELECTIONS_EXTRAS, setup: electionsFixture },
  { id: 'elections-upload', script: 'elections-app-r2-upload', args: ['--upload'], extras: ELECTIONS_EXTRAS, setup: electionsFixture },
  {
    id: 'elections-head-denied', script: 'elections-app-r2-upload', args: ['--upload'], extras: ELECTIONS_EXTRAS,
    setup: (fx) => ({ ...electionsFixture(fx), fail: [{ op: 'HeadObject', key: 'data/elections-app/v1/extracts/seanad-ba9876543210.parquet', status: 403, name: 'AccessDenied' }] }),
  },
  {
    id: 'elections-put-fails', script: 'elections-app-r2-upload', args: ['--upload'], extras: ELECTIONS_EXTRAS,
    setup: (fx) => ({ ...electionsFixture(fx), fail: [{ op: 'PutObject', key: 'data/elections-app/v1/extracts/seanad-ba9876543210.parquet', status: 500 }] }),
  },
);

// r2-cache-control: HEAD each in-scope object, rewrite its metadata by a server-side copy.
/** @param {Fixture} _fx */
function cacheFixture(_fx) {
  const SET = 'public, max-age=3600, stale-while-revalidate=86400';
  /** @type {Record<string, Record<string, unknown>>} */
  const objects = {
    'data/maps/a.fgb': { body: 'a', contentType: 'application/octet-stream', cacheControl: SET },
    'data/maps/b.fgb': { body: 'b', contentType: 'application/octet-stream' },
    'data/maps/b.fgb.br': { body: 'b-br', contentType: 'application/octet-stream', contentEncoding: 'br', metadata: { source: 'b.fgb' } },
    'data/maps/c.fgb.gz': { body: 'c-gz', contentEncoding: 'gzip' },
    'data/maps/d.fgb': { body: 'd', contentType: 'application/octet-stream', cacheControl: 'public, max-age=86400' },
    'data/maps/denied.fgb': { body: 'x' },
    'data/maps/huge.fgb': { size: 6e9 },
    'data/maps/notes.json': { body: '{}', contentType: 'application/json' },
    'data/maps/shapes.geojson': { body: '{}' },
    'data/maps/README': { body: 'no extension' },
    'data/maps/tiles/1/0/0.png': { body: 'png' },
    'data/maps/tiles/1/0/1.png': { body: 'png' },
    'data/maps/tiles/1/1/0.png': { body: 'png' },
    'data/other/z.fgb': { body: 'outside the prefix' },
  };
  for (let i = 0; i < 30; i += 1) objects[`data/maps/n/n-${String(i).padStart(2, '0')}.fgb`] = { body: `n${i}`, contentType: 'application/octet-stream' };
  return { pageSize: 7, objects, fail: [{ op: 'HeadObject', key: 'data/maps/denied.fgb', times: 99, status: 403, name: 'Forbidden' }] };
}
CASES.push(
  { id: 'cache-control-dry-run', script: 'r2-cache-control', setup: cacheFixture },
  { id: 'cache-control-apply', script: 'r2-cache-control', args: ['--apply'], setup: cacheFixture },
  { id: 'cache-control-exclude-png', script: 'r2-cache-control', args: ['--exclude-ext', 'png', '--apply'], setup: cacheFixture },
  { id: 'cache-control-all-prefix', script: 'r2-cache-control', args: ['--ext', '*', '--prefix', 'data/maps/tiles/'], setup: cacheFixture },
  {
    id: 'cache-control-copy-fails', script: 'r2-cache-control', args: ['--ext', 'fgb', '--apply'],
    setup: (fx) => ({ ...cacheFixture(fx), fail: [{ op: 'CopyObject', key: 'data/maps/b.fgb', status: 500 }] }),
  },
);

// r2-copy-keys: server-side copies of PMTiles archives to their renamed keys.
const OLD = (/** @type {string} */ id) => `${OLD_PMTILES_PREFIX}${id}-vector-test.pmtiles`;
/** @param {Fixture} fx @param {{ approval?: boolean }} [options] */
function copyKeysFixture(fx, { approval = true } = {}) {
  const pairs = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => /** @type {{ from: string, to: string }} */ (renamePmtilesKey(OLD(id))));
  fx.write('tmp/r2-key-renames/pmtiles.json', JSON.stringify({
    schemaVersion: 1, kind: 'r2-key-renames', description: 'fixture', source: 'render/metadata/maps-test.json',
    generatedAt: '2026-11-13T00:00:00.000Z', retainOldUntil: '2027-11-13',
    approval: approval ? { date: '2026-11-13', note: 'fixture approval' } : null,
    pairs, notCovered: [],
  }, null, 2));
  const [a, b, c, , e, f] = pairs;
  // a and f: copied; b: already copied; c: the destination holds something else; d: no source;
  // e: too big for one CopyObject.
  return {
    objects: {
      [a.from]: { body: 'a archive', contentType: 'application/vnd.pmtiles', cacheControl: 'public, max-age=3600', metadata: { layer: 'a' } },
      [b.from]: { body: 'b archive' },
      [b.to]: { body: 'b archive' },
      [c.from]: { body: 'c archive' },
      [c.to]: { body: 'something else' },
      [e.from]: { size: 6 * 1024 ** 3 },
      [f.from]: { body: 'f archive' },
    },
  };
}
CASES.push(
  {
    id: 'copy-keys-plan', script: 'r2-copy-keys', args: ['plan'], files: ['tmp/r2-key-renames/pmtiles.json'],
    setup: (fx) => {
      fx.write('render/metadata/maps-test.json', JSON.stringify({ layers: [
        { id: 'a-vector-test', tileUrl: `${SITE.dataOrigin}/${OLD('a')}` },
        { id: 'a-alias-test', tileUrl: `${SITE.dataOrigin}/${OLD('a')}` },
        { id: 'b-vector-test', nested: { tileUrl: `${SITE.dataOrigin}/${OLD('b')}` } },
        { id: 'c-vector-test', tileUrl: '/render/pmtiles/generated/c-vector-test.pmtiles' },
      ] }));
    },
  },
  { id: 'copy-keys-usage', script: 'r2-copy-keys', args: ['move'] },
  { id: 'copy-keys-dry-run', script: 'r2-copy-keys', args: ['copy', '--manifest', 'tmp/r2-key-renames/pmtiles.json'], setup: (fx) => copyKeysFixture(fx) },
  {
    id: 'copy-keys-no-approval', script: 'r2-copy-keys', args: ['copy', '--manifest', 'tmp/r2-key-renames/pmtiles.json', '--apply'],
    setup: (fx) => copyKeysFixture(fx, { approval: false }),
  },
  {
    id: 'copy-keys-apply', script: 'r2-copy-keys', args: ['copy', '--manifest', 'tmp/r2-key-renames/pmtiles.json', '--apply'],
    files: ['tmp/r2-key-renames/pmtiles.receipt.json'], setup: (fx) => copyKeysFixture(fx),
  },
  { id: 'copy-keys-verify', script: 'r2-copy-keys', args: ['verify', '--manifest', 'tmp/r2-key-renames/pmtiles.json'], setup: (fx) => copyKeysFixture(fx) },
  {
    id: 'copy-keys-head-denied', script: 'r2-copy-keys', args: ['verify', '--manifest', 'tmp/r2-key-renames/pmtiles.json'],
    setup: (fx) => ({ ...copyKeysFixture(fx), fail: [{ op: 'HeadObject', key: OLD('b'), status: 403, name: 'Forbidden' }] }),
  },
  {
    id: 'copy-keys-no-credentials', script: 'r2-copy-keys', args: ['verify', '--manifest', 'tmp/r2-key-renames/pmtiles.json'], credentials: false,
    setup: (fx) => copyKeysFixture(fx),
  },
);

// r2-upload-manifest: a tree (or a manifest's subset) under a prefix; skip by size; retry; verify by listing.
/** @param {Fixture} fx */
function treeFixture(fx) {
  fx.write('tree/a.json', '{"a":1}');
  fx.write('tree/b.pdf', '%PDF fixture');
  fx.write('tree/c.txt', 'text');
  fx.write('tree/sub/d.xml', '<d/>');
  fx.write('tree/sub/e.csv', 'x,y\n1,2\n');
  fx.write('tree/sub/f.html', '<p>f</p>');
  fx.write('tree/sub/g.bin', Buffer.from([0, 1, 2, 3]));
  fx.write('tree/sub/same-size.txt', 'new!');
  return {
    pageSize: 3,
    objects: {
      'data/oireachtas/t/a.json': { body: '{"a":1}' },
      'data/oireachtas/t/sub/same-size.txt': { body: 'old!' },
      'data/oireachtas/t/sub/e.csv': { body: 'short' },
      'data/oireachtas/t/zz-remote-only.txt': { body: 'not local' },
    },
  };
}
const TREE = ['--dir', 'tree', '--prefix', 'data/oireachtas/t'];
CASES.push(
  { id: 'upload-manifest-usage', script: 'r2-upload-manifest', args: ['--prefix', 'data/oireachtas/t'] },
  { id: 'upload-manifest-no-credentials', script: 'r2-upload-manifest', args: TREE, credentials: false, setup: treeFixture },
  { id: 'upload-manifest-dry', script: 'r2-upload-manifest', args: [...TREE, '--dry'], setup: treeFixture },
  { id: 'upload-manifest-verify-only', script: 'r2-upload-manifest', args: [...TREE, '--verify-only'], setup: treeFixture },
  { id: 'upload-manifest-send', script: 'r2-upload-manifest', args: [...TREE, '--concurrency', '1'], setup: treeFixture },
  { id: 'upload-manifest-send-concurrent', script: 'r2-upload-manifest', args: TREE, setup: treeFixture },
  { id: 'upload-manifest-force', script: 'r2-upload-manifest', args: [...TREE, '--force', '--concurrency', '1'], setup: treeFixture },
  {
    id: 'upload-manifest-retry', script: 'r2-upload-manifest', args: [...TREE, '--concurrency', '1'],
    setup: (fx) => ({ ...treeFixture(fx), fail: [{ op: 'PutObject', key: 'data/oireachtas/t/b.pdf', times: 2 }] }),
  },
  {
    id: 'upload-manifest-gives-up', script: 'r2-upload-manifest', args: [...TREE, '--concurrency', '1'],
    setup: (fx) => ({ ...treeFixture(fx), fail: [{ op: 'PutObject', key: 'data/oireachtas/t/c.txt', times: 5, status: 503, name: 'SlowDown' }] }),
  },
  {
    // A manifest subset, one entry missing locally, and a file over the 128 MiB buffer limit, which streams.
    id: 'upload-manifest-subset-stream', script: 'r2-upload-manifest', args: ['--manifest', 'subset.json', '--prefix', 'data/oireachtas/big/', '--concurrency', '1'],
    setup: (fx) => {
      fx.write('tree/small.json', '{}');
      fx.big('tree/huge.pdf', 128 * 1024 * 1024 + 1);
      fx.write('subset.json', JSON.stringify([
        { local: fx.abs('tree/small.json'), rel: 'small.json' },
        { local: fx.abs('tree/huge.pdf'), rel: 'scans/huge.pdf' },
        { local: fx.abs('tree/absent.pdf'), rel: 'absent.pdf' },
      ]));
      return {};
    },
  },
  { id: 'upload-manifest-gate', script: 'r2-upload-manifest', args: ['--dir', 'tree', '--prefix', 'private/t'], setup: treeFixture },
);

// r2-upload-tree: a tile or thumbnail tree, with Cache-Control; --check, --changed-only, --tracked-only.
/** @param {Fixture} fx */
function thumbFixture(fx) {
  for (const name of ['a.png', 'b.webp', 'c.jpg', 'd.jpeg', 'e.pdf', 'f.json', 'g.bin', 'sub/h.png']) fx.write(`thumbs/${name}`, `thumb ${name}\n`);
  return {
    pageSize: 3,
    objects: {
      'assets/thumbnails/a.png': { body: 'thumb a.png\n' },
      'assets/thumbnails/b.webp': { body: 'an older b' },
      'assets/thumbnails/sub/h.png': { body: 'thumb sub/h.png\n' },
    },
  };
}
const THUMBS = ['thumbs', 'assets/thumbnails'];
CASES.push(
  { id: 'upload-tree-usage', script: 'r2-upload-tree', args: ['thumbs'] },
  { id: 'upload-tree-dry-run', script: 'r2-upload-tree', args: [...THUMBS, '--dry-run'], setup: thumbFixture },
  { id: 'upload-tree-send', script: 'r2-upload-tree', args: [...THUMBS, '--concurrency=1'], setup: thumbFixture },
  { id: 'upload-tree-send-concurrent', script: 'r2-upload-tree', args: THUMBS, setup: thumbFixture },
  {
    id: 'upload-tree-check', script: 'r2-upload-tree', args: [...THUMBS, '--check', '--concurrency=1'],
    setup: (fx) => ({ ...thumbFixture(fx), fail: [{ op: 'HeadObject', key: 'assets/thumbnails/c.jpg', status: 403, name: 'Forbidden' }] }),
  },
  { id: 'upload-tree-changed-only', script: 'r2-upload-tree', args: [...THUMBS, '--changed-only', '--concurrency=1'], setup: thumbFixture },
  {
    id: 'upload-tree-tracked-only', script: 'r2-upload-tree', args: [...THUMBS, '--tracked-only', '--concurrency=2'],
    setup: (fx) => { const state = thumbFixture(fx); fx.git(['init', '-q']); fx.git(['add', 'thumbs/a.png', 'thumbs/sub/h.png', 'thumbs/e.pdf']); return state; },
  },
  {
    id: 'upload-tree-put-fails', script: 'r2-upload-tree', args: [...THUMBS, '--concurrency=1'],
    setup: (fx) => ({ ...thumbFixture(fx), fail: [{ op: 'PutObject', key: 'assets/thumbnails/d.jpeg', status: 500 }] }),
  },
  { id: 'upload-tree-gate', script: 'r2-upload-tree', args: ['thumbs', 'private/thumbs', '--concurrency=1'], setup: thumbFixture },
  { id: 'upload-tree-no-credentials', script: 'r2-upload-tree', args: THUMBS, credentials: false, setup: thumbFixture },
);

// verify-r2-parity: everything the registry and the chunk indexes name under a served prefix is in the bucket.
/** @param {Fixture} fx */
function parityFixture(fx) {
  fx.write('functions/data/maps/[[path]].js', 'export const onRequest = (context) => context.env.MAPS_BUCKET.get(key);\n');
  fx.write('functions/data/pages/[[path]].js', 'export const onRequest = () => new Response(null);\n');
  fx.write('data/database/maps.json', JSON.stringify({ maps: [
    { id: 'a', fgb: `${SITE.dataOrigin}/data/maps/a.fgb`, sourceNotes: 'data/maps/prose.fgb' },
    { id: 'b', files: [{ url: '/data/maps/b%20b.fgb?v=3#x' }], xyz: 'data/maps/tiles/{z}/{x}/{y}.png' },
    { id: 'c', image: 'data/maps/c.png', pmtiles: `${SITE.dataOrigin}/data/maps/c.pmtiles` },
    { id: 'd', csv: 'data/other/d.csv' },
  ] }));
  fx.write('data/maps/x/x-chunks.json', JSON.stringify({ chunks: [{ file: 'data/maps/x/part-1.fgb', zoomFiles: { 5: 'data/maps/x/part-1-z5.fgb' } }, { file: 'data/maps/x/part-2.fgb' }] }));
  fx.write('data/maps/x/part-2.fgb', 'local copy');
  return {
    pageSize: 2,
    objects: Object.fromEntries(['data/maps/a.fgb', 'data/maps/b b.fgb', 'data/maps/c.png', 'data/maps/c.pmtiles', 'data/maps/x/x-chunks.json', 'data/maps/x/part-1.fgb', 'data/maps/x/part-1-z5.fgb', 'data/maps/x/part-2.fgb', 'data/maps/unreferenced.fgb'].map((k) => [k, { body: k }])),
  };
}
CASES.push(
  { id: 'parity-no-prefixes', script: 'verify-r2-parity', setup: (fx) => { fx.write('functions/index.js', ''); } },
  { id: 'parity-no-credentials', script: 'verify-r2-parity', credentials: false, setup: parityFixture },
  { id: 'parity-pass', script: 'verify-r2-parity', args: ['--json', '--list-orphans'], setup: parityFixture },
  {
    id: 'parity-missing', script: 'verify-r2-parity', args: ['--list-orphans'],
    setup: (fx) => {
      const state = parityFixture(fx);
      delete state.objects['data/maps/x/part-2.fgb'];
      delete state.objects['data/maps/b b.fgb'];
      return state;
    },
  },
  {
    id: 'parity-list-denied', script: 'verify-r2-parity',
    setup: (fx) => ({ ...parityFixture(fx), fail: [{ op: 'ListObjectsV2', key: undefined, status: 403, name: 'AccessDenied' }] }),
  },
);

// ---------------------------------------------------------------------------------------------
// Golden files and the command line.

/** @param {string} id */
export const goldenFile = (id) => path.join(GOLDEN, `${id}.json`);

/** @param {Run} run */
export const goldenText = (run) => `${JSON.stringify(run, null, 1)}\n`;

/**
 * Where two runs differ, as short lines (empty when they are the same).
 * @param {Run} a
 * @param {Run} b
 */
export function differences(a, b) {
  const out = [];
  if (a.exit !== b.exit) out.push(`exit ${a.exit} vs ${b.exit}`);
  if (a.stdout !== b.stdout) out.push('stdout differs');
  if (a.stderr !== b.stderr) out.push('stderr differs');
  if (!isDeepStrictEqual(a.files, b.files)) out.push('written files differ');
  if (a.calls.length !== b.calls.length) out.push(`${a.calls.length} vs ${b.calls.length} calls`);
  const n = Math.min(a.calls.length, b.calls.length);
  for (let i = 0; i < n; i += 1) {
    if (!isDeepStrictEqual(a.calls[i], b.calls[i])) { out.push(`call ${i}: ${JSON.stringify(a.calls[i])} vs ${JSON.stringify(b.calls[i])}`); break; }
  }
  return out;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [mode, rev, ...ids] = process.argv.slice(2);
  if ((mode !== '--record' && mode !== '--compare') || !rev) {
    console.error(`Usage: node ${path.relative(process.cwd(), fileURLToPath(import.meta.url))} (--record | --compare) <rev> [case ...]`);
    process.exit(2);
  }
  const chosen = ids.length ? CASES.filter((c) => ids.includes(c.id)) : CASES;
  mkdirSync(GOLDEN, { recursive: true });
  let differing = 0;
  for (const c of chosen) {
    const before = runCase(c, { rev: rev === 'worktree' ? null : rev });
    if (mode === '--record') {
      writeFileSync(goldenFile(c.id), goldenText(before));
      console.log(`recorded ${c.id}: exit ${before.exit}, ${before.calls.length} calls`);
      continue;
    }
    const after = runCase(c);
    const diff = differences(before, after);
    if (diff.length) differing += 1;
    console.log(`${diff.length ? 'DIFFERENT' : 'identical'} ${c.id}: exit ${after.exit}, ${after.calls.length} calls${diff.length ? `\n    ${diff.join('\n    ')}` : ''}`);
  }
  if (mode === '--compare') console.log(`\n${chosen.length - differing} of ${chosen.length} cases identical.`);
  process.exit(differing ? 1 : 0);
}
