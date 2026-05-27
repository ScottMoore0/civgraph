import 'maplibre-gl/dist/maplibre-gl.css';
import './styles.css';

import { getElements } from './dom.js';
import { TestMapLibreController } from './map-controller.js';
import { TestMetadataService } from './metadata-service.js';
import { TestCatalogue } from './catalogue-controller.js';
import { renderActiveLayers } from './active-layers.js';
import { renderFeatureDetails } from './feature-details.js';
import { emitDiagnostics } from './diagnostics.js';
import { UrlStateController } from './url-state.js';
import { FeatureSearchService } from './search-service.js';
import { TimeSeriesController } from './time-series-controller.js';
import { ElectionService } from './election-service.js';
import { ConditionalStylingController } from './conditional-styling.js';
import { assessMigrationReadiness } from './migration-readiness.js';
import { showToast } from './utils.js';

async function main() {
  const els = getElements();
  let metadata = null;
  let catalogue = null;
  let urlState = null;
  let featureSearch = { featureIndexes: new Map() };
  let timeSeries = { getChains: () => [] };
  let elections = { getCatalogues: () => [] };
  let conditionalStyling = { activeStyles: new Map() };

  const renderDiagnostics = () => {
    emitDiagnostics(els, controller, metadata, {
      migrationReadiness: assessMigrationReadiness(metadata, controller),
      featureSearchIndexes: featureSearch.featureIndexes.size,
      timeSeriesChains: timeSeries.getChains().length,
      electionCatalogues: elections.getCatalogues().length,
      conditionalStyles: conditionalStyling.activeStyles.size
    });
  };

  const controller = new TestMapLibreController('map', {
    onSelection: (selection) => renderFeatureDetails(els, selection),
    onChange: () => {
      renderActiveLayers(els, controller, { onRendered: renderDiagnostics, conditionalStyling });
      catalogue?.render();
      urlState?.write();
      renderDiagnostics();
    }
  });
  controller.init();

  const metadataService = new TestMetadataService();
  metadata = await metadataService.load();

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
      showToast(els, err.message);
    }
  });
  catalogue.init();

  urlState = new UrlStateController(controller, metadataService);
  await urlState.restore();
  renderActiveLayers(els, controller, { onRendered: renderDiagnostics, conditionalStyling });
  renderFeatureDetails(els, null);
  renderDiagnostics();

  window.__civgraphTest = {
    controller,
    metadataService,
    featureSearch,
    timeSeries,
    elections,
    conditionalStyling,
    assessMigrationReadiness: () => assessMigrationReadiness(metadata, controller)
  };
}

main().catch((err) => {
  console.error(err);
  const els = getElements();
  showToast(els, err.message);
  els.diagnostics.textContent = `Startup failed: ${err.stack || err.message}`;
});
