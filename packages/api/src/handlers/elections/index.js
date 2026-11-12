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
 *   view=citations&key=<key>[&constituency=<seq>|&constituencyName=<name>]
 *                                 the original sources of the results: one contest's citations, or an
 *                                 election's distinct sources with how many contests cite each
 *   view=citations&person=<id>    the citations of every contest a person stood in
 *   view=areas&key=<key|slug>     a national contest's results by area (the presidential elections by
 *                                 Dail constituency): per area, each candidate's figure at every count,
 *                                 the candidates named by their one national candidacy; areas [] when
 *                                 the election has none
 *
 * A retired contest slug (packages/core/src/election-slug-aliases.js) in contest= or in a record
 * view's slug= answers 301 to the same request with the slug that replaced it.
 *
 * Every list is ordered by stored columns that end in the key (data design 4.3): a delta load
 * reorders rowids, and SQLite promises no order without ORDER BY.
 */
import { reportError } from '../_error.js';
import { resolveElectionSlugAlias } from '../../../../core/src/election-slug-aliases.js';
import {
  bundleObject, cachedJson, documentBody, electionAggregates, isMarker, parseJson, withoutMarkers,
} from '../_records.js';
import { binding } from '../../../../config/src/config.js';
import { fromD1 } from '../../../../storage/src/d1.js';
import { areaResultsAnswer } from '../../../../core/src/area-results.mjs';
import { foldSearchText } from '../../../../core/src/format.js';
import { ELECTIONS, ELECTIONS_API, ELECTION_CARDS } from '../../queries/elections.js';

// Bump whenever the RESPONSE SHAPE changes, not just when the data does: it is part of the
// cache key. elections-8: the records tables; ORDER BY on every list; the views above.
/** @typedef {import('../../types.js').ApiContext} ApiContext */
/** @typedef {import('../../../../storage/src/store.js').RecordStore} RecordStore */
/** @typedef {import('../../../../types/index.js').ApiV1.ElectionsListAnswer} ElectionsListAnswer */
/**
 * A bundle result as lite=1 trims it: the fields it drops and the two it adds.
 * @typedef {object} LiteResult
 * @property {unknown} [elected]
 * @property {unknown} [countGroup]
 * @property {{ Constituency?: { countGroup?: Array<{ Count_Number?: unknown }> } }} [animationPayload]
 * @property {number} [animationRowCount]
 * @property {boolean} [animationHasMultipleCounts]
 */

const CACHE_VERSION = 'elections-8';

// Fields of a contest that the constituency views never carried (they live in other tables).
const CONTEST_TABLE_FIELDS = ['candidates', 'countGroup', 'animationPayload', 'featureId', 'featureName', 'matchName', 'matched'];

/**
 * Columns first, then the stored record over them, as the old meta column was spread.
 * @param {Record<string, unknown> | null} row
 * @returns {Record<string, unknown> | null}
 */
function withMeta(row) {
  if (!row) return row;
  const { meta, ...rest } = row;
  const parsed = /** @type {Record<string, unknown> | null} */ (parseJson(meta));
  return parsed ? { ...rest, ...withoutMarkers(parsed) } : rest;
}

/** @param {Record<string, unknown>} row */
function contestRow(row) {
  const out = /** @type {Record<string, unknown>} */ (withMeta(row));
  for (const k of CONTEST_TABLE_FIELDS) delete out[k];
  return out;
}

/** @param {import('../../types.js').ApiContext} context */
export async function onRequestGet(context) {
  const moved = retiredSlugRedirect(new URL(context.request.url));
  if (moved) return moved;
  return cachedJson(context, CACHE_VERSION, () => handle(context));
}

/**
 * The same request with a retired contest slug replaced, as a 301, or null. contest= holds the
 * contest's own slug, so it is read with its election's slug in front (the key with "__" made
 * "-"); a record view's slug= is the whole slug.
 * @param {URL} url
 */
