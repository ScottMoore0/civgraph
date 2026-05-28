export const TEST_ASSET_VERSION = 'test-018';
export const METADATA_URL = `/test/metadata/maps-test.json?v=${TEST_ASSET_VERSION}`;
export const PORT_PLAN_URL = `/test/metadata/main-site-port-plan.json?v=${TEST_ASSET_VERSION}`;
export const IRELAND_BOUNDS = [[-10.75, 51.35], [-5.35, 55.55]];
export const HOVER_MIN_ZOOM = 7;
export const HOVER_THROTTLE_MS = 80;
export const CLICK_TOLERANCE_PX = 6;
export const DEFAULT_TEXT_SCALE = 100;
export const DEFAULT_LABEL_MIN_ZOOM = 0;

export const TEST_CAPABILITIES = Object.freeze({
  metadataV2: true,
  vectorTiles: true,
  catalogue: true,
  activeLayerControls: true,
  labels: true,
  featureDetails: true,
  featureSearch: true,
  urlState: true,
  timeSeriesScaffold: true,
  electionScaffold: true,
  conditionalStylingScaffold: true,
  migrationReadiness: true
});
