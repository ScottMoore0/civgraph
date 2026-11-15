/**
 * The bodies of the Elections app's home page and one body's page (views/home.js): each body's
 * elections are those filed under it and those the election-bodies registry also lists under it
 * (groups.alsoListed: the 1918 election, filed under the Dáil, is on the House of Commons' page
 * too). The record stays one; only the listing repeats it. Pure.
 */

/** @typedef {import('./api.js').ElectionRow} ElectionRow */
/** @typedef {{ slug: string, name: string, n: number, by: number, from: string, to: string }} BodySummary */

/**
 * A body's row on the home page: how many elections and by-elections it lists, and their years.
 * @param {readonly ElectionRow[]} all  every election of the index
 * @param {(slug: string) => readonly string[]} alsoFor  the keys also listed under a body
 * @returns {Map<string, BodySummary>}
 */
export function bodySummaries(all, alsoFor) {
  /** @type {Map<string, BodySummary>} */
  const bodies = new Map();
  /** @param {string} slug @param {string} name @param {ElectionRow} e */
  const count = (slug, name, e) => {
    const b = bodies.get(slug) || { slug, name, n: 0, by: 0, from: e.date, to: e.date };
    b.n += 1;
    if (e.kind === 'by-election') b.by += 1;
    if (e.date < b.from) b.from = e.date;
    if (e.date > b.to) b.to = e.date;
    bodies.set(slug, b);
  };
  for (const e of all) count(e.bodySlug, e.body || e.bodySlug, e);
  const byKey = new Map(all.map((e) => [e.key, e]));
  for (const b of [...bodies.values()]) {
    for (const key of alsoFor(b.slug)) {
      const e = byKey.get(key);
      if (e && e.bodySlug !== b.slug) count(b.slug, b.name, e);
    }
  }
  return bodies;
}

/**
 * The bodies a page must also ask for, each with the keys it lists from them.
 * @param {readonly string[]} keys  election keys (<body>__<date>)
 * @param {string} slug  the page's own body
 * @returns {Map<string, string[]>}
 */
export function alsoListedSources(keys, slug) {
  /** @type {Map<string, string[]>} */
  const sources = new Map();
  for (const key of keys) {
    const body = String(key).split('__')[0];
    if (!body || body === slug) continue;
    sources.set(body, [...(sources.get(body) || []), key]);
  }
  return sources;
}

/**
 * One body's elections, newest first: its own, then those listed under it from other bodies.
 * @param {readonly ElectionRow[]} own  the body's own elections
 * @param {readonly ElectionRow[]} others  elections of other bodies (only the listed keys are kept)
 * @param {readonly string[]} keys  the keys also listed under the body
 * @returns {ElectionRow[]}
 */
export function bodyListing(own, others, keys) {
  const seen = new Set(own.map((e) => e.key));
  const also = others.filter((e) => keys.includes(e.key) && !seen.has(e.key));
  return [...own, ...also].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}
