import { DEFAULT_LABEL_MIN_ZOOM } from './config.js';
import {
  buildRepairedLabelFilterExpression,
  buildRepairedLabelValueExpression,
  repairFeatureProperties
} from './feature-property-repairs.js';
import { clamp, unique } from './utils.js';
import { MAP_COLOURS } from '../views/colours.mjs';
import { bilingualLines, titleCaseCaps } from './label-text.mjs';

/**
 * How a label's text is cleaned: strip a trailing bracket, or map whole values to others.
 * @typedef {'stripTrailingBracketNumber' | { type: 'mapValues', map?: Record<string, string> }} LabelCleanupRule
 */

/**
 * A layer's label style as maps-test.json writes it (every field optional; getLabelStyle fills
 * the defaults and clamps the numbers).
 * @typedef {{
 *   color?: string,
 *   hoverColor?: string,
 *   selectedColor?: string,
 *   haloColor?: string,
 *   haloWidth?: number,
 *   haloBlur?: number,
 *   fontSize?: number,
 *   fontWeight?: string,
 *   maxWidth?: number,
 *   lineHeight?: number
 * }} LabelStyleInput
 */

/**
 * A layer as the renderer reads it (a LayerEntry, packages/types: render/metadata/maps-test.json
 * `layers[]`): only the fields read here, any of which may be missing; the rest stay unknown.
 * @typedef {{
 *   [field: string]: unknown,
 *   id?: string | undefined,
 *   sourceMapId?: string | undefined,
 *   sourceLayer?: string,
 *   style?: { color?: string, [key: string]: unknown } | undefined,
 *   labelStyle?: LabelStyleInput,
 *   labelMinZoom?: number | string,
 *   labelMaxZoom?: number | string | null,
 *   labelProperty?: string | null | undefined,
 *   labelPropertyFallbacks?: string[],
 *   labelCanonicalProperty?: string,
 *   labelRankProperty?: string,
 *   labelTextColor?: string,
 *   labelCleanup?: LabelCleanupRule
 * }} RendererLayer
 */

/** @typedef {ReturnType<typeof getLabelStyle>} LabelStyle */

/** @param {RendererLayer} layer */
export function getLabelMinZoom(layer) {
  const value = Number(layer.labelMinZoom);
  return Number.isFinite(value) ? value : DEFAULT_LABEL_MIN_ZOOM;
}

/** @param {RendererLayer} layer */
export function getLabelMaxZoom(layer) {
  if (layer.labelMaxZoom === undefined || layer.labelMaxZoom === null || layer.labelMaxZoom === '') return undefined;
  const value = Number(layer.labelMaxZoom);
  return Number.isFinite(value) ? value : undefined;
}

/**
 * A layer's label style. The text is drawn in the layer's line colour (owner, 20 Nov 2026: a
 * label reads as the same colour as its outlines), whatever colour the metadata's labelStyle or
 * labelTextColor names, since the load-order palette and a visitor's colour change only the
 * line. legibleLabelColour darkens it only as far as its halo needs.
 * @param {RendererLayer} layer
 * @param {string | null} [lineColour]  the colour the line is drawn in now (the map controller's
 *   record colour, after a palette or visitor change), when it may differ from layer.style.color
 * @param {{ darkBase?: boolean }} [options]  darkBase: the base map is dark (OpenFreeMap Dark in
 *   the dark theme), so the halo is dark and the label colour is lightened against it
 */
export function getLabelStyle(layer, lineColour, { darkBase = false } = {}) {
  /** @type {LabelStyleInput} */
  const style = layer.labelStyle || {};
  const haloColor = darkBase ? MAP_COLOURS.labelHaloDark : resolveLabelColor(layer, style.haloColor || MAP_COLOURS.labelHaloDefault);
  return {
    color: legibleLabelColour(lineColour || layerLineColour(layer), haloColor),
    hoverColor: resolveLabelColor(layer, style.hoverColor || MAP_COLOURS.labelHover),
    selectedColor: resolveLabelColor(layer, style.selectedColor || MAP_COLOURS.labelSelected),
    haloColor,
    haloWidth: clamp(style.haloWidth ?? 1.4, 0, 4),
    haloBlur: clamp(style.haloBlur ?? 0, 0, 2),
    fontSize: clamp(style.fontSize ?? 12, 6, 32),
    fontWeight: style.fontWeight === 'regular' ? 'regular' : 'bold',
    maxWidth: clamp(style.maxWidth ?? 14, 4, 30),
    lineHeight: clamp(style.lineHeight ?? 1.25, 0.8, 2)
  };
}

/**
 * @param {RendererLayer} layer
 * @param {unknown} value
 */
export function resolveLabelColor(layer, value) {
  if (value === 'layer') return layer.style?.color || MAP_COLOURS.layer;
  if (typeof value === 'string' && value.trim()) return value.trim();
  return MAP_COLOURS.layer;
}

/**
 * The colour a layer's line (or point) is drawn in when it is added, as the map controller
 * paints it.
 * @param {RendererLayer} layer
 * @returns {string}
 */
