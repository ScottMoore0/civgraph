import { DEFAULT_LABEL_MIN_ZOOM } from './config.js';
import {
  buildRepairedLabelFilterExpression,
  buildRepairedLabelValueExpression,
  repairFeatureProperties
} from './feature-property-repairs.js';
import { clamp, unique } from './utils.js';
import { MAP_COLOURS } from '../colours.mjs';

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
 *   id?: string,
 *   sourceMapId?: string,
 *   sourceLayer?: string,
 *   style?: { color?: string, [key: string]: unknown },
 *   labelStyle?: LabelStyleInput,
 *   labelMinZoom?: number | string,
 *   labelMaxZoom?: number | string | null,
 *   labelProperty?: string | null,
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

/** @param {RendererLayer} layer */
export function getLabelStyle(layer) {
  /** @type {LabelStyleInput} */
  const style = layer.labelStyle || {};
  const baseColor = resolveLabelColor(layer, style.color || layer.labelTextColor || 'layer');
  return {
    color: baseColor,
    hoverColor: resolveLabelColor(layer, style.hoverColor || MAP_COLOURS.labelHover),
    selectedColor: resolveLabelColor(layer, style.selectedColor || MAP_COLOURS.labelSelected),
    haloColor: resolveLabelColor(layer, style.haloColor || MAP_COLOURS.labelHaloDefault),
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

/** @param {RendererLayer} layer */
export function buildLabelColorExpression(layer) {
  const style = getLabelStyle(layer);
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
