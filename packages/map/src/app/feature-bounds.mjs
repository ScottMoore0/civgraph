/**
 * Where a feature is, before any of its tiles are drawn: the box a feature link frames.
 *
 * WHY
 *
 * A shared feature link (#layers=pc-2023&featureMap=pc-2023&featureId=BELFAST+WEST) opened on the
 * whole island at zoom 6 with nothing visible drawn (QA 2026-11-11, H2): the app asked the map for
 * the feature among the features already RENDERED, which at that view were none, and had no box
 * to fit. A link and a search result often carry no box at all (the names index omits them).
 *
 * The app already holds two indexes that know where features are without drawing them:
 *
 *   the spatial index   data/database/spatial-index/<mapId>.json (via /_api/spatial): a bbox per
 *                       feature, by name, for the maps the global search covers;
 *   the feature index   render/metadata/feature-indexes/<layer>.json (the layer's featureIndexUrl):
 *                       a centre and the whole feature's area per feature, by tile id and name,
 *                       for every vector layer with one.
 *
 * featureBoundsFromSpatial and featureBoundsFromIndex pick the feature out of each; the adapter
 * (packages/map/app/maplibre-main-adapter.js resolveFeatureBounds) tries them in that order and
 * falls back to the layer's own bounds. Pure: no DOM, no fetch.
 */

/** @typedef {[number, number, number, number]} BBox  [west, south, east, north] */

const norm = (/** @type {unknown} */ value) => String(value ?? '').replace(/\s+/g, ' ').trim().toLowerCase();

/** @param {unknown} bbox @returns {BBox | null} */
export function validBbox(bbox) {
  if (!Array.isArray(bbox) || bbox.length !== 4) return null;
  const values = bbox.map(Number);
  if (!values.every(Number.isFinite)) return null;
  const [w, s, e, n] = values;
  if (w > e || s > n || s < -90 || n > 90) return null;
  return /** @type {BBox} */ (values);
}

/**
 * The feature's bbox from a map's spatial-index entries ({ name, mapId, bbox, id? }): by id (the
 * index writes "<mapId>:<index>"), else by the one entry with its name. Null when absent or when
 * the name is not unique (a name shared by two features could frame the wrong one).
 * @param {Array<{ name?: string, mapId?: string, id?: string | number, bbox?: unknown }> | null | undefined} entries
 * @param {string} mapId
 * @param {string | number | null | undefined} featureId
 * @param {string | null | undefined} [featureName]
 * @returns {BBox | null}
 */
export function featureBoundsFromSpatial(entries, mapId, featureId, featureName) {
  if (!Array.isArray(entries) || !entries.length) return null;
  const id = String(featureId ?? '').trim();
  if (id) {
    const byId = entries.find((entry) => entry && entry.id !== undefined && entry.id !== null
      && (String(entry.id) === id || String(entry.id) === `${mapId}:${id}`));
    const bbox = validBbox(byId?.bbox);
    if (bbox) return bbox;
  }
  for (const name of [featureName, featureId]) {
    const wanted = norm(name);
    if (!wanted) continue;
    const matches = entries.filter((entry) => entry && norm(entry.name) === wanted && validBbox(entry.bbox));
    if (matches.length === 1) return validBbox(matches[0].bbox);
    if (matches.length > 1) return sameFeature(unionBbox(matches.map((entry) => /** @type {BBox} */ (validBbox(entry.bbox)))));
  }
  return null;
}

/** The box holding every box given. @param {BBox[]} boxes @returns {BBox | null} */
export function unionBbox(boxes) {
  if (!boxes.length) return null;
  return [
    Math.min(...boxes.map((b) => b[0])),
    Math.min(...boxes.map((b) => b[1])),
    Math.max(...boxes.map((b) => b[2])),
    Math.max(...boxes.map((b) => b[3])),
  ];
}

/**
 * Parts of one feature lie together; features that merely share a name (two townlands called
 * Ballymore) can lie anywhere. A union wider than 3 degrees or taller than 2 (about 200 by 220 km,
 * more than any county) is taken for the second case, and nothing is framed rather than half the
 * island. @param {BBox | null} box @returns {BBox | null}
 */
export function sameFeature(box) {
  return box && box[2] - box[0] <= 3 && box[3] - box[1] <= 2 ? box : null;
}

const METRES_PER_DEGREE = 111_320;

/**
 * A box around a centre wide enough to show a feature of that area whole: the side of a square
 * of the same area, doubled (a constituency or barony is rarely square), at least 1.5 km, so a
 * point or a line with no area still opens at street level rather than on a single building.
 * @param {[number, number]} center  [lng, lat]
 * @param {number | null | undefined} areaM2
 * @returns {BBox | null}
 */
export function bboxAround(center, areaM2) {
  if (!Array.isArray(center) || center.length < 2) return null;
  const [lng, lat] = center.map(Number);
  if (!Number.isFinite(lng) || !Number.isFinite(lat) || Math.abs(lat) > 89) return null;
  const side = Math.max(1500, Number(areaM2) > 0 ? Math.sqrt(Number(areaM2)) * 2 : 0);
  const half = side / 2;
  const dLat = half / METRES_PER_DEGREE;
  const dLng = half / (METRES_PER_DEGREE * Math.cos((lat * Math.PI) / 180));
  return [lng - dLng, lat - dLat, lng + dLng, lat + dLat];
}

/**
 * The feature's box from a layer's feature index ({ items: [{ id, name, aliases?, center, areaM2? }] }):
 * by tile id, else by the items with its name or an alias (framed together: sameFeature). Null when absent.
 * @param {{ items?: Array<{ id?: string | number, name?: string, aliases?: string[], center?: [number, number] | null, areaM2?: number }> } | null | undefined} index
 * @param {string | number | null | undefined} featureId
 * @param {string | null | undefined} [featureName]
 * @returns {BBox | null}
 */
export function featureBoundsFromIndex(index, featureId, featureName) {
  const items = Array.isArray(index?.items) ? index.items : [];
  if (!items.length) return null;
  const id = String(featureId ?? '').trim();
  /** @param {typeof items[number] | undefined} item */
  const box = (item) => (item?.center ? bboxAround(item.center, item.areaM2) : null);
  if (id) {
    const byId = items.find((item) => item && item.id !== undefined && item.id !== null && String(item.id) === id);
    if (byId) return box(byId);
  }
  for (const name of [featureName, featureId]) {
    const wanted = norm(name);
    if (!wanted) continue;
    const matches = items.filter((item) => item && (norm(item.name) === wanted
      || (Array.isArray(item.aliases) && item.aliases.some((alias) => norm(alias) === wanted))));
    if (matches.length === 1) return box(matches[0]);
    if (matches.length > 1) {
      const boxes = /** @type {BBox[]} */ (matches.map(box).filter(Boolean));
      return sameFeature(unionBbox(boxes));
    }
  }
  return null;
}

