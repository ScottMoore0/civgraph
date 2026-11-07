/**
 * Named queries: the PRONI eCatalogue (D1 civgraph-proni, binding PRONI_DB): records, their
 * full-text index (proni_fts, FTS5) and Extracted Dates (ext) (storage slice ST-6). The filter
 * clauses and the FTS match text come from functions/_api/proni/_query.js (buildFilters,
 * buildMatch); the builders here assemble the statements around them. `matched` says whether a
 * full-text match leads the parameters.
 */

/** The search list's columns: a trimmed description preview of `preview` characters. */
const searchCols = (/** @type {number} */ preview) => `p.ref, p.slug, p.title, p.level, p.dates, p.parent,
  p.parent_slug AS parentSlug, p.has_children AS hasChildren, p.fond,
  p.access, p.digital_record AS digitalRecord, ext.ext_start_year AS startYear, ext.ext_end_year AS endYear,
  substr(p.description,1,${preview + 1}) AS descPreview, length(p.description) AS descLen`;

const EXPORT_COLS = 'p.ref, p.title, p.level, p.dates, p.access, p.digital_record, p.parent, '
  + 'ext.ext_display, ext.ext_start_year, ext.ext_end_year, ext.ext_circa, ext.ext_estimated, ext.ext_bound, ext.ext_undated, '
  + 'p.description';

const CHILD_COLS = 'ref, slug, title, level, dates, has_children AS hasChildren';
// proni.* columns are qualified because the item query LEFT JOINs the Extracted Dates
// "Additional Data" table (ext), which also has a `ref` column.
const ITEM_COLS = 'proni.ref, proni.slug, proni.title, proni.level, proni.dates, proni.description, '
  + 'proni.access, proni.digital_record AS digitalRecord, proni.has_children AS hasChildren, proni.fond, '
  + 'ext.ext_display, ext.ext_start_year, ext.ext_end_year, ext.ext_circa, ext.ext_estimated, ext.ext_bound, ext.ext_undated';

/** ' AND <filters>' after a full-text match, or '' */
const andWhere = (/** @type {string[]} */ where) => (where.length ? ' AND ' + where.join(' AND ') : '');

// A child's sort key within its parent: the reference after the parent prefix, numeric parts
// numerically (…/2 before …/10) and letter suffixes (56C) breaking ties as text.
const SEG = "substr(ref, CASE WHEN ?1 = '' THEN 1 ELSE length(?1) + 2 END)";
const ASC = `ORDER BY CAST(${SEG} AS INTEGER) ASC, ${SEG} ASC`;
const DESC = `ORDER BY CAST(${SEG} AS INTEGER) DESC, ${SEG} DESC`;
const LT = `(CAST(${SEG} AS INTEGER), ${SEG}) < (?2, ?3)`;
const GT = `(CAST(${SEG} AS INTEGER), ${SEG}) > (?2, ?3)`;
const LE = `(CAST(${SEG} AS INTEGER), ${SEG}) <= (?2, ?3)`;
const KSEG = 'substr(ref, length(?1) + 2)'; // ?1 (a real record ref) is never ''

