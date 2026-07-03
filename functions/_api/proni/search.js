/**
 * PRONI catalogue search over Cloudflare D1 (SQLite + FTS5). Powers both the
 * Browse tab search box and the "Civgraph PRONI Search" app.
 *
 * GET /_api/proni/search
 *   q       free text with operators: "phrase", -exclude, +require,
 *           title: ref: date: description: text:  (field-scoped)
 *   title,description,ref,text,dates   per-field boxes (advanced search)
 *   from,to    year range (inclusive), matched against parsed start/end year
 *   letter     A-Z: reference begins with this letter
 *   sort       relevance|ref|title|date|level   dir=asc|desc
 *   limit,offset   infinite scroll
 *
 * FTS index covers ref,title,dates,description. Base table has parsed
 * start_year/end_year for date filtering.
 */
import { buildMatch, buildFilters } from './_query.js';

const CACHE_VERSION = 'v9';
const MAX_LIMIT = 60;
const DEFAULT_LIMIT = 25;
const DESC_PREVIEW = 160; // trimmed list preview — full text is fetched on the record page

const ORDER = {
  relevance: 'bm25(proni_fts)',
  ref: 'p.ref',
  title: 'p.title',
  date: 'p.start_year',
  level: 'p.level',
};

const SELECT_COLS = `p.ref, p.slug, p.title, p.level, p.dates, p.parent,
  p.parent_slug AS parentSlug, p.has_children AS hasChildren, p.fond,
  p.access, p.digital_record AS digitalRecord, p.start_year AS startYear, p.end_year AS endYear,
  substr(p.description,1,${DESC_PREVIEW + 1}) AS descPreview, length(p.description) AS descLen`;

function mapRow(r, exact) {
  const desc = r.descPreview || '';
  const truncated = (r.descLen || 0) > DESC_PREVIEW;
  return {
    ref: r.ref, slug: r.slug, title: r.title || r.ref, level: r.level || '',
    dates: r.dates || '', access: r.access || '', digitalRecord: r.digitalRecord || '',
    parent: r.parent || '', parentSlug: r.parentSlug || '', hasChildren: !!r.hasChildren,
    fond: r.fond || '', startYear: r.startYear ?? null, endYear: r.endYear ?? null,
    description: truncated ? desc.slice(0, DESC_PREVIEW) : desc,
    descTruncated: truncated,
    exact: !!exact,
    url: `/browse/#/proni/${encodeURIComponent(r.slug)}`,
  };
}

const JSON_HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600, s-maxage=86400', 'Access-Control-Allow-Origin': '*' };

export async function onRequestGet(context) {
  const cache = caches.default;
  const keyUrl = new URL(context.request.url);
  keyUrl.searchParams.set('_cv', CACHE_VERSION);
  const cacheKey = new Request(keyUrl.toString(), { method: 'GET' });
  const hit = await cache.match(cacheKey);
  if (hit) return hit;

  // Second tier: Workers KV is replicated to every edge, so a query answered
  // anywhere is fast everywhere (the per-PoP cache above only helps locally).
  // Feature-detected — no-op until a PRONI_KV binding is added.
  const kv = context.env.PRONI_KV;
  const kvKey = `search:${CACHE_VERSION}:${keyUrl.search}`;
  if (kv) {
    const cached = await kv.get(kvKey);
    if (cached) {
      const resp = new Response(cached, { headers: JSON_HEADERS });
      context.waitUntil(cache.put(cacheKey, resp.clone()));
      return resp;
    }
  }

  const resp = await handle(context);
  if (resp.status === 200) {
    context.waitUntil(cache.put(cacheKey, resp.clone()));
    if (kv) context.waitUntil(resp.clone().text().then((b) => kv.put(kvKey, b, { expirationTtl: 86400 })));
  }
  return resp;
}

async function handle(context) {
  const url = new URL(context.request.url);
  const g = (k) => (url.searchParams.get(k) || '').trim();
  const q = g('q');
  const fields = { title: g('title'), description: g('description'), ref: g('ref'), text: g('text'), dates: g('dates') };
  const from = parseInt(g('from'), 10); const to = parseInt(g('to'), 10);
  const letter = g('letter').slice(0, 1).toUpperCase();
  const sort = g('sort') || 'relevance';
  const dir = g('dir').toLowerCase() === 'asc' ? 'ASC' : 'DESC';
  const limit = Math.min(parseInt(g('limit'), 10) || DEFAULT_LIMIT, MAX_LIMIT);
  const offset = Math.max(parseInt(g('offset'), 10) || 0, 0);

  const json = (b, s = 200) => new Response(JSON.stringify(b), {
    status: s,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600, s-maxage=86400', 'Access-Control-Allow-Origin': '*' },
  });

  const db = context.env.PRONI_DB;
  if (!db) return json({ results: [], error: 'PRONI_DB binding not configured' }, 503);

  const top = g('top') === '1'; // letter-browse: top-level records only, alphabetical
  const level = g('level'); const access = g('access');
  const match = buildMatch(q, fields);
  const hasFilters = letter || top || level || access || Number.isFinite(from) || Number.isFinite(to);
  if (!match && !hasFilters) return json({ query: q, results: [], count: 0 });

  // WHERE fragments shared by both modes
  const { where, binds } = buildFilters({ letter, from, to, top, level, access });

  // Serve reads from a nearby D1 replica when replication is enabled (falls back
  // to the primary otherwise; harmless where withSession is unavailable).
  const rdb = db.withSession ? db.withSession('first-unconstrained') : db;

  try {
    const out = [];
    const seen = new Set();

    // exact-ref fast path (page 1 only, no explicit sort)
    if (!offset && q && !/\s/.test(q) && !q.includes(':') && sort === 'relevance') {
      const ex = await rdb.prepare(`SELECT ${SELECT_COLS} FROM proni p WHERE p.ref = ?1 LIMIT 1`).bind(q.toUpperCase()).all();
      for (const r of ex.results || []) { out.push(mapRow(r, true)); seen.add(r.ref); }
    }

    let sql, bindArr;
    if (match) {
      const order = top ? 'p.ref ASC' : (sort === 'relevance' ? 'bm25(proni_fts)' : `${ORDER[sort] || 'p.ref'} ${dir}`);
      const w = where.length ? ' AND ' + where.join(' AND ') : '';
      sql = `SELECT ${SELECT_COLS}${sort === 'relevance' ? ', bm25(proni_fts) AS rank' : ''}
             FROM proni_fts f JOIN proni p ON p.rowid = f.rowid
             WHERE proni_fts MATCH ?${w}
             ORDER BY ${order} LIMIT ? OFFSET ?`;
      bindArr = [match, ...binds, limit, offset];
    } else {
      const order = top ? 'p.ref ASC' : `${ORDER[sort] && sort !== 'relevance' ? ORDER[sort] : 'p.ref'} ${dir}`;
      sql = `SELECT ${SELECT_COLS} FROM proni p
             WHERE ${where.join(' AND ')}
             ORDER BY ${order} LIMIT ? OFFSET ?`;
      bindArr = [...binds, limit, offset];
    }
    const { results } = await rdb.prepare(sql).bind(...bindArr).all();
    for (const r of results || []) { if (!seen.has(r.ref)) out.push(mapRow(r, false)); }

    return json({ query: q, match, sort, dir, letter, from: from || null, to: to || null, offset, limit, count: out.length, results: out.slice(0, limit + 1) });
  } catch (error) {
    return json({ query: q, results: [], error: String(error && error.message || error) }, 500);
  }
}