export function retiredSlugRedirect(url) {
  const params = url.searchParams;
  const view = (params.get('view') || '').trim();
  const key = (params.get('key') || '').trim();
  const target = new URL(url);
  if (view === 'record') {
    const name = params.has('slug') ? 'slug' : 'key';
    const slug = (params.get(name) || '').trim().replace(/__/g, '-');
    const resolved = slug ? resolveElectionSlugAlias(slug) : slug;
    if (!slug || resolved === slug.toLowerCase()) return null;
    target.searchParams.set(name, resolved);
  } else {
    const contest = (params.get('contest') || '').trim().toLowerCase();
    if (!contest || !key || view) return null;
    const electionSlug = key.replace(/__/g, '-').toLowerCase();
    const full = `${electionSlug}-${contest}`;
    const resolved = resolveElectionSlugAlias(full);
    if (resolved === full || !resolved.startsWith(`${electionSlug}-`)) return null;
    target.searchParams.set('contest', resolved.slice(electionSlug.length + 1));
  }
  return new Response(null, {
    status: 301,
    headers: { Location: target.toString(), 'Cache-Control': 'public, max-age=86400', 'Access-Control-Allow-Origin': '*' },
  });
}

/**
 * Case, accents and punctuation folded, so "Cork North-Central" finds "Cork North Central".
 * @param {unknown} value
 */
