/**
 * What counts as "a map" for a public total.
 *
 * WHY THIS EXISTS
 *
 * The site reported three different totals for the same catalogue: the homepage said
 * 1,011, /browse said 993, and data/database/maps.json holds 1,031 entries of which 794
 * are neither hidden nor placeholder. Each surface applied its own filter, so none of the
 * numbers was wrong exactly -- they were answers to three different questions, presented
 * as the same one.
 *
 * The rule, decided 2026-08-23: a map is PUBLIC if it is visible, loadable, and not a
 * placeholder.
 *
 *   visible      not `hidden`
 *   not a stub   not `placeholder` -- those mark dates that exist but have not been
 *                digitised, and belong in a time series rather than in a count of what
 *                you can look at
 *   loadable     something can actually be drawn for it
 *
 * LOADABLE IS DECIDED BY THE RENDER RECORD, not by the catalogue's `files`. The DoBIH
 * layers carry no `files` at all yet have working render layers, so a files-only test
 * dropped 24 maps that load perfectly. Conversely a catalogue entry with files but no
 * render layer draws nothing.
 *
 * Clones and groups resolve through: `cloneOf` reuses another map's data, and a group is
 * loadable when any member is. Both are followed with a seen-set, because a mis-authored
 * cycle should return false rather than hang.
 *
 * Shared by the app and by scripts/build-browse-indexes.mjs deliberately. Two
 * implementations of one rule is how the three numbers happened.
 */

const hasOwnData = (map) => Boolean(
  (map.files && Object.keys(map.files).length)
  || (map.compositeSources || []).length
  || (map.variants || []).length
  || (map.isGroup && (map.members || []).length)
);

/**
 * @param {object} map                     catalogue entry
 * @param {(id: string) => object|undefined} getMapById
 * @param {(id: string) => boolean} hasRenderLayer   true when something can draw this id
 */
export function isLoadableMap(map, getMapById, hasRenderLayer, seen = new Set()) {
  if (!map || !map.id || seen.has(map.id)) return false;
  seen.add(map.id);
  if (hasRenderLayer && hasRenderLayer(map.id)) return true;
  if (hasOwnData(map)) return true;
  if (map.cloneOf) return isLoadableMap(getMapById(map.cloneOf), getMapById, hasRenderLayer, seen);
  if (map.isGroup && (map.members || []).length) {
    return (map.members || []).some((id) => isLoadableMap(getMapById(id), getMapById, hasRenderLayer, seen));
  }
  return false;
}

export function isPublicMap(map, getMapById, hasRenderLayer) {
  if (!map || map.hidden || map.placeholder) return false;
  return isLoadableMap(map, getMapById, hasRenderLayer);
}

/** The public set, in catalogue order. */
export function publicMaps(maps, hasRenderLayer) {
  const byId = new Map((maps || []).map((map) => [map.id, map]));
  const getMapById = (id) => byId.get(id);
  return (maps || []).filter((map) => isPublicMap(map, getMapById, hasRenderLayer));
}
