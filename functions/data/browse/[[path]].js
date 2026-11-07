/**
 * /data/browse/** -- the Browse files, answered from D1 (data design stage D.9; phase 4).
 *
 * The files were build output of scripts/build/build-browse-indexes.mjs published to R2. Each path
 * below is rebuilt from the records tables in the file's shape (its wrapper's generatedAt is the
 * one field that is gone). Data design phase 3 moved the map files into tables (maps.json,
 * features.json, details/maps/<slug>.json: map_cards and feature_groups) and retired
 * proni-roots.json; phase 4 answers the source detail shards from `sources` and ends the read of
 * the R2 copies, except that the heavy kinds no page reads any more answer from theirs first
 * (LEGACY_HEAVY, below). Old file URLs keep answering for 90 days from 6 Nov 2026 (owner decision);
 * after that the R2 objects can go (a separate, approved step; not map-features/, which
 * browse.js reads from data.civgraph.net). Anything not listed answers 404.
 *
 *   index.json, persons.json, sources.json, register-interests.json, persons-facets.json
 *   person-shards/*, source-index-shards/*, register-interest-shards/*   (slices of the rows in source order)
 *   parties.json, party-names.json, party-label-folds.json, details/parties/<slug>.json,
 *   party-profiles/<slug>.json
 *   elections.json (streamed), elections-list.json, details/elections/<slug>.json,
 *   details/election-contests/<slug>.json, election-contest-parents(.json|/<nnnn>.json)
 *   offices.json, details/offices/<slug>.json   (the facts model's office pages)
 *   source-merges.json
 *   votes/index.json, votes/persons/<id>.json, votes/parties/<slug>.json, votes/divisions/<nnn>.json
 *   maps.json, features.json, details/maps/<slug>.json   (phase 3)
 *   proni-roots.json                                       301 /_api/proni/node (phase 3)
 *   details/source-shards/<name>.json                      sources.detail (phase 4)
 *   details/sources|register-interests/<slug>.json, details/proni/<slug>.json, proni.json
 *                                                          301 to their /_api routes (older layouts)
 *   map-features/**                                        301 to the same object on data.civgraph.net
 *
 * Pages serves a matching static asset in preference to a Function, so data/browse/ is never
 * deployed (scripts/build/site.mjs builds dist/ from an allow-list that does not include it).
 */
import { cachedJson, documentBody, jsonResponse, parseJson, streamFrom } from '../../_api/_records.js';
import { divisionShard } from '../../_api/votes/index.js';
import { resolvePartySlug } from '../../_api/parties/index.js';
import { browseFeaturesText, browseMapsText } from '../../_api/_maps.js';
import { binding } from '../../_lib/config.js';
import { fromD1 } from '../../../packages/storage/src/d1.js';
import { OFFICES, SHARDS, SOURCES } from '../../_lib/queries/cards.js';
import { ELECTION_CARDS } from '../../_lib/queries/elections.js';
import { MAP_CARDS } from '../../_lib/queries/maps.js';
import { PARTIES } from '../../_lib/queries/parties.js';
import { VOTES } from '../../_lib/queries/votes.js';

const VERSION = 'data-browse-4';
const CONTEST_PARENT_BUCKETS = 64;
export const MAP_FEATURES_ORIGIN = 'https://data.civgraph.net/data/browse/map-features';

const moved = (location) => new Response(null, {
  status: 301, headers: { Location: location, 'Cache-Control': 'public, max-age=86400', 'Access-Control-Allow-Origin': '*' },
});

