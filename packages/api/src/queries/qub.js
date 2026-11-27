/**
 * Named queries: the Independent QUB Catalogue (binding QUB_DB, a local SQLite file until the
 * owner approves a D1 database; LANDING/qub-app). Built by scripts/records/qub/build-qub-db.py:
 *
 *   qub      one row per catalogue record (mms_id, the display columns, scope, tags, detail JSON)
 *   qub_fts  contentless FTS5 (rowid = qub.rowid) over title, author, subjects, notes and facets
 *
 * `facets` holds the filter tokens ('scopein'/'scopeout', 'taga'..'tagh'), so the scope and
 * topic filters are part of the full-text match and need no scan of the table. The match text
 * and the year filters come from packages/api/src/handlers/qub/_query.js (buildMatch,
 * buildFilters); the builders here assemble the statements around them.
 */

/** The search list's columns. */
const LIST_COLS = 'q.mms_id AS mmsId, q.title, q.author, q.imprint, q.year, q.format, q.scope, q.tags';

const EXPORT_COLS = 'q.mms_id, q.title, q.author, q.imprint, q.year, q.format, q.language, q.shelf, q.subjects, '
  + 'q.scope, q.tags, q.scope_reason';

const ITEM_COLS = 'mms_id AS mmsId, title, author, imprint, year, date_text AS dateText, format, language, shelf, '
  + 'subjects, scope, tags, scope_reason AS scopeReason, scope_method AS scopeMethod, detail';

/** ' AND <filters>' after a full-text match, or '' */
const andWhere = (/** @type {string[]} */ where) => (where.length ? ' AND ' + where.join(' AND ') : '');

export const QUB = Object.freeze({
  /**
   * [match, ...filters, limit, offset] -> the list columns, in order of `key` `dir` then mms_id.
   * The inner query orders the matches on their keys alone and keeps one page of row ids.
   */
  searchMatched: (/** @type {string[]} */ where, /** @type {string} */ key, /** @type {'ASC' | 'DESC'} */ dir) => `SELECT ${LIST_COLS}
             FROM (SELECT q.rowid AS rid, ${key} AS k, q.mms_id AS m
                     FROM qub_fts f JOIN qub q ON q.rowid = f.rowid
                    WHERE qub_fts MATCH ?${andWhere(where)}
                    ORDER BY k ${dir}, m LIMIT ? OFFSET ?) h
             JOIN qub q ON q.rowid = h.rid
             ORDER BY h.k ${dir}, h.m`,
  /** [...filters, limit, offset] -> the list columns (no full-text match: filters only) */
  searchFiltered: (/** @type {string[]} */ where, /** @type {string} */ order) => `SELECT ${LIST_COLS} FROM qub q
             WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT ? OFFSET ?`,
  /** [match, ...filters, cap] -> { n } how many match, counted up to `cap` + 1 */
  countMatched: (/** @type {string[]} */ where) => `SELECT COUNT(*) AS n FROM (SELECT 1 FROM qub_fts f JOIN qub q ON q.rowid = f.rowid
             WHERE qub_fts MATCH ?${andWhere(where)} LIMIT ?)`,
  /** [...filters, cap] -> { n } */
  countFiltered: (/** @type {string[]} */ where) => `SELECT COUNT(*) AS n FROM (SELECT 1 FROM qub q WHERE ${where.join(' AND ')} LIMIT ?)`,
  /** [match?, ...filters, limit, offset] -> the CSV export's columns, by mms_id */
  exportPage: (/** @type {boolean} */ matched, /** @type {string[]} */ where) => (matched
    ? `SELECT ${EXPORT_COLS} FROM qub_fts f JOIN qub q ON q.rowid = f.rowid WHERE qub_fts MATCH ?${andWhere(where)} ORDER BY q.mms_id LIMIT ? OFFSET ?`
    : `SELECT ${EXPORT_COLS} FROM qub q WHERE ${where.length ? where.join(' AND ') : '1'} ORDER BY q.mms_id LIMIT ? OFFSET ?`),
  /** [mmsId] -> one record with its detail JSON */
  item: `SELECT ${ITEM_COLS} FROM qub WHERE mms_id = ?1 LIMIT 1`,
  /** [] -> { key, n } the catalogue's figures: 'all', 'in', 'out' and 'tag:A'..'tag:H' (in scope) */
  stats: 'SELECT key, n FROM qub_stats ORDER BY key',
});
