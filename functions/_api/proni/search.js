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
const CACHE_VERSION = 'v2';
const MAX_LIMIT = 60;
const DEFAULT_LIMIT = 25;
const DESC_PREVIEW = 600;

const FIELD_COL = { title: 'title', ref: 'ref', date: 'dates', dates: 'dates', description: 'description', desc: 'description', text: '{title description}' };

const cleanTerm = (t) => String(t).replace(/["]/g, '').trim();
const ftsPhrase = (t, col, prefix) => {
  const q = `"${cleanTerm(t)}"${prefix ? '*' : ''}`;
  return col ? `${col}:${q}` : q;
};

// Tokenize free text honoring "quotes", field:value, +require, -exclude.
function parseQuery(q) {
  const positives = [];
  const negatives = [];
  const re = /(-)?([a-zA-Z]+):"([^"]+)"|(-)?([a-zA-Z]+):(\S+)|(-)?"([^"]+)"|(-)?(\+)?(\S+)/g;
  let m;
  while ((m = re.exec(q)) !== null) {
    let neg = false, col = null, val = null;
    if (m[2]) { neg = !!m[1]; col = FIELD_COL[m[2].toLowerCase()]; val = m[3]; }
    else if (m[5]) { neg = !!m[4]; col = FIELD_COL[m[5].toLowerCase()]; val = m[6]; }
    else if (m[8]) { neg = !!m[7]; val = m[8]; }             // "phrase"
    else if (m[11]) { neg = !!m[9]; val = m[11]; }           // bare / +term
    if (!val) continue;
    // an unknown field: prefix (e.g. foo:) falls back to a plain term
    if (m[2] && col === undefined) { col = null; val = m[3]; }
    if (m[5] && col === undefined) { col = null; val = m[6]; }
    (neg ? negatives : positives).push({ col, val, isField: !!(m[2] || m[5]) });
  }
  return { positives, negatives };
}

function buildMatch(q, fields) {
  const { positives, negatives } = parseQuery(q || '');
  // per-field advanced boxes -> field-scoped positives
  for (const [key, col] of [['title', 'title'], ['description', 'description'], ['ref', 'ref'], ['text', '{title description}'], ['dates', 'dates']]) {
    const v = (fields[key] || '').trim();
    if (v) positives.push({ col, val: v, isField: true });
  }
  if (!positives.length && !negatives.length) return null;
  const parts = [];
  positives.forEach((p, i) => {
    const last = i === positives.length - 1 && !p.isField && cleanTerm(p.val).length >= 2;
    parts.push(ftsPhrase(p.val, p.col, last));
  });
  for (const n of negatives) parts.push(`NOT ${ftsPhrase(n.val, n.col, false)}`);
  return parts.join(' ').trim() || null;
}

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

export async function onRequestGet(context) {
  const cache = caches.default;
  const keyUrl = new URL(context.request.url);
  keyUrl.searchParams.set('_cv', CACHE_VERSION);
  const cacheKey = new Request(keyUrl.toString(), { method: 'GET' });
  const hit = await cache.match(cacheKey);
  if (hit) return hit;
  const resp = await handle(context);
  if (resp.status === 200) context.waitUntil(cache.put(cacheKey, resp.clone()));
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

  const match = buildMatch(q, fields);
  const hasFilters = letter || Number.isFinite(from) || Number.isFinite(to);
  if (!match && !hasFilters) return json({ query: q, results: [], count: 0 });

  // WHERE fragments shared by both modes
  const where = [];
  const binds = [];
  if (letter && /^[A-Z]$/.test(letter)) { where.push('p.ref LIKE ?'); binds.push(letter + '%'); }
  if (Number.isFinite(from)) { where.push('p.end_year >= ?'); binds.push(from); }
  if (Number.isFinite(to)) { where.push('p.start_year <= ?'); binds.push(to); }

  try {
    const out = [];
    const seen = new Set();

    // exact-ref fast path (page 1 only, no explicit sort)
    if (!offset && q && !/\s/.test(q) && !q.includes(':') && sort === 'relevance') {
      const ex = await db.prepare(`SELECT ${SELECT_COLS} FROM proni p WHERE p.ref = ?1 LIMIT 1`).bind(q.toUpperCase()).all();
      for (const r of ex.results || []) { out.push(mapRow(r, true)); seen.add(r.ref); }
    }

    let sql, bindArr;
    if (match) {
      const order = sort === 'relevance' ? 'bm25(proni_fts)' : `${ORDER[sort] || 'p.ref'} ${dir}`;
      const w = where.length ? ' AND ' + where.join(' AND ') : '';
      sql = `SELECT ${SELECT_COLS}${sort === 'relevance' ? ', bm25(proni_fts) AS rank' : ''}
             FROM proni_fts f JOIN proni p ON p.rowid = f.rowid
             WHERE proni_fts MATCH ?${w}
             ORDER BY ${order} LIMIT ? OFFSET ?`;
      bindArr = [match, ...binds, limit, offset];
    } else {
      const order = `${ORDER[sort] && sort !== 'relevance' ? ORDER[sort] : 'p.ref'} ${dir}`;
      sql = `SELECT ${SELECT_COLS} FROM proni p
             WHERE ${where.join(' AND ')}
             ORDER BY ${order} LIMIT ? OFFSET ?`;
      bindArr = [...binds, limit, offset];
    }
    const { results } = await db.prepare(sql).bind(...bindArr).all();
    for (const r of results || []) { if (!seen.has(r.ref)) out.push(mapRow(r, false)); }

    return json({ query: q, match, sort, dir, letter, from: from || null, to: to || null, offset, limit, count: out.length, results: out.slice(0, limit + 1) });
  } catch (error) {
    return json({ query: q, results: [], error: String(error && error.message || error) }, 500);
  }
}
