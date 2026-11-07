/**
 * The review guards of the intake framework spec (site-restructure intake-framework-spec.md
 * section 4) that the first version lacked:
 *
 * - rights: a source whose rights are `unknown` fails validate (ask the owner instead);
 * - personal data: the manifest says whether the batch holds any, and how it is handled; a
 *   staged JSON or CSV with address-like fields fails when it does (raw addresses never
 *   reach the public repository: they go to the smallest census unit), and warns when the
 *   manifest says it does not, in case they are people's addresses after all;
 * - no email address in preparedBy (owner identifiers stay out of everything we write);
 * - a lock: `validate --lock` records the SHA-256 of every batch input in state/SHA256SUMS,
 *   and every later command refuses to run if one has changed since review;
 * - state records (state/<command>.json) and the drift of HEAD from the batch's base commit,
 *   which `status` reports.
 */
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { batchPath, toPosix } from './batch.mjs';

/** @typedef {import('./batch.mjs').Batch} Batch */

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const ADDRESS_FIELD = /^(?:address|addresses|agent_?address|home_?address|street|street_?address|postcode|post_?code|postal_?code|eircode)$/i;
const SCANNED_EXTENSIONS = new Set(['.json', '.geojson', '.csv']);
const MAX_SCAN_BYTES = 50 * 1024 * 1024;

/** @param {string} root @returns {string[]} */
function walkFiles(root) {
  if (!existsSync(root)) return [];
  if (!statSync(root).isDirectory()) return [root];
  /** @type {string[]} */
  const out = [];
  for (const name of readdirSync(root).sort()) out.push(...walkFiles(path.join(root, name)));
  return out;
}

/**
 * Every batch file a command reads, absolute, sorted, de-duplicated.
 * @param {Batch} batch
 */
export function batchInputs(batch) {
  /** @type {Set<string>} */
  const files = new Set();
  /** @param {string | undefined} p */
  const add = (p) => { if (p) for (const f of walkFiles(batchPath(batch, p))) files.add(path.resolve(f)); };
  for (const op of batch.manifest.operations || []) {
    switch (op.type) {
      case 'copy-files': for (const f of op.files || []) add(f.from); break;
      case 'maps-json-patch': add(op.entries); add(op.classes); add(op.edits); break;
      case 'election-sources': add(op.fromDir); add(op.excludeRounds); break;
      case 'corrections': add(op.records); break;
      case 'r2-fgb': add(op.pairsFile); break;
      case 'r2-tree': add(op.manifest); break;
      case 'r2-pmtiles':
      case 'switch-to-cdn': add(op.idsFile); break;
      default: break;
    }
  }
  return [...files].sort();
}

/**
 * The files that land in the repository (the ones a personal-data scan must read).
 * @param {Batch} batch
 */
function repositoryInputs(batch) {
  /** @type {Set<string>} */
  const files = new Set();
  /** @param {string | undefined} p */
  const add = (p) => { if (p) for (const f of walkFiles(batchPath(batch, p))) files.add(path.resolve(f)); };
  for (const op of batch.manifest.operations || []) {
    if (op.type === 'copy-files') for (const f of op.files || []) add(f.from);
    if (op.type === 'maps-json-patch') { add(op.entries); add(op.classes); add(op.edits); }
    if (op.type === 'election-sources') add(op.fromDir);
    if (op.type === 'corrections') add(op.records);
  }
  return [...files].sort();
}

/** @param {unknown} value @param {Set<string>} [out] */
function jsonFieldNames(value, out = new Set()) {
  if (Array.isArray(value)) for (const v of value) jsonFieldNames(v, out);
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) { out.add(k); jsonFieldNames(v, out); }
  }
  return out;
}

/**
 * Address-like field names in JSON keys or a CSV header: [{ file, field }].
 * @param {string[]} files
 */
export function scanAddressFields(files) {
  /** @type {{ file: string, field: string }[]} */
  const hits = [];
  for (const file of files) {
    const ext = path.extname(file).toLowerCase();
    if (!SCANNED_EXTENSIONS.has(ext) || statSync(file).size > MAX_SCAN_BYTES) continue;
    const text = readFileSync(file, 'utf8');
    let names;
    if (ext === '.csv') {
      names = (text.split(/\r?\n/, 1)[0] || '').split(',').map((s) => s.trim().replace(/^"|"$/g, ''));
    } else {
      try { names = [...jsonFieldNames(JSON.parse(text))]; } catch { continue; }
    }
    for (const field of names) if (ADDRESS_FIELD.test(field)) hits.push({ file, field });
  }
  return hits;
}

/**
 * Rights, personal data and identifiers. Returns { errors, warnings }.
 * @param {Batch} batch
 */