export function layerLineColour(layer) {
  return layer.style?.color || MAP_COLOURS.layerLine;
}

/** The least contrast a label keeps against its halo: WCAG's figure for large or bold text. */
export const LABEL_MIN_CONTRAST = 3;

/**
 * A colour as [r, g, b] (0 to 255), from #rgb or #rrggbb; null for anything else.
 * @param {unknown} colour
 * @returns {[number, number, number] | null}
 */
export function parseHexColour(colour) {
  const match = typeof colour === 'string' ? /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(colour.trim()) : null;
  if (!match) return null;
  const hex = /** @type {string} */ (match[1]);
  const full = hex.length === 3 ? hex.replace(/./g, (c) => c + c) : hex;
  return [parseInt(full.slice(0, 2), 16), parseInt(full.slice(2, 4), 16), parseInt(full.slice(4, 6), 16)];
}

/**
 * A colour's WCAG relative luminance (0 black to 1 white).
 * @param {[number, number, number]} rgb
 */
export function relativeLuminance(rgb) {
  const [r, g, b] = rgb.map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * /** @type {number} */ (r) + 0.7152 * /** @type {number} */ (g) + 0.0722 * /** @type {number} */ (b);
}

/**
 * The WCAG contrast ratio of two colours (1 to 21).
 * @param {[number, number, number]} a
 * @param {[number, number, number]} b
 */
