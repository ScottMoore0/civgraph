import { TEST_ASSET_VERSION, TEST_CAPABILITIES } from './config.js';
import { escapeHtml } from './utils.js';

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
  emitDiagnostics.lastData = data;
  els.diagnostics.innerHTML = renderDiagnosticsPanel(data);
}
emitDiagnostics.lastData = null;

function renderDiagnosticsPanel(data) {
  const health = data.health || {};
  const latestLoads = (data.metrics || []).filter((metric) => metric.event === 'load').slice(-4);
  const warnings = getDiagnosticWarnings(data)
    .filter((item) => data.severity === 'all' || item.severity === data.severity)
    .sort((a, b) => data.sort === 'layer'
      ? a.layerId.localeCompare(b.layerId)
      : severityRank(b.severity) - severityRank(a.severity) || a.layerId.localeCompare(b.layerId));
  const grouped = groupWarnings(warnings);
  return `
    <div class="diagnostics-grid">
      ${renderStat('Renderer', data.renderer)}
      ${renderStat('Version', data.assetVersion)}
      ${renderStat('Layers', `${health.pmtilesLayers || 0} PMTiles / ${health.directoryMvtLayers || 0} MVT`)}
      ${renderStat('Loaded', (data.loadedLayers || []).length)}
      ${renderStat('Zoom', data.zoom)}
      ${renderStat('Labels', data.renderedLabelFeatures)}
      ${renderStat('Fallbacks', data.telemetry?.fallbackCount || 0)}
      ${renderStat('CDN failures', data.telemetry?.cdnFailures || 0)}
    </div>
    ${warnings.length ? `
      <section class="diagnostics-section diagnostics-section--warn">
        <h3>Grouped Warnings</h3>
        ${Object.entries(grouped).map(([layerId, items]) => `
          <details class="diagnostics-warning-group" open>
            <summary>${escapeHtml(layerId)} <span>${items.length}</span></summary>
            <ul>${items.slice(0, 8).map((item) => `<li data-severity="${escapeHtml(item.severity)}"><b>${escapeHtml(item.type)}</b>: ${escapeHtml(item.message)}</li>`).join('')}</ul>
          </details>
        `).join('')}
      </section>
    ` : ''}
    ${latestLoads.length ? `
      <section class="diagnostics-section">
        <h3>Recent Loads</h3>
        <ul>${latestLoads.map((item) => `<li>${escapeHtml(item.layerId)}: ${escapeHtml(String(item.durationMs))}ms (${escapeHtml(item.sourceType)})</li>`).join('')}</ul>
      </section>
    ` : ''}
    ${data.telemetry?.resourceTimings?.length ? `
      <section class="diagnostics-section">
        <h3>PMTiles Network</h3>
        <ul>${data.telemetry.resourceTimings.map((item) => `<li>${escapeHtml(item.name)}: ${escapeHtml(item.durationMs)}ms${item.transferSize ? `, ${escapeHtml(formatBytes(item.transferSize))}` : ''}</li>`).join('')}</ul>
      </section>
    ` : ''}
    <details class="diagnostics-raw">
      <summary>Raw JSON</summary>
      <pre>${escapeHtml(JSON.stringify(data, null, 2))}</pre>
    </details>
  `;
}

function renderStat(label, value) {
  return `<div class="diagnostics-stat"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value ?? 'n/a')}</strong></div>`;
}

function renderWarningList(title, items = [], format) {
  if (!items.length) return '';
  return `
    <section class="diagnostics-section diagnostics-section--warn">
      <h3>${escapeHtml(title)}</h3>
      <ul>${items.slice(0, 8).map((item) => `<li>${escapeHtml(format(item))}</li>`).join('')}</ul>
      ${items.length > 8 ? `<p>${items.length - 8} more</p>` : ''}
    </section>
  `;
}

function getDiagnosticWarnings(data) {
  const health = data.health || {};
  const metrics = data.metrics || [];
  return [
    ...(health.slowLoads || []).map((item) => ({ severity: 'warn', layerId: item.layerId, type: 'slow-load', message: `${item.durationMs}ms` })),
    ...(health.largeLayers || []).map((item) => ({ severity: 'warn', layerId: item.id, type: 'large-layer', message: `${formatBytes(item.bytes)}${item.maxTileBytes ? `, max tile ${formatBytes(item.maxTileBytes)}` : ''}` })),
    ...(health.oversizedTiles || []).map((item) => ({ severity: 'warn', layerId: item.id, type: 'large-tile', message: formatBytes(item.maxTileBytes) })),
    ...(health.missingIndexes || []).map((id) => ({ severity: 'warn', layerId: id, type: 'missing-index', message: 'No feature-search index' })),
    ...metrics
      .filter((metric) => /fallback|failed|error/i.test(metric.event))
      .map((metric) => ({ severity: /failed|error/i.test(metric.event) ? 'error' : 'warn', layerId: metric.layerId || 'runtime', type: metric.event, message: metric.reason || metric.sourceType || 'runtime event' }))
  ];
}

function groupWarnings(items) {
  return items.reduce((groups, item) => {
    const key = item.layerId || 'runtime';
    if (!groups[key]) groups[key] = [];
    groups[key].push(item);
    return groups;
  }, {});
}

function severityRank(value) {
  return value === 'error' ? 2 : value === 'warn' ? 1 : 0;
}

function formatBytes(bytes) {
  return `${(Number(bytes || 0) / 1024 / 1024).toFixed(1)} MB`;
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
