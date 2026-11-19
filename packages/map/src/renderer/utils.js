import { setHidden } from '../state-helpers.mjs';

/**
 * @param {unknown} value
 * @param {number} min
 * @param {number} max
 */
export function clamp(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.max(min, Math.min(max, number));
}

/** @param {unknown} value */
export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => (/** @type {Record<string, string>} */ ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[char]));
}

/**
 * @template T
 * @param {T | number | null | undefined} value
 * @returns {T | string}
 */
export function formatValue(value) {
  if (value === undefined || value === null || value === '') return '-';
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : value.toFixed(2);
  return value;
}

/**
 * [[south, west], [north, east]] as MapLibre's [[west, south], [east, north]]; null when it is not a pair.
 * @param {unknown} bounds
 * @returns {[[number, number], [number, number]] | null}
 */
export function boundsToMapLibre(bounds) {
  if (!Array.isArray(bounds) || bounds.length !== 2) return null;
  const [[south, west], [north, east]] = /** @type {[[number, number], [number, number]]} */ (bounds);
  return [[west, south], [east, north]];
}

/**
 * The bounds as MapLibre's flat [west, south, east, north]; undefined when they are not a pair.
 * @param {unknown} bounds
 * @returns {[number, number, number, number] | undefined}
 */
export function boundsToFlatBbox(bounds) {
  const converted = boundsToMapLibre(bounds);
  if (!converted) return undefined;
  return [converted[0][0], converted[0][1], converted[1][0], converted[1][1]];
}

/** @typedef {{ minzoom?: number, maxzoom?: number, bounds?: [number, number, number, number] }} TileSourceRange */

/**
 * The zoom range and bounds of a tiled MapLibre source, with only the keys that have a value.
 * MapLibre copies a key that is present but undefined over its default (minzoom 0, maxzoom 22, or
 * the TileJSON's own), which leaves the source with no zoom range and no parent-tile fallback.
 * @param {unknown} minzoom
 * @param {unknown} maxzoom
 * @param {unknown} [bounds]  [[south, west], [north, east]]
 * @returns {TileSourceRange}
 */
export function tileSourceRange(minzoom, maxzoom, bounds) {
  /** @type {TileSourceRange} */
  const range = {};
  if (typeof minzoom === 'number' && Number.isFinite(minzoom)) range.minzoom = minzoom;
  if (typeof maxzoom === 'number' && Number.isFinite(maxzoom)) range.maxzoom = maxzoom;
  const bbox = boundsToFlatBbox(bounds);
  if (bbox) range.bounds = bbox;
  return range;
}

/**
 * @param {unknown} bounds
 * @returns {[[number, number], [number, number], [number, number], [number, number]] | null}
 */
export function boundsToImageCoordinates(bounds) {
  if (!Array.isArray(bounds) || bounds.length !== 2) return null;
  const [[south, west], [north, east]] = /** @type {[[number, number], [number, number]]} */ (bounds);
  if (![south, west, north, east].every(Number.isFinite)) return null;
  return [
    [west, north],
    [east, north],
    [east, south],
    [west, south]
  ];
}

/** @param {string} template */
export function absoluteTileTemplate(template) {
  if (/^https?:\/\//i.test(template)) return template;
  const origin = location.origin.replace(/\/$/, '');
  return template.startsWith('/') ? `${origin}${template}` : `${origin}/${template}`;
}

/**
 * @param {{ toast: HTMLElement }} els
 * @param {string} message
 */
export function showToast(els, message) {
  els.toast.textContent = message;
  setHidden(els.toast, false);
  const toast = /** @type {{ _timer?: number }} */ (/** @type {unknown} */ (showToast));
  window.clearTimeout(toast._timer);
  toast._timer = window.setTimeout(() => {
    setHidden(els.toast, true);
  }, 5000);
}

/** @param {unknown} value */
export async function copyText(value) {
  if (!navigator.clipboard?.writeText) {
    throw new Error('Clipboard API is unavailable');
  }
  await navigator.clipboard.writeText(String(value ?? ''));
}

/**
 * @template T
 * @param {T[]} values
 * @returns {T[]}
 */
export function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

/** @param {unknown} value */
export function normalizeSearchText(value) {
  return String(value ?? '').trim().toLowerCase();
}
