export function assessMigrationReadiness(metadata, controller) {
  const layers = metadata?.layers || [];
  const vectorReady = layers.filter((layer) => layer.renderer === 'maplibre' && ['mvt', 'pmtiles'].includes(layer.sourceType)).length;
  const withBounds = layers.filter((layer) => Array.isArray(layer.bounds)).length;
  const withSourceCredits = layers.filter((layer) => layer.provider || layer.references?.length || layer.sourceDownloads?.length).length;
  const withLabels = layers.filter((layer) => layer.labelProperty).length;
  return {
    vectorReady,
    totalLayers: layers.length,
    withBounds,
    withSourceCredits,
    withLabels,
    loadedLayers: controller ? controller.layers.size : 0,
    readyForCutover: layers.length > 0 && vectorReady === layers.length && withBounds === layers.length
  };
}
