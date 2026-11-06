/**
 * Election results served from D1 (binding ELECTIONS_DB), from the records tables
 * (scripts/records/, data design phase 2).
 *
 *   GET /_api/elections                                  -> { elections: [...] }  (index, date then key)
 *   GET /_api/elections?body=northern-ireland-assembly   -> filtered index
 *   GET /_api/elections?key=<key>                        -> one election + constituencies
 *   GET /_api/elections?key=<key>&constituency=<seq>     -> one constituency, candidates + counts
 *   GET /_api/elections?key=<key>&constituencyName=<name> -> the same, found by name (Browse contest pages)
 *   GET /_api/elections?key=<key>&contest=<slug>         -> the same, found by its Browse slug
 *   GET /_api/elections?key=<key>&format=bundle[&lite=1] -> the election bundle (the static file's shape)
 *
 * Views (the documents that were files):
 *   view=manifest                 render/metadata/elections-test2.json (resultUrl/summaryUrl stay as they were)
 *   view=summary&key=             render/metadata/elections-test2-summaries/<file>.json
 *   view=provenance&key=          render/metadata/election-provenance/<key>.json
 *   view=list[&body=&decade=&q=&limit=&offset=]   data/browse/elections-list.json, or a page of it
 *   view=detail&key=<slug|key>    data/browse/details/elections/<slug>.json
 *   view=contests&key=<slug|key>  data/browse/details/election-contests/<slug>.json
 *   view=record&slug=<slug>       one Browse election record: an election's detail item or a contest's
 *                                 entry (resolving the parent server-side; replaces election-contest-parents)
 *
 * Every list is ordered by stored columns that end in the key (data design 4.3): a delta load
 * reorders rowids, and SQLite promises no order without ORDER BY.
 */
import { reportError } from '../_error.js';
import {
  T, bundleObject, cachedJson, documentBody, electionAggregates, isMarker, parseJson, withoutMarkers,
} from '../_records.js';

// Bump whenever the RESPONSE SHAPE changes, not just when the data does: it is part of the
// cache key. elections-8: the records tables; ORDER BY on every list; the views above.
const CACHE_VERSION = 'elections-8';

const ELECTION_COLS =
  'key, body, body_slug AS bodySlug, body_group AS bodyGroup, display_title AS displayTitle, '
  + 'contest_type AS contestType, kind, voting_system AS votingSystem, '
  + 'contest_status AS contestStatus, date, year, source_map_id AS sourceMapId, '
  + 'layer_id AS layerId, label_property AS labelProperty, '
  + 'candidate_rows_expected AS candidateRowsExpected, transfer_data_expected AS transferDataExpected';

const CONS_COL_LIST = [
  'seq', 'name', 'winner_party AS winnerParty', 'winner_name AS winnerName',
  'leading_party AS leadingParty', 'leading_name AS leadingName', 'leading_votes AS leadingVotes',
  'leading_pct AS leadingPct', 'turnout_pct AS turnoutPct', 'majority', 'majority_pct AS majorityPct',
  'seats_won AS seatsWon', 'seats_total AS seatsTotal', 'quota', 'electorate', 'source_file AS sourceFile',
];
const CONS_COLS = CONS_COL_LIST.join(', ');

const CAND_COLS =
  'candidate_id AS id, name, party_label AS party, person_id AS personId, '
  + 'first_prefs AS firstPrefs, final_votes AS finalVotes, elected, elected_at AS electedAt, '
  + 'excluded, excluded_at AS excludedAt, status, colour, gender, meta';

// Fields of a contest that the constituency views never carried (they live in other tables).
const CONTEST_TABLE_FIELDS = ['candidates', 'countGroup', 'animationPayload', 'featureId', 'featureName', 'matchName', 'matched'];

/** Columns first, then the stored record over them, as the old meta column was spread. */
function withMeta(row) {
  if (!row) return row;
  const { meta, ...rest } = row;
  const parsed = parseJson(meta);
  return parsed ? { ...rest, ...withoutMarkers(parsed) } : rest;
}

function contestRow(row) {
  const out = withMeta(row);
  for (const k of CONTEST_TABLE_FIELDS) delete out[k];
  return out;
}

export async function onRequestGet(context) {
  return cachedJson(context, CACHE_VERSION, () => handle(context));
}

