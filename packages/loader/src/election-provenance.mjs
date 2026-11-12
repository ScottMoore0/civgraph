/**
 * Election provenance on disk, in one place: the one door every reader and the one writer go through.
 *
 * The record build writes the provenance document (one record per election contest saying where its
 * figures come from; contract: data/database/election-provenance.schema.json) as
 *
 *   PROVENANCE_FILE       the index: the document's head fields (schemaVersion, generatedAt, licence,
 *                         counts, legislation) and `contestParts`, which lists the parts and the
 *                         order their contests interleave in;
 *   PROVENANCE_PART_DIR   one part per decade of the contest date (1830s.json, ...), holding that
 *                         decade's contest records, one per line.
 *
 * As one file it reached 25.6 MB in November 2026, against Cloudflare Pages' 25 MiB per-file limit
 * (wave 6 had cut the budget's headroom to 256 KiB). A decade is a stable key that keeps every part
 * a few megabytes for years: the largest, the 2010s, is 3.5 MB, and a decade only grows by new
 * contests of its own years. Each part is held under PART_BUDGET_BYTES.
 *
 * readProvenance() gives back the whole document exactly as the single file held it: the same head,
 * the same contest records in the same order (provenanceText() is the single file's text, byte for
 * byte). It also reads a single-file document written before the split, so a build tree from
 * before it still reads.
 *
 * The published form leaves out every optional field that is null: an absent field means null. A
 * source's url, origin and checked are required by the schema and stay even when null (a printed
 * work has no url); a contest's required fields stay as they are. Readers must treat a missing
 * field as null. The per-election shards (PROVENANCE_SHARD_DIR, which the map app reads) are a
 * different, much smaller file per election and keep their nulls.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { recordPaths } from '../../config/src/node.mjs';

export const SOURCE_REQUIRED = Object.freeze(['url', 'origin', 'checked']);
export const CONTEST_REQUIRED = Object.freeze(['file', 'body', 'date', 'constituency', 'status', 'sources']);

/** Cloudflare Pages' hard per-file limit (25 MiB). */
export const PAGES_FILE_LIMIT = 25 * 1024 * 1024;
/** No provenance file may come within a mebibyte of the Pages limit (the budget before wave 6). */
export const PUBLISHED_BUDGET_BYTES = 24 * 1024 * 1024;
/** Each decade's part. The largest is about 3.5 MB (2010s, November 2026). */
export const PART_BUDGET_BYTES = 8 * 1024 * 1024;
/** The index: head fields and the part list, about 45 KB (November 2026). */
export const INDEX_BUDGET_BYTES = 1024 * 1024;
/** All files together: a guard against runaway duplication, not a size limit (25.6 MB in Nov 2026). */
export const TOTAL_BUDGET_BYTES = 64 * 1024 * 1024;

/** The part of contests whose date has no year (none in November 2026). */
export const UNDATED_PART = 'undated';

/**
 * One source cited for a contest; every field passes through.
 * @typedef {Record<string, unknown>} ProvenanceSource
 * @typedef {{ sources: ProvenanceSource[], [field: string]: unknown }} ProvenanceContest
 * @typedef {{ contests: ProvenanceContest[], [field: string]: unknown }} ProvenanceDocument
 * @typedef {{ part: string, contests: number }} ContestPartEntry
 * @typedef {{ parts: ContestPartEntry[], order: [string, number][] }} ContestParts
 * @typedef {{ contestParts: ContestParts, [field: string]: unknown }} ProvenanceIndex
 * @typedef {{ schemaVersion: number, part: string, contests: ProvenanceContest[] }} ProvenancePart
 * @typedef {{ file?: string, partDir?: string }} ProvenanceLocation
 */

const dropNulls = (/** @type {Record<string, unknown>} */ obj, /** @type {Set<string>} */ keep) => Object.fromEntries(Object.entries(obj).filter(([k, v]) => v !== null || keep.has(k)));
const sourceKeep = new Set(SOURCE_REQUIRED);
const contestKeep = new Set(CONTEST_REQUIRED);

/**
 * The document as published: the same records with their null optional fields left out.
 * @template {{ contests: ProvenanceContest[] }} D
 * @param {D} doc
 * @returns {D}
 */
export function slimProvenance(doc) {
  return {
    ...doc,
    contests: doc.contests.map((c) => ({
      ...dropNulls(c, contestKeep),
      sources: c.sources.map((s) => dropNulls(s, sourceKeep)),
    })),
  };
}