/** Where an older file layout moved to (a 301), or null. */
export function movedPath(parts) {
  const p = parts.join('/');
  const json = (s) => (s && s.endsWith('.json') ? s.slice(0, -5) : null);
  const enc = encodeURIComponent;
  if (p === 'proni-roots.json' || p === 'proni.json') return '/_api/proni/node';
  if (parts[0] === 'map-features' && parts.length > 1) return `${MAP_FEATURES_ORIGIN}/${parts.slice(1).map(enc).join('/')}`;
  const [a, b, c] = parts;
  if (parts.length !== 3 || a !== 'details' || !json(c)) return null;
  if (b === 'sources') return `/_api/sources?slug=${enc(json(c))}&view=detail`;
  if (b === 'register-interests') return `/_api/register-interests?slug=${enc(json(c))}&view=detail`;
  if (b === 'proni') return `/_api/proni/node?ref=${enc(json(c).replace(/~/g, '/'))}`;
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
  if (parts.includes('..')) return notFound();
  const location = movedPath(parts);
  if (location) return moved(location);
  const route = matchBrowsePath(parts);
  if (!route) return notFound();
  const bound = binding(context.env, 'ELECTIONS_DB');
  if (!bound) return jsonResponse({ error: 'records database not bound' }, 503);
  // through the storage adapter (packages/storage/); the SQL is named in functions/_lib/queries/
  const db = fromD1(bound);
  return cachedJson(context, VERSION, () => answer(db, route), {
    edgeTtl: EDGE_TTL, gate: HEAVY.has(route.kind),
    ...LEGACY_HEAVY.has(route.kind) && { r2Key: `data/browse/${parts.join('/')}`, r2First: true },
  });
}

/**
 * Browse still reads some of these files (index, persons, sources and register-interests with
 * their shards, maps, features, offices, elections.json), so the edge key keeps the dataset
 * version (a publish is seen at once); under it an answer never changes, so it is stored for
 * EDGE_TTL. The kinds that run to megabytes rebuild through the isolate's gate (cachedJson
 * `gate`). Those no page reads any more, only old links, answer from their R2 copy while it is
 * there (as it was at go-live), then from D1.
 */
const EDGE_TTL = 30 * 86400;
export const HEAVY = new Set(['shard', 'source-shard', 'contest-parents', 'elections', 'elections-list', 'source-merges', 'election-contests', 'maps', 'features', 'parties']);
export const LEGACY_HEAVY = new Set(['source-shard', 'contest-parents', 'elections-list', 'source-merges']);

const SHARDED = {
  'person-shards': { table: 'person_cards', manifest: 'browse/persons.json', kind: 'person-index' },
  'source-index-shards': { table: 'sources', manifest: 'browse/sources.json', kind: 'source-index' },
  'register-interest-shards': { table: 'register_entries', manifest: 'browse/register-interests.json', kind: 'register-interest-index' },
};

export function matchBrowsePath(parts) {
  const p = parts.join('/');
  const json = (s) => (s && s.endsWith('.json') ? s.slice(0, -5) : null);
  if (['index.json', 'persons.json', 'sources.json', 'register-interests.json', 'persons-facets.json', 'party-label-folds.json'].includes(p)) return { kind: 'doc', name: `browse/${p}` };
  if (p === 'parties.json') return { kind: 'parties' };
  if (p === 'party-names.json') return { kind: 'party-names' };
  if (p === 'offices.json') return { kind: 'offices' };
  if (p === 'elections.json') return { kind: 'elections' };
  if (p === 'elections-list.json') return { kind: 'elections-list' };
  if (p === 'election-contest-parents.json') return { kind: 'contest-parents' };
  if (p === 'source-merges.json') return { kind: 'source-merges' };
  if (p === 'maps.json') return { kind: 'maps' };
  if (p === 'features.json') return { kind: 'features' };
  if (p === 'votes/index.json') return { kind: 'doc', name: 'votes/index.json' };
  const [a, b, c] = parts;
  if (parts.length === 2 && SHARDED[a] && json(b)) return { kind: 'shard', dir: a, name: b };
  if (parts.length === 2 && a === 'election-contest-parents' && /^\d{4}$/.test(json(b) || '')) return { kind: 'contest-parents', bucket: Number(json(b)) };
  if (parts.length === 2 && a === 'party-profiles' && json(b)) return { kind: 'party-profile', slug: json(b) };
  if (parts.length === 3 && a === 'details' && b === 'parties' && json(c)) return { kind: 'party-detail', slug: json(c) };
  if (parts.length === 3 && a === 'details' && b === 'offices' && json(c)) return { kind: 'office-detail', slug: json(c) };
  if (parts.length === 3 && a === 'details' && b === 'maps' && json(c)) return { kind: 'map-detail', slug: json(c) };
  if (parts.length === 3 && a === 'details' && b === 'source-shards' && json(c)) return { kind: 'source-shard', name: c };
  if (parts.length === 3 && a === 'details' && b === 'elections' && json(c)) return { kind: 'election-detail', slug: json(c) };
  if (parts.length === 3 && a === 'details' && b === 'election-contests' && json(c)) return { kind: 'election-contests', slug: json(c) };
  if (parts.length === 3 && a === 'votes' && b === 'persons' && json(c)) return { kind: 'votes-person', id: json(c) };
  if (parts.length === 3 && a === 'votes' && b === 'parties' && json(c)) return { kind: 'votes-party', slug: json(c) };
  if (parts.length === 3 && a === 'votes' && b === 'divisions' && /^\d{1,4}$/.test(json(c) || '')) return { kind: 'votes-shard', shard: Number(json(c)) };
  return null;
}

