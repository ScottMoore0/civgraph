/**
 * Loading and validating an intake batch (batch.json). See docs/intake.md.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateAgainstSchema } from './schema.mjs';
import { reviewPolicy } from './review.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const SCHEMA_PATH = path.resolve(HERE, '..', '..', '..', 'scripts', 'intake', 'batch.schema.json');
export const DEFAULT_REPO = path.resolve(HERE, '..', '..', '..');

export const STAGE_TYPES = new Set(['copy-files', 'maps-json-patch', 'election-sources', 'corrections']);
export const UPLOAD_TYPES = new Set(['r2-fgb', 'r2-tree', 'r2-cache-control', 'r2-pmtiles', 'stamp-cache-tokens']);
export const POST_UPLOAD_TYPES = new Set(['switch-to-cdn', 'thumbnails']);

/** @param {Operation} op */
export function phaseOf(op) {
  if (op.type === 'command') return op.phase;
  if (STAGE_TYPES.has(op.type)) return 'stage';
  if (UPLOAD_TYPES.has(op.type)) return 'upload';
  if (POST_UPLOAD_TYPES.has(op.type)) return 'post-upload';
  return 'unknown';
}

/**
 * A parsed batch.json. Its shape is scripts/intake/batch.schema.json, checked at run time by
 * validateBatch.
 * @typedef {import('../../types/index.js').IntakeManifest} Manifest
 */
/**
 * One operation of batch.json; which fields it has depends on its `type` (see the schema).
 * @typedef {import('../../types/index.js').IntakeOperation} Operation
 */
/**
 * An operation of the named type(s).
 * @template {Operation['type']} T
 * @typedef {import('../../types/index.js').IntakeOperationOf<T>} OperationOf
 */
/** @typedef {{ dir: string, manifestPath: string, repo: string, manifest: Manifest }} Batch */
/** @typedef {{ local: string, rel: string | null, repoRel: string | null }} TreeEntry */

/** Never list or rewrite these whole: data/maps/ alone is 1.2 million objects. */
export const FORBIDDEN_PREFIXES = new Set(['', 'data/', 'data/maps/']);

/**
 * @param {string} batchDir   folder holding the batch's data (and, by default, batch.json)
 * @param {object} [options]
 * @param {string} [options.manifest]  batch.json elsewhere (docs/intake-examples/ point at past batch folders)
 * @param {string} [options.repo]      repository root the batch applies to
 * @returns {Batch}
 */
export function loadBatch(batchDir, { manifest, repo } = {}) {
  const dir = path.resolve(batchDir);
  const manifestPath = path.resolve(manifest || path.join(dir, 'batch.json'));
  if (!existsSync(manifestPath)) throw new Error(`No batch manifest at ${manifestPath}`);
  const raw = readFileSync(manifestPath, 'utf8');
  let data;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    throw new Error(`${manifestPath} is not valid JSON: ${/** @type {Error} */ (err).message}`);
  }
  return { dir, manifestPath, repo: path.resolve(repo || DEFAULT_REPO), manifest: data };
}

/** @param {Batch} batch @param {string} p */
export const batchPath = (batch, p) => (path.isAbsolute(p) ? p : path.resolve(batch.dir, p));
/** @param {Batch} batch @param {string} p */
export const repoPath = (batch, p) => path.resolve(batch.repo, p);
/** @param {string} p */
export const toPosix = (p) => p.split(path.sep).join('/');