/**
 * The exact text written for a document whose last key is `contests` (the whole document as one
 * file, or one part): indented, except that each contest record is written on one line. The fully
 * indented file reached 26.7 MB in November 2026; the indentation inside contest records was about a
 * third of it. One line per contest keeps the file readable and its diffs line-per-contest.
 * @param {ProvenanceDocument} doc
 */
export function publishedText(doc) {
  const slim = slimProvenance(doc);
  const { contests, ...rest } = slim;
  const head = JSON.stringify({ ...rest, contests: [] }, null, 1);
  const body = contests.map((c) => `  ${JSON.stringify(c)}`).join(',\n');
  // The contests array is the last key; splice its records into the indented head.
  const tail = head.lastIndexOf('"contests": []');
  if (tail < 0 || head.slice(tail + '"contests": []'.length).trim() !== '}') {
    throw new Error('publishedText: "contests" must be the last top-level key');
  }
  return `${head.slice(0, tail)}"contests": [${contests.length ? `\n${body}\n ` : ''}]\n}\n`;
}

/**
 * The part a contest belongs to: the decade of its date ('1830s'), or UNDATED_PART.
 * @param {Record<string, unknown>} contest
 */
export function partOf(contest) {
  const m = /^(\d{3})\d/.exec(String(contest.date ?? ''));
  return m ? `${m[1]}0s` : UNDATED_PART;
}

/** A part's file name in PROVENANCE_PART_DIR. */
export const partFileName = (/** @type {string} */ part) => `${part}.json`;

/**
 * The document split into its index and its parts (slimmed, as published). The index keeps every
 * head field in its order, then `contestParts`: the parts in name order with their contest counts,
 * and `order`, the runs [part, count] that interleave the parts back into the document's order.
 * @param {ProvenanceDocument} doc
 * @returns {{ index: ProvenanceIndex, parts: ProvenancePart[] }}
 */
export function splitProvenance(doc) {
  const { contests, ...head } = slimProvenance(doc);
  if ('contestParts' in head) throw new Error('splitProvenance: the document already has a contestParts field');
  /** @type {Map<string, ProvenanceContest[]>} */
  const byPart = new Map();
  /** @type {[string, number][]} */
  const order = [];
  for (const c of contests) {
    const part = partOf(c);
    if (!byPart.has(part)) byPart.set(part, []);
    /** @type {ProvenanceContest[]} */ (byPart.get(part)).push(c);
    const last = order[order.length - 1];
    if (last && last[0] === part) last[1] += 1;
    else order.push([part, 1]);
  }
  const names = [...byPart.keys()].sort();
  return {
    index: {
      ...head,
      contestParts: { parts: names.map((part) => ({ part, contests: /** @type {ProvenanceContest[]} */ (byPart.get(part)).length })), order },
    },
    parts: names.map((part) => ({ schemaVersion: 1, part, contests: /** @type {ProvenanceContest[]} */ (byPart.get(part)) })),
  };
}

/**
 * The document back from its index and parts: the inverse of splitProvenance.
 * @param {ProvenanceIndex} index
 * @param {(part: string) => ProvenancePart} readPart
 * @returns {ProvenanceDocument}
 */
export function joinProvenance(index, readPart) {
  const { contestParts, ...head } = index;
  if (!contestParts || !Array.isArray(contestParts.parts) || !Array.isArray(contestParts.order)) {
    throw new Error('joinProvenance: the index has no contestParts');
  }
  /** @type {Map<string, { contests: ProvenanceContest[], next: number }>} */
  const queues = new Map();
  for (const { part, contests } of contestParts.parts) {
    const doc = readPart(part);
    if (doc.part !== part) throw new Error(`election provenance part ${part}: the file says it is part ${doc.part}`);
    if (doc.contests.length !== contests) {
      throw new Error(`election provenance part ${part}: ${doc.contests.length} contests, the index says ${contests} (a stale or half-written build: rebuild it)`);
    }
    queues.set(part, { contests: doc.contests, next: 0 });
  }
  /** @type {ProvenanceContest[]} */
  const contests = [];
  for (const [part, n] of contestParts.order) {
    const q = queues.get(part);
    if (!q || q.next + n > q.contests.length) throw new Error(`election provenance: the index's order overruns part ${part}`);
    for (let i = 0; i < n; i += 1) contests.push(q.contests[q.next + i]);
    q.next += n;
  }
  for (const [part, q] of queues) {
    if (q.next !== q.contests.length) throw new Error(`election provenance: the index's order leaves ${q.contests.length - q.next} contests of part ${part} unread`);
  }
  return { ...head, contests };
}

