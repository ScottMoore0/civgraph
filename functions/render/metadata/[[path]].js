/**
 * Compatibility route: the election documents that were static files under /render/metadata/,
 * answered from D1 in their identical shape (data design stage D.9). These URLs are permanent:
 * manifests, saved links and the map app name them.
 *
 *   elections-test2.json                       the manifest (as /_api/elections?view=manifest)
 *   elections-test2/<key>.json                 the full bundle, byte for byte as the file was
 *                                              (streamed one contest at a time; the largest,
 *                                              ireland-local 2019, is 24.7 MB)
 *   election-provenance/<key>.json             the per-election provenance shard
 *   elections-test2-summaries/<file>.json      the trend summary
 *
 * The layer metadata moved to /_api/layers in data design phase 3 (PHASE3.md; renamed per the
 * site-restructure renames.csv), so its old file URLs answer a permanent redirect there, with no
 * database read:
 *
 *   maps-test.json                             301 /_api/layers
 *   maps-test-index.json                       301 /_api/layers?view=index
 *   layer-details-test2/<id>.json              301 /_api/layers/<id>
 *   duplicate-feature-ids/<id>.json            301 /_api/layers/<id>/duplicates
 *
 * Anything else under /render/metadata/ (feature indexes, anchors, the ni-local year files...)
 * is still a static file: context.next() hands it to Pages. So does a key D1 does not hold. The
 * _redirects entries for renamed keys (Bangor and Lisburn) run first.
 *
 * Pages serves a static file in preference to a Function: this answers only once the files are
 * no longer deployed (.gitignore, .cfignore and clean-for-pages.sh, stage G).
 */
import { bundleChunks, cachedJson, datasetState, documentBody, parseJson, streamFrom } from '../../../packages/api/src/handlers/_records.js';
import { binding } from '../../../packages/config/src/config.js';
import { fromD1 } from '../../../packages/storage/src/d1.js';
import { ELECTIONS_API } from '../../../packages/api/src/queries/elections.js';

/**
 * @typedef {{ kind: 'manifest' } | { kind: 'bundle' | 'provenance', key: string } | { kind: 'summary', file: string }} MetadataRoute
 *   what a /render/metadata/ path asks for
 */

const VERSION = 'render-metadata-1';

/** The paths this answers; _routes.json includes exactly these (validate-routes-manifest.mjs). */
export const ROUTE_PATTERNS = [
  '/render/metadata/elections-test2.json',
  '/render/metadata/elections-test2/*',
  '/render/metadata/election-provenance/*',
  '/render/metadata/elections-test2-summaries/*',
  '/render/metadata/maps-test.json',
  '/render/metadata/maps-test-index.json',
  '/render/metadata/layer-details-test2/*',
  '/render/metadata/duplicate-feature-ids/*',
];

/**
 * The phase-3 renames: an old layer-metadata path -> its /_api/layers URL, or null.
 * @param {string[]} parts  the decoded path segments under /render/metadata/
 * @returns {string | null}
 */
export function renamedLayerUrl(parts) {
  const [first, second, ...rest] = parts;
  if (rest.length) return null;
  if (first === 'maps-test.json' && !second) return '/_api/layers';
  if (first === 'maps-test-index.json' && !second) return '/_api/layers?view=index';
  if (!second || !second.endsWith('.json')) return null;
  const id = encodeURIComponent(second.slice(0, -5));
  if (first === 'layer-details-test2') return `/_api/layers/${id}`;
  if (first === 'duplicate-feature-ids') return `/_api/layers/${id}/duplicates`;
  return null;
}
const HEADERS = { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' };

const text = (/** @type {string} */ body) => new Response(body, { status: 200, headers: HEADERS });
const notHere = () => new Response(null, { status: 404 });

/** @param {CatchAllContext} context */
export async function onRequestGet(context) {
  const parts = (context.params.path || []).map((p) => decodeURIComponent(p));
  const renamed = renamedLayerUrl(parts);
  if (renamed) {
    return new Response(null, { status: 301, headers: { Location: renamed, 'Cache-Control': 'public, max-age=86400', 'Access-Control-Allow-Origin': '*' } });
  }
  const route = matchRoute(parts);
  const bound = binding(context.env, 'ELECTIONS_DB');
  if (!route || !bound) return context.next();
  // through the storage adapter (packages/storage/); the SQL is named in queries/elections.js
  const db = fromD1(bound);
  const resp = await cachedJson(context, VERSION, () => answer(db, route));
  // A key D1 does not know is left to Pages (a static copy, or its 404).
  return resp.status === 404 ? context.next() : resp;
}

/**
 * @param {string[]} parts  the decoded path segments under /render/metadata/
 * @returns {MetadataRoute | null}
 */
export function matchRoute(parts) {
  const [first, second, ...rest] = parts;
  if (rest.length) return null;
  if (first === 'elections-test2.json' && !second) return { kind: 'manifest' };
  if (!second || !second.endsWith('.json')) return null;
  const name = second.slice(0, -5);
  if (first === 'elections-test2') return { kind: 'bundle', key: name };
  if (first === 'election-provenance') return { kind: 'provenance', key: name };
  if (first === 'elections-test2-summaries') return { kind: 'summary', file: second };
  return null;
}

/**
 * @param {import('../../../packages/storage/src/store.js').RecordStore} db
 * @param {MetadataRoute} route
 * @returns {Promise<Response>}
 */
async function answer(db, route) {
  if (route.kind === 'manifest') {
    const head = await documentBody(db, 'elections-test2.json');
    if (!head) return notHere();
    const results = await db.all(ELECTIONS_API.manifest);
    // The manifest was written by the Node generators: JSON.stringify(doc, null, 2) and a newline.
    return text(`${JSON.stringify({ ...head, elections: results.map((r) => parseJson(r.entry)) }, null, 2)}\n`);
  }
  if (route.kind === 'bundle') {
    const chunks = await bundleChunks(db, route.key);
    return chunks ? new Response(streamFrom(chunks), { status: 200, headers: HEADERS }) : notHere();
  }
  if (route.kind === 'provenance') {
    const row = await db.first(ELECTIONS_API.provenance, [route.key]);
    // build-election-provenance.mjs shardText: one-space indentation and a newline.
    return row ? text(`${JSON.stringify(parseJson(row.shard), null, 1)}\n`) : notHere();
  }
  if (route.kind === 'summary') {
    const row = await db.first(ELECTIONS_API.summaryOfFile, [route.file]);
    return row ? text(`${JSON.stringify(parseJson(row.summary), null, 2)}\n`) : notHere();
  }
  return notHere();
}

export { datasetState };
