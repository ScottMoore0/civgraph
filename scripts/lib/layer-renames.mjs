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

/** The new id for an old one; an id without an old suffix is returned unchanged. */
export function renameLayerId(id) {
  const value = String(id ?? '');
  for (const [from, to] of LAYER_ID_SUFFIXES) {
    if (value.endsWith(from) && value.length > from.length) return value.slice(0, -from.length) + to;
  }
  return value;
}

/** The old id a new one came from, for the reverse lookup; unchanged when not renamed. */
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
