/** Named queries: the knowledge graph's entities, statements, reverse links and browse keys (storage slice ST-6). */

export const GRAPH = Object.freeze({
  /** [entityId] -> { entity_id, summary } */
  entity: 'SELECT entity_id, summary FROM graph_entities WHERE entity_id = ?1',
  /** [entityId, limit, offset] -> { statement } */
  statements: 'SELECT statement FROM graph_statements WHERE subject_id = ?1 ORDER BY ord LIMIT ?2 OFFSET ?3',
  /** [entityId] -> { n } */
  statementCount: 'SELECT COUNT(*) AS n FROM graph_statements WHERE subject_id = ?1',
  /** [entityId, limit] -> { item } */
  reverse: 'SELECT item FROM graph_reverse WHERE entity_id = ?1 ORDER BY ord LIMIT ?2',
  /** [sourceId, limit] -> { item } */
  sourceStatements: 'SELECT item FROM graph_source_statements WHERE source_id = ?1 ORDER BY ord LIMIT ?2',
  /**
   * [`%word%`, `%word%`, ...] (two per word) -> { search }: entities whose label or search card
   * holds every word, at most `limit` (a number the handler has bounded).
   */
  search: (/** @type {number} */ wordCount, /** @type {number} */ limit) => {
    const where = ['search IS NOT NULL'];
    for (let i = 0; i < wordCount; i += 1) where.push(`(label_norm LIKE ?${2 * i + 1} OR lower(search) LIKE ?${2 * i + 2})`);
    return `SELECT search FROM graph_entities WHERE ${where.join(' AND ')} ORDER BY shard, ord LIMIT ${limit}`;
  },
  /** [browseKey] -> { entity_id } */
  browseKey: 'SELECT entity_id FROM graph_browse_keys WHERE browse_key = ?1',
  /** [...browseKeys] -> { browse_key, entity_id } */
  browseKeys: (/** @type {number} */ count) =>
    `SELECT browse_key, entity_id FROM graph_browse_keys WHERE browse_key IN (${Array.from({ length: count }, (_, i) => `?${i + 1}`).join(', ')}) ORDER BY browse_key`,
});

const ENTITY = 'JOIN graph_entities e ON e.entity_id = j.value';
/**
 * How each /data/graph lookup file's keys join to their rows: the value column, the join on the
 * key, and the order of several rows per key.
 */
const GRAPH_FILE_JOINS = Object.freeze({
  entity: { value: 'e.entity', join: ENTITY },
  summary: { value: 'e.summary', join: ENTITY },
  search: { value: 'e.search', join: ENTITY },
  browse: { value: 'b.entity_id', join: 'JOIN graph_browse_keys b ON b.browse_key = j.value' },
  slug: { value: 'b.entity_id', join: "JOIN graph_browse_keys b ON b.browse_key = 'slug:' || j.value" },
  'statements-by-subject': { value: 's.statement', join: 'JOIN graph_statements s ON s.subject_id = j.value', order: 's.ord' },
  'reverse-entity-value': { value: 'r.item', join: 'JOIN graph_reverse r ON r.entity_id = j.value', order: 'r.ord' },
  'source-statements': { value: 's.item', join: 'JOIN graph_source_statements s ON s.source_id = j.value', order: 's.ord' },
});

/** @typedef {keyof typeof GRAPH_FILE_JOINS} GraphFileJoin */
export const GRAPH_FILE_JOIN_NAMES = Object.freeze(/** @type {GraphFileJoin[]} */ (Object.keys(GRAPH_FILE_JOINS)));

export const GRAPH_FILES = Object.freeze({
  /** [file] -> { keys, extra } in part order */
  keys: 'SELECT keys, extra FROM graph_files WHERE file = ?1 ORDER BY part',
  /** [`${dir}/`, `${dir}0`] -> { file, keys }: every file under a directory */
  keysUnder: 'SELECT file, keys FROM graph_files WHERE file > ?1 AND file < ?2 ORDER BY file, part',
  /** [file] -> { k, v }: each key of a file joined to its rows (GRAPH_FILE_JOINS) */
  valuesByKey: (/** @type {GraphFileJoin} */ joinName) => {
    const { value, join, order } = /** @type {{ value: string, join: string, order?: string }} */ (GRAPH_FILE_JOINS[joinName]);
    return `SELECT j.value AS k, ${value} AS v
    FROM graph_files f, json_each(f.keys) j ${join}
    WHERE f.file = ?1 ORDER BY f.part, j.key${order ? `, ${order}` : ''}`;
  },
});
