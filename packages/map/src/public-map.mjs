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
 * Shared by the app and by scripts/build/build-browse-indexes.mjs deliberately. Two
 * implementations of one rule is how the three numbers happened.
 */

/**
 * A catalogue entry (data/database/maps.json `maps[]`, a MapEntry in packages/types) as the rule
 * reads it.
 * @typedef {{
 *   id?: string,
 *   files?: object | null,
 *   compositeSources?: string[],
 *   variants?: Array<{ id?: string, hidden?: boolean } | null>,
 *   isGroup?: boolean,
 *   members?: string[],
 *   cloneOf?: string,
 *   hidden?: boolean,
 *   placeholder?: boolean
 * }} CatalogueMap
 */

/** @param {CatalogueMap} map */
const hasOwnData = (map) => Boolean(
  (map.files && Object.keys(map.files).length)
  || (map.compositeSources || []).length
  || (map.variants || []).length
  || (map.isGroup && (map.members || []).length)
);

/**
 * @param {CatalogueMap | null | undefined} map  catalogue entry
 * @param {(id: string) => CatalogueMap | undefined} getMapById
 * @param {((id: string) => boolean) | null | undefined} hasRenderLayer   true when something can draw this id
 * @param {Set<string>} [seen]
 * @returns {boolean}
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

/**
 * @param {CatalogueMap | null | undefined} map
 * @param {(id: string) => CatalogueMap | undefined} getMapById
 * @param {((id: string) => boolean) | null | undefined} hasRenderLayer
 */
export function isPublicMap(map, getMapById, hasRenderLayer) {
  if (!map || map.hidden || map.placeholder) return false;
  return isLoadableMap(map, getMapById, hasRenderLayer);
}

/**
 * The public set, in catalogue order.
 * @template {CatalogueMap} M
 * @param {M[] | null | undefined} maps
 * @param {((id: string) => boolean) | null | undefined} hasRenderLayer
 * @returns {M[]}
 */
export function publicMaps(maps, hasRenderLayer) {
  const byId = new Map((maps || []).map((map) => [map.id, map]));
  /** @param {string} id */
  const getMapById = (id) => byId.get(id);
  return (maps || []).filter((map) => isPublicMap(map, getMapById, hasRenderLayer));
}

/**
 * The ids a census statistic may be drawn on: every public map, and the editions (variants) a
 * public map holds, such as eds-census-2011 inside Electoral Divisions 2008 (eds-2006), which
 * the Pobal 2011 and 2016 deprivation statistics are drawn on.
 * @param {CatalogueMap[] | null | undefined} publicMapList
 * @returns {Set<string>}
 */
export function statisticGeographyIds(publicMapList) {
  const ids = new Set();
  for (const map of publicMapList || []) {
    if (!map?.id) continue;
    ids.add(map.id);
    for (const variant of map.variants || []) if (variant?.id && !variant.hidden) ids.add(variant.id);
  }
  return ids;
}

/**
 * A census statistic (data/database/data-entries.json) is drawn on its geography's layer
 * (packages/map/src/census-overlay.mjs), so it is public exactly when it is not hidden, has its figures,
 * and the boundary map it is drawn on is public. Statistics are listed in Browse beside the
 * maps but are not maps: the public MAP total (the homepage figure) does not include them.
 *
 * @param {{ id?: string, hidden?: boolean, csv?: string, geography?: string } | null | undefined} entry  data entry
 * @param {(id: string) => boolean} isPublicMapId
 */
export function isPublicStatistic(entry, isPublicMapId) {
  if (!entry || !entry.id || entry.hidden || !entry.csv || !entry.geography) return false;
  return Boolean(isPublicMapId(entry.geography));
}

/**
 * The catalogue pane's document (data/catalogue/catalogue.json, scripts/build/catalogue/build-catalogue.mjs)
 * as far as the map figures read it.
 * @typedef {{ series?: Array<{ members?: Array<{ id?: string }>, local?: Array<{ id?: string }>, todo?: Array<{ id?: string }> }> }} CatalogueDocument
 */

/**
 * The maps the catalogue shows a reader (data/catalogue/catalogue.json, the pane at /maps): every
 * series' maps -- its editions, versions and parts placed as maps (`members`) and its council maps
 * (`local`) -- each once. This is the site's map figure (owner, 11 Nov 2026): the homepage and
 * About said 909 by the rule above while the catalogue's sections added up to 820, because 139
 * of those maps are listed there as still to be added and 42 are kept out by the catalogue's
 * review, while the sections also hold maps the rule does not count (the census statistics, the
 * 3D terrain and the point clouds). The sections' own counts (packages/map/src/catalogue/index.js tabCounts)
 * add up to this same number.
 *
 * scripts/build/build-site-stats.mjs computes the figure with this, and check:site-figures holds
 * every page that states it to that.
 * @param {CatalogueDocument | null | undefined} catalogue
 * @returns {Set<string>}
 */
export function catalogueMapIds(catalogue) {
  const ids = new Set();
  for (const series of catalogue?.series || []) {
    for (const map of [...(series.members || []), ...(series.local || [])]) if (map?.id) ids.add(map.id);
  }
  return ids;
}

/**
 * The maps the catalogue lists as still to be added (a series' `todo`, shown on request as "Show
 * N to be added") and does not show anywhere as a map: the About page's second map figure.
 * @param {CatalogueDocument | null | undefined} catalogue
 * @returns {Set<string>}
 */
export function catalogueToBeAddedIds(catalogue) {
  const shown = catalogueMapIds(catalogue);
  const ids = new Set();
  for (const series of catalogue?.series || []) {
    for (const map of series.todo || []) if (map?.id && !shown.has(map.id)) ids.add(map.id);
  }
  return ids;
}
