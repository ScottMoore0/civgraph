import { DEFAULT_LABEL_MIN_ZOOM } from './config.js';
import { clamp, unique } from './utils.js';

export function getLabelMinZoom(layer) {
  const value = Number(layer.labelMinZoom);
  return Number.isFinite(value) ? value : DEFAULT_LABEL_MIN_ZOOM;
}

export function getLabelMaxZoom(layer) {
  if (layer.labelMaxZoom === undefined || layer.labelMaxZoom === null || layer.labelMaxZoom === '') return undefined;
  const value = Number(layer.labelMaxZoom);
  return Number.isFinite(value) ? value : undefined;
}

export function getLabelStyle(layer) {
  const style = layer.labelStyle || {};
  const baseColor = resolveLabelColor(layer, style.color || layer.labelTextColor || 'layer');
  return {
    color: baseColor,
    hoverColor: resolveLabelColor(layer, style.hoverColor || '#ff7a1a'),
    selectedColor: resolveLabelColor(layer, style.selectedColor || '#111827'),
    haloColor: resolveLabelColor(layer, style.haloColor || '#ffffff'),
    haloWidth: clamp(style.haloWidth ?? 1.4, 0, 4),
    haloBlur: clamp(style.haloBlur ?? 0, 0, 2),
    fontSize: clamp(style.fontSize ?? 12, 6, 32),
    fontWeight: style.fontWeight === 'regular' ? 'regular' : 'bold',
    maxWidth: clamp(style.maxWidth ?? 14, 4, 30),
    lineHeight: clamp(style.lineHeight ?? 1.25, 0.8, 2)
  };
}

export function resolveLabelColor(layer, value) {
  if (value === 'layer') return layer.style?.color || '#3388ff';
  if (typeof value === 'string' && value.trim()) return value.trim();
  return '#3388ff';
}

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

export function buildLabelFontStack(labelStyle) {
  return labelStyle.fontWeight === 'bold'
    ? ['Open Sans Bold', 'Arial Unicode MS Bold']
    : ['Open Sans Regular', 'Arial Unicode MS Regular'];
}

export function getLabelProperties(layer) {
  return unique([
    layer.labelCanonicalProperty || 'label_name',
    layer.labelProperty,
    ...(Array.isArray(layer.labelPropertyFallbacks) ? layer.labelPropertyFallbacks : [])
  ]);
}

export function buildLabelTextExpression(layer) {
  const props = getLabelProperties(layer);
  if (props.length === 0) return '';
  return ['coalesce', ...props.map((prop) => ['get', prop]), ''];
}

export function buildLabelFilter(layer) {
  const props = getLabelProperties(layer);
  return props.length > 0 ? ['any', ...props.map((prop) => ['has', prop])] : true;
}

export function buildLabelTextSizeExpression(layer, scale) {
  const style = getLabelStyle(layer);
  const multiplier = clamp(scale, 50, 200) / 100;
  return style.fontSize * multiplier;
}

export function buildLabelSortExpression(layer) {
  return ['*', -1, ['to-number', ['get', layer.labelRankProperty || 'label_rank'], 0]];
}

export function getFeatureLabel(layer, props) {
  for (const prop of getLabelProperties(layer)) {
    const value = cleanLabelValue(props?.[prop], layer.labelCleanup);
    if (value) return value;
  }
  return '';
}

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