/** Case, accents and punctuation folded, so "Cork North-Central" finds "Cork North Central". */
function foldName(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const json = (payload, status = 200) => new Response(typeof payload === 'string' ? payload : JSON.stringify(payload), {
  status,
  headers: {
    'Content-Type': 'application/json',
    'Cache-Control': status === 200 ? 'public, max-age=300' : 'no-store',
    'Access-Control-Allow-Origin': '*',
  },
});

/** An election key from a key or a Browse slug (dail-eireann-2024-11-29). */
async function electionKeyFor(db, value) {
  if (!value) return null;
  const row = await db.prepare(`SELECT key FROM ${T.elections} WHERE key = ?1 OR slug = ?1 ORDER BY (key = ?1) DESC, key LIMIT 1`).bind(value).first();
  return row?.key || null;
}

async function handle(context) {
  const url = new URL(context.request.url);
  const key = (url.searchParams.get('key') || '').trim();
  const body = (url.searchParams.get('body') || '').trim();
  const view = (url.searchParams.get('view') || '').trim();
  let constituency = url.searchParams.get('constituency');
  const constituencyName = (url.searchParams.get('constituencyName') || '').trim();
  const contestSlugParam = (url.searchParams.get('contest') || '').trim();

  const db = context.env.ELECTIONS_DB;
  if (!db) return json({ error: 'ELECTIONS_DB binding not configured' }, 503);

  try {
    if (view) return await handleView(db, view, url);

    // Index: every election, or those for one body. Ordered by date then key: 76 dates are
    // shared by several elections.
    if (!key) {
      const stmt = body
        ? db.prepare(`SELECT ${ELECTION_COLS} FROM ${T.elections} WHERE body_slug = ?1 ORDER BY date, key`).bind(body)
        : db.prepare(`SELECT ${ELECTION_COLS} FROM ${T.elections} ORDER BY date, key`);
      const { results } = await stmt.all();
      return json({ elections: results || [], count: (results || []).length });
    }

    // A constituency by its Browse slug (contest=) or by name.
    if (contestSlugParam && (constituency === null || constituency === '')) {
      const row = await db.prepare('SELECT seq FROM contests WHERE election_key = ?1 AND slug = ?2 ORDER BY seq LIMIT 1').bind(key, contestSlugParam.toLowerCase()).first();
      if (!row) return json({ error: 'constituency not found' }, 404);
      constituency = String(row.seq);
    }
    if (constituencyName && (constituency === null || constituency === '')) {
      const { results: names } = await db
        .prepare('SELECT seq, name FROM contests WHERE election_key = ?1 ORDER BY seq')
        .bind(key)
        .all();
      const wanted = foldName(constituencyName);
      const match = (names || []).find((row) => row.name === constituencyName)
        || (names || []).find((row) => foldName(row.name) === wanted);
      if (!match) return json({ error: 'constituency not found' }, 404);
      constituency = String(match.seq);
    }

    // One constituency, with its candidates and count rows.
    if (constituency !== null && constituency !== '') {
      const seq = Number(constituency);
      if (!Number.isInteger(seq)) return json({ error: 'constituency must be an integer' }, 400);
      const [cons, cands, counts, feature, anim] = await Promise.all([
        db.prepare(`SELECT ${CONS_COLS}, meta FROM contests WHERE election_key = ?1 AND seq = ?2`).bind(key, seq).first(),
        db.prepare(`SELECT ${CAND_COLS} FROM candidacies WHERE election_key = ?1 AND contest_seq = ?2 ORDER BY first_prefs DESC, ord`).bind(key, seq).all(),
        db.prepare(`SELECT candidate_id AS candidateId, count_number AS countNumber, total_votes AS totalVotes, transfers, status FROM ${T.counts} WHERE election_key = ?1 AND contest_seq = ?2 ORDER BY count_number, ord`).bind(key, seq).all(),
        db.prepare('SELECT layer_id AS layerId, feature_id AS featureId, feature_name AS featureName, match_name AS matchName, matched FROM contest_features WHERE election_key = ?1 AND contest_seq = ?2').bind(key, seq).first(),
        db.prepare('SELECT payload FROM contest_animation WHERE election_key = ?1 AND contest_seq = ?2').bind(key, seq).first(),
      ]);
      if (!cons) return json({ error: 'constituency not found' }, 404);
      return json({
        constituency: contestRow(cons),
        feature: feature || null,
        candidates: (cands.results || []).map(withMeta),
        counts: counts.results || [],
        animationPayload: parseJson(anim?.payload),
      });
    }

    // Bundle mode: the static election bundle's shape, rebuilt from the rows exactly.
    if (url.searchParams.get('format') === 'bundle') {
      const lite = url.searchParams.get('lite') === '1';
      const bundle = await bundleObject(db, key);
      if (!bundle) return json({ error: 'election not found' }, 404);
      if (lite) {
        // lite=1 drops the two redundant structures (38.6% of a bundle): countGroup, which the
        // client derives from the animation payload, and `elected`, a subset of candidates no
        // client reads; the payload itself becomes two signals, fetched per constituency.
        for (const result of bundle.results || []) {
          delete result.elected;
          delete result.countGroup;
          const rows = result.animationPayload?.Constituency?.countGroup || [];
          delete result.animationPayload;
          result.animationRowCount = rows.length;
          result.animationHasMultipleCounts = rows.some((r) => Number(r.Count_Number) > 1);
        }
      }
      return json(bundle);
    }

    // One election: header plus its constituencies and their feature matches.
    const [election, cons, aggregates] = await Promise.all([
      db.prepare(`SELECT ${ELECTION_COLS}, meta FROM ${T.elections} WHERE key = ?1`).bind(key).first(),
      db.prepare(
        `SELECT ${CONS_COL_LIST.map((c) => `c.${c}`).join(', ')}, c.meta, `
        + 'f.feature_id AS featureId, f.feature_name AS featureName, f.matched '
        + 'FROM contests c '
        + 'LEFT JOIN contest_features f '
        + '  ON f.election_key = c.election_key AND f.contest_seq = c.seq '
        + 'WHERE c.election_key = ?1 ORDER BY c.seq'
      ).bind(key).all(),
      electionAggregates(db, key),
    ]);
    if (!election) return json({ error: 'election not found' }, 404);
    const head = withMeta(election);
    for (const k of ['matchedCount', 'unmatchedCount', 'loadable']) delete head[k];
    for (const [name, value] of aggregates) head[name] = value;
    const rows = (cons.results || []).map((row) => {
      const { featureId, featureName, matched, ...rest } = row;
      const mapped = contestRow(rest);
      return { ...mapped, featureId, featureName, matched: matched === 1 || matched === true };
    });
    return json({
      election: head,
      constituencies: rows,
      matchedCount: rows.filter((r) => r.matched).length,
      unmatchedCount: rows.filter((r) => !r.matched).length,
    });
  } catch (error) {
    return json({ error: 'Election query failed', ...reportError(context.env, 'elections', error) }, 500);
  }
}

const listFold = (value) => String(value || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();

async function handleView(db, view, url) {
  const key = (url.searchParams.get('key') || '').trim();
  switch (view) {
    case 'manifest': {
      const head = await documentBody(db, 'elections-test2.json');
      const { results } = await db.prepare('SELECT entry FROM election_manifest ORDER BY ord, key').all();
      return json({ ...(head || {}), elections: (results || []).map((r) => parseJson(r.entry)) });
    }
    case 'summary': {
      const k = await electionKeyFor(db, key);
      const row = k ? await db.prepare('SELECT summary FROM election_summaries WHERE election_key = ?1').bind(k).first() : null;
      return row ? json(row.summary) : json({ error: 'summary not found' }, 404);
    }
    case 'provenance': {
      const k = await electionKeyFor(db, key);
      const row = k ? await db.prepare('SELECT shard FROM provenance_shards WHERE election_key = ?1').bind(k).first() : null;
      return row ? json(row.shard) : json({ error: 'provenance not found' }, 404);
    }
    case 'list': return json(await electionList(db, url));
    case 'detail': {
      const slug = await electionSlugFor(db, key);
      const row = slug ? await db.prepare('SELECT detail FROM election_details WHERE slug = ?1').bind(slug).first() : null;
      return row?.detail ? json(`{"schemaVersion":1,"item":${row.detail}}`) : json({ error: 'election not found' }, 404);
    }
    case 'contests': {
      const slug = await electionSlugFor(db, key);
      const row = slug ? await db.prepare('SELECT contests FROM election_details WHERE slug = ?1').bind(slug).first() : null;
      return row?.contests ? json(`{"schemaVersion":1,"items":${row.contests}}`) : json({ error: 'election not found' }, 404);
    }
    case 'record': return electionRecord(db, (url.searchParams.get('slug') || key).trim());
    default: return json({ error: `unknown view ${view}` }, 400);
  }
}

/** The Browse slug of an election from its key or slug. */
async function electionSlugFor(db, value) {
  if (!value) return null;
  const row = await db.prepare(`SELECT slug FROM election_cards WHERE (slug = ?1 OR key = ?1) AND entry_kind = 'election' ORDER BY (slug = ?1) DESC, ord LIMIT 1`).bind(value).first();
  return row?.slug || null;
}

/** One Browse election record by slug: an election's detail item, or a contest or overall entry. */
async function electionRecord(db, slugIn) {
  let slug = String(slugIn || '');
  if (slug.includes('__')) slug = slug.replace(/__/g, '-');
  const card = await db.prepare('SELECT slug, entry_kind AS entryKind, election_key AS electionKey FROM election_cards WHERE slug = ?1').bind(slug).first();
  if (!card) return json({ error: 'not found', slug }, 404);
  if (card.entryKind === 'election') {
    const row = await db.prepare('SELECT detail FROM election_details WHERE slug = ?1').bind(slug).first();
    return row?.detail ? json(`{"item":${row.detail}}`) : json({ error: 'not found', slug }, 404);
  }
  const parent = await electionSlugFor(db, card.electionKey);
  const row = parent ? await db.prepare('SELECT contests FROM election_details WHERE slug = ?1').bind(parent).first() : null;
  const item = (parseJson(row?.contests, []) || []).find((entry) => entry.slug === slug);
  return item ? json({ item, parent }) : json({ error: 'not found', slug }, 404);
}

/**
 * data/browse/elections-list.json, whole (no limit) or one page of it. Filtered pages answer
 * from the columns: body (slug or name), decade ("1990s"), q (words over the search text).
 */
async function electionList(db, url) {
  const head = (await documentBody(db, 'browse/elections-list.json')) || {};
  const where = [];
  const binds = [];
  const bind = (v) => `?${binds.push(v)}`;
  const bodies = url.searchParams.getAll('body').map((v) => v.trim()).filter(Boolean);
  if (bodies.length) where.push(`(body_slug IN (${bodies.map(bind).join(', ')}) OR body IN (${bodies.map(bind).join(', ')}))`);
  const decades = url.searchParams.getAll('decade').map((v) => v.trim()).filter(Boolean);
  if (decades.length) where.push(`decade IN (${decades.map(bind).join(', ')})`);
  for (const word of listFold(url.searchParams.get('q')).split(/\s+/).filter(Boolean).slice(0, 8)) where.push(`search_norm LIKE ${bind(`%${word}%`)}`);
  where.push('list_card IS NOT NULL');
  const clause = `WHERE ${where.join(' AND ')}`;
  const limitRaw = url.searchParams.get('limit');
  const limit = limitRaw ? Math.min(Math.max(1, Number(limitRaw) || 50), 1000) : null;
  const offset = Math.max(0, Number(url.searchParams.get('offset')) || 0);
  const page = limit ? ` LIMIT ${limit} OFFSET ${offset}` : '';
  const filtered = where.length > 1;
  const [rows, total] = await Promise.all([
    db.prepare(`SELECT list_card FROM election_cards ${clause} ORDER BY ord, slug${page}`).bind(...binds).all(),
    db.prepare(`SELECT COUNT(*) AS n FROM election_cards ${clause}`).bind(...binds).first(),
  ]);
  const items = (rows.results || []).map((r) => parseJson(r.list_card));
  // The whole list keeps `of` (a contest's place of its election in the list) valid; a page or a
  // filtered list cannot, so its entries carry their election's fields instead.
  if (!limit && !filtered) return { ...head, items };
  return { ...head, total: total?.n ?? items.length, limit, offset, items, partial: true };
}

export { isMarker };
