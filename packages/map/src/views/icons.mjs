/**
 * The stroke icons the map app draws (Lucide, ISC licence): 24px grid, 2px round strokes,
 * currentColor. The catalogue's icon() (packages/map/src/catalogue/icons.js) draws every one of
 * its Lucide icons with strokeIconSvg; the icons the views here need live in this module, so a
 * view and the catalogue draw them from the same paths.
 */

/** Lucide 'maximize': the frame every zoom-to button draws (catalogue rows, layer cards, the timeline's changes). */
export const ZOOM_ICON_PATHS = '<path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/>';

/**
 * A stroke icon's SVG.
 * @param {string} paths its SVG paths (trusted markup from this module or the catalogue's table)
 * @param {string} cls
 * @returns {string}
 */
export function strokeIconSvg(paths, cls) {
  return `<svg aria-hidden="true" class="${cls}" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" viewBox="0 0 24 24">${paths}</svg>`;
}
