/**
 * /data/graph/** -- the semantic graph's old file URLs, answered from D1 (data phase 4).
 *
 * The files were the graph build's output on R2. Record pages ask /_api/graph since phase 2;
 * these URLs keep answering for 90 days from 6 Nov 2026 (owner decision), rebuilt in each file's
 * shape from the graph tables (only the wrapper's generatedAt is gone). graph_files holds which
 * keys each file held, in order, so a hash bucket or a sorted run is one indexed read:
 *
 *   manifest.json, entity-types.json, properties.json, quality/validation-summary.json,
 *   indexes/property-summary.json, indexes/lookup.json, indexes/browse-record-to-entity.json,
 *   indexes/entity-slugs.json, indexes/entity-search.json        documents
 *   entity-shards/entities-NNN.json                              graph_entities.entity
 *   indexes/lookup/browse|slug|entity/NNNN.json                  graph_browse_keys, summaries
 *   indexes/statements-by-subject-shards/*, reverse-entity-value-shards/*,
 *   source-statements-shards/*                                   graph_statements, graph_reverse,
 *                                                                graph_source_statements
 *   indexes/entity-summary-shards/*                              graph_entities.summary
 *   indexes/entity-search-part-N.json, entity-slugs-part-N.json  graph_entities.search, slugs
 *   indexes/browse-record-to-entity-<type>.json                  graph_browse_keys
 *   indexes/<statements-by-subject|reverse-entity-value|source-statements>-map.json
 *                                                                graph_files (key -> file URL)
 *   statement-shards/*, exports/**    the bulk dumps: no table holds the full statements, so the
 *                                     R2 copy while it is there, then 301 to the bulk downloads
 *                                     (https://data.civgraph.net/downloads/), which
 *                                     records:downloads writes and an approved upload publishes
 *   anything else                     404
 *
 * Pages serves a matching static asset in preference to a Function, so data/graph/ is never
 * deployed (scripts/build/site.mjs builds dist/ from an allow-list that does not include it).
 */
import { cachedJson, documentBody, jsonResponse, parseJson } from '../../../packages/api/src/handlers/_records.js';
import { binding } from '../../../packages/config/src/config.js';
import { fromD1 } from '../../../packages/storage/src/d1.js';
import { GRAPH_FILES } from '../../../packages/api/src/queries/graph.js';

const VERSION = 'data-graph-2';
/**
 * The answers are cached at the edge for EDGE_TTL under a key without the dataset version: the
 * files retire on 6 Feb 2027 and graph_files is frozen as loaded at go-live (records:build
 * carries it forward, scripts/records/graph-files-freeze.mjs), so a publish leaves them be. Every
 * rebuild goes through the isolate's gate (cachedJson `gate`); the kinds whose files run to about
 * 1 MB and more (up to 25 MB) answer from their R2 copy while it is there, and any kind falls back
 * to it when D1 fails.
 */
const EDGE_TTL = 30 * 86400;
export const HEAVY = new Set(['entities', 'statements-by-subject', 'reverse-entity-value', 'source-statements', 'search-part', 'slugs-part', 'browse-type', 'map']);
export const DOWNLOADS_ORIGIN = 'https://data.civgraph.net/downloads';
const DOWNLOAD_FILES = new Set(['civgraph.jsonld', 'civgraph-rdf.ndjson', 'civgraph-provenance.json']);

/** Where a bulk file moved to in the downloads (a shard: the downloads manifest, which lists them). */
export function downloadsUrl(file) {
  return DOWNLOAD_FILES.has(file) ? `${DOWNLOADS_ORIGIN}/${encodeURIComponent(file)}.gz` : `${DOWNLOADS_ORIGIN}/manifest.json`;
}

const DOCUMENTS = new Set([
  'manifest.json', 'entity-types.json', 'properties.json', 'quality/validation-summary.json',
  'indexes/property-summary.json', 'indexes/lookup.json', 'indexes/browse-record-to-entity.json',
  'indexes/entity-slugs.json', 'indexes/entity-search.json',
]);

