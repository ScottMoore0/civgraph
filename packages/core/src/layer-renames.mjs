/**
 * The wave-3 rename rules for layer ids and their PMTiles keys (site-restructure renames.csv).
 *
 *   <mapId>-vector-test   ->  <mapId>-vector
 *   <mapId>-raster-test   ->  <mapId>-raster
 *   <mapId>-alias-test    ->  <mapId>-alias
 *
 *   data/maps/test/pmtiles/generated/<mapId>-vector-test.pmtiles
 *                         ->  data/maps/pmtiles/<mapId>-vector.pmtiles
 *
 * Pure and dependency-free, so the same rule can serve the R2 copy (scripts/publish/
 * r2-copy-keys.mjs), the layer_aliases rows D3 loads, and the client resolver's suffix rule
 * (resolveLegacyLayerId in packages/map/app/app.js, which D3 extends; not edited here).
 */

/** @type {ReadonlyArray<readonly [string, string]>} [old suffix, new suffix] */
export const LAYER_ID_SUFFIXES = [
  ['-vector-test', '-vector'],
  ['-raster-test', '-raster'],
  ['-alias-test', '-alias'],
];

export const OLD_PMTILES_PREFIX = 'data/maps/test/pmtiles/generated/';
export const NEW_PMTILES_PREFIX = 'data/maps/pmtiles/';

/**
 * Which side of the rename an id is on (state-machine catalogue RC-L, light; the R2 key
 * migration PL-03 moves keys from 'legacy' to 'current'): 'legacy' ends in an old suffix,
 * 'current' in a new one, 'other' in neither (not a renamed layer id).
 * @typedef {'legacy'|'current'|'other'} LayerIdForm
 * @param {unknown} id
 * @returns {LayerIdForm}
 */
export function layerIdForm(id) {
  const value = String(id ?? '');
  if (renameLayerId(value) !== value) return 'legacy';
  if (legacyLayerId(value) !== value) return 'current';
  return 'other';
}

/**
 * The new id for an old one; an id without an old suffix is returned unchanged.
 * @param {unknown} id
 * @returns {string}
 */
export function renameLayerId(id) {
  const value = String(id ?? '');
  for (const [from, to] of LAYER_ID_SUFFIXES) {
    if (value.endsWith(from) && value.length > from.length) return value.slice(0, -from.length) + to;
  }
  return value;
}

/**
 * The old id a new one came from, for the reverse lookup; unchanged when not renamed.
 * @param {unknown} id
 * @returns {string}
 */
export function legacyLayerId(id) {
  const value = String(id ?? '');
  for (const [from, to] of LAYER_ID_SUFFIXES) {
    if (value.endsWith(to) && value.length > to.length) return value.slice(0, -to.length) + from;
  }
  return value;
}

/**
 * The new R2 key for an old PMTiles key or CDN URL, or null when it is not one the rename
 * covers (another prefix, not .pmtiles, or a name without an old suffix).
 * @param {unknown} keyOrUrl
 * @returns {{ from: string, to: string } | null}
 */
export function renamePmtilesKey(keyOrUrl) {
  let key = String(keyOrUrl ?? '');
  key = key.replace(/^https?:\/\/[^/]+\//i, '').replace(/^\/+/, '');
  if (!key.startsWith(OLD_PMTILES_PREFIX)) return null;
  const name = key.slice(OLD_PMTILES_PREFIX.length);
  if (name.includes('/') || !name.endsWith('.pmtiles')) return null;
  const stem = name.slice(0, -'.pmtiles'.length);
  // An archive uploaded after the layer-id rename already carries the new id
  // (e.g. eds-ulster-1912-vector.pmtiles); it still moves to the new prefix.
  const renamed = renameLayerId(stem);
  if (renamed === stem && !/-(vector|raster|alias)$/.test(stem)) return null;
  return { from: key, to: `${NEW_PMTILES_PREFIX}${renamed}.pmtiles` };
}

/**
 * Layer ids that have been renamed, mapped old -> new.
 *
 * A layer id is not private. It appears in `#layers=` share links, so renaming one
 * breaks every link anyone has posted, bookmarked or cited -- silently, as an empty map
 * rather than an error. This is the cost that makes id renames worth avoiding, and the
 * reason to accept a slightly wrong id is usually stronger than it looks.
 *
 * `roi-local-authorities-*` was renamed to `local-authorities-*` on 2026-08-22. The
 * prefix was wrong for four of the 26 layers outright -- 1915 and the three 1920 dates
 * cover the whole island, before partition -- and anachronistic for a dozen more, since
 * there was no republic before 1949. The fix was not a better jurisdiction prefix but
 * none at all: the display name carries the scope, and encoding a jurisdiction that
 * changes over the life of a series is what went wrong in the first place.
 *
 * Kept as a prefix rewrite rather than 26 entries so the table cannot fall out of step
 * with the rename.
 */
/** @type {ReadonlyArray<readonly [string, string]>} [old prefix, new prefix] */
export const LEGACY_LAYER_ID_PREFIXES = [
  ['roi-local-authorities-', 'local-authorities-'],
  // NI editions re-dated to the census date on 2026-11-01 (the id carries the date): Newtownards RD
  // was renamed North Down RD on 1 Aug 1954, not 1 Apr (Census 1961); Londonderry's wards were
  // reduced on 15 May 1938, not 16 May (Census 1951). The 1939 edition became a layer of its own
  // (Ballymena made a borough), and the 1957 "CED" edition was the county map counties-ireland-1957.
  ['admin-areas-1954-04-01', 'admin-areas-1954-08-01'],
  ['ded-1954-04-01', 'ded-1954-08-01'],
  ['county-ed-1954-04-01', 'county-ed-1954-08-01'],
  ['admin-areas-1938-05-16', 'admin-areas-1938-05-15'],
  ['ded-1938-05-16', 'ded-1938-05-15'],
  ['county-ed-1938-05-16', 'county-ed-1938-05-15'],
  ['admin-areas-1939-05-23-alias-test', 'admin-areas-1939-05-23-vector-test'],
  ['county-ed-1957-04-01-vector-test', 'counties-ireland-1957-vector-test']
];
