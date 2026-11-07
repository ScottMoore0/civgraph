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

export async function divisionShard(db, shard) {
  const [divs, votes] = await Promise.all([
    db.prepare('SELECT division_id, record FROM divisions WHERE shard = ?1 ORDER BY ord, division_id').bind(shard).all(),
    db.prepare('SELECT v.division_id, v.entry FROM division_votes v JOIN divisions d ON d.division_id = v.division_id WHERE d.shard = ?1 ORDER BY v.division_id, v.ord').bind(shard).all(),
  ]);
  if (!(divs.results || []).length) return null;
  const byDivision = new Map();
  for (const r of votes.results || []) {
    if (!byDivision.has(r.division_id)) byDivision.set(r.division_id, []);
    byDivision.get(r.division_id).push(parseJson(r.entry));
  }
  const divisions = {};
  for (const d of divs.results || []) divisions[d.division_id] = fillVotes(d.record, byDivision.get(d.division_id) || []);
  return { schemaVersion: 1, shard: Number(shard), divisions };
}

async function handle(context) {
  const db = binding(context.env, 'ELECTIONS_DB');
  const url = new URL(context.request.url);
  const p = (name) => (url.searchParams.get(name) || '').trim();
  try {
    if (p('view') === 'index') {
      const doc = await documentBody(db, 'votes/index.json');
      return doc ? jsonResponse(doc) : jsonResponse({ error: 'no votes loaded' }, 404);
    }
    if (p('division')) {
      const row = await db.prepare('SELECT division_id, record FROM divisions WHERE division_id = ?1').bind(p('division')).first();
      if (!row) return jsonResponse({ error: 'division not found' }, 404);
      const { results } = await db.prepare('SELECT entry FROM division_votes WHERE division_id = ?1 ORDER BY ord').bind(row.division_id).all();
      return jsonResponse({ id: row.division_id, ...fillVotes(row.record, (results || []).map((r) => parseJson(r.entry))) });
    }
    if (p('shard') !== '') {
      if (!/^\d{1,4}$/.test(p('shard'))) return jsonResponse({ error: 'shard must be a number' }, 400);
      const shard = await divisionShard(db, Number(p('shard')));
      return shard ? jsonResponse(shard) : jsonResponse({ error: 'shard not found' }, 404);
    }
    if (p('person')) {
      const row = await db.prepare('SELECT record FROM vote_persons WHERE person_id = ?1').bind(p('person')).first();
      return row ? jsonResponse(row.record) : jsonResponse({ error: 'no votes', person: p('person') }, 404);
    }
    if (p('party')) {
      const row = await db.prepare('SELECT record FROM vote_parties WHERE slug = ?1').bind(p('party')).first();
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
