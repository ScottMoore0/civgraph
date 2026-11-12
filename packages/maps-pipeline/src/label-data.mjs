/**
 * Shared rules for the names and anchor points the map shows: where a feature index puts a
 * feature's centre, and which label text counts as damaged.
 *
 * - Centres are lon/lat (EPSG:4326). A source in another CRS has its centre transformed; before
 *   11 Nov 2026 it was not, and dail-1998-vector (TM65 / Irish Grid, EPSG:29902) shipped centres
 *   in metres, so search and fly-to for that layer pointed into the Atlantic.
 * - Every map in the catalogue is on the island of Ireland, so a centre outside
 *   IRELAND_LONLAT_BOUNDS is a CRS or geometry fault, never a real place.
 * - Label text is NFC (precomposed: "á", not "a" + U+0301) and carries no U+FFFD (the
 *   replacement character a wrong-encoding decode leaves where a fada was).
 *
 * Used by packages/maps-pipeline/src/tiles/feature-indexes.mjs,
 * scripts/build/build-test2-election-manifest.mjs, scripts/check/rules/map-label-data.mjs and
 * packages/maps-pipeline/src/tiles/repair-label-text.mjs (repairApplies).
 */

/** The island of Ireland with its offshore islands (Tory, Inishtrahull, the Blaskets, Fastnet), in degrees. */
export const IRELAND_LONLAT_BOUNDS = Object.freeze({ west: -11, south: 51.2, east: -5.2, north: 55.7 });

/**
 * True when `center` is a finite [lon, lat] pair on or around the island of Ireland.
 * @param {unknown} center
 * @returns {boolean}
 */
export function centreInIreland(center) {
  if (!Array.isArray(center) || center.length < 2) return false;
  const [lon, lat] = center.map(Number);
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return false;
  const b = IRELAND_LONLAT_BOUNDS;
  return lon >= b.west && lon <= b.east && lat >= b.south && lat <= b.north;
}

/**
 * The SQLite-dialect columns (for ogr2ogr -dialect SQLite) giving a feature's centroid as lon/lat.
 * A source with a known EPSG code other than 4326 has the centroid transformed to 4326; a source
 * with no EPSG code (SRID 0) cannot be transformed, so its centroid is returned as stored and the
 * index check (scripts/check/rules/map-label-data.mjs) fails it if that is not lon/lat.
 * @param {number | null | undefined} epsg
 * @returns {string[]}
 */
export function featureCentreColumns(epsg) {
  const centroid = 'ST_Centroid(geometry)';
  const point = Number.isInteger(epsg) && Number(epsg) > 0 && epsg !== 4326 ? `ST_Transform(${centroid}, 4326)` : centroid;
  return [`ST_X(${point}) AS lon`, `ST_Y(${point}) AS lat`];
}

/**
 * True when the text holds U+FFFD, the replacement character.
 * @param {unknown} value
 * @returns {boolean}
 */
export function hasReplacementChar(value) {
  return typeof value === 'string' && value.includes('�');
}

/**
 * True when the text is not in Unicode Normalization Form C (for example a combining acute
 * accent, U+0301, after its letter instead of the precomposed letter).
 * @param {unknown} value
 * @returns {boolean}
 */
export function notNfc(value) {
  return typeof value === 'string' && value !== value.normalize('NFC');
}

/**
 * Whether a keyed repair from data/database/label-text-repairs.json is written into its source.
 * The file's `apply.confidence` lists the confidence levels the owner has accepted (12 Nov 2026:
 * "high" only); a reading at any other level (medium, open) is held back and the source keeps
 * its damaged text. With no such list every reading applies, and a reading with no confidence
 * is certain and always applies.
 * @param {{ confidence?: string | null }} record
 * @param {readonly string[] | null | undefined} accepted
 * @returns {boolean}
 */
export function repairApplies(record, accepted) {
  if (!Array.isArray(accepted)) return true;
  if (!record.confidence) return true;
  return accepted.includes(record.confidence);
}

/**
 * Label text as the map should carry it: NFC-normalised. Anything that is not a string is
 * returned unchanged.
 * @template T
 * @param {T} value
 * @returns {T}
 */
export function nfcLabel(value) {
  return /** @type {T} */ (typeof value === 'string' ? value.normalize('NFC') : value);
}
