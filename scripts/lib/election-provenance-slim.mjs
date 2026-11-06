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
 * missing field as null (build-browse-indexes.mjs and build-status.mjs do).
 */
export const SOURCE_REQUIRED = Object.freeze(['url', 'origin', 'checked']);
export const CONTEST_REQUIRED = Object.freeze(['file', 'body', 'date', 'constituency', 'status', 'sources']);

// The size the published file must stay under: Pages' hard limit is 25 MiB (26,214,400 bytes);
// the budget keeps a mebibyte of headroom so a batch of citations cannot tip it over unnoticed.
export const PUBLISHED_BUDGET_BYTES = 24 * 1024 * 1024;

const dropNulls = (obj, keep) => Object.fromEntries(Object.entries(obj).filter(([k, v]) => v !== null || keep.has(k)));
const sourceKeep = new Set(SOURCE_REQUIRED);
const contestKeep = new Set(CONTEST_REQUIRED);

/** The document as published: the same records with their null optional fields left out. */
export function slimProvenance(doc) {
  return {
    ...doc,
    contests: doc.contests.map((c) => ({
      ...dropNulls(c, contestKeep),
      sources: c.sources.map((s) => dropNulls(s, sourceKeep)),
    })),
  };
}

/** The exact text written to disk. */
export const publishedText = (doc) => `${JSON.stringify(slimProvenance(doc), null, 1)}\n`;