/** FNV-1a over UTF-16 code units, as build-browse-indexes.mjs lookupBucket buckets contest parents. */
export function lookupBucket(key, count) {
  let hash = 0x811c9dc5;
  const text = String(key);
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) % count;
}

const notFound = () => jsonResponse({ error: 'not found' }, 404);

async function answer(db, route) {
  switch (route.kind) {
    case 'doc': {
      const body = await documentBody(db, route.name);
      return body ? jsonResponse(body) : notFound();
    }
    case 'parties': {
      const head = (await documentBody(db, 'browse/parties.json')) || {};
      const results = await db.all(PARTIES.cards);
      return jsonResponse({ ...head, items: results.map((r) => parseJson(r.card)) });
    }
    case 'party-names': {
      const head = (await documentBody(db, 'browse/party-names.json')) || {};
      const results = await db.all(PARTIES.labelMap);
      return jsonResponse({ ...head, items: Object.fromEntries(results.map((r) => [r.label, r.party_slug])) });
    }
    case 'party-detail':
    case 'party-profile': {
      const resolved = await resolvePartySlug(db, route.slug);
      if (!resolved) return notFound();
      const row = await db.first(PARTIES.detailProfile, [resolved.slug]);
      if (route.kind === 'party-profile') return row?.profile ? jsonResponse(row.profile) : notFound();
      return row?.detail ? jsonResponse(`{"schemaVersion":1,"item":${row.detail}}`) : notFound();
    }
    case 'offices': {
      const head = (await documentBody(db, 'browse/offices.json')) || {};
      const results = await db.all(OFFICES.cards);
      return jsonResponse({ ...head, items: results.map((r) => parseJson(r.card)) });
    }
    case 'office-detail': {
      const row = await db.first(OFFICES.detail, [route.slug]);
      return row?.detail ? jsonResponse(`{"schemaVersion":1,"item":${row.detail}}`) : notFound();
    }
    case 'shard': {
      const spec = SHARDED[route.dir];
      const manifest = await documentBody(db, spec.manifest);
      const index = (manifest?.shards || []).findIndex((s) => s.name === route.name);
      if (index < 0) return notFound();
      const size = Number(manifest.indexShardSize) || 5000;
      // Shard n is rows n*size .. (n+1)*size-1 in source order. ord is a sort key with gaps
      // (scripts/records/stable-order.mjs), not a position, so the slice is LIMIT/OFFSET.
      const results = await db.all(SHARDS.page(spec.table), [size, index * size]);
      const items = results.map((r) => parseJson(r.card));
      return jsonResponse({ schemaVersion: 1, kind: spec.kind, shard: route.name, total: items.length, items });
    }
    case 'elections': {
      // 68 MB: streamed in pages, never held whole (and under D1's 50 MB result limit).
      const head = (await documentBody(db, 'browse/elections.json')) || {};
      const headText = JSON.stringify(head);
      async function* generate() {
        yield `${headText.slice(0, -1)}${headText.length > 2 ? ',' : ''}"items":[`;
        let first = true;
        for (let offset = 0; ; offset += 1000) {
          const results = await db.all(ELECTION_CARDS.cardsPage, [offset]);
          if (!results.length) break;
          for (const r of results) { yield `${first ? '' : ','}${r.card}`; first = false; }
        }
        yield ']}';
      }
      return new Response(streamFrom(generate()), { status: 200, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' } });
    }
    case 'elections-list': {
      const head = (await documentBody(db, 'browse/elections-list.json')) || {};
      const results = await db.all(ELECTION_CARDS.listCards);
      return jsonResponse({ ...head, items: results.map((r) => parseJson(r.list_card)) });
    }
    case 'election-detail': {
      const row = await db.first(ELECTION_CARDS.detail, [route.slug]);
      return row?.detail ? jsonResponse(`{"schemaVersion":1,"item":${row.detail}}`) : notFound();
    }
    case 'election-contests': {
      const row = await db.first(ELECTION_CARDS.contests, [route.slug]);
      return row?.contests ? jsonResponse(`{"schemaVersion":1,"items":${row.contests}}`) : notFound();
    }
    case 'contest-parents': {
      const results = await db.all(ELECTION_CARDS.contestParents);
      const items = {};
      for (const r of results) {
        if (route.bucket !== undefined && lookupBucket(r.slug, CONTEST_PARENT_BUCKETS) !== route.bucket) continue;
        items[r.slug] = r.parent;
      }
      return jsonResponse({ schemaVersion: 1, items });
    }
    case 'source-merges': {
      const head = (await documentBody(db, 'browse/source-merges.json')) || {};
      const results = await db.all(SOURCES.merges);
      return jsonResponse({ ...head, items: results.map((r) => parseJson(r.item)) });
    }
    case 'votes-person': {
      const row = await db.first(VOTES.person, [route.id]);
      return row ? jsonResponse(row.record) : notFound();
    }
    case 'votes-party': {
      const row = await db.first(VOTES.party, [route.slug]);
      return row ? jsonResponse(row.record) : notFound();
    }
    case 'votes-shard': {
      const shard = await divisionShard(db, route.shard);
      return shard ? jsonResponse(shard) : notFound();
    }
    case 'maps': {
      const text = await browseMapsText(db);
      return text === null ? notFound() : jsonResponse(text);
    }
    case 'features': {
      const text = await browseFeaturesText(db);
      return text === null ? notFound() : jsonResponse(text);
    }
    case 'source-shard': {
      // The sources whose card names this shard, sorted by slug as the build wrote them
      // (build-browse-indexes.mjs writeSourceDetailShards: localeCompare in the default locale).
      const url = `/data/browse/details/source-shards/${route.name}`;
      const results = await db.all(SOURCES.detailsInShard, [url]);
      if (!results.length) return notFound();
      const items = results.map((r) => parseJson(r.detail)).filter(Boolean);
      items.sort((x, y) => String(x.slug || '').localeCompare(String(y.slug || '')));
      return jsonResponse({ schemaVersion: 1, kind: 'sources', shard: route.name, total: items.length, items });
    }
    case 'map-detail': {
      // The file was named by slug: only an exact slug answers (no id fallback, as before).
      const row = await db.first(MAP_CARDS.detail, [route.slug]);
      return row?.detail ? jsonResponse(`{"schemaVersion":1,"item":${row.detail}}`) : notFound();
    }
    default: return notFound();
  }
}
