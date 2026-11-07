/**
 * Approximate boundary stretches (boundary audit of 7 Nov 2026).
 *
 * Some editions were reconstructed rather than taken from a source dataset: council extensions traced
 * from the plans deposited with their Orders, the 1969 Stormont divisions cut along the Interim
 * Boundary Commission's map, lines whose townlands are not confirmed. maps.json gives such an edition
 * `approximateSegments: {url, count, totalKm, note}`, the url a small GeoJSON of LineStrings (one per
 * published file, data/maps/approximate/) whose features carry `reason`, `uncertainty_m` and `label`.
 * The renderer draws them dotted over the layer's own line (map-controller addApproximateSegmentLayers),
 * the legend names them and Browse prints the note.
 */

export const APPROXIMATE_REASONS = Object.freeze([
  'map-line-deposited-plan',
  'map-line-~150m',
  'assumed-cut',
  'unconfirmed-composition',
  'modern-townland-may-differ'
]);

const CDN_ORIGIN = 'https://data.civgraph.net/';

/** The layer's segment file, or '' when it has none. On localhost it goes through the dev proxy (/_r/),
 * as the FGB and other CDN files do, because the bucket's CORS rules do not admit localhost. */
export function resolveApproximateSegmentsUrl(layer, loc = (typeof location !== 'undefined' ? location : null)) {
  const url = layer?.approximateSegments?.url;
  if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) return '';
  if (loc?.hostname === 'localhost' && url.startsWith(CDN_ORIGIN)) {
    return `${loc.origin}/_r/${url.slice(CDN_ORIGIN.length)}`;
  }
  return url;
}

/** Map style ids for a layer's approximate stretches. */
export function approximateSegmentIds(layerId) {
  return {
    sourceId: `${layerId}-approx-source`,
    gapId: `${layerId}-approx-gap`,
    lineId: `${layerId}-approx`,
    hitId: `${layerId}-approx-hit`
  };
}

const FALLBACK_LABEL = {
  'map-line-deposited-plan': 'Traced from the map deposited with the Order or Act',
  'map-line-~150m': 'Cut along the line of a small-scale map',
  'assumed-cut': 'Drawn to fit the census area; no map of this line is held',
  'unconfirmed-composition': 'Follows townland or division lines, but which ones is not confirmed',
  'modern-townland-may-differ': "Follows today's townland or coast line; the line of the time may differ"
};

/** The tooltip's second line: the segment's own label, else one built from its reason and uncertainty. */
export function approximateSegmentLabel(properties = {}) {
  if (typeof properties.label === 'string' && properties.label.trim()) return properties.label.trim();
  const base = FALLBACK_LABEL[properties.reason] || 'This stretch of the line is approximate';
  const metres = Number(properties.uncertainty_m);
  return Number.isFinite(metres) && metres > 0 ? `${base}; may be out by about ${Math.round(metres)} m.` : `${base}.`;
}