/** The route for a path under data/graph/, or null. */
export function matchGraphPath(p) {
  if (DOCUMENTS.has(p)) return { kind: 'doc', name: `graph/${p}` };
  if (/^(statement-shards|exports)\//.test(p)) return { kind: 'bulk' };
  let m;
  if ((m = /^entity-shards\/entities-(\d{3,})\.json$/.exec(p))) return { kind: 'entities', n: Number(m[1]) };
  if ((m = /^indexes\/lookup\/(browse|slug|entity)\/(\d{4})\.json$/.exec(p))) return { kind: `lookup-${m[1]}` };
  if ((m = /^indexes\/(statements-by-subject|reverse-entity-value|source-statements)-shards\/\1-(\d{3,})\.json$/.exec(p))) return { kind: m[1], n: Number(m[2]) };
  if ((m = /^indexes\/entity-summary-shards\/entity-summaries-(\d{3,})\.json$/.exec(p))) return { kind: 'summaries', n: Number(m[1]) };
  if ((m = /^indexes\/entity-search-part-(\d+)\.json$/.exec(p))) return { kind: 'search-part', n: Number(m[1]) };
  if ((m = /^indexes\/entity-slugs-part-(\d+)\.json$/.exec(p))) return { kind: 'slugs-part', n: Number(m[1]) };
  if ((m = /^indexes\/(statements-by-subject|reverse-entity-value|source-statements)-map\.json$/.exec(p))) return { kind: 'map', prefix: m[1] };
  if (/^indexes\/browse-record-to-entity-[a-z0-9-]+\.json$/.test(p)) return { kind: 'browse-type' };
  return null;
}

export async function onRequest(context) {
  const method = context.request.method;
  if (method !== 'GET' && method !== 'HEAD') {
    return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
  }
  const resp = await onRequestGet(context);
  return method === 'HEAD' ? new Response(null, { status: resp.status, headers: resp.headers }) : resp;
}

export async function onRequestGet(context) {
  const parts = (context.params.path || []).map(decodeURIComponent);
  const p = parts.join('/');
  const route = parts.includes('..') ? null : matchGraphPath(p);
  if (route?.kind === 'bulk') {
    const copy = binding(context.env, 'MAPS_BUCKET') ? await binding(context.env, 'MAPS_BUCKET').get(`data/graph/${p}`) : null;
    if (copy) return r2Response(copy);
    return new Response(null, { status: 301, headers: { Location: downloadsUrl(parts[parts.length - 1]), 'Cache-Control': 'public, max-age=86400' } });
  }
  const bound = binding(context.env, 'ELECTIONS_DB');
  if (!route) return notFound();
  if (!bound) return jsonResponse({ error: 'records database not bound' }, 503);
  // through the storage adapter (packages/storage/); the SQL is named in queries/graph.js
  const db = fromD1(bound);
  return cachedJson(context, VERSION, () => answer(db, route, p), {
    stable: true, edgeTtl: EDGE_TTL, cacheControl: 'public, max-age=86400', gate: route.kind !== 'doc',
    r2Key: `data/graph/${p}`, r2First: HEAVY.has(route.kind),
  });
}

function r2Response(obj) {
  return new Response(obj.body, {
    headers: {
      'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800',
      'Access-Control-Allow-Origin': '*',
      'Content-Type': 'application/json; charset=utf-8',
    },
  });
}

const notFound = () => jsonResponse({ error: 'not found' }, 404);

/** The keys (and the lookup files' shard numbers) a file held, in order; null if no such file. */
async function fileKeys(db, file) {
  const results = await db.all(GRAPH_FILES.keys, [file]);
  if (!results.length) return null;
  const keys = [];
  const extra = [];
  for (const r of results) {
    keys.push(...(parseJson(r.keys) || []));
    if (r.extra) extra.push(...(parseJson(r.extra) || []));
  }
  return { keys, extra };
}

/**
 * Each key of a file joined to its rows (GRAPH_FILES.valuesByKey: the value column, the join on
 * the key, and the order of several rows per key): key -> [values], the statement lists in their
 * ord order.
 */
async function valuesByKey(db, file, joinName) {
  const results = await db.all(GRAPH_FILES.valuesByKey(joinName), [file]);
  const out = new Map();
  for (const r of results) {
    if (!out.has(r.k)) out.set(r.k, []);
    out.get(r.k).push(r.v);
  }
  return out;
}

/** The file's keys with one value each (or the list of values), in the file's order. */
async function keyed(db, file, joinName, { many = false, parse = true } = {}) {
  const listed = await fileKeys(db, file);
  if (!listed) return null;
  const values = await valuesByKey(db, file, joinName);
  const read = (v) => (parse ? parseJson(v) : v);
  const entries = [];
  listed.keys.forEach((key, i) => {
    const vals = values.get(key) || [];
    if (!many && !vals.length) return;
    entries.push([key, many ? vals.map(read) : read(vals[0]), listed.extra[i]]);
  });
  return entries;
}

/** Every key of the files under `dir`, in file order, with the file's URL. */
async function keysUnder(db, dir) {
  const results = await db.all(GRAPH_FILES.keysUnder, [`${dir}/`, `${dir}0`]);
  const out = [];
  for (const r of results) for (const key of parseJson(r.keys) || []) out.push([key, `/data/graph/${r.file}`]);
  return out;
}

/** The head's part count (the build splits each collection into that many positional slices). */
async function partSlice(db, head, list, n) {
  const doc = await documentBody(db, head);
  const count = Array.isArray(doc?.parts) && doc.parts.length ? doc.parts.length : 4;
  const size = Math.ceil(list.length / count);
  return list.slice(n * size, (n + 1) * size);
}

async function answer(db, route, p) {
  switch (route.kind) {
    case 'doc': {
      const body = await documentBody(db, route.name);
      return body ? jsonResponse(body) : notFound();
    }
    case 'entities': {
      const entries = await keyed(db, p, 'entity');
      if (!entries) return notFound();
      return jsonResponse({ schemaVersion: 1, shard: route.n, total: entries.length, items: entries.map(([, v]) => v) });
    }
    case 'lookup-browse':
    case 'lookup-slug': {
      const entries = await keyed(db, p, route.kind === 'lookup-browse' ? 'browse' : 'slug', { parse: false });
      if (!entries) return notFound();
      return jsonResponse({ schemaVersion: 1, items: Object.fromEntries(entries.map(([k, v]) => [k, v])) });
    }
    case 'lookup-entity': {
      const entries = await keyed(db, p, 'summary');
      if (!entries) return notFound();
      const items = {};
      for (const [id, summary, extra] of entries) {
        const [st, rv, ss] = extra || [];
        items[id] = { ...summary, ...(st ?? null) !== null && { st }, ...(rv ?? null) !== null && { rv }, ...(ss ?? null) !== null && { ss } };
      }
      return jsonResponse({ schemaVersion: 1, items });
    }
    case 'statements-by-subject':
    case 'reverse-entity-value':
    case 'source-statements': {
      const entries = await keyed(db, p, route.kind, { many: true });
      if (!entries) return notFound();
      return jsonResponse({ schemaVersion: 1, shard: route.n, totalSubjects: entries.length, items: Object.fromEntries(entries.map(([k, v]) => [k, v])) });
    }
    case 'summaries': {
      const entries = await keyed(db, p, 'summary');
      if (!entries) return notFound();
      return jsonResponse({ schemaVersion: 1, shard: route.n, total: entries.length, items: Object.fromEntries(entries.map(([k, v]) => [k, v])) });
    }
    case 'search-part': {
      const entries = await keyed(db, p, 'search');
      if (!entries) return notFound();
      return jsonResponse({ schemaVersion: 1, part: route.n, items: entries.map(([, v]) => v) });
    }
    case 'slugs-part': {
      const entries = await keyed(db, p, 'slug', { parse: false });
      if (!entries) return notFound();
      // byIdShard is every summary file's ids in order, cut into the same positional parts.
      const ids = await partSlice(db, 'graph/indexes/entity-slugs.json', await keysUnder(db, 'indexes/entity-summary-shards'), route.n);
      return jsonResponse({
        schemaVersion: 1, part: route.n,
        bySlug: Object.fromEntries(entries.map(([k, v]) => [k, v])),
        byIdShard: Object.fromEntries(ids),
      });
    }
    case 'browse-type': {
      const entries = await keyed(db, p, 'browse', { parse: false });
      if (!entries) return notFound();
      const type = entries.length ? entries[0][0].slice(0, entries[0][0].indexOf(':')) : p.replace(/^indexes\/browse-record-to-entity-|\.json$/g, '');
      return jsonResponse({ schemaVersion: 1, type, total: entries.length, items: Object.fromEntries(entries.map(([k, v]) => [k, v])) });
    }
    case 'map': {
      const all = await keysUnder(db, `indexes/${route.prefix}-shards`);
      if (!all.length) return notFound();
      return jsonResponse({ schemaVersion: 1, totalSubjects: all.length, items: Object.fromEntries(all) });
    }
    default: return notFound();
  }
}
