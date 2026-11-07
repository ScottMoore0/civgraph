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
