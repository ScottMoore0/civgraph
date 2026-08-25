/**
 * Browse sources served from D1 (binding ELECTIONS_DB).
 *
 *   GET /_api/sources?slug=<slug>                -> { source }        one record
 *   GET /_api/sources?q=<text>&limit=N           -> { sources, total }
 *   GET /_api/sources?provider=A&provider=B      -> filtered
 *   GET /_api/sources?category=&publicationStatus=
 *
 * The largest of the three indexes: 40,327 records, 51 MB across nine shards. Opening a
 * single source in Browse required all of it, because findItem() searches an in-memory
 * list. This returns kilobytes.
 */
import { browseIndexHandler } from '../_browse-index.js';

export const onRequestGet = browseIndexHandler({
  table: 'browse_sources',
  key: 'sources',
  // Bump on RESPONSE SHAPE changes, not data changes: it is part of the edge cache key.
  version: 'sources-1',
  filters: {
    provider: 'provider',
    category: 'category',
    publicationStatus: 'publication_status',
  },
});
