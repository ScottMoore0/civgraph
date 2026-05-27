import 'maplibre-gl/dist/maplibre-gl.css';
import './styles.css';

import { getElements } from './dom.js';
import { TestMapLibreController } from './map-controller.js';
import { TestMetadataService } from './metadata-service.js';
import { TestCatalogue } from './catalogue-controller.js';
import { renderActiveLayers } from './active-layers.js';
import { renderFeatureDetails } from './feature-details.js';
import { renderSourcePanel } from './source-panel.js';
import { renderTimeSeriesPanel } from './time-series-panel.js';
import { emitDiagnostics } from './diagnostics.js';
import { UrlStateController } from './url-state.js';
import { FeatureSearchService } from './search-service.js';
import { TimeSeriesController } from './time-series-controller.js';
import { ElectionService } from './election-service.js';
import { ConditionalStylingController } from './conditional-styling.js';
import { assessMigrationReadiness } from './migration-readiness.js';
import { showToast } from './utils.js';
import { TestTelemetry } from './telemetry.js';

async function main() {
  const els = getElements();
  let metadata = null;
  let catalogue = null;
  let urlState = null;
  let featureSearch = { featureIndexes: new Map() };
  let timeSeries = { getChains: () => [] };
  let elections = { getCatalogues: () => [] };
  let conditionalStyling = { activeStyles: new Map() };
  const telemetry = new TestTelemetry();

  const renderDiagnostics = () => {
    emitDiagnostics(els, controller, metadata, {
      severity: els.diagnosticsSeverity?.value || 'all',
      sort: els.diagnosticsSort?.value || 'severity',
      migrationReadiness: assessMigrationReadiness(metadata, controller),
      featureSearchIndexes: featureSearch.featureIndexes.size,
      timeSeriesChains: timeSeries.getChains().length,
      electionCatalogues: elections.getCatalogues().length,
      conditionalStyles: conditionalStyling.activeStyles.size,
      telemetry: telemetry.snapshot()
    });
  };
  const renderSecondaryPanels = () => {
    renderSourcePanel(els, controller, { query: els.sourceFilter?.value || '' });
    renderTimeSeriesPanel(els, timeSeries, controller, {
      onChange: () => {
        renderActiveLayers(els, controller, { onRendered: renderDiagnostics, conditionalStyling });
        renderSecondaryPanels();
        urlState?.write();
      }
    });
  };

  const controller = new TestMapLibreController('map', {
    onSelection: (selection) => {
      renderFeatureDetails(els, selection);
      renderSecondaryPanels();
    },
    onMetric: (metric) => telemetry.record(metric),
    onFallback: (event) => {
      telemetry.record({ ...event, event: 'pmtiles-fallback-visible' });
      renderFallbackAlerts(els, controller);
      const name = event.layerName || event.layerId;
      showToast(els, event.fallbackUnavailable
        ? `${name} PMTiles failed; no production directory fallback is deployed.`
        : `${name} fell back to directory tiles.`);
    },
    onChange: () => {
      renderActiveLayers(els, controller, { onRendered: renderDiagnostics, conditionalStyling });
      catalogue?.render();
      renderSecondaryPanels();
      urlState?.write();
      renderDiagnostics();
    }
  });
  controller.init();
  els.sourceFilter?.addEventListener('input', renderSecondaryPanels);
  els.diagnosticsSeverity?.addEventListener('change', renderDiagnostics);
  els.diagnosticsSort?.addEventListener('change', renderDiagnostics);
  els.copyDiagnostics?.addEventListener('click', async () => {
    const report = JSON.stringify(window.__civgraphTest?.diagnostics?.() || {}, null, 2);
    try {
      await navigator.clipboard.writeText(report);
      showToast(els, 'Diagnostics copied.');
    } catch {
      showToast(els, 'Diagnostics copy failed.');
    }
  });
  els.sidebarToggle?.addEventListener('click', () => {
    const open = !document.body.classList.contains('test-sidebar-open');
    document.body.classList.toggle('test-sidebar-open', open);
    els.sidebarToggle.setAttribute('aria-expanded', String(open));
  });

  const metadataService = new TestMetadataService();
  metadata = await metadataService.load();
  telemetry.record({
    event: 'startup',
    layerCount: metadata.layers.length,
    pmtilesLayers: metadata.layers.filter((layer) => layer.sourceType === 'pmtiles').length
  });

  featureSearch = new FeatureSearchService(metadataService);
  timeSeries = new TimeSeriesController(metadataService, controller);
  conditionalStyling = new ConditionalStylingController(controller);
  elections = new ElectionService(metadataService, conditionalStyling);

  catalogue = new TestCatalogue(els, metadataService, controller, {
    onLayerStateChange: () => {
      renderActiveLayers(els, controller, { onRendered: renderDiagnostics, conditionalStyling });
      urlState?.write();
      renderDiagnostics();
    },
    featureSearch,
    onError: (err) => {
      console.error(err);
      telemetry.record({ event: 'catalogue-error', reason: err.message });
      showToast(els, err.message);
    }
  });
  catalogue.init();

  urlState = new UrlStateController(controller, metadataService, conditionalStyling);
  await urlState.restore();
  renderActiveLayers(els, controller, { onRendered: renderDiagnostics, conditionalStyling });
  renderFeatureDetails(els, null);
  renderSecondaryPanels();
  renderDiagnostics();

  window.__civgraphTest = {
    controller,
    metadataService,
    featureSearch,
    timeSeries,
    elections,
    conditionalStyling,
    telemetry,
    diagnostics: () => emitDiagnostics.lastData || {},
    assessMigrationReadiness: () => assessMigrationReadiness(metadata, controller)
  };
}

function renderFallbackAlerts(els, controller) {
  if (!els.fallbackAlerts) return;
  const fallbacks = controller.metrics
    .filter((metric) => metric.event === 'pmtiles-fallback' || metric.event === 'pmtiles-fallback-unavailable')
    .slice(-3);
  els.fallbackAlerts.innerHTML = fallbacks.map((metric) => `
    <div class="fallback-alert">
      <strong>${metric.layerName || metric.layerId}</strong>
      <span>${metric.fallbackUnavailable
        ? 'PMTiles failed; production directory fallback is not deployed.'
        : 'PMTiles failed; using directory vector tiles.'}</span>
    </div>
  `).join('');
}

main().catch((err) => {
  console.error(err);
  const els = getElements();
  showToast(els, err.message);
  els.diagnostics.textContent = `Startup failed: ${err.stack || err.message}`;
});