export function reviewPolicy(batch) {
  /** @type {string[]} */
  const errors = [];
  /** @type {string[]} */
  const warnings = [];
  const m = batch.manifest;
  for (const s of m.sources || []) {
    if (s.rights === 'unknown') errors.push(`source ${s.id}: rights unknown; ask the owner before taking it in`);
    else if (!s.rights && !s.licence) warnings.push(`source ${s.id}: no rights or licence given`);
  }
  if (m.preparedBy && EMAIL.test(m.preparedBy)) errors.push('preparedBy holds an email address; use an agent or session label');
  const pd = m.personalData || {};
  if (pd.contains && (!pd.handling || pd.handling === 'none')) errors.push('personalData.contains is true, so personalData.handling must say how it is handled');
  if (!pd.contains && pd.handling && pd.handling !== 'none') warnings.push(`personalData.handling is ${pd.handling} but contains is false`);
  /** @param {string} f */
  const rel = (f) => toPosix(path.relative(batch.dir, f));
  for (const hit of scanAddressFields(repositoryInputs(batch))) {
    const where = `${rel(hit.file)} has an address-like field "${hit.field}"`;
    if (pd.contains) errors.push(`${where}: raw addresses never go into the repository; reduce them to the smallest census unit (DZ/SA/OA, else ward/DED) first`);
    else warnings.push(`${where}: if these are people's addresses, set personalData.contains and reduce them to the census unit`);
  }
  return { errors, warnings };
}

/** @param {Batch} batch */
export const stateDir = (batch) => path.join(batch.dir, 'state');
/** @param {Batch} batch */
const lockPath = (batch) => path.join(stateDir(batch), 'SHA256SUMS');
/** @param {string} file */
const sha256 = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');

/** @param {Batch} batch */
function lockEntries(batch) {
  /** @type {[string, string][]} */
  const entries = [[batch.manifestPath, sha256(batch.manifestPath)]];
  for (const f of batchInputs(batch)) entries.push([f, sha256(f)]);
  /** @param {string} f */
  const label = (f) => {
    const r = path.relative(batch.dir, f);
    return r.startsWith('..') || path.isAbsolute(r) ? toPosix(f) : toPosix(r);
  };
  return entries.map(([f, h]) => `${h}  ${label(f)}`);
}

/**
 * Record what was reviewed.
 * @param {Batch} batch
 */
export function writeLock(batch) {
  mkdirSync(stateDir(batch), { recursive: true });
  const lines = lockEntries(batch);
  writeFileSync(lockPath(batch), `${lines.join('\n')}\n`);
  return lines.length;
}

/**
 * Problems with the lock: [] when there is none or nothing changed.
 * @param {Batch} batch
 * @returns {string[]}
 */
export function checkLock(batch) {
  if (!existsSync(lockPath(batch))) return [];
  const recorded = new Map(readFileSync(lockPath(batch), 'utf8').split(/\r?\n/).filter(Boolean).map((l) => {
    const i = l.indexOf('  ');
    return [l.slice(i + 2), l.slice(0, i)];
  }));
  const now = new Map(lockEntries(batch).map((l) => { const i = l.indexOf('  '); return [l.slice(i + 2), l.slice(0, i)]; }));
  /** @type {string[]} */
  const problems = [];
  for (const [file, hash] of now) {
    if (!recorded.has(file)) problems.push(`${file} was added after review`);
    else if (recorded.get(file) !== hash) problems.push(`${file} changed after review`);
  }
  for (const file of recorded.keys()) if (!now.has(file)) problems.push(`${file} was removed after review`);
  return problems;
}

/** @param {string} repo @param {string[]} args @returns {string | null} */
export function git(repo, args) {
  const res = spawnSync('git', args, { cwd: repo, encoding: 'utf8' });
  return res.status === 0 ? res.stdout.trim() : null;
}

/**
 * A record of one command's run, for `status`.
 * @param {Batch} batch
 * @param {string} command
 * @param {Record<string, unknown>} record
 */
export function writeState(batch, command, record) {
  mkdirSync(stateDir(batch), { recursive: true });
  const file = path.join(stateDir(batch), `${command}.json`);
  writeFileSync(file, `${JSON.stringify({ command, at: new Date().toISOString(), head: git(batch.repo, ['rev-parse', '--short=10', 'HEAD']), baseCommit: batch.manifest.repo?.baseCommit || null, ...record }, null, 2)}\n`);
  return file;
}

/** @param {Batch} batch */
export function readStates(batch) {
  const dir = stateDir(batch);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith('.json')).sort().map((f) => {
    try { return JSON.parse(readFileSync(path.join(dir, f), 'utf8')); } catch { return { command: f, unreadable: true }; }
  });
}

/**
 * How far HEAD has moved from the batch's base commit, and whether its targets changed.
 * @param {Batch} batch
 * @param {string[]} [targets]
 */
export function drift(batch, targets = []) {
  const base = batch.manifest.repo?.baseCommit;
  const head = git(batch.repo, ['rev-parse', '--short=10', 'HEAD']);
  if (!base) return { base: null, head, commits: null, changedTargets: [] };
  const commits = git(batch.repo, ['rev-list', '--count', `${base}..HEAD`]);
  const changed = targets.length ? git(batch.repo, ['diff', '--name-only', base, 'HEAD', '--', ...targets]) : '';
  return { base, head, commits: commits === null ? null : Number(commits), changedTargets: changed ? changed.split(/\r?\n/).filter(Boolean) : [], unknownBase: commits === null };
}

/**
 * A starting batch.json for `init`.
 * @param {{ id: string, title: string, baseCommit?: string, today?: Date }} options
 */
export function scaffoldManifest({ id, title, baseCommit, today = new Date() }) {
  return {
    schemaVersion: 1,
    id,
    title,
    date: today.toISOString().slice(0, 10),
    status: 'draft',
    summary: '',
    preparedBy: '',
    repo: { baseCommit: baseCommit || '' },
    sources: [],
    personalData: { contains: false, handling: 'none' },
    operations: [],
    expectedChecks: { beforeUpload: [], afterPostUpload: [] },
  };
}
