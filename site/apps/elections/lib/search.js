/**
 * The app's search over places, people, parties and elections (el-places, 14 Nov 2026). Pure (no
 * DOM, no fetch): views/search-box.js wires it. Tests: the unit test elections-app-places.test.mjs.
 *
 * Case, accents and punctuation are folded away on both sides ("sinn fein" finds Sinn Féin, "naomi
 * long" Naomi Long), and every word typed must begin a word of the entry ("long" finds Naomi Long
 * and Longford, not Belong). Places, parties and elections are matched here, from indexes the app
 * reads once (the area index, the party list and the elections index); people are too many to send
 * whole, so the persons API searches them and rankPersons() orders what it returns.
 */
import { foldSearchText } from '../../../pkg/core/src/format.js';

/** @typedef {import('./api.js').AreaRow} AreaRow */
/** @typedef {import('./api.js').PartyCard} PartyCard */
/** @typedef {import('./api.js').PersonCard} PersonCard */
/** @typedef {import('./api.js').ElectionRow} ElectionRow */

/** A place: every body whose contests carried this name (one contest slug). */
/** @typedef {{ kind: 'place', slug: string, name: string, words: string[], contests: number, lastYear: number, bodies: Array<{ bodySlug: string, body: string, contests: number, firstYear: number, lastYear: number }> }} PlaceHit */
/** @typedef {{ kind: 'party', slug: string, title: string, colour: string, words: string[], aliasWords: string[], stood: number }} PartyHit */
/** @typedef {{ kind: 'election', key: string, title: string, date: string, body: string, words: string[] }} ElectionHit */
/** @typedef {{ places: PlaceHit[], parties: PartyHit[], elections: ElectionHit[] }} SearchIndex */

/**
 * Text folded for matching: lower case, no accents, every run of other characters one space.
 * "Sinn Féin" -> "sinn fein", "O'Neill" -> "o neill".
 * @param {unknown} value
 */
export function foldText(value) {
  return foldSearchText(value).replace(/[^a-z0-9]+/g, ' ').trim();
}

/** The folded words of a text. @param {unknown} value @returns {string[]} */
export const wordsOf = (value) => foldText(value).split(' ').filter(Boolean);

/**
 * Whether every query word begins some word of the entry.
 * @param {string[]} query @param {string[]} words
 */
export function matchesAll(query, words) {
  return query.length > 0 && query.every((q) => words.some((w) => w.startsWith(q)));
}

/**
 * How well a name answers the query: 3 the whole name, 2 the name begins with it, 1 every word
 * begins a word of it, 0 no match.
 * @param {string[]} query @param {string[]} words
 */
export function nameScore(query, words) {
  if (!matchesAll(query, words)) return 0;
  const q = query.join(' ');
  const name = words.join(' ');
  if (name === q) return 3;
  if (name.startsWith(q)) return 2;
  return 1;
}

/**
 * The search index from what the app reads: the area index, the party list and the elections
 * index (each may be empty while it loads).
 * @param {{ areas?: AreaRow[], parties?: PartyCard[], elections?: ElectionRow[] }} sources
 * @returns {SearchIndex}
 */
export function buildSearchIndex({ areas = [], parties = [], elections = [] }) {
  /** @type {Map<string, PlaceHit>} */
  const places = new Map();
  for (const a of areas) {
    let p = places.get(a.slug);
    if (!p) {
      p = { kind: 'place', slug: a.slug, name: a.name, words: wordsOf(a.name), contests: 0, lastYear: 0, bodies: [] };
      places.set(a.slug, p);
    }
    const lastYear = Number(a.lastYear) || 0;
    p.bodies.push({ bodySlug: a.bodySlug, body: a.body || a.bodySlug, contests: Number(a.contests) || 0, firstYear: Number(a.firstYear) || 0, lastYear });
    p.contests += Number(a.contests) || 0;
    if (lastYear >= p.lastYear) { p.lastYear = lastYear; p.name = a.name; p.words = wordsOf(a.name); }
  }
  for (const p of places.values()) p.bodies.sort((x, y) => y.lastYear - x.lastYear || y.contests - x.contests);
  return {
    places: [...places.values()],
    parties: parties.map((p) => ({
      kind: /** @type {const} */ ('party'),
      slug: p.slug,
      title: p.title,
      colour: p.colour,
      words: wordsOf(p.title),
      aliasWords: wordsOf((/** @type {string[]} */ (p.knownAliases || [])).join(' ')),
      stood: Number(/** @type {{ totals?: { stood?: number } }} */ (p).totals?.stood) || 0,
    })),
    elections: elections.map((e) => ({
      kind: /** @type {const} */ ('election'),
      key: e.key,
      title: e.displayTitle,
      date: e.date,
      body: e.body,
      words: wordsOf(`${e.displayTitle} ${e.body} ${e.date} ${e.year}`),
    })),
  };
}

/**
 * The places, parties and elections that answer a query, best first: by how well the name
 * matches, then the bigger record (more contests, more candidates, the later election).
 * @param {SearchIndex} index
 * @param {string} queryText
 * @param {{ limit?: number }} [opts]
 * @returns {{ query: string[], places: PlaceHit[], parties: PartyHit[], elections: ElectionHit[] }}
 */
export function searchIndex(index, queryText, { limit = 8 } = {}) {
  const query = wordsOf(queryText);
  if (!query.length) return { query, places: [], parties: [], elections: [] };
  /** @template T @param {T[]} items @param {(item: T) => number} score @param {(item: T) => number} size */
  const rank = (items, score, size) => items
    .map((item) => ({ item, s: score(item) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || size(b.item) - size(a.item))
    .slice(0, limit)
    .map((x) => x.item);
  return {
    query,
    places: rank(index.places, (p) => nameScore(query, p.words), (p) => p.contests),
    // A party answers to its other names too ("SF", "Provisional Sinn Féin"), a little below its own.
    parties: rank(index.parties, (p) => nameScore(query, p.words) * 2 || (matchesAll(query, p.aliasWords) ? 1 : 0), (p) => p.stood),
    elections: rank(index.elections, (e) => (matchesAll(query, e.words) ? 1 : 0), (e) => Date.parse(e.date) || 0),
  };
}

/**
 * The people the persons API returned, kept when their name answers the query (the API also
 * matches places and parties a person stood in) and ordered by how well it does, then by seats won.
 * @param {PersonCard[]} persons
 * @param {string[]} query  folded words (searchIndex's `query`)
 * @param {number} [limit]
 */
export function rankPersons(persons, query, limit = 8) {
  return persons
    .map((p) => ({ p, s: nameScore(query, wordsOf(p.title || p.name)) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || electedOf(b.p) - electedOf(a.p))
    .slice(0, limit)
    .map((x) => x.p);
}

/** @param {PersonCard} p */
const electedOf = (p) => Number(/** @type {{ totals?: { elected?: number } }} */ (p).totals?.elected) || 0;
