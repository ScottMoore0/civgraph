/**
 * GET /_api/qub/search: the Independent QUB Catalogue's search (FTS5 over QUB_DB).
 *
 *   q, scope (in|out|all; default in), tag (A-H, comma-separated), from, to,
 *   sort (relevance|year|title), dir (asc|desc), limit, offset
 *
 * Answers one more row than `limit` so the client knows there is a next page, and on the first
 * page (offset 0) the number of matches, counted up to LIMITS.countCap (`countCapped` says when
 * there are more). Every row carries its QUB catalogue link (the reuse condition, _query.js).
 */
import { binding } from '@civgraph/config';
import { fromD1 } from '@civgraph/storage/d1.js';
import { reportError } from '../_error.js';
import { QUB } from '../../queries/qub.js';
import { buildFilters, buildMatch, LIMITS, qubRecordUrl, readParams, sortKey, tagList } from './_query.js';

/** @typedef {import('@civgraph/types').ApiV1.QubSearchResultsAnswer} QubSearchResultsAnswer */
/**
 * A row of the search list (queries/qub.js LIST_COLS).
 * @typedef {{ mmsId: string, title: string | null, author: string | null, imprint: string | null,
 *   year: number | null, format: string | null, scope: number | null, tags: string | null }} QubListRow
 */

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=300' };

/**
 * One row of the answer.
 * @param {QubListRow} r
 * @returns {QubSearchResultsAnswer['results'][number]}
 */
export function mapRow(r) {
  return {
    mmsId: String(r.mmsId), title: r.title || '(untitled)', author: r.author || '', imprint: r.imprint || '',
    year: r.year ?? null, format: r.format || '', inScope: r.scope === 1, tags: tagList(r.tags),
    url: `/qub/${r.mmsId}`, qubUrl: qubRecordUrl(String(r.mmsId)),
  };
}

/**
 * The statements one search runs: a page, and on the first page a capped count.
 * @param {import('./_query.js').QubParams} p
 * @returns {{ page: { sql: string, params: unknown[] }, count: { sql: string, params: unknown[] } | null } | null}
 */
export function searchPlan(p) {
  const match = buildMatch(p);
  const { where, binds } = buildFilters(p);
  if (!match && !where.length) return null;
  const cap = LIMITS.countCap + 1;
  if (match) {
    const key = sortKey(p.sort);
    const dir = p.sort === 'relevance' ? 'ASC' : p.dir;
    return {
      page: { sql: QUB.searchMatched(where, key, dir), params: [match, ...binds, p.limit + 1, p.offset] },
      count: p.offset ? null : { sql: QUB.countMatched(where), params: [match, ...binds, cap] },
    };
  }
  const order = `${p.sort === 'title' ? 'q.title' : 'q.year'} ${p.dir}, q.mms_id`;
  return {
    page: { sql: QUB.searchFiltered(where, order), params: [...binds, p.limit + 1, p.offset] },
    count: p.offset ? null : { sql: QUB.countFiltered(where), params: [...binds, cap] },
  };
}

/** @param {import('../../types.js').ApiContext} context */
export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const p = readParams(url.searchParams);
  const json = (/** @type {unknown} */ body, status = 200) => new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
  const bound = binding(context.env, 'QUB_DB');
  if (!bound) return json({ error: 'QUB_DB binding not configured' }, 503);
  const plan = searchPlan(p);
  const echo = { query: p.q, scope: p.scope, tags: p.tags, from: p.from, to: p.to, sort: p.sort, offset: p.offset, limit: p.limit };
  if (!plan) return json({ ...echo, results: [], count: 0, total: 0, totalCapped: false });
  try {
    // through the storage adapter (packages/storage/); the SQL is named in queries/qub.js
    const db = fromD1(bound);
    const statements = plan.count ? [plan.page, plan.count] : [plan.page];
    const [rows, countRows] = await db.batch(statements);
    const results = /** @type {QubListRow[]} */ (/** @type {unknown} */ (rows ?? [])).map(mapRow);
    const n = countRows ? Number(countRows[0]?.['n'] ?? 0) : null;
    return json({
      ...echo, results, count: results.length,
      total: n === null ? null : Math.min(n, LIMITS.countCap), totalCapped: n !== null && n > LIMITS.countCap,
    });
  } catch (error) {
    return json({ ...echo, results: [], error: 'Search failed', ...reportError(context.env, 'qub-search', error) }, 500);
  }
}
