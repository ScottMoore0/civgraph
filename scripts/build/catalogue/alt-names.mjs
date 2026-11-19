/**
 * A catalogue row's other names, for search (build-catalogue.mjs writes them as a row's `alt`;
 * packages/map/src/catalogue/search.js indexes them in place of the maps' keywords, which Phelim
 * Birch's notes of 19 Nov 2026 took out of search):
 *
 *   - the row's Irish name (the catalogue-names strings, data/i18n/strings/catalogue-names.txt, as
 *     site/assets/i18n/en.json and ga.json carry them) and its maps' Irish names (the map-name
 *     overlay, data/i18n/map-names.overlay.json);
 *   - the names the row was known by before it was renamed or merged (catalogue.source.json
 *     seriesRedirects: an old row id is its subject's id and its old name, slugged).
 *
 * Pure: the build reads the files and hands their contents in (tests/unit/catalogue-alt-names.test.mjs).
 */

/**
 * English -> Irish for the catalogue's own names: the `catalogue-names.*` keys present in both
 * language files.
 * @param {Record<string, unknown>} en
 * @param {Record<string, unknown>} ga
 * @returns {Map<string, string>}
 */
export function catalogueIrishNames(en, ga) {
  /** @type {Map<string, string>} */
  const out = new Map();
  for (const [key, english] of Object.entries(en)) {
    if (!key.startsWith('catalogue-names.')) continue;
    const irish = ga[key];
    if (typeof english === 'string' && typeof irish === 'string' && irish && irish !== english) out.set(english, irish);
  }
  return out;
}

/**
 * An old row id read back as the name it was slugged from: its subject's id taken off the front,
 * a "--points"-style suffix off the end, the hyphens as spaces ("built-heritage-and-protected-
 * structures-defence-heritage-sites" -> "defence heritage sites").
 * @param {string} id
 * @param {Iterable<string>} subjectIds
 * @returns {string}
 */
export function nameFromRowId(id, subjectIds) {
  let rest = String(id).replace(/--[a-z0-9-]+$/, '');
  const prefixes = [...subjectIds].sort((a, b) => b.length - a.length);
  const p = prefixes.find((x) => rest.startsWith(`${x}-`));
  if (p) rest = rest.slice(p.length + 1);
  return rest.replace(/-+/g, ' ').trim();
}

/**
 * The rows each row's old ids lead to, following a chain of redirects to its end.
 * @param {Record<string, string>} redirects  old row id -> the row it went into
 * @returns {Map<string, string[]>}  row id -> its old ids
 */
export function oldIdsByRow(redirects) {
  /** @type {Map<string, string[]>} */
  const out = new Map();
  for (const from of Object.keys(redirects || {})) {
    let to = redirects[from];
    const seen = new Set([from]);
    while (to && redirects[to] && !seen.has(to)) { seen.add(to); to = redirects[to]; }
    if (!to) continue;
    if (!out.has(to)) out.set(to, []);
    /** @type {string[]} */ (out.get(to)).push(from);
  }
  return out;
}

/**
 * A row's other names: its Irish name, its maps' Irish names and its old names, each once, none
 * the same as the row's own name.
 * @param {{ name: string, members: Array<{ id: string }>, local?: Array<{ id: string }> }} row
 * @param {{ irishNames: Map<string, string>, mapIrish: (id: string) => string | undefined, oldIds: string[], subjectIds: Iterable<string> }} sources
 * @returns {string[]}
 */
export function altNames(row, { irishNames, mapIrish, oldIds, subjectIds }) {
  /** @type {Map<string, string>} */
  const out = new Map();
  const own = row.name.trim().toLowerCase();
  /** @param {string | undefined} text */
  const add = (text) => {
    const v = String(text || '').replace(/\s+/g, ' ').trim();
    if (v && v.toLowerCase() !== own && !out.has(v.toLowerCase())) out.set(v.toLowerCase(), v);
  };
  add(irishNames.get(row.name));
  for (const m of [...row.members, ...(row.local || [])]) add(mapIrish(m.id));
  for (const id of oldIds) add(nameFromRowId(id, subjectIds));
  return [...out.values()];
}
