/**
 * /data/graph/** -- the semantic graph's old file URLs, retired.
 *
 * The files were the graph build's output on R2; record pages ask /_api/graph since data phase 2,
 * and from 6 Nov 2026 these URLs were rebuilt from the graph tables (graph_files held which keys
 * each file held). The 90-day window was ended early on 8 Nov 2026 (owner): every path answers
 * 410 Gone, graph_files is dropped (packages/schema/migrations/0005_drop_graph_files.sql) and the
 * R2 copies are deleted, except the bulk dumps:
 *
 *   statement-shards/*, exports/**    the bulk dumps: 301 to the bulk downloads
 *                                     (https://data.civgraph.net/data/downloads/, written by
 *                                     records:downloads and published 9 Nov 2026): the three index
 *                                     files to their .gz, every shard to civgraph-graph-shards.tar.gz
 *                                     (the shards byte for byte), anything else to manifest.json.
 *                                     Their R2 copies were deleted once the downloads were live.
 *   anything else                     410 Gone
 *
 * Pages serves a matching static asset in preference to a Function, so data/graph/ is never
 * deployed (scripts/build/site.mjs builds dist/ from an allow-list that does not include it).
 */
export const DOWNLOADS_ORIGIN = 'https://data.civgraph.net/data/downloads';
const DOWNLOAD_FILES = new Set(['civgraph.jsonld', 'civgraph-rdf.ndjson', 'civgraph-provenance.json']);

/**
 * Where a bulk file moved to in the downloads: an index file to its .gz, a shard to the shard
 * archive, anything else to the downloads manifest.
 * @param {string} file  the file's name
 * @param {string} [p]  the path under data/graph/
 * @returns {string}
 */
export function downloadsUrl(file, p = '') {
  if (DOWNLOAD_FILES.has(file)) return `${DOWNLOADS_ORIGIN}/${encodeURIComponent(file)}.gz`;
  if (/^(statement-shards|exports\/(jsonld|rdf-ndjson-shards|provenance-shards))\//.test(p)) return `${DOWNLOADS_ORIGIN}/civgraph-graph-shards.tar.gz`;
  return `${DOWNLOADS_ORIGIN}/manifest.json`;
}

/**
 * Whether a path under data/graph/ is one of the bulk dumps (still served).
 * @param {string} p  the decoded path under data/graph/
 * @returns {boolean}
 */
export function isBulkPath(p) {
  return /^(statement-shards|exports)\/./.test(p);
}

/** @param {CatchAllContext} context */
export async function onRequest(context) {
  const method = context.request.method;
  if (method !== 'GET' && method !== 'HEAD') {
    return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
  }
  const resp = onRequestGet(context);
  return method === 'HEAD' ? new Response(null, { status: resp.status, headers: resp.headers }) : resp;
}

/** @param {CatchAllContext} context */
export function onRequestGet(context) {
  const parts = (context.params.path || []).map(decodeURIComponent);
  const p = parts.join('/');
  if (parts.includes('..') || !isBulkPath(p)) return gone();
  return new Response(null, { status: 301, headers: { Location: downloadsUrl(parts[parts.length - 1], p), 'Cache-Control': 'public, max-age=86400' } });
}


/**
 * A retired graph file URL: 410 Gone, cached briefly. The body names where the graph is now.
 */
export const gone = () => new Response(JSON.stringify({
  error: 'gone',
  detail: 'The old graph file URLs retired on 8 Nov 2026. The graph is served by /_api/graph; the bulk exports are at https://data.civgraph.net/data/downloads/',
}), { status: 410, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=300', 'Access-Control-Allow-Origin': '*' } });
