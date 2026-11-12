/**
 * The repository side of a batch: copy files in, patch maps.json, add election source files,
 * merge corrections. Dry run unless `write` is set, and idempotent: a second run over a tree it
 * has already been applied to reports no changes.
 *
 * Every operation reads through one in-memory view of the files it touches, so a dry run of
 * two operations on the same file shows their combined effect, and nothing is written until
 * every operation has been computed without error.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { batchPath, phaseOf, readJson, repoPath, sha256File, toPosix } from './batch.mjs';

/** @typedef {import('./batch.mjs').Batch} Batch */
/** @typedef {import('./batch.mjs').Operation} Operation */
/** @template {Operation['type']} T @typedef {import('./batch.mjs').OperationOf<T>} OperationOf */
/** @typedef {{ op: string, action: 'add' | 'replace' | 'edit', path: string, bytes?: number, detail?: string }} Change */
/** @typedef {{ op: string, path: string, reason: string }} Conflict */
/** @typedef {{ changes: Change[], conflicts: Conflict[], errors: string[], warnings: string[], notes: string[], unchanged: number, written: boolean }} StageResult */
/** @typedef {ReturnType<typeof createView>} View */
/** A map entry or catalogue class of data/database/maps.json, read by id. @typedef {{ id: string, [field: string]: unknown }} MapsRecord */
/** @typedef {import('../../types/index.js').IntakeMapEdit} MapEdit */
/**
 * A stage operation's handler.
 * @template {Operation} [O=Operation]
 * @typedef {(batch: Batch, op: O, view: View, out: StageResult) => void} Handler
 */

/**
 * JSON written back with the file's own line endings and final newline.
 * @param {string} raw
 * @param {unknown} data
 */
function serialiseLike(raw, data) {
  const eol = raw.includes('\r\n') ? '\r\n' : '\n';
  const body = JSON.stringify(data, null, 2) + (/\r?\n$/.test(raw) ? '\n' : '');
  return eol === '\n' ? body : body.replace(/\n/g, '\r\n');
}

/** @param {Batch} batch */
function createView(batch) {
  /** @type {Map<string, string>} */
  const pendingText = new Map(); // repo-relative path -> new text
  /** @type {Map<string, string>} */
  const pendingCopies = new Map(); // repo-relative path -> absolute source
  return {
    /** @param {string} rel @returns {string} */
    readText(rel) {
      const pending = pendingText.get(rel);
      if (pending !== undefined) return pending;
      return readFileSync(repoPath(batch, rel), 'utf8');
    },
    /** @param {string} rel */
    exists(rel) {
      return pendingText.has(rel) || pendingCopies.has(rel) || existsSync(repoPath(batch, rel));
    },
    /** @param {string} rel @param {string} text */
    setText(rel, text) { pendingText.set(rel, text); },
    /** @param {string} rel @param {string} src */
    copy(rel, src) { pendingCopies.set(rel, src); },
    flush() {
      for (const [rel, src] of pendingCopies) {
        const dst = repoPath(batch, rel);
        mkdirSync(path.dirname(dst), { recursive: true });
        copyFileSync(src, dst);
      }
      for (const [rel, text] of pendingText) {
        const dst = repoPath(batch, rel);
        mkdirSync(path.dirname(dst), { recursive: true });
        writeFileSync(dst, text);
      }
      return { files: pendingCopies.size + pendingText.size };
    },
  };
}

/** @type {Handler<OperationOf<'copy-files'>>} */
function copyFilesOp(batch, op, view, out) {
  for (const f of op.files) {
    const src = batchPath(batch, f.from);
    const dst = repoPath(batch, f.to);
    if (!existsSync(dst)) {
      out.changes.push({ op: op.id, action: 'add', path: f.to, bytes: statSync(src).size });
      view.copy(f.to, src);
    } else if (sha256File(src) === sha256File(dst)) {
      out.unchanged += 1;
    } else if (op.onConflict === 'refuse') {
      out.conflicts.push({ op: op.id, path: f.to, reason: 'repository file differs and onConflict is refuse' });
    } else {
      out.changes.push({ op: op.id, action: 'replace', path: f.to, bytes: statSync(src).size });
      view.copy(f.to, src);
    }
  }
}

/**
 * Upsert entries, upsert classes, apply edits -- the semantics of the hand-written apply.py
 * of ni-plu-dispensary-towns-2026-11-02, which this replaces:
 *   entries: an existing id is replaced in place if it differs; a new one goes after
 *            insertAfter, and each later new entry after the one before it;
 *   classes: the same, each placed after its own `_insert_after` (end of list if absent);
 *   edits:   replace-text (skipped once `new` is present), add-reference (keyed on label),
 *            set-field.
 */
