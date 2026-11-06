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

/** JSON written back with the file's own line endings and final newline. */
function serialiseLike(raw, data) {
  const eol = raw.includes('\r\n') ? '\r\n' : '\n';
  const body = JSON.stringify(data, null, 2) + (/\r?\n$/.test(raw) ? '\n' : '');
  return eol === '\n' ? body : body.replace(/\n/g, '\r\n');
}

function createView(batch) {
  const pendingText = new Map(); // repo-relative path -> new text
  const pendingCopies = new Map(); // repo-relative path -> absolute source
  return {
    readText(rel) {
      if (pendingText.has(rel)) return pendingText.get(rel);
      return readFileSync(repoPath(batch, rel), 'utf8');
    },
    exists(rel) {
      return pendingText.has(rel) || pendingCopies.has(rel) || existsSync(repoPath(batch, rel));
    },
    setText(rel, text) { pendingText.set(rel, text); },
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
function mapsJsonPatchOp(batch, op, view, out) {
  const target = op.target || 'data/database/maps.json';
  if (!view.exists(target)) { out.errors.push(`${op.id}: ${target} not found in the repository`); return; }
  const raw = view.readText(target);
  const doc = JSON.parse(raw);
  const changes = [];
  const maps = doc.maps;
  const ids = maps.map((m) => m.id);
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  if (op.entries) {
    let anchor = op.insertAfter;
    for (const entry of readJson(batchPath(batch, op.entries))) {
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
    const classes = doc.classes;
    for (const proposed of readJson(batchPath(batch, op.classes))) {
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
    for (const ed of readJson(batchPath(batch, op.edits))) {
      const i = ids.indexOf(ed.id);
      if (i === -1) { out.warnings.push(`${op.id}: ${ed.id} not in ${target}; edit skipped`); continue; }
      const m = maps[i];
      if (ed.op === 'replace-text') {
        const text = m[ed.field] || '';
        if (text.includes(ed.new)) continue;
        if (!text.includes(ed.old)) { out.warnings.push(`${op.id}: text to replace not found in ${ed.id}.${ed.field}; skipped: ${ed.old.slice(0, 60)}...`); continue; }
        m[ed.field] = text.replace(ed.old, ed.new);
        changes.push(`edit ${ed.id}.${ed.field}`);
      } else if (ed.op === 'add-reference') {
        const refs = m.references || (m.references = []);
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

function listJson(dir) {
  const out = [];
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

function electionSourcesOp(batch, op, view, out) {
  const from = batchPath(batch, op.fromDir);
  const toDir = op.toDir || 'data/elections-source/data/elections';
  const exclude = new Set();
  if (op.excludeRounds) {
    for (const r of readJson(batchPath(batch, op.excludeRounds)).rounds || []) exclude.add(`${r.slug}/${r.folder}`);
  }
  let excluded = 0;
  for (const file of listJson(from)) {
    const rel = toPosix(path.relative(from, file));
    const parts = rel.split('/');
    if (parts.length >= 3 && exclude.has(`${parts.at(-3)}/${parts.at(-2)}`)) { excluded += 1; continue; }
    try { JSON.parse(readFileSync(file, 'utf8')); } catch (err) { out.errors.push(`${op.id}: ${rel} is not valid JSON (${err.message})`); continue; }
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

function correctionsOp(batch, op, view, out) {
  const doc = view.exists(op.target) ? JSON.parse(view.readText(op.target)) : null;
  if (!doc) { out.errors.push(`${op.id}: ${op.target} does not exist; create it (with a description and provenance) before merging records`); return; }
  const raw = view.readText(op.target);
  const incoming = readJson(batchPath(batch, op.records));
  const records = Array.isArray(incoming) ? incoming : incoming.records;
  const current = doc.records || (doc.records = []);
  const keyOf = (r) => JSON.stringify(op.key.map((k) => r[k]));
  const index = new Map(current.map((r, i) => [keyOf(r), i]));
  let changed = 0;
  for (const r of records) {
    const k = keyOf(r);
    if (!index.has(k)) {
      current.push(r);
      index.set(k, current.length - 1);
      out.changes.push({ op: op.id, action: 'edit', path: op.target, detail: `add record ${op.key.map((f) => r[f]).join(' / ')}` });
      changed += 1;
    } else if (JSON.stringify(current[index.get(k)]) !== JSON.stringify(r)) {
      current[index.get(k)] = r;
      out.changes.push({ op: op.id, action: 'edit', path: op.target, detail: `replace record ${op.key.map((f) => r[f]).join(' / ')}` });
      changed += 1;
    } else {
      out.unchanged += 1;
    }
  }
  if (changed) view.setText(op.target, serialiseLike(raw, doc));
}

const HANDLERS = {
  'copy-files': copyFilesOp,
  'maps-json-patch': mapsJsonPatchOp,
  'election-sources': electionSourcesOp,
  corrections: correctionsOp,
};

/**
 * @returns {{changes: object[], conflicts: object[], errors: string[], warnings: string[], notes: string[], unchanged: number, written: boolean}}
 */
export function stageBatch(batch, { write = false } = {}) {
  const out = { changes: [], conflicts: [], errors: [], warnings: [], notes: [], unchanged: 0, written: false };
  const view = createView(batch);
  for (const op of batch.manifest.operations) {
    if (phaseOf(op) !== 'stage') continue;
    HANDLERS[op.type](batch, op, view, out);
  }
  if (write && !out.errors.length && !out.conflicts.length && out.changes.length) {
    view.flush();
    out.written = true;
  }
  return out;
}
