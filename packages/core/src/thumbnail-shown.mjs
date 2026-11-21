/**
 * Whether a map's thumbnail may be used: only for a map the site can show. Not for one to be added
 * (maps.json `placeholder`), nor for a hidden one the map app has no render layer for. Their images
 * stay in the thumbnail folder for their return. Used by the thumbnail manifest
 * (scripts/build/shell-assets.mjs), which the map app's cards read, and by the catalogue build
 * (scripts/build/catalogue/build-catalogue.mjs). Pure.
 */

/**
 * @param {{ placeholder?: boolean, hidden?: boolean } | undefined} record  the map's maps.json record, if any
 * @param {boolean} hasLayer  the map app has a render layer for it
 * @returns {boolean}
 */
export function thumbnailShown(record, hasLayer) {
  return !record || !(record.placeholder || (record.hidden && !hasLayer));
}

/**
 * The map id a thumbnail file names: "plu-1901-60" (the 60 px copy) -> "plu-1901".
 * @param {string} name  a file name without its extension
 * @returns {string}
 */
export function thumbnailMapId(name) {
  return name.replace(/-60$/, '');
}
