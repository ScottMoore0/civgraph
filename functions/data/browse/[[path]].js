/**
 * /data/browse/** -- the Browse files, now answered from D1 (data design stage D.9).
 *
 * The files were build output of scripts/build-browse-indexes.mjs published to R2. Each path
 * below is rebuilt from the records tables in the file's shape (its wrapper's generatedAt is the
 * one field that is gone); everything else -- the map records (phase 3), source detail shards,
 * proni-roots.json -- is still read from R2 as before. The R2 objects stay where they are for the
 * dual run, and the fallback to them stays until stage I; old file URLs keep answering for 90
 * days (owner decision, 2026-11-06), after which unknown paths will answer 410.
 *
 *   index.json, persons.json, sources.json, register-interests.json, persons-facets.json
 *   person-shards/*, source-index-shards/*, register-interest-shards/*   (rows by source order)
 *   parties.json, party-names.json, party-label-folds.json, details/parties/<slug>.json,
 *   party-profiles/<slug>.json
 *   elections.json (streamed), elections-list.json, details/elections/<slug>.json,
 *   details/election-contests/<slug>.json, election-contest-parents(.json|/<nnnn>.json)
 *   offices.json, details/offices/<slug>.json   (the facts model's office pages)
 *   source-merges.json
 *   votes/index.json, votes/persons/<id>.json, votes/parties/<slug>.json, votes/divisions/<nnn>.json
 *
 * Pages serves a matching static asset in preference to a Function, so data/browse/ must stay
 * out of the deployment (.cfignore, clean-for-pages.sh).
 */
import { cachedJson, documentBody, jsonResponse, parseJson, streamFrom } from '../../_api/_records.js';
import { divisionShard } from '../../_api/votes/index.js';
import { resolvePartySlug } from '../../_api/parties/index.js';

const VERSION = 'data-browse-2';
const R2_CACHE_CONTROL = 'public, max-age=0, must-revalidate';
const CONTEST_PARENT_BUCKETS = 64;

export async function onRequestGet(context) {
  const parts = (context.params.path || []).map(decodeURIComponent);
  const db = context.env.ELECTIONS_DB;
  const route = db ? matchBrowsePath(parts) : null;
  if (route) {
    const resp = await cachedJson(context, VERSION, () => answer(db, route));
    if (resp.status !== 503 && resp.status < 500) return resp;
  }
  return fromR2(context, parts);
}

