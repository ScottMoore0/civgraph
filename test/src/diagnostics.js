import { TEST_ASSET_VERSION, TEST_CAPABILITIES } from './config.js';

export function emitDiagnostics(els, controller, metadata = null, extra = {}) {
  const data = {
    renderer: 'maplibre-gl',
    assetVersion: TEST_ASSET_VERSION,
    maplibreVersion: controller.maplibreVersion,
    capabilities: TEST_CAPABILITIES,
    metadata: metadata ? {
      schemaVersion: metadata.schemaVersion,
      layers: metadata.layers.length,
      categories: metadata.categories.length,
      timeSeriesChains: metadata.timeSeriesChains.length,
      electionCatalogues: metadata.electionCatalogues.length
    } : null,
    loadedLayers: [...controller.layers.keys()],
    labelLayers: getDiagnosticLabelLayers(controller),
    renderedLabelFeatures: getRenderedLabelFeatureCount(controller),
    health: getHealthDiagnostics(controller, metadata),
    zoom: controller.map ? Number(controller.map.getZoom().toFixed(3)) : null,
    center: controller.map ? controller.map.getCenter().toArray().map((value) => Number(value.toFixed(5))) : null,
    metrics: controller.metrics.slice(-8),
    ...extra
  };
  els.diagnostics.textContent = JSON.stringify(data, null, 2);
}

export function getHealthDiagnostics(controller, metadata) {
  const layers = metadata?.layers || [];
  const loadable = layers.filter((layer) => layer.loadable !== false);
  const slowLoads = controller.metrics
    .filter((metric) => metric.event === 'load' && metric.durationMs >= 1500)
    .slice(-10);
  const largeLayers = loadable
    .filter((layer) => Number(layer.generatedFrom?.bytes || layer.tilePackage?.bytes || 0) >= 50 * 1024 * 1024)
    .map((layer) => ({
      id: layer.id,
      sourceType: layer.sourceType,
      bytes: layer.generatedFrom?.bytes || layer.tilePackage?.bytes || null,
      maxTileBytes: layer.generatedFrom?.maxTileBytes || null
    }));
  const oversizedTiles = loadable
    .filter((layer) => Number(layer.generatedFrom?.maxTileBytes || 0) >= 1024 * 1024)
    .map((layer) => ({
      id: layer.id,
      maxTileBytes: layer.generatedFrom.maxTileBytes
    }));
  const missingIndexes = loadable
    .filter((layer) => ['mvt', 'pmtiles'].includes(layer.sourceType))
    .filter((layer) => layer.labelProperty && !layer.featureIndexUrl)
    .map((layer) => layer.id);
  return {
    loadableLayers: loadable.length,
    pmtilesLayers: loadable.filter((layer) => layer.sourceType === 'pmtiles').length,
    directoryMvtLayers: loadable.filter((layer) => layer.sourceType === 'mvt').length,
    slowLoads,
    largeLayers,
    oversizedTiles,
    missingIndexes
  };
}

export function getDiagnosticLabelLayers(controller) {
  if (!controller.map) return [];
  return [...controller.layers.entries()].flatMap(([layerId, record]) => (
    (record.labelLayerIds || []).map((labelLayerId) => {
      const styleLayer = controller.map.getLayer(labelLayerId);
      return {
        layerId,
        labelLayerId,
        minzoom: styleLayer?.minzoom ?? null,
        maxzoom: styleLayer?.maxzoom ?? null,
        labelsEnabled: record.labelsEnabled,
        textScale: record.textScale
      };
    })
  ));
}

export function getRenderedLabelFeatureCount(controller) {
  if (!controller.map) return 0;
  const labelLayerIds = getDiagnosticLabelLayers(controller).map((layer) => layer.labelLayerId);
  if (!labelLayerIds.length) return 0;
  try {
    return controller.map.queryRenderedFeatures(undefined, { layers: labelLayerIds }).length;
  } catch {
    return null;
  }
}
