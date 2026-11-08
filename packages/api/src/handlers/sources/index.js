/**
 * Browse sources served from D1 (binding ELECTIONS_DB).
 *
 *   GET /_api/sources?slug=<slug>                -> { source }        one record
 *   GET /_api/sources?q=<text>&limit=N           -> { sources, total }
 *   GET /_api/sources?provider=A&provider=B      -> filtered
 *   GET /_api/sources?category=&publicationStatus=
 *   GET /_api/sources?slug=<slug>&view=detail    -> { item } the full record (was details/source-shards)
 *
 * The largest of the three indexes: 40,327 records, 51 MB across nine shards. Opening a
 * single source in Browse required all of it, because findItem() searches an in-memory
 * list. This returns kilobytes.
 */
import { browseIndexHandler } from '../_browse-index.js';
import { parseJson } from '../_records.js';
import { SOURCES } from '../../queries/cards.js';

/**
 * ?slug=&view=detail: { schemaVersion, item } as browse.js loadShardDetail builds it from a
 * details/source-shards file, the card with the shard record over it.
 * @param {import('../_browse-index.js').ViewContext} view
 */
async function detail({ db, slug, record, json }) {
  const row = /** @type {{ detail: string | null } | null} */ (await db.first(SOURCES.detail, [slug]));
  const match = parseJson(row?.detail);
  if (!match) return json({ error: 'no detail', slug }, 404);
  return json({ schemaVersion: 1, item: { ...record, ...match } });
}

export const onRequestGet = browseIndexHandler({
  table: 'sources',
  recordColumn: 'card',
  aliasTable: 'source_aliases',
  facetsTable: 'sources_facets',
  key: 'sources',
  // Bump on RESPONSE SHAPE changes, not data changes: it is part of the edge cache key.
  version: 'sources-3',
  views: { detail },
  filters: {
    provider: 'provider',
    category: 'category',
    publicationStatus: 'publication_status',
    license: 'license',
  },
  sorts: {
    date: 'date',
    title: 'title_norm',
    provider: 'provider',
  },
  facets: true,
});