function foldName(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const json = (/** @type {unknown} */ payload, status = 200) => new Response(typeof payload === 'string' ? payload : JSON.stringify(payload), {
  status,
  headers: {
    'Content-Type': 'application/json',
    'Cache-Control': status === 200 ? 'public, max-age=300' : 'no-store',
    'Access-Control-Allow-Origin': '*',
  },
});

/**
 * An election key from a key or a Browse slug (dail-eireann-2024-11-29).
 * @param {RecordStore} db
 * @param {string} value
 * @returns {Promise<string | null>}
 */
async function electionKeyFor(db, value) {
  if (!value) return null;
  const row = /** @type {{ key: string } | null} */ (await db.first(ELECTIONS_API.keyFor, [value]));
  return row?.key || null;
}

/** @param {ApiContext} context */
async function handle(context) {
  const url = new URL(context.request.url);
  const key = (url.searchParams.get('key') || '').trim();
  const body = (url.searchParams.get('body') || '').trim();
  const view = (url.searchParams.get('view') || '').trim();
  let constituency = url.searchParams.get('constituency');
  const constituencyName = (url.searchParams.get('constituencyName') || '').trim();
  const contestSlugParam = (url.searchParams.get('contest') || '').trim();

  const bound = binding(context.env, 'ELECTIONS_DB');
  if (!bound) return json({ error: 'ELECTIONS_DB binding not configured' }, 503);
  // through the storage adapter (packages/storage/); the SQL is named in queries/elections.js
  /** @type {RecordStore} */
  const db = fromD1(bound);

  try {
    if (view) return await handleView(db, view, url);

    // Index: every election, or those for one body. Ordered by date then key: 76 dates are
    // shared by several elections.
    if (!key) {
      const results = body
        ? await db.all(ELECTIONS_API.indexOfBody, [body])
        : await db.all(ELECTIONS_API.index);
      return json({ elections: results || [], count: (results || []).length });
    }

    // A constituency by its Browse slug (contest=) or by name.
    if (contestSlugParam && (constituency === null || constituency === '')) {
      const row = await db.first(ELECTIONS_API.contestBySlug, [key, contestSlugParam.toLowerCase()]);
      if (!row) return json({ error: 'constituency not found' }, 404);
      constituency = String(row.seq);
    }
    if (constituencyName && (constituency === null || constituency === '')) {
      const names = /** @type {Array<{ seq: number, name: string }>} */ (await db.all(ELECTIONS_API.contestNames, [key]));
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
        db.first(ELECTIONS_API.contest, [key, seq]),
        db.all(ELECTIONS_API.contestCandidates, [key, seq]),
        db.all(ELECTIONS_API.contestCounts, [key, seq]),
        db.first(ELECTIONS_API.contestFeature, [key, seq]),
        db.first(ELECTIONS.contestAnimation, [key, seq]),
      ]);
      if (!cons) return json({ error: 'constituency not found' }, 404);
      return json({
        constituency: contestRow(cons),
        feature: feature || null,
        candidates: cands.map(withMeta),
        counts,
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
        for (const result of /** @type {{ results?: LiteResult[] }} */ (bundle).results || []) {
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
      db.first(ELECTIONS_API.election, [key]),
      db.all(ELECTIONS_API.electionContests, [key]),
      electionAggregates(db, key),
    ]);
    if (!election) return json({ error: 'election not found' }, 404);
    const head = /** @type {Record<string, unknown>} */ (withMeta(election));
    for (const k of ['matchedCount', 'unmatchedCount', 'loadable']) delete head[k];
    for (const [name, value] of aggregates) head[name] = value;
    const rows = cons.map((/** @type {Record<string, unknown>} */ row) => {
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

const listFold = (/** @type {unknown} */ value) => foldSearchText(value || '');

/**
 * @param {RecordStore} db
 * @param {string} view
 * @param {URL} url
 */
async function handleView(db, view, url) {
  const key = (url.searchParams.get('key') || '').trim();
  switch (view) {
    case 'manifest': {
      const head = await documentBody(db, 'elections-test2.json');
      const results = /** @type {Array<{ entry: string }>} */ (await db.all(ELECTIONS_API.manifest));
      return json({ ...(head || {}), elections: results.map((r) => parseJson(r.entry)) });
    }
    case 'summary': {
      const k = await electionKeyFor(db, key);
      const row = k ? await db.first(ELECTIONS_API.summary, [k]) : null;
      return row ? json(row.summary) : json({ error: 'summary not found' }, 404);
    }
    case 'provenance': {
      const k = await electionKeyFor(db, key);
      const row = k ? await db.first(ELECTIONS_API.provenance, [k]) : null;
      return row ? json(row.shard) : json({ error: 'provenance not found' }, 404);
    }
    case 'list': return json(await electionList(db, url));
    case 'detail': {
      const slug = await electionSlugFor(db, key);
      const row = slug ? await db.first(ELECTION_CARDS.detail, [slug]) : null;
      return row?.detail ? json(`{"schemaVersion":1,"item":${row.detail}}`) : json({ error: 'election not found' }, 404);
    }
    case 'contests': {
      const slug = await electionSlugFor(db, key);
      const row = slug ? await db.first(ELECTION_CARDS.contests, [slug]) : null;
      return row?.contests ? json(`{"schemaVersion":1,"items":${row.contests}}`) : json({ error: 'election not found' }, 404);
    }
    case 'record': return electionRecord(db, (url.searchParams.get('slug') || key).trim());
    case 'citations': return json(await citationsView(db, url));
    case 'areas': {
      const k = await electionKeyFor(db, key);
      const row = /** @type {{ key: string, displayTitle: string | null, body: string | null, date: string | null, modes: string | null } | null} */ (k ? await db.first(ELECTIONS_API.areaModes, [k]) : null);
      if (!row) return json({ error: 'election not found' }, 404);
      const modes = /** @type {Parameters<typeof areaResultsAnswer>[1]} */ (parseJson(row.modes, []));
      const national = Array.isArray(modes) && modes.some((m) => m?.dataKind === 'area-results')
        ? /** @type {Array<{ id: unknown, name: unknown, party: unknown, personId: unknown, personSlug?: unknown, colour?: unknown }>} */ (await db.all(ELECTIONS_API.contestCandidates, [row.key, 0]))
        : [];
      return json(areaResultsAnswer(row, modes, national));
    }
    default: return json({ error: `unknown view ${view}` }, 400);
  }
}

/**
 * The original sources of the results (QA H5, 11 Nov 2026): Browse and the record pages cite
 * these, never "Civgraph Browse election index", for a contest, an election or a person.
 * @param {RecordStore} db
 * @param {URL} url
 */
async function citationsView(db, url) {
  const person = (url.searchParams.get('person') || '').trim();
  if (person) {
    const rows = /** @type {Array<Record<string, unknown> & { electionKey: string, seq: number, constituency: string }>} */ (await db.all(ELECTIONS_API.personCitations, [person]));
    /** @type {Map<string, { electionKey: string, seq: number, constituency: string, citations: Record<string, unknown>[] }>} */
    const byContest = new Map();
    for (const { electionKey, seq, constituency, ...citation } of rows) {
      const id = `${electionKey}|${seq}`;
      if (!byContest.has(id)) byContest.set(id, { electionKey, seq, constituency, citations: [] });
      byContest.get(id)?.citations.push(citation);
    }
    return { person, candidacies: [...byContest.values()] };
  }
  const key = await electionKeyFor(db, (url.searchParams.get('key') || '').trim());
  if (!key) return { key: null, citations: [] };
  let seq = url.searchParams.get('constituency');
  const name = (url.searchParams.get('constituencyName') || '').trim();
  if ((seq === null || seq === '') && name) {
    const names = /** @type {Array<{ seq: number, name: string }>} */ (await db.all(ELECTIONS_API.contestNames, [key]));
    const match = names.find((row) => row.name === name) || names.find((row) => foldName(row.name) === foldName(name));
    seq = match ? String(match.seq) : null;
    if (seq === null) return { key, constituency: name, citations: [] };
  }
  if (seq !== null && seq !== '' && Number.isInteger(Number(seq))) {
    return { key, seq: Number(seq), citations: await db.all(ELECTIONS_API.contestCitations, [key, Number(seq)]) };
  }
  const [sources, count] = await Promise.all([
    db.all(ELECTIONS_API.electionCitations, [key]),
    db.first(ELECTIONS_API.electionContestCount, [key]),
  ]);
  return { key, contests: Number(/** @type {{ n?: number } | null} */ (count)?.n) || 0, sources };
}

/**
 * The Browse slug of an election from its key or slug.
 * @param {RecordStore} db
 * @param {string | null} value
 * @returns {Promise<string | null>}
 */
async function electionSlugFor(db, value) {
  if (!value) return null;
  const row = /** @type {{ slug: string } | null} */ (await db.first(ELECTION_CARDS.slugFor, [value]));
  return row?.slug || null;
}

/**
 * One Browse election record by slug: an election's detail item, or a contest or overall entry.
 * @param {RecordStore} db
 * @param {string} slugIn
 */
async function electionRecord(db, slugIn) {
  let slug = String(slugIn || '');
  if (slug.includes('__')) slug = slug.replace(/__/g, '-');
  const card = /** @type {{ slug: string, entryKind: string | null, electionKey: string | null } | null} */ (await db.first(ELECTION_CARDS.card, [slug]));
  if (!card) return json({ error: 'not found', slug }, 404);
  if (card.entryKind === 'election') {
    const row = await db.first(ELECTION_CARDS.detail, [slug]);
    return row?.detail ? json(`{"item":${row.detail}}`) : json({ error: 'not found', slug }, 404);
  }
  const parent = await electionSlugFor(db, card.electionKey);
  const row = parent ? await db.first(ELECTION_CARDS.contests, [parent]) : null;
  const item = (/** @type {Array<{ slug?: unknown }> | null} */ (parseJson(row?.contests, [])) || []).find((/** @type {{ slug?: unknown }} */ entry) => entry.slug === slug);
  return item ? json({ item, parent }) : json({ error: 'not found', slug }, 404);
}

/**
 * data/browse/elections-list.json, whole (no limit) or one page of it. Filtered pages answer
 * from the columns: body (slug or name), decade ("1990s"), q (words over the search text).
 * @param {RecordStore} db
 * @param {URL} url
 * @returns {Promise<ElectionsListAnswer>}
 */
async function electionList(db, url) {
  const head = /** @type {ElectionsListAnswer} */ ((await documentBody(db, 'browse/elections-list.json')) || {});
  /** @type {string[]} */
  const where = [];
  /** @type {string[]} */
  const binds = [];
  const bind = (/** @type {string} */ v) => `?${binds.push(v)}`;
  const bodies = url.searchParams.getAll('body').map((v) => v.trim()).filter(Boolean);
  if (bodies.length) where.push(ELECTION_CARDS.bodyFilter(bodies.map(bind), bodies.map(bind)));
  const decades = url.searchParams.getAll('decade').map((v) => v.trim()).filter(Boolean);
  if (decades.length) where.push(ELECTION_CARDS.decadeFilter(decades.map(bind)));
  for (const word of listFold(url.searchParams.get('q')).split(/\s+/).filter(Boolean).slice(0, 8)) where.push(ELECTION_CARDS.wordFilter(bind(`%${word}%`)));
  where.push('list_card IS NOT NULL');
  const clause = `WHERE ${where.join(' AND ')}`;
  const limitRaw = url.searchParams.get('limit');
  const limit = limitRaw ? Math.min(Math.max(1, Number(limitRaw) || 50), 1000) : null;
  const offset = Math.max(0, Number(url.searchParams.get('offset')) || 0);
  const page = limit ? ` LIMIT ${limit} OFFSET ${offset}` : '';
  const filtered = where.length > 1;
  const [rows, total] = /** @type {[Array<{ list_card: string }>, { n: number } | null]} */ (await Promise.all([
    db.all(ELECTION_CARDS.list(clause, page), binds),
    db.first(ELECTION_CARDS.listCount(clause), binds),
  ]));
  const items = rows.map((r) => /** @type {ElectionsListAnswer['items'][number]} */ (parseJson(r.list_card)));
  // The whole list keeps `of` (a contest's place of its election in the list) valid; a page or a
  // filtered list cannot, so its entries carry their election's fields instead.
  if (!limit && !filtered) return { ...head, items };
  return { ...head, total: total?.n ?? items.length, limit, offset, items, partial: true };
}

export { isMarker };