export const PRONI = Object.freeze({
  /** [match?, ...filters] -> { level, n }: /_api/proni/count?breakdown=1 */
  levelCounts: (/** @type {boolean} */ matched, /** @type {string} */ joinExt, /** @type {string[]} */ where) => (matched
    ? `SELECT p.level AS level, COUNT(*) AS n FROM proni_fts f JOIN proni p ON p.rowid = f.rowid${joinExt} WHERE proni_fts MATCH ?${andWhere(where)} GROUP BY p.level ORDER BY p.level`
    : `SELECT p.level AS level, COUNT(*) AS n FROM proni p${joinExt} WHERE ${where.join(' AND ')} GROUP BY p.level ORDER BY p.level`),
  /** [match?, ...filters] -> { n } */
  count: (/** @type {boolean} */ matched, /** @type {string} */ joinExt, /** @type {string[]} */ where) => (matched
    ? `SELECT COUNT(*) AS n FROM proni_fts f JOIN proni p ON p.rowid = f.rowid${joinExt} WHERE proni_fts MATCH ?${andWhere(where)}`
    : `SELECT COUNT(*) AS n FROM proni p${joinExt} WHERE ${where.join(' AND ')}`),
  /** [match?, ...filters, limit, offset] -> the CSV export's columns, by ref */
  exportPage: (/** @type {boolean} */ matched, /** @type {string[]} */ where) => (matched
    ? `SELECT ${EXPORT_COLS} FROM proni_fts f JOIN proni p ON p.rowid = f.rowid LEFT JOIN ext ON ext.ref = p.ref WHERE proni_fts MATCH ?${andWhere(where)} ORDER BY p.ref LIMIT ? OFFSET ?`
    : `SELECT ${EXPORT_COLS} FROM proni p LEFT JOIN ext ON ext.ref = p.ref WHERE ${where.join(' AND ')} ORDER BY p.ref LIMIT ? OFFSET ?`),
  /** [REF] -> the search columns of the record with exactly this reference */
  exactRef: (/** @type {number} */ preview) => `SELECT ${searchCols(preview)} FROM proni p LEFT JOIN ext ON ext.ref = p.ref WHERE p.ref = ?1 LIMIT 1`,
  /** [match, ...filters, limit, offset] -> search columns (and rank when ranked by relevance) */
  searchMatched: (/** @type {number} */ preview, /** @type {string[]} */ where, /** @type {string} */ order, /** @type {boolean} */ withRank) => `SELECT ${searchCols(preview)}${withRank ? ', bm25(proni_fts) AS rank' : ''}
             FROM proni_fts f JOIN proni p ON p.rowid = f.rowid LEFT JOIN ext ON ext.ref = p.ref
             WHERE proni_fts MATCH ?${andWhere(where)}
             ORDER BY ${order} LIMIT ? OFFSET ?`,
  /** [...filters, limit, offset] -> search columns */
  searchFiltered: (/** @type {number} */ preview, /** @type {string[]} */ where, /** @type {string} */ order) => `SELECT ${searchCols(preview)} FROM proni p LEFT JOIN ext ON ext.ref = p.ref
             WHERE ${where.join(' AND ')}
             ORDER BY ${order} LIMIT ? OFFSET ?`,
  /** [] -> the top-level records */
  roots: `SELECT ${CHILD_COLS}, fond FROM proni WHERE parent = '' ORDER BY ref`,
  /** [ref] -> one record with its Extracted Dates */
  item: `SELECT ${ITEM_COLS} FROM proni LEFT JOIN ext ON ext.ref = proni.ref WHERE proni.ref = ?1 LIMIT 1`,
  /** [ref] -> its children in natural reference order */
  children: `SELECT ${CHILD_COLS} FROM proni WHERE parent = ?1 ORDER BY CAST(${KSEG} AS INTEGER), ${KSEG}`,
  /** [...refs] -> { ref, slug, title } */
  ancestors: (/** @type {number} */ count) => `SELECT ref, slug, title FROM proni WHERE ref IN (${Array.from({ length: count }, (_, i) => `?${i + 1}`).join(',')})`,
  /** [parent] -> { ref } the first sibling */
  firstSibling: `SELECT ref FROM proni WHERE parent = ?1 ${ASC} LIMIT 1`,
  /** [parent] -> { ref } the last sibling */
  lastSibling: `SELECT ref FROM proni WHERE parent = ?1 ${DESC} LIMIT 1`,
  /** [parent, segmentInt, segment] -> { ref } the previous sibling */
  previousSibling: `SELECT ref FROM proni WHERE parent = ?1 AND ${LT} ${DESC} LIMIT 1`,
  /** [parent, segmentInt, segment] -> { ref } the next sibling */
  nextSibling: `SELECT ref FROM proni WHERE parent = ?1 AND ${GT} ${ASC} LIMIT 1`,
  /** [parent] -> { n } */
  siblingCount: 'SELECT COUNT(*) AS n FROM proni WHERE parent = ?1',
  /** [parent, segmentInt, segment] -> { n } this record's position among its siblings */
  siblingPosition: `SELECT COUNT(*) AS n FROM proni WHERE parent = ?1 AND ${LE}`,
});