/** @type {Handler<OperationOf<'maps-json-patch'>>} */
function mapsJsonPatchOp(batch, op, view, out) {
  const target = op.target || 'data/database/maps.json';
  if (!view.exists(target)) { out.errors.push(`${op.id}: ${target} not found in the repository`); return; }
  const raw = view.readText(target);
  const doc = JSON.parse(raw);
  /** @type {string[]} */
  const changes = [];
  /** @type {MapsRecord[]} */
  const maps = doc.maps;
  const ids = maps.map((m) => m.id);
  /** @param {unknown} a @param {unknown} b */
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  if (op.entries) {
    let anchor = op.insertAfter;
    for (const entry of /** @type {MapsRecord[]} */ (readJson(batchPath(batch, op.entries)))) {
      const i = ids.indexOf(entry.id);
      if (i !== -1) {
        if (!same(maps[i], entry)) { maps[i] = entry; changes.push(`replace maps entry ${entry.id}`); }
      } else {
        if (!anchor || !ids.includes(anchor)) { out.errors.push(`${op.id}: insertAfter ${anchor} is not a map id in ${target}`); return; }
        const at = ids.indexOf(anchor) + 1;
        maps.splice(at, 0, entry);
        ids.splice(at, 0, entry.id);
        changes.push(`insert maps entry ${entry.id} after ${anchor}`);
      }
      anchor = entry.id;
    }
  }

  if (op.classes) {
    /** @type {MapsRecord[]} */
    const classes = doc.classes;
    for (const proposed of /** @type {Array<MapsRecord & { _insert_after?: string }>} */ (readJson(batchPath(batch, op.classes)))) {
      const { _insert_after: after, ...cls } = proposed;
      const cids = classes.map((c) => c.id);
      const i = cids.indexOf(cls.id);
      if (i !== -1) {
        if (!same(classes[i], cls)) { classes[i] = cls; changes.push(`replace class ${cls.id}`); }
      } else {
        const at = after && cids.includes(after) ? cids.indexOf(after) + 1 : classes.length;
        classes.splice(at, 0, cls);
        changes.push(`insert class ${cls.id} after ${after}`);
      }
    }
  }

  if (op.edits) {
    for (const ed of /** @type {MapEdit[]} */ (readJson(batchPath(batch, op.edits)))) {
      const i = ids.indexOf(ed.id);
      if (i === -1) { out.warnings.push(`${op.id}: ${ed.id} not in ${target}; edit skipped`); continue; }
      const m = maps[i];
      if (ed.op === 'replace-text') {
        const text = /** @type {string} */ (m[ed.field] || '');
        if (text.includes(ed.new)) continue;
        if (!text.includes(ed.old)) { out.warnings.push(`${op.id}: text to replace not found in ${ed.id}.${ed.field}; skipped: ${ed.old.slice(0, 60)}...`); continue; }
        m[ed.field] = text.replace(ed.old, ed.new);
        changes.push(`edit ${ed.id}.${ed.field}`);
      } else if (ed.op === 'add-reference') {
        const refs = /** @type {Array<{ label: string }>} */ (m.references || (m.references = []));
        if (!refs.some((r) => r.label === ed.ref.label)) {
          refs.push(ed.ref);
          changes.push(`add reference to ${ed.id}: ${ed.ref.label.slice(0, 70)}`);
        }
      } else if (ed.op === 'set-field') {
        if (!same(m[ed.field], ed.value)) { m[ed.field] = ed.value; changes.push(`set ${ed.id}.${ed.field}`); }
      }
    }
  }

  for (const detail of changes) out.changes.push({ op: op.id, action: 'edit', path: target, detail });
  if (changes.length) view.setText(target, serialiseLike(raw, doc));
}

