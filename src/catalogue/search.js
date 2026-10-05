/**
 * Search for the rebuilt catalogue. Pure: no DOM, no fetch -- the caller supplies the catalogue
 * (data/catalogue/catalogue.json) and, when a place search is wanted, the place list
 * (data/catalogue/places.json). Tested by tests/catalogue/search.test.mjs.
 *
 * What it does that the current search does not:
 *   - typo tolerance: a word of five letters or more matches with one letter wrong
 *     ("townlnds" finds Townlands);
 *   - periods: a year ("1911") or decade ("1900s") in the query is a date filter, not a word,
 *     so "census 1911" finds census maps whose editions include 1911;
 *   - series, not rows: a match on one edition returns its series, with the matching editions;
 *   - constituencies: "Dungannon" finds the elections Dungannon was contested in;
 *   - places: a named ward, district or parish returns the maps that draw it.
 */

const DIACRITICS = /[̀-ͯ]/g;
export function normalise(text) {
  return String(text ?? '')
    .normalize('NFKD').replace(DIACRITICS, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}
export const tokenise = (text) => normalise(text).split(' ').filter(Boolean);

const STOP = new Set(['the', 'of', 'and', 'in', 'a', 'an', 'for', 'to', 'on', 'map', 'maps']);

/** Years and decades in a query, and the words left over. */
export function parseQuery(query) {
  const words = [];
  let from = null;
  let to = null;
  const widen = (a, b) => { from = from === null ? a : Math.min(from, a); to = to === null ? b : Math.max(to, b); };
  for (const raw of String(query ?? '').split(/\s+/)) {
    const w = raw.trim();
    if (!w) continue;
    let m;
    if ((m = /^(1[5-9]\d|20\d)0s$/.exec(w))) widen(Number(`${m[1]}0`), Number(`${m[1]}9`));
    else if ((m = /^(1[5-9]\d\d|20\d\d)\s*[-–]\s*(1[5-9]\d\d|20\d\d)$/.exec(w))) widen(Number(m[1]), Number(m[2]));
    else if ((m = /^(1[5-9]\d\d|20\d\d)$/.exec(w))) widen(Number(m[1]), Number(m[1]));
    else words.push(...tokenise(w));
  }
  const meaningful = words.filter((t) => !STOP.has(t));
  return { words: meaningful.length ? meaningful : words, period: from === null ? null : { from, to } };
}

/** Damerau-free edit distance, stopping as soon as it exceeds `max`. */
export function withinOneEdit(a, b) {
  if (a === b) return true;
  const la = a.length;
  const lb = b.length;
  if (Math.abs(la - lb) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < la && j < lb) {
    if (a[i] === b[j]) { i += 1; j += 1; continue; }
    edits += 1;
    if (edits > 1) return false;
    if (la > lb) i += 1;
    else if (lb > la) j += 1;
    else { i += 1; j += 1; }
  }
  return edits + (la - i) + (lb - j) <= 1;
}

/** How well a query word matches a document word: 1 exact, 0.8 prefix, 0.5 one typo, 0 none. */
export function wordMatch(q, d) {
  if (d === q) return 1;
  if (q.length >= 2 && d.startsWith(q)) return 0.8;
  if (q.length >= 5 && withinOneEdit(q, d)) return 0.5;
  if (q.length >= 6 && d.length > q.length && withinOneEdit(q, d.slice(0, q.length))) return 0.4;
  return 0;
}

function bestIn(word, tokens) {
  let best = 0;
  for (const t of tokens) {
    const s = wordMatch(word, t);
    if (s > best) best = s;
    if (best === 1) break;
  }
  return best;
}

const overlaps = (span, period) => !period || (span && span[0] <= period.to && span[1] >= period.from);

export class CatalogueSearch {
  constructor(catalogue, { books = [] } = {}) {
    this.catalogue = catalogue;
    const subjectName = new Map(catalogue.subjects.map((s) => [s.id, s.name]));
    const shelfName = new Map(catalogue.shelves.map((s) => [s.id, s.name]));
    this.docs = [];
    for (const s of catalogue.series) {
      const members = s.members.map((m) => {
        const rec = catalogue.maps[m.id] || {};
        const year = /(\d{4})/.exec(rec.date || '');
        return { id: m.id, tokens: tokenise(`${m.label} ${rec.name || ''}`), year: year ? Number(year[1]) : null };
      });
      this.docs.push({
        type: 'series',
        id: s.id,
        span: s.years || null,
        scope: s.scope || '',
        kind: (catalogue.subjects.find((x) => x.id === s.subject) || {}).kind || '',
        status: s.status,
        name: normalise(s.name),
        fields: [
          [tokenise(s.name), 10],
          [tokenise((s.aliases || []).join(' ')), 8],
          [tokenise(subjectName.get(s.subject)), 4],
          [tokenise(shelfName.get(s.shelf)), 2],
          [tokenise(s.scope), 2],
          [members.flatMap((m) => m.tokens), 3],
          [tokenise((s.provider || []).join(' ')), 2],
          [tokenise(s.members.map((m) => (catalogue.maps[m.id]?.keywords || []).join(' ')).join(' ')), 1],
        ],
        members,
      });
    }
    for (const e of catalogue.elections) {
      const year = Number(String(e.date).slice(0, 4)) || null;
      this.docs.push({
        type: 'election',
        id: e.key,
        span: year ? [year, year] : null,
        name: normalise(e.title),
        fields: [[tokenise(e.title), 8], [tokenise(e.body), 3], [tokenise(e.kind), 2], [tokenise(e.subtitle), 1]],
      });
    }
    for (const b of books) {
      const year = /(\d{4})/.exec(String(b.date || b.dateDisplay || ''));
      this.docs.push({
        type: 'book',
        id: b.id,
        span: year ? [Number(year[1]), Number(year[1])] : null,
        name: normalise(b.title),
        fields: [[tokenise(b.title), 8], [tokenise((b.authors || []).join(' ')), 4], [tokenise((b.keywords || []).join(' ')), 2]],
      });
    }
    // Constituency names, normalised, for the elections they were contested in.
    this.contests = Object.entries(catalogue.contestIndex || {}).map(([name, keys]) => ({ name, norm: normalise(name), keys }));
    this.places = null;
  }

  /** Load the place list (data/catalogue/places.json) to enable place search. */
  setPlaces(doc) {
    this.places = doc ? { maps: doc.maps, rows: doc.places.map((p) => ({ name: p[0], norm: normalise(p[0]), map: doc.maps[p[1]], bbox: p.slice(2, 6) })) } : null;
  }

  /**
   * @param {string} query
   * @param {{scope?:string, kind?:string, from?:number, to?:number, includeToAdd?:boolean, types?:string[]}} filters
   * @returns {{series:Array, elections:Array, books:Array, places:Array, contests:Array, period:object|null, words:string[]}}
   */
  query(query, filters = {}) {
    const { words, period: qPeriod } = parseQuery(query);
    const fPeriod = filters.from || filters.to ? { from: filters.from || 0, to: filters.to || 9999 } : null;
    const period = qPeriod && fPeriod ? { from: Math.max(qPeriod.from, fPeriod.from), to: Math.min(qPeriod.to, fPeriod.to) } : (qPeriod || fPeriod);
    const phrase = words.join(' ');
    const out = { series: [], elections: [], books: [], places: [], contests: [], period: qPeriod, words };
    if (!words.length && !qPeriod) return out;

    for (const doc of this.docs) {
      if (doc.type === 'series') {
        if (filters.scope && doc.scope !== filters.scope) continue;
        if (filters.kind && doc.kind !== filters.kind) continue;
        if (!filters.includeToAdd && doc.status && !doc.status.ready && !doc.status.incomplete) continue;
      }
      if (!overlaps(doc.span, period)) continue;
      let score = 0;
      let all = true;
      for (const w of words) {
        let best = 0;
        for (const [tokens, weight] of doc.fields) {
          const s = bestIn(w, tokens) * weight;
          if (s > best) best = s;
        }
        if (!best) { all = false; break; }
        score += best;
      }
      if (!all) continue;
      if (!words.length) score = 1;
      if (phrase && doc.name === phrase) score += 12;
      else if (phrase && doc.name.startsWith(phrase)) score += 6;
      else if (phrase && doc.name.includes(phrase)) score += 3;
      const hit = { id: doc.id, score };
      if (doc.type === 'series') {
        // The editions that match: by words where they name one, by period where one is given.
        hit.members = doc.members.filter((m) => (!period || (m.year && m.year >= period.from && m.year <= period.to))
          && (!words.length || words.every((w) => bestIn(w, m.tokens) > 0) || !words.some((w) => doc.members.some((x) => bestIn(w, x.tokens) > 0)))).map((m) => m.id);
        if (period && !hit.members.length && doc.members.some((m) => m.year)) continue;
        if (doc.status && !doc.status.ready) hit.score -= 1;
        out.series.push(hit);
      } else if (doc.type === 'election') out.elections.push(hit);
      else out.books.push(hit);
    }

    if (phrase && phrase.length >= 3) {
      for (const c of this.contests) {
        if (c.norm === phrase || c.norm.startsWith(phrase)) out.contests.push({ name: c.name, keys: c.keys, exact: c.norm === phrase });
      }
      out.contests.sort((a, b) => Number(b.exact) - Number(a.exact) || a.name.localeCompare(b.name));
      out.contests = out.contests.slice(0, 12);
      if (this.places) {
        const byName = new Map();
        for (const p of this.places.rows) {
          if (!(p.norm === phrase || p.norm.startsWith(phrase))) continue;
          const key = p.norm;
          if (!byName.has(key)) byName.set(key, { name: p.name, exact: p.norm === phrase, hits: [] });
          byName.get(key).hits.push({ map: p.map, bbox: p.bbox });
        }
        out.places = [...byName.values()]
          .sort((a, b) => Number(b.exact) - Number(a.exact) || b.hits.length - a.hits.length || a.name.localeCompare(b.name))
          .slice(0, 15);
      }
    }
    const byScore = (a, b) => b.score - a.score;
    out.series.sort(byScore);
    out.elections.sort(byScore);
    out.books.sort(byScore);
    return out;
  }
}

/** Series whose maps cover a point, by layer bounds; and the named features there, by box. */
export function coveringPoint(catalogue, places, lng, lat) {
  const inBox = (b) => b && lng >= b[0] && lng <= b[2] && lat >= b[1] && lat <= b[3];
  const series = [];
  for (const s of catalogue.series) {
    const members = s.members.filter((m) => inBox(catalogue.maps[m.id]?.bounds)).map((m) => m.id);
    if (members.length) series.push({ id: s.id, members });
  }
  const named = [];
  if (places) {
    for (const p of places.rows) if (inBox(p.bbox)) named.push({ name: p.name, map: p.map, bbox: p.bbox });
  }
  return { series, named };
}

/**
 * Search everyone who stood in an election (data/catalogue/people.json, built by
 * build-catalogue.mjs). Every word must match a word of the name or one of its other forms: as
 * typed, or as the start of it ("robins" finds Robinson), or, for words of six letters or more,
 * with one letter wrong ("paisly"). A year or decade keeps people active then ("robinson 1998").
 * Ties go to the better known: more contests won, then more stood.
 */
export class PeopleSearch {
  constructor(doc) {
    this.doc = doc;
    this.rows = doc.people.map((row) => ({
      row,
      norm: normalise(row[1]),
      tokens: [...new Set(tokenise([row[1], ...((Array.isArray(row[9]) && row[9]) || [])].join(' ')))],
    }));
  }

  query(query, { limit = 200 } = {}) {
    const { words, period } = parseQuery(query);
    if (!words.length) return [];
    const phrase = words.join(' ');
    const match = (q, d) => {
      if (d === q) return 1;
      if (q.length >= 2 && d.startsWith(q)) return 0.8;
      if (q.length >= 6 && withinOneEdit(q, d)) return 0.5;
      return 0;
    };
    const out = [];
    for (const x of this.rows) {
      const [, , , , first, last] = x.row;
      if (period && (last < period.from || first > period.to)) continue;
      let score = 0;
      let ok = true;
      for (const w of words) {
        let best = 0;
        for (const t of x.tokens) {
          const s = match(w, t);
          if (s > best) best = s;
          if (best === 1) break;
        }
        if (!best) { ok = false; break; }
        score += best;
      }
      if (!ok) continue;
      if (x.norm === phrase) score += 3;
      else if (x.norm.startsWith(phrase)) score += 1.5;
      out.push({ row: x.row, score });
    }
    out.sort((a, b) => b.score - a.score || b.row[7] - a.row[7] || b.row[6] - a.row[6] || a.row[1].localeCompare(b.row[1]));
    return out.slice(0, limit);
  }

  /** A person's Browse page. */
  static url(row) {
    const slug = row[10] || `${String(row[1]).normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}-${row[0]}`;
    // Browse routes in the hash: /browse/persons/<slug> is not served (404).
    return `/browse/#/persons/${encodeURIComponent(slug)}`;
  }
}