/** The R2 copy, as this Function served it before (ETag, 304, must-revalidate). */
async function fromR2(context, parts) {
  const bucket = context.env.MAPS_BUCKET;
  if (!bucket) return context.next();
  const key = `data/browse/${parts.join('/')}`;
  const object = await bucket.get(key, { onlyIf: context.request.headers });
  if (!object) return new Response('Not found', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  const headers = new Headers({ 'Cache-Control': R2_CACHE_CONTROL, 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json; charset=utf-8' });
  if (object.httpEtag) headers.set('ETag', object.httpEtag);
  if (!('body' in object) || object.body === null || object.body === undefined) return new Response(null, { status: 304, headers });
  return new Response(object.body, { headers });
}

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
  if (p === 'votes/index.json') return { kind: 'doc', name: 'votes/index.json' };
  const [a, b, c] = parts;
  if (parts.length === 2 && SHARDED[a] && json(b)) return { kind: 'shard', dir: a, name: b };
  if (parts.length === 2 && a === 'election-contest-parents' && /^\d{4}$/.test(json(b) || '')) return { kind: 'contest-parents', bucket: Number(json(b)) };
  if (parts.length === 2 && a === 'party-profiles' && json(b)) return { kind: 'party-profile', slug: json(b) };
  if (parts.length === 3 && a === 'details' && b === 'parties' && json(c)) return { kind: 'party-detail', slug: json(c) };
  if (parts.length === 3 && a === 'details' && b === 'offices' && json(c)) return { kind: 'office-detail', slug: json(c) };
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
      const { results } = await db.prepare('SELECT card FROM party_cards ORDER BY ord, slug').all();
      return jsonResponse({ ...head, items: (results || []).map((r) => parseJson(r.card)) });
    }
    case 'party-names': {
      const head = (await documentBody(db, 'browse/party-names.json')) || {};
      const { results } = await db.prepare('SELECT label, party_slug FROM party_label_map ORDER BY ord, label').all();
      return jsonResponse({ ...head, items: Object.fromEntries((results || []).map((r) => [r.label, r.party_slug])) });
    }
    case 'party-detail':
    case 'party-profile': {
      const resolved = await resolvePartySlug(db, route.slug);
      if (!resolved) return notFound();
      const row = await db.prepare('SELECT detail, profile FROM party_cards WHERE slug = ?1').bind(resolved.slug).first();
      if (route.kind === 'party-profile') return row?.profile ? jsonResponse(row.profile) : notFound();
      return row?.detail ? jsonResponse(`{"schemaVersion":1,"item":${row.detail}}`) : notFound();
    }
    case 'offices': {
      const head = (await documentBody(db, 'browse/offices.json')) || {};
      const { results } = await db.prepare('SELECT card FROM office_cards ORDER BY ord, slug').all();
      return jsonResponse({ ...head, items: (results || []).map((r) => parseJson(r.card)) });
    }
    case 'office-detail': {
      const row = await db.prepare('SELECT detail FROM office_cards WHERE slug = ?1').bind(route.slug).first();
      return row?.detail ? jsonResponse(`{"schemaVersion":1,"item":${row.detail}}`) : notFound();
    }
    case 'shard': {
      const spec = SHARDED[route.dir];
      const manifest = await documentBody(db, spec.manifest);
      const index = (manifest?.shards || []).findIndex((s) => s.name === route.name);
      if (index < 0) return notFound();
      const size = Number(manifest.indexShardSize) || 5000;
      const { results } = await db.prepare(`SELECT card FROM ${spec.table} WHERE ord >= ?1 AND ord < ?2 ORDER BY ord`).bind(index * size, (index + 1) * size).all();
      const items = (results || []).map((r) => parseJson(r.card));
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
          const { results } = await db.prepare('SELECT card FROM election_cards ORDER BY ord, slug LIMIT 1000 OFFSET ?1').bind(offset).all();
          if (!results?.length) break;
          for (const r of results) { yield `${first ? '' : ','}${r.card}`; first = false; }
        }
        yield ']}';
      }
      return new Response(streamFrom(generate()), { status: 200, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' } });
    }
    case 'elections-list': {
      const head = (await documentBody(db, 'browse/elections-list.json')) || {};
      const { results } = await db.prepare('SELECT list_card FROM election_cards WHERE list_card IS NOT NULL ORDER BY ord, slug').all();
      return jsonResponse({ ...head, items: (results || []).map((r) => parseJson(r.list_card)) });
    }
    case 'election-detail': {
      const row = await db.prepare('SELECT detail FROM election_details WHERE slug = ?1').bind(route.slug).first();
      return row?.detail ? jsonResponse(`{"schemaVersion":1,"item":${row.detail}}`) : notFound();
    }
    case 'election-contests': {
      const row = await db.prepare('SELECT contests FROM election_details WHERE slug = ?1').bind(route.slug).first();
      return row?.contests ? jsonResponse(`{"schemaVersion":1,"items":${row.contests}}`) : notFound();
    }
    case 'contest-parents': {
      const { results } = await db.prepare(`SELECT c.slug, p.slug AS parent FROM election_cards c
        JOIN election_cards p ON p.key = c.election_key AND p.entry_kind = 'election'
        WHERE c.entry_kind <> 'election' ORDER BY c.ord, c.slug`).all();
      const items = {};
      for (const r of results || []) {
        if (route.bucket !== undefined && lookupBucket(r.slug, CONTEST_PARENT_BUCKETS) !== route.bucket) continue;
        items[r.slug] = r.parent;
      }
      return jsonResponse({ schemaVersion: 1, items });
    }
    case 'source-merges': {
      const head = (await documentBody(db, 'browse/source-merges.json')) || {};
      const { results } = await db.prepare('SELECT item FROM source_merges ORDER BY ord').all();
      return jsonResponse({ ...head, items: (results || []).map((r) => parseJson(r.item)) });
    }
    case 'votes-person': {
      const row = await db.prepare('SELECT record FROM vote_persons WHERE person_id = ?1').bind(route.id).first();
      return row ? jsonResponse(row.record) : notFound();
    }
    case 'votes-party': {
      const row = await db.prepare('SELECT record FROM vote_parties WHERE slug = ?1').bind(route.slug).first();
      return row ? jsonResponse(row.record) : notFound();
    }
    case 'votes-shard': {
      const shard = await divisionShard(db, route.shard);
      return shard ? jsonResponse(shard) : notFound();
    }
    default: return notFound();
  }
}