/** @param {string} dir */
function listJson(dir) {
  /** @type {string[]} */
  const out = [];
  /** @param {string} d */
  const walk = (d) => {
    for (const name of readdirSync(d).sort()) {
      const full = path.join(d, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (name.endsWith('.json')) out.push(full);
    }
  };
  walk(dir);
  return out;
}

/** @type {Handler<OperationOf<'election-sources'>>} */
function electionSourcesOp(batch, op, view, out) {
  const from = batchPath(batch, op.fromDir);
  const toDir = op.toDir || 'data/elections-source/data/elections';
  /** @type {Set<string>} */
  const exclude = new Set();
  if (op.excludeRounds) {
    const rounds = /** @type {{ rounds?: { slug: string, folder: string }[] }} */ (readJson(batchPath(batch, op.excludeRounds))).rounds || [];
    for (const r of rounds) exclude.add(`${r.slug}/${r.folder}`);
  }
  let excluded = 0;
  for (const file of listJson(from)) {
    const rel = toPosix(path.relative(from, file));
    const parts = rel.split('/');
    if (parts.length >= 3 && exclude.has(`${parts.at(-3)}/${parts.at(-2)}`)) { excluded += 1; continue; }
    try { JSON.parse(readFileSync(file, 'utf8')); } catch (err) { out.errors.push(`${op.id}: ${rel} is not valid JSON (${/** @type {Error} */ (err).message})`); continue; }
    const target = `${toDir}/${rel}`;
    if (!existsSync(repoPath(batch, target))) {
      out.changes.push({ op: op.id, action: 'add', path: target, bytes: statSync(file).size });
      view.copy(target, file);
    } else if (sha256File(file) === sha256File(repoPath(batch, target))) {
      out.unchanged += 1;
    } else if (op.onConflict === 'replace') {
      out.changes.push({ op: op.id, action: 'replace', path: target, bytes: statSync(file).size });
      view.copy(target, file);
    } else {
      out.conflicts.push({ op: op.id, path: target, reason: 'repository file exists with other content (never overwritten unless onConflict is replace)' });
    }
  }
  if (excluded) out.notes.push(`${op.id}: ${excluded} file(s) held back by ${op.excludeRounds}`);
}

/** @type {Handler<OperationOf<'corrections'>>} */
function correctionsOp(batch, op, view, out) {
  const doc = view.exists(op.target) ? JSON.parse(view.readText(op.target)) : null;
  if (!doc) { out.errors.push(`${op.id}: ${op.target} does not exist; create it (with a description and provenance) before merging records`); return; }
  const raw = view.readText(op.target);
  const incoming = /** @type {Record<string, unknown>[] | { records?: Record<string, unknown>[] }} */ (readJson(batchPath(batch, op.records)));
  const records = Array.isArray(incoming) ? incoming : incoming.records;
  /** @type {Record<string, unknown>[]} */
  const current = doc.records || (doc.records = []);
  /** @param {Record<string, unknown>} r */
  const keyOf = (r) => JSON.stringify(op.key.map((/** @type {string} */ k) => r[k]));
  /** @type {Map<string, number>} */
  const index = new Map(current.map((r, i) => [keyOf(r), i]));
  let changed = 0;
  for (const r of /** @type {Record<string, unknown>[]} */ (records)) {
    const k = keyOf(r);
    const at = index.get(k);
    if (at === undefined) {
      current.push(r);
      index.set(k, current.length - 1);
      out.changes.push({ op: op.id, action: 'edit', path: op.target, detail: `add record ${op.key.map((/** @type {string} */ f) => r[f]).join(' / ')}` });
      changed += 1;
    } else if (JSON.stringify(current[at]) !== JSON.stringify(r)) {
      current[at] = r;
      out.changes.push({ op: op.id, action: 'edit', path: op.target, detail: `replace record ${op.key.map((/** @type {string} */ f) => r[f]).join(' / ')}` });
      changed += 1;
    } else {
      out.unchanged += 1;
    }
  }
  if (changed) view.setText(op.target, serialiseLike(raw, doc));
}

/** @type {{ [T in 'copy-files' | 'maps-json-patch' | 'election-sources' | 'corrections']: Handler<OperationOf<T>> }} */
const HANDLERS = {
  'copy-files': copyFilesOp,
  'maps-json-patch': mapsJsonPatchOp,
  'election-sources': electionSourcesOp,
  corrections: correctionsOp,
};

/**
 * @param {Batch} batch
 * @param {{ write?: boolean }} [options]
 * @returns {StageResult}
 */
export function stageBatch(batch, { write = false } = {}) {
  /** @type {StageResult} */
  const out = { changes: [], conflicts: [], errors: [], warnings: [], notes: [], unchanged: 0, written: false };
  const view = createView(batch);
  for (const op of batch.manifest.operations) {
    if (phaseOf(op) !== 'stage') continue;
    // a stage op's type is one of HANDLERS' keys (STAGE_TYPES), and its handler takes that op
    const handler = /** @type {Handler} */ (HANDLERS[/** @type {keyof typeof HANDLERS} */ (op.type)]);
    handler(batch, op, view, out);
  }
  if (write && !out.errors.length && !out.conflicts.length && out.changes.length) {
    view.flush();
    out.written = true;
  }
  return out;
}
