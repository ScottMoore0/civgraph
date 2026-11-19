/**
 * Browse sources served from D1 (binding ELECTIONS_DB).
 *
 *   GET /_api/sources?slug=<slug>                -> { source }        one record
 *   GET /_api/sources?q=<text>&limit=N           -> { sources, total }
 *   GET /_api/sources?provider=A&provider=B      -> filtered
 *   GET /_api/sources?category=&publicationStatus=
 *   GET /_api/sources?slug=<slug>&view=detail    -> { item } the full record (was details/source-shards)
 *
 * An election's source under a retired election or contest slug (election-source-<old>,
 * packages/core/src/election-slug-aliases.js) answers 301 to the same request with the slug that
 * replaced it, as the elections API does: browse.js follows it for an old #/ address.
 *
 * The largest of the three indexes: 40,327 records, 51 MB across nine shards. Opening a
 * single source in Browse required all of it, because findItem() searches an in-memory
 * list. This returns kilobytes.
 */
import { resolveElectionSourceSlugAlias } from '@civgraph/core/election-slug-aliases.js';
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

const sources = browseIndexHandler({
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

/** @param {import('../../types.js').ApiContext} context */
export async function onRequestGet(context) {
  return retiredSourceRedirect(new URL(context.request.url)) || sources(context);
}

/**
 * The same request with a retired election source slug replaced, as a 301, or null.
 * @param {URL} url
 * @returns {Response | null}
 */
export function retiredSourceRedirect(url) {
  const slug = (url.searchParams.get('slug') || '').trim();
  const resolved = slug ? resolveElectionSourceSlugAlias(slug) : slug;
  if (!slug || resolved === slug) return null;
  const target = new URL(url);
  target.searchParams.set('slug', resolved);
  return new Response(null, {
    status: 301,
    headers: { Location: target.toString(), 'Cache-Control': 'public, max-age=86400', 'Access-Control-Allow-Origin': '*' },
  });
}
