/**
 * The published form of data/database/election-provenance.json.
 *
 * The file leaves out every optional field that is null: an absent field means null. Cloudflare
 * Pages serves no file over 25 MiB, and with the Elliott and Flackes citations of November 2026 the
 * indented file passed it (26.2 MB) largely on null fields (about 3 MB of `"archiveUrl": null` and
 * the like). A source's url, origin and checked are required by the schema and stay even when null
 * (a printed work has no url); a contest's required fields stay as they are.
 *
 * The per-election shards (render/metadata/election-provenance/) keep their nulls: the app reads
 * them field by field and each is far below any limit. Readers of the whole file must treat a
 * missing field as null (build-browse-indexes.mjs and build-status.mjs do). Each contest record is
 * written on a line of its own (publishedText below).
 */
export const SOURCE_REQUIRED = Object.freeze(['url', 'origin', 'checked']);
export const CONTEST_REQUIRED = Object.freeze(['file', 'body', 'date', 'constituency', 'status', 'sources']);

// The size the published file must stay under: Pages' hard limit is 25 MiB (26,214,400 bytes);
// the budget keeps a mebibyte of headroom so a batch of citations cannot tip it over unnoticed.
export const PUBLISHED_BUDGET_BYTES = 24 * 1024 * 1024;

/**
 * The parts of election-provenance.json this module reads; every other field passes through.
 * @typedef {{ sources: Record<string, unknown>[], [field: string]: unknown }} ProvenanceContest
 * @typedef {{ contests: ProvenanceContest[], [field: string]: unknown }} ProvenanceDocument
 */

const dropNulls = (/** @type {Record<string, unknown>} */ obj, /** @type {Set<string>} */ keep) => Object.fromEntries(Object.entries(obj).filter(([k, v]) => v !== null || keep.has(k)));
const sourceKeep = new Set(SOURCE_REQUIRED);
const contestKeep = new Set(CONTEST_REQUIRED);

/**
 * The document as published: the same records with their null optional fields left out.
 * @param {ProvenanceDocument} doc
 * @returns {ProvenanceDocument}
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
 * The exact text written to disk: indented, except that each contest record is written on one line.
 * The second instalment of the Northern Ireland council elections (November 2026, about 5,000
 * contests) took the fully indented file to 26.7 MB; the indentation inside contest records was
 * about a third of it. One line per contest keeps the file readable and its diffs line-per-contest.
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