/**
 * Every file of the split form with its exact text: the index (JSON, one-space indentation) and
 * one file per part (publishedText).
 * @param {ProvenanceDocument} doc
 * @returns {{ indexText: string, parts: { part: string, file: string, text: string, contests: number }[] }}
 */
export function provenanceFiles(doc) {
  const { index, parts } = splitProvenance(doc);
  return {
    indexText: `${JSON.stringify(index, null, 1)}\n`,
    parts: parts.map((p) => ({ part: p.part, file: partFileName(p.part), text: publishedText(p), contests: p.contests.length })),
  };
}

/**
 * Whatever in the split form breaks a budget, as messages (none when every file is within budget).
 * @param {ReturnType<typeof provenanceFiles>} files
 */
export function budgetProblems(files) {
  const problems = [];
  const indexBytes = Buffer.byteLength(files.indexText);
  if (indexBytes > INDEX_BUDGET_BYTES) problems.push(`the index is ${indexBytes} bytes, over its ${INDEX_BUDGET_BYTES}-byte budget`);
  let total = indexBytes;
  for (const p of files.parts) {
    const bytes = Buffer.byteLength(p.text);
    total += bytes;
    if (bytes > PART_BUDGET_BYTES) {
      problems.push(`part ${p.part} is ${bytes} bytes, over its ${PART_BUDGET_BYTES}-byte budget: split that decade (partOf in packages/loader/src/election-provenance.mjs)`);
    }
  }
  if (total > TOTAL_BUDGET_BYTES) problems.push(`the files total ${total} bytes, over the ${TOTAL_BUDGET_BYTES}-byte overall budget`);
  return problems;
}

/** @param {ProvenanceLocation} [where] */
function located(where = {}) {
  const P = recordPaths();
  return { file: where.file ?? P.PROVENANCE_FILE, partDir: where.partDir ?? P.PROVENANCE_PART_DIR };
}

const readJsonFile = (/** @type {string} */ p) => JSON.parse(readFileSync(p, 'utf8'));

/**
 * The whole provenance document, or null when it has not been built. Reads the split form (index
 * and parts) and a single file from before the split alike.
 * @param {ProvenanceLocation} [where] defaults to the record build's locations (recordPaths)
 * @returns {ProvenanceDocument | null}
 */
export function readProvenance(where) {
  const { file, partDir } = located(where);
  if (!existsSync(file)) return null;
  const doc = readJsonFile(file);
  if (Array.isArray(doc.contests) && !doc.contestParts) return doc;
  return joinProvenance(doc, (part) => readJsonFile(path.join(partDir, partFileName(part))));
}

/**
 * The text the provenance document had as one file (publishedText), whichever form is on disk;
 * '' when it has not been built. For readers that search what the site cites.
 * @param {ProvenanceLocation} [where]
 */
export function provenanceText(where) {
  const doc = readProvenance(where);
  return doc ? publishedText(doc) : '';
}

/**
 * Write the document in the split form: parts first and only where their text changed, stale
 * parts removed, the index last (a reader never sees an index naming parts not yet written).
 * Throws, writing nothing, when a file would break its budget.
 * @param {ProvenanceDocument} doc
 * @param {ProvenanceLocation} [where]
 * @returns {{ index: string, written: string[], removed: string[], bytes: number }}
 */
export function writeProvenance(doc, where) {
  const { file, partDir } = located(where);
  const files = provenanceFiles(doc);
  const problems = budgetProblems(files);
  if (problems.length) throw new Error(`election provenance is over budget (Pages refuses files over 25 MiB):\n  ${problems.join('\n  ')}`);
  mkdirSync(partDir, { recursive: true });
  /** @type {string[]} */
  const written = [];
  for (const p of files.parts) {
    const target = path.join(partDir, p.file);
    if (!existsSync(target) || readFileSync(target, 'utf8') !== p.text) {
      writeFileSync(target, p.text);
      written.push(p.file);
    }
  }
  const wanted = new Set(files.parts.map((p) => p.file));
  /** @type {string[]} */
  const removed = [];
  for (const f of readdirSync(partDir).filter((name) => name.endsWith('.json'))) {
    if (!wanted.has(f)) { unlinkSync(path.join(partDir, f)); removed.push(f); }
  }
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, files.indexText);
  const bytes = files.parts.reduce((sum, p) => sum + Buffer.byteLength(p.text), Buffer.byteLength(files.indexText));
  return { index: file, written, removed, bytes };
}