export function contrastRatio(a, b) {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * A label colour of the same hue as `colour` that keeps LABEL_MIN_CONTRAST against its halo:
 * the colour itself when it already does; otherwise the least darkening that does (each channel
 * scaled by one factor, so hue and saturation hold), or the least lightening for a dark halo.
 * A colour or halo that is not #rgb/#rrggbb is returned unchanged.
 * @param {string} colour
 * @param {string} halo
 * @returns {string}
 */
export function legibleLabelColour(colour, halo) {
  const rgb = parseHexColour(colour);
  const haloRgb = parseHexColour(halo);
  if (!rgb || !haloRgb || contrastRatio(rgb, haloRgb) >= LABEL_MIN_CONTRAST) return colour;
  const darken = relativeLuminance(haloRgb) >= relativeLuminance(rgb);
  /** @param {number} t  0 the colour, 1 black (darkening) or white (lightening) */
  const shade = (t) => /** @type {[number, number, number]} */ (rgb.map((v) => Math.round(darken ? v * (1 - t) : v + (255 - v) * t)));
  for (let step = 1; step <= 20; step += 1) {
    const next = shade(step / 20);
    if (contrastRatio(next, haloRgb) >= LABEL_MIN_CONTRAST) return toHexColour(next);
  }
  return toHexColour(shade(1));
}

/**
 * @param {[number, number, number]} rgb
 * @returns {string}
 */
function toHexColour(rgb) {
  return `#${rgb.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

/**
 * The text colour of a layer's labels: the hover and selected colours, else its line colour.
 * @param {RendererLayer} layer
 * @param {string | null} [lineColour]  as getLabelStyle
 */
export function buildLabelColorExpression(layer, lineColour) {
  const style = getLabelStyle(layer, lineColour);
  return [
    'case',
    ['boolean', ['feature-state', 'selected'], false],
    style.selectedColor,
    ['boolean', ['feature-state', 'hover'], false],
    style.hoverColor,
    style.color
  ];
}

/** @param {Pick<LabelStyle, 'fontWeight'>} labelStyle */
export function buildLabelFontStack(labelStyle) {
  return labelStyle.fontWeight === 'bold'
    ? ['Open Sans Bold', 'Arial Unicode MS Bold']
    : ['Open Sans Regular', 'Arial Unicode MS Regular'];
}

/**
 * The tile property holding the Irish name of this layer's features, when the interface is in
 * Irish (assets/i18n/i18n.js, loaded only with the language preview on) and the layer's data
 * carries one (assets/i18n/place-name-fields.json). Otherwise null, and labels are as before.
 * @param {RendererLayer} layer
 * @returns {string | null}
 */
export function irishNameProperty(layer) {
  const i18n = typeof globalThis !== 'undefined' ? /** @type {{ civgraphI18n?: { placeNameField?: (layer: RendererLayer) => string | null } }} */ (globalThis).civgraphI18n : null;
  return i18n && typeof i18n.placeNameField === 'function' ? i18n.placeNameField(layer) : null;
}

/**
 * The per-layer Irish name properties (assets/i18n/place-name-fields.json), loaded by the map at
 * start (setIrishNameFields) so the Irish second line shows for every reader (owner, 24 Nov 2026,
 * as Phelim Birch asked), not only after the language control is loaded.
 * @type {{ layers: Record<string, string>, hints: string[] } | null}
 */
let irishNameFields = null;

/**
 * @param {{ layers?: Record<string, string>, hints?: string[] } | null | undefined} table
 */
export function setIrishNameFields(table) {
  irishNameFields = table ? { layers: table.layers || {}, hints: Array.isArray(table.hints) ? table.hints : [] } : null;
}

/**
 * The same lookup as assets/i18n/i18n.js irishNameField, over the table the map loaded.
 * @param {RendererLayer} layer
 * @returns {string | null}
 */
function irishNameFieldFromTable(layer) {
  if (!irishNameFields || !layer) return null;
  const l = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (layer));
  for (const id of [l.id, l.layerId, l.sourceMapId, l.mapId]) {
    if (typeof id === 'string' && id && irishNameFields.layers[id]) return irishNameFields.layers[id];
  }
  const props = /** @type {unknown[]} */ ([]).concat(l.categoricalProperties || [], l.popupProperties || []);
  for (const hint of irishNameFields.hints) {
    if (props.includes(hint)) return hint;
  }
  return null;
}

/**
 * The tile property whose Irish name goes on a second line under an English label (OT22
 * decision 1). Shown to every reader (owner, 24 Nov 2026): the language control's lookup when it
 * is loaded, else the table the map loaded at start. With the interface in Irish, null: the Irish
 * name is then the label itself (irishNameProperty), alone, as before.
 * @param {RendererLayer} layer
 * @returns {string | null}
 */
export function irishSecondLineField(layer) {
  if (irishNameProperty(layer)) return null;
  const i18n = typeof globalThis !== 'undefined' ? /** @type {{ civgraphI18n?: { irishNameField?: (layer: RendererLayer) => string | null } }} */ (globalThis).civgraphI18n : null;
  if (i18n && typeof i18n.irishNameField === 'function') return i18n.irishNameField(layer);
  return irishNameFieldFromTable(layer);
}

/**
 * What a feature's map label says: its name in title case when the data has it in capitals (the
 * data, the details pane and search keep the official form), and the Irish name for a second line
 * where irishSecondLineField gives one ('' otherwise).
 * @param {RendererLayer} layer
 * @param {Record<string, unknown> | null | undefined} props
 * @returns {import('./label-text.mjs').LabelLines}
 */
export function getLabelLines(layer, props) {
  const primary = getFeatureLabel(layer, props);
  const irishField = irishSecondLineField(layer);
  if (!irishField) return { primary: titleCaseCaps(primary), secondary: '' };
  const irish = cleanLabelValue(repairFeatureProperties(layer, props || {})?.[irishField], layer.labelCleanup);
  return bilingualLines(primary, irish);
}

/** @param {RendererLayer} layer */
export function getLabelProperties(layer) {
  const irish = irishNameProperty(layer);
  // unique() drops the empty ones.
  return /** @type {string[]} */ (unique([
    ...(irish ? [irish] : []),
    layer.labelCanonicalProperty || 'label_name',
    layer.labelProperty,
    ...(Array.isArray(layer.labelPropertyFallbacks) ? layer.labelPropertyFallbacks : [])
  ]));
}

/** @param {RendererLayer} layer */
export function buildLabelTextExpression(layer) {
  const props = getLabelProperties(layer);
  if (props.length === 0) return '';
  return buildRepairedLabelValueExpression(layer, ['coalesce', ...props.map((prop) => ['get', prop]), '']);
}

/** @param {RendererLayer} layer */
export function buildLabelFilter(layer) {
  const props = getLabelProperties(layer);
  const baseFilter = props.length > 0 ? ['any', ...props.map((prop) => ['has', prop])] : true;
  const repairFilter = buildRepairedLabelFilterExpression(layer);
  return repairFilter ? ['any', baseFilter, repairFilter] : baseFilter;
}

/**
 * @param {RendererLayer} layer
 * @param {unknown} scale
 */
export function buildLabelTextSizeExpression(layer, scale) {
  const style = getLabelStyle(layer);
  const multiplier = clamp(scale, 50, 200) / 100;
  return style.fontSize * multiplier;
}

/** @param {RendererLayer} layer */
export function buildLabelSortExpression(layer) {
  return ['*', -1, ['to-number', ['get', layer.labelRankProperty || 'label_rank'], 0]];
}

/**
 * @param {RendererLayer} layer
 * @param {Record<string, unknown> | null | undefined} props
 */
export function getFeatureLabel(layer, props) {
  const repairedProps = repairFeatureProperties(layer, props || {});
  for (const prop of getLabelProperties(layer)) {
    const value = cleanLabelValue(repairedProps?.[prop], layer.labelCleanup);
    if (value) return value;
  }
  return '';
}

/**
 * @param {unknown} value
 * @param {LabelCleanupRule | null | undefined} cleanupRule
 */
export function cleanLabelValue(value, cleanupRule) {
  if (value === undefined || value === null) return '';
  const text = String(value).trim();
  if (!text) return '';
  if (cleanupRule === 'stripTrailingBracketNumber') return text.replace(/\s*\([^()]*\)\s*$/, '').trim();
  if (cleanupRule && typeof cleanupRule === 'object' && cleanupRule.type === 'mapValues') {
    const mapped = cleanupRule.map?.[text];
    if (typeof mapped === 'string' && mapped.trim()) return mapped.trim();
  }
  return text;
}
