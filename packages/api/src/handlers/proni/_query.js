/**
 * Shared query-building for the PRONI endpoints (search, count, export) so they
 * interpret the same operators and filters identically.
 *
 *   q      free text: "phrase", -exclude, +require, field:value
 *          (title/ref/date/dates/description/desc/text)
 *   fields per-field advanced boxes: {title,description,ref,text,dates}
 *   filters letter (A-Z ref prefix) + from/to (inclusive year range)
 */
export const FIELD_COL = { title: 'title', ref: 'ref', date: 'dates', dates: 'dates', description: 'description', desc: 'description', text: '{title description}' };

const cleanTerm = (t) => String(t).replace(/["]/g, '').trim();
const ftsPhrase = (t, col, prefix) => {
  const q = `"${cleanTerm(t)}"${prefix ? '*' : ''}`;
  return col ? `${col}:${q}` : q;
};

export function parseQuery(q) {
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
    if (m[2] && col === undefined) { col = null; val = m[3]; }
    if (m[5] && col === undefined) { col = null; val = m[6]; }
    (neg ? negatives : positives).push({ col, val, isField: !!(m[2] || m[5]) });
  }
  return { positives, negatives };
}

export function buildMatch(q, fields = {}) {
  const { positives, negatives } = parseQuery(q || '');
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

// Base-table filters shared by both query modes. `letter` matches a ref prefix;
// `top` restricts to top-level records (fonds, parent='') for letter-browse;
// `level`/`access` are exact-match column filters (advanced search); from/to
// bound the parsed year range inclusively.
//
// The year range is matched against the Extracted Dates layer
// (ext.ext_start_year / ext_end_year), so any caller that passes from/to must
// have `ext` in scope. This used to return a `joinExt` flag so callers could add
// the join conditionally -- but both callers (proni/search.js, proni/export.js)
// always LEFT JOIN ext regardless, and neither ever read the flag. It was a
// documented contract describing an arrangement that was never built, so it has
// been removed rather than left to mislead the next caller.
export function buildFilters({ letter, from, to, top, level, access }) {
  const where = [];
  const binds = [];
  const L = (letter || '').slice(0, 1).toUpperCase();
  if (L && /^[A-Z]$/.test(L)) { where.push('p.ref LIKE ?'); binds.push(L + '%'); }
  if (top) where.push("p.parent = ''");
  if (level) { where.push('p.level = ?'); binds.push(level); }
  if (access) { where.push('p.access = ?'); binds.push(access); }
  if (Number.isFinite(from)) { where.push('ext.ext_end_year >= ?'); binds.push(from); }
  if (Number.isFinite(to)) { where.push('ext.ext_start_year <= ?'); binds.push(to); }
  return { where, binds };
}