/** @param {string} file */
export function sha256File(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

/** @param {string} file @returns {unknown} the parsed JSON: the caller says which shape it reads */
export function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

/** @param {string} text */
function splitList(text) {
  return text.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
}

/** Layer ids of an r2-pmtiles / switch-to-cdn op: inline, from a file, or from another op. */
/**
 * @param {Batch} batch
 * @param {OperationOf<'r2-pmtiles' | 'switch-to-cdn'>} op
 * @param {Set<string>} [seen]
 * @returns {string[]}
 */
export function resolveIds(batch, op, seen = new Set()) {
  if (op.ids) return op.ids;
  if (op.idsFile) return splitList(readFileSync(batchPath(batch, op.idsFile), 'utf8'));
  if (op.idsFrom) {
    if (seen.has(op.id)) throw new Error(`idsFrom cycle at ${op.id}`);
    seen.add(op.id);
    const from = batch.manifest.operations.find((/** @type {Operation} */ o) => o.id === op.idsFrom);
    if (!from) throw new Error(`${op.id}: idsFrom ${op.idsFrom} names no operation`);
    // validateBatch: idsFrom names an r2-pmtiles operation
    return resolveIds(batch, /** @type {OperationOf<'r2-pmtiles'>} */ (from), seen);
  }
  return [];
}

/** FGB pairs of an r2-fgb op: inline, or "local=key" lines as the hand-written batches kept them. */
/**
 * @param {Batch} batch
 * @param {OperationOf<'r2-fgb'>} op
 * @returns {{ file: string, key: string }[]}
 */
export function resolveFgbPairs(batch, op) {
  if (op.pairs) return op.pairs.map((/** @type {{ file: string, key: string }} */ p) => ({ file: p.file, key: p.key.replace(/^\/+/, '') }));
  if (!op.pairsFile) return [];
  return readFileSync(batchPath(batch, op.pairsFile), 'utf8')
    .split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
    .map((line) => {
      const i = line.indexOf('=');
      if (i <= 0) throw new Error(`${op.pairsFile}: not a <file>=<key> pair: ${line}`);
      return { file: line.slice(0, i), key: line.slice(i + 1).replace(/^\/+/, '') };
    });
}

/**
 * The [{local, rel}] list an r2-tree op sends. `files` are repo-relative and must sit under the
 * prefix; `manifest` is an upload-tree-r2 manifest already on disk; `dir` is listed now if it exists.
 */
/**
 * @param {Batch} batch
 * @param {OperationOf<'r2-tree'>} op
 * @returns {TreeEntry[]}
 */
export function resolveTreeEntries(batch, op) {
  if (op.files) {
    return op.files.map((/** @type {string} */ f) => ({
      local: toPosix(repoPath(batch, f)),
      rel: f.startsWith(op.prefix) ? f.slice(op.prefix.length) : null,
      repoRel: f,
    }));
  }
  if (op.manifest) {
    return /** @type {Array<{ local: string, rel: string }>} */ (readJson(batchPath(batch, op.manifest))).map((e) => ({ local: e.local, rel: e.rel, repoRel: null }));
  }
  if (op.dir) {
    const root = repoPath(batch, op.dir);
    if (!existsSync(root)) return [];
    /** @type {TreeEntry[]} */
    const out = [];
    /** @param {string} d */
    const walk = (d) => {
      for (const name of readdirSync(d)) {
        const full = path.join(d, name);
        if (statSync(full).isDirectory()) walk(full);
        else out.push({ local: toPosix(full), rel: toPosix(path.relative(root, full)), repoRel: toPosix(path.relative(batch.repo, full)) });
      }
    };
    walk(root);
    return out;
  }
  return [];
}

/** @param {string} layerId */
export const pmtilesKey = (layerId) => `data/maps/test/pmtiles/generated/${layerId}.pmtiles`;

/** Every R2 key the batch writes (for the publication gate and the plan). */
/** @param {Batch} batch @returns {string[]} */
export function r2Keys(batch) {
  /** @type {string[]} */
  const keys = [];
  for (const op of batch.manifest.operations || []) {
    if (op.type === 'r2-fgb') keys.push(...resolveFgbPairs(batch, op).map((p) => p.key));
    if (op.type === 'r2-tree') keys.push(...resolveTreeEntries(batch, op).filter((e) => e.rel).map((e) => op.prefix + e.rel));
    if (op.type === 'r2-pmtiles') keys.push(...resolveIds(batch, op).map(pmtilesKey));
  }
  return keys;
}

/** @type {[RegExp, string][]} */
const SECRET_PATTERNS = [
  [/R2_(?:SECRET_ACCESS_KEY|ACCESS_KEY_ID)\s*[=:]\s*['"]?[A-Za-z0-9/+]{16,}/, 'an R2 key assignment'],
  [/CLOUDFLARE_API_TOKEN\s*[=:]\s*['"]?[A-Za-z0-9_-]{20,}/, 'a Cloudflare API token'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'a private key'],
  [/\bAKIA[0-9A-Z]{16}\b/, 'an AWS-style access key id'],
  [/\b(?:api[_-]?key|secret|access[_-]?token|password)\b["']?\s*[=:]\s*["'][A-Za-z0-9_\-/+]{20,}["']/i, 'a credential assignment'],
  [/\bBearer\s+[A-Za-z0-9._-]{24,}/, 'a bearer token'],
];
const TEXT_EXTENSIONS = new Set(['.json', '.txt', '.md', '.ps1', '.py', '.mjs', '.js', '.sh', '.csv', '.yml', '.yaml', '.toml', '.ini', '.cfg', '.env', '']);
const SKIP_DIRS = new Set(['node_modules', '.git', '__pycache__']);
const SECRET_FILES = /^(?:\.env(?:\..*)?|.*\.pem|.*\.key|credentials(?:\.json)?)$/i;

/** Credentials never belong in a batch folder or manifest. */
/**
 * @param {string[]} paths
 * @param {{ maxBytes?: number }} [options]
 * @returns {string[]}
 */
export function scanSecrets(paths, { maxBytes = 5e6 } = {}) {
  /** @type {string[]} */
  const hits = [];
  /** @param {string} file */
  const visit = (file) => {
    const st = statSync(file);
    if (st.isDirectory()) {
      if (SKIP_DIRS.has(path.basename(file))) return;
      for (const name of readdirSync(file)) visit(path.join(file, name));
      return;
    }
    const base = path.basename(file);
    if (SECRET_FILES.test(base)) { hits.push(`${file}: a credentials file does not belong in a batch`); return; }
    if (!TEXT_EXTENSIONS.has(path.extname(base).toLowerCase()) || st.size > maxBytes) return;
    const text = readFileSync(file, 'utf8');
    for (const [re, what] of SECRET_PATTERNS) if (re.test(text)) hits.push(`${file}: looks like ${what}`);
  };
  for (const p of paths) if (existsSync(p)) visit(p);
  return hits;
}

/** @param {OperationOf<'command'>} op @param {Batch} batch @returns {string[]} */
function checkCommandArgv(op, batch) {
  /** @type {string[]} */
  const errors = [];
  /** @type {string[]} */
  const [prog, ...rest] = op.argv;
  const joined = op.argv.join(' ');
  if (/\.claude[\\/]+publish/.test(joined)) errors.push(`${op.id}: nothing under .claude/publish/ runs from an intake batch (publishing needs the owner's approval)`);
  if (/[;&|`$<>]/.test(joined)) errors.push(`${op.id}: shell metacharacters are not allowed in argv`);
  if (/@[a-z0-9-]+\.[a-z]{2,}/i.test(joined)) errors.push(`${op.id}: argv carries what looks like an email address; never send owner identifiers to outside services`);
  if (prog === 'node' || prog === 'python') {
    const script = rest.find((a) => !a.startsWith('-'));
    const inRepo = script && /^scripts\//.test(script.replace(/\\/g, '/'));
    const inBatch = script && existsSync(batchPath(batch, script)) && path.resolve(batchPath(batch, script)).startsWith(batch.dir);
    if (!inRepo && !inBatch) errors.push(`${op.id}: ${prog} must run a script under scripts/ or in the batch folder (got ${script || 'none'})`);
    else if (inRepo && !existsSync(repoPath(batch, script))) errors.push(`${op.id}: ${script} does not exist in the repository`);
  } else if (prog === 'npm') {
    if (rest[0] !== 'run' || !rest[1]) errors.push(`${op.id}: npm commands must be "npm run <script>"`);
  } else {
    errors.push(`${op.id}: argv[0] must be node, python or npm (got ${prog})`);
  }
  return errors;
}

/**
 * Everything that can be known before touching the repository or R2.
 * Returns { errors, warnings }; errors make `validate` exit non-zero.
 * @param {Batch} batch
 * @param {{ checkPublicationGate?: boolean }} [options]
 * @returns {{ errors: string[], warnings: string[] }}
 */
export function validateBatch(batch, { checkPublicationGate = true } = {}) {
  /** @type {string[]} */
  const errors = [];
  /** @type {string[]} */
  const warnings = [];
  const m = batch.manifest;
  const schema = /** @type {import('./schema.mjs').Schema} */ (readJson(SCHEMA_PATH));
  errors.push(...validateAgainstSchema(m, schema).map((e) => `schema ${e}`));
  if (errors.length) return { errors, warnings };

  /** @param {unknown[]} list */
  const dupes = (list) => [...new Set(list.filter((v, i) => list.indexOf(v) !== i))];
  for (const d of dupes(m.operations.map((/** @type {Operation} */ o) => o.id))) errors.push(`operation id ${d} is used more than once`);
  for (const d of dupes(m.sources.map((/** @type {{ id: string }} */ s) => s.id))) errors.push(`source id ${d} is used more than once`);
  const sourceIds = new Set(m.sources.map((/** @type {{ id: string }} */ s) => s.id));
  for (const op of m.operations) {
    for (const s of ('sources' in op && op.sources) || []) if (!sourceIds.has(s)) errors.push(`${op.id}: cites unknown source ${s}`);
  }

  /** @param {Operation} op @param {string} p @param {string} what */
  const mustExist = (op, p, what) => {
    if (!existsSync(batchPath(batch, p))) errors.push(`${op.id}: ${what} ${p} does not exist`);
  };
  /** @type {Set<string>} */
  const copyTargets = new Set();
  /** @type {string[]} */
  const repoTargets = [];

  for (const op of m.operations) {
    switch (op.type) {
      case 'copy-files':
        for (const f of op.files) {
          const src = batchPath(batch, f.from);
          if (!existsSync(src)) { errors.push(`${op.id}: ${f.from} does not exist in the batch`); continue; }
          if (f.sha256 && sha256File(src) !== f.sha256) errors.push(`${op.id}: ${f.from} does not match its sha256`);
          copyTargets.add(f.to);
          repoTargets.push(f.to);
        }
        break;
      case 'maps-json-patch': {
        if (!op.entries && !op.classes && !op.edits) errors.push(`${op.id}: needs entries, classes or edits`);
        for (const k of /** @type {const} */ (['entries', 'classes', 'edits'])) {
          const p = op[k];
          if (p) mustExist(op, p, k);
        }
        if (op.entries && existsSync(batchPath(batch, op.entries))) {
          const entries = readJson(batchPath(batch, op.entries));
          if (!Array.isArray(entries)) errors.push(`${op.id}: entries must be a JSON array`);
          else {
            for (const e of entries) if (!e.id) errors.push(`${op.id}: an entry has no id`);
            for (const d of dupes(entries.map((e) => e.id))) errors.push(`${op.id}: map id ${d} appears twice in entries`);
          }
        }
        if (op.classes && existsSync(batchPath(batch, op.classes))) {
          const classes = /** @type {Array<{ id: string }>} */ (readJson(batchPath(batch, op.classes)));
          for (const d of dupes(classes.map((c) => c.id))) errors.push(`${op.id}: class id ${d} appears twice`);
        }
        if (op.edits && existsSync(batchPath(batch, op.edits))) {
          for (const [i, ed] of /** @type {Array<{ op: string }>} */ (readJson(batchPath(batch, op.edits))).entries()) {
            if (!['replace-text', 'add-reference', 'set-field'].includes(ed.op)) errors.push(`${op.id}: edit ${i} has unknown op ${ed.op}`);
          }
        }
        break;
      }
      case 'election-sources':
        mustExist(op, op.fromDir, 'fromDir');
        if (op.excludeRounds) mustExist(op, op.excludeRounds, 'excludeRounds');
        if (op.toDir && !op.toDir.startsWith('data/elections-source/')) errors.push(`${op.id}: toDir must be under data/elections-source/`);
        break;
      case 'corrections': {
        mustExist(op, op.records, 'records');
        if (!op.target.startsWith('data/elections/corrections/')) errors.push(`${op.id}: target must be under data/elections/corrections/`);
        if (existsSync(batchPath(batch, op.records))) {
          const doc = /** @type {unknown[] | { records?: unknown }} */ (readJson(batchPath(batch, op.records)));
          const records = Array.isArray(doc) ? doc : doc.records;
          if (!Array.isArray(records)) errors.push(`${op.id}: records must be an array or {records: [...]}`);
          else {
            records.forEach((r, i) => { for (const k of op.key) if (!(k in r)) errors.push(`${op.id}: record ${i} lacks key field ${k}`); });
            for (const d of dupes(records.map((r) => JSON.stringify(op.key.map((/** @type {string} */ k) => r[k]))))) errors.push(`${op.id}: key ${d} appears twice`);
          }
        }
        repoTargets.push(op.target);
        break;
      }
      case 'r2-fgb': {
        if (!op.pairs && !op.pairsFile) { errors.push(`${op.id}: needs pairs or pairsFile`); break; }
        if (op.pairsFile && !existsSync(batchPath(batch, op.pairsFile))) { errors.push(`${op.id}: pairsFile ${op.pairsFile} does not exist`); break; }
        const pairs = resolveFgbPairs(batch, op);
        for (const p of pairs) {
          if (!p.key.endsWith('.fgb')) errors.push(`${op.id}: ${p.key} is not a .fgb key (upload-fgb-r2 sends only .fgb)`);
          if (!existsSync(repoPath(batch, p.file)) && !copyTargets.has(p.file)) errors.push(`${op.id}: ${p.file} is neither in the repository nor copied in by this batch`);
        }
        break;
      }
      case 'r2-tree': {
        const sources = /** @type {const} */ (['files', 'manifest', 'dir']).filter((k) => op[k]);
        if (sources.length !== 1) { errors.push(`${op.id}: give exactly one of files, manifest, dir`); break; }
        if (FORBIDDEN_PREFIXES.has(op.prefix)) errors.push(`${op.id}: prefix ${op.prefix} is too broad; use a sub-prefix`);
        if (op.manifest && !existsSync(batchPath(batch, op.manifest))) { errors.push(`${op.id}: manifest ${op.manifest} does not exist`); break; }
        for (const e of resolveTreeEntries(batch, op)) {
          if (e.repoRel && e.rel === null) errors.push(`${op.id}: ${e.repoRel} is not under ${op.prefix}`);
          if (e.repoRel && !existsSync(e.local) && !copyTargets.has(e.repoRel)) errors.push(`${op.id}: ${e.repoRel} is neither in the repository nor copied in by this batch`);
          if (!e.repoRel && !existsSync(e.local)) warnings.push(`${op.id}: ${e.local} (from ${op.manifest}) does not exist yet`);
        }
        break;
      }
      case 'r2-cache-control':
        for (const p of op.prefixes) if (FORBIDDEN_PREFIXES.has(p)) errors.push(`${op.id}: prefix ${p} is too broad; use a sub-prefix`);
        break;
      case 'r2-pmtiles':
      case 'switch-to-cdn': {
        const given = /** @type {const} */ (['ids', 'idsFile', 'idsFrom']).filter((k) => op[k]);
        if (given.length !== 1) { errors.push(`${op.id}: give exactly one of ids, idsFile${op.type === 'switch-to-cdn' ? ', idsFrom' : ''}`); break; }
        if (op.idsFile && !existsSync(batchPath(batch, op.idsFile))) { errors.push(`${op.id}: idsFile ${op.idsFile} does not exist`); break; }
        if (op.idsFrom && !m.operations.some((/** @type {Operation} */ o) => o.id === op.idsFrom && o.type === 'r2-pmtiles')) { errors.push(`${op.id}: idsFrom must name an r2-pmtiles operation`); break; }
        const ids = resolveIds(batch, op);
        if (!ids.length) errors.push(`${op.id}: no layer ids (an empty --ids would mean every layer)`);
        for (const d of dupes(ids)) errors.push(`${op.id}: layer id ${d} is listed twice`);
        break;
      }
      case 'command':
        errors.push(...checkCommandArgv(op, batch));
        break;
      default:
        break;
    }
  }

  for (const d of dupes(repoTargets)) errors.push(`repository path ${d} is written by more than one operation`);
  for (const t of repoTargets) {
    if (/^(?:\.git|\.claude|node_modules)\//.test(t)) errors.push(`repository path ${t} is outside what a batch may write`);
  }

  const keys = r2Keys(batch);
  for (const d of dupes(keys)) errors.push(`R2 key ${d} is written more than once`);
  const allowlist = path.join(batch.repo, 'data', 'database', 'r2-publication-allowlist.json');
  if (checkPublicationGate && keys.length) {
    if (!existsSync(allowlist)) warnings.push('no data/database/r2-publication-allowlist.json in the repository; R2 keys were not checked against it');
    else {
      const { prefixes } = /** @type {{ prefixes: Array<{ prefix: string }> }} */ (readJson(allowlist));
      const unlisted = keys.filter((k) => !prefixes.some((p) => k.startsWith(p.prefix.replace(/^\/+/, ''))));
      for (const k of unlisted.slice(0, 20)) errors.push(`R2 key ${k} is not covered by the publication allowlist`);
    }
  }

  const insideDir = !path.relative(batch.dir, batch.manifestPath).startsWith('..');
  const scanTargets = insideDir ? [batch.dir] : [batch.manifestPath, batch.dir];
  errors.push(...scanSecrets(scanTargets).map((h) => `secret check: ${h}`));

  const policy = reviewPolicy(batch);
  errors.push(...policy.errors);
  warnings.push(...policy.warnings);

  return { errors, warnings };
}
