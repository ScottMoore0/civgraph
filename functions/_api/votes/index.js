/**
 * Parliamentary divisions and votes from D1 (records tables; data design phase 2).
 *
 *   GET /_api/votes?view=index              -> data/browse/votes/index.json
 *   GET /_api/votes?division=<id>           -> one division with its votes, in their order
 *   GET /_api/votes?shard=<nnn>             -> data/browse/votes/divisions/<nnn>.json
 *   GET /_api/votes?person=<id>             -> data/browse/votes/persons/<id>.json
 *   GET /_api/votes?party=<slug>[&body=&term=] -> data/browse/votes/parties/<slug>.json (cohesion by
 *                                              body and term, as built; body/term narrow its terms)
 */
import { cachedJson, documentBody, isMarker, jsonResponse, parseJson } from '../_records.js';
import { reportError } from '../_error.js';
import { binding } from '../../_lib/config.js';
import { asStore } from '../../../packages/storage/src/d1.js';
import { VOTES } from '../../_lib/queries/votes.js';

const VERSION = 'votes-1';

export async function onRequestGet(context) {
  return cachedJson(context, VERSION, () => handle(context));
}

function fillVotes(recordText, votes) {
  const record = parseJson(recordText, {});
  const out = {};
  for (const [k, v] of Object.entries(record)) out[k] = isMarker(v) && v === '$votes' ? votes : v;
  return out;
}

/**
 * @param {import('../../../packages/storage/src/store.js').RecordStore | D1Database} source a store or a D1 binding
 * @param {number} shard
 */
export async function divisionShard(source, shard) {
  const db = asStore(source);
  const [divs, votes] = await Promise.all([
    db.all(VOTES.shardDivisions, [shard]),
    db.all(VOTES.shardVotes, [shard]),
  ]);
  if (!divs.length) return null;
  const byDivision = new Map();
  for (const r of votes) {
    if (!byDivision.has(r.division_id)) byDivision.set(r.division_id, []);
    byDivision.get(r.division_id).push(parseJson(r.entry));
  }
  const divisions = {};
  for (const d of divs) divisions[d.division_id] = fillVotes(d.record, byDivision.get(d.division_id) || []);
  return { schemaVersion: 1, shard: Number(shard), divisions };
}

async function handle(context) {
  const bound = binding(context.env, 'ELECTIONS_DB');
  // through the storage adapter (packages/storage/); the SQL is named in queries/votes.js
  const db = bound && asStore(bound);
  const url = new URL(context.request.url);
  const p = (name) => (url.searchParams.get(name) || '').trim();
  try {
    if (p('view') === 'index') {
      const doc = await documentBody(db, 'votes/index.json');
      return doc ? jsonResponse(doc) : jsonResponse({ error: 'no votes loaded' }, 404);
    }
    if (p('division')) {
      const row = await db.first(VOTES.division, [p('division')]);
      if (!row) return jsonResponse({ error: 'division not found' }, 404);
      const results = await db.all(VOTES.divisionVotes, [row.division_id]);
      return jsonResponse({ id: row.division_id, ...fillVotes(row.record, results.map((r) => parseJson(r.entry))) });
    }
    if (p('shard') !== '') {
      if (!/^\d{1,4}$/.test(p('shard'))) return jsonResponse({ error: 'shard must be a number' }, 400);
      const shard = await divisionShard(db, Number(p('shard')));
      return shard ? jsonResponse(shard) : jsonResponse({ error: 'shard not found' }, 404);
    }
    if (p('person')) {
      const row = await db.first(VOTES.person, [p('person')]);
      return row ? jsonResponse(row.record) : jsonResponse({ error: 'no votes', person: p('person') }, 404);
    }
    if (p('party')) {
      const row = await db.first(VOTES.party, [p('party')]);
      if (!row) return jsonResponse({ error: 'no votes', party: p('party') }, 404);
      if (!p('body') && !p('term')) return jsonResponse(row.record);
      const record = parseJson(row.record, {});
      record.terms = (record.terms || []).filter((t) => (!p('body') || t.body === p('body')) && (!p('term') || t.term === p('term')));
      return jsonResponse(record);
    }
    return jsonResponse({ error: 'give view=index, division, shard, person or party' }, 400);
  } catch (error) {
    return jsonResponse({ error: 'votes query failed', ...reportError(context.env, 'votes', error) }, 500);
  }
}
