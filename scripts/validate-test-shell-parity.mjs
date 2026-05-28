import { readFile } from 'node:fs/promises';

const checks = [
  {
    file: 'test/index.html',
    required: [
      'app-header__brand',
      'app-header__nav',
      'mobileMenuBtn',
      'mobileMenu',
      'supportModal',
      'themeToggle',
      'sidebarToggle',
      'catalogueBack',
      'catalogueForward',
      'catalogueHistory',
      'catalogueHome',
      'catalogueView',
      'catalogueSort',
      'catalogueFilters',
      'catalogueDetail',
      'featureDetails',
      'sourcePanel',
      'diagnosticsSeverity',
      'diagnosticsType',
      'diagnosticsClearHistory',
      'preferencesExport',
      'preferencesImport',
      'preferencesReset',
      'preferencesSaveProfile',
      'preferencesApplyProfile',
      'preferencesResetShell',
      'preferencesDeviceDefaults',
      'preferencesPayload',
      'screenReaderStatus',
      'mapInstructions'
    ]
  },
  {
    file: 'test/src/app.js',
    required: [
      'setupKeyboardShortcuts',
      'setupPreferenceTools',
      'exportPreferences',
      'importPreferences',
      'readPreferenceProfiles',
      'clearPreferenceSection',
      'applyDeviceDefaults',
      'runAccessibilityAudit',
      'setupServiceWorkerStatus',
      'panelsCollapsed',
      'PANEL_PREF_KEY',
      'DIAGNOSTIC_PREF_KEY',
      'togglePanelCollapsed',
      'readRuntimeEnvironment',
      'aria-expanded'
    ]
  },
  {
    file: 'test/src/catalogue-controller.js',
    required: [
      'groupByGroupAndCategory',
      'renderDetail',
      'copyLayerShare',
      'applyHashState',
      'writeCatalogueHash',
      'renderFilters',
      'renderCompactHome',
      'catalogue-flat__toc-table',
      'toggleHistoryPanel',
      'toggleCollapsed',
      'catView',
      'goHistory',
      'selectFeatureResult',
      'feature-result--selected'
    ]
  },
  {
    file: 'test/src/feature-details.js',
    required: [
      'data-copy-feature',
      'groupProperties',
      'Technical fields',
      'Source context',
      'feature-details__primary',
      'data-copy-layer'
    ]
  },
  {
    file: 'test/src/source-panel.js',
    required: [
      'source-panel__header',
      'source-panel__badge--missing',
      'data-copy-link',
      'No source references',
      'PMTiles archive'
    ]
  },
  {
    file: 'test/src/active-layers.js',
    required: [
      'active-layer__header',
      'data-action="layer-fit"',
      'data-action="layer-copy"',
      'data-action="layer-unload"',
      'makeLayerShareUrl',
      'moveLayerOrder'
    ]
  },
  {
    file: 'test/src/map-controller.js',
    required: [
      'moveLayerOrder',
      'reorderFromSavedLayerOrder',
      'civgraph:test:layer-order'
    ]
  },
  {
    file: 'test/src/diagnostics.js',
    required: [
      'Production Readiness',
      'renderReadinessStatus',
      'CDN/PMTiles health',
      'Main shell parity',
      'CI guardrails',
      'Deployment Discipline',
      'Browser resources',
      'Tile Budget Notes',
      'readinessScore',
      'Accessibility Smoke',
      'Deploy Checklist',
      'Service Worker Cache',
      'warningExplanation',
      'Readiness History',
      'DIAGNOSTIC_HISTORY_KEY'
    ]
  },
  {
    file: 'test/src/styles.css',
    required: [
      '.mobile-menu',
      '.support-modal',
      '.catalogue-filters',
      '.catalogue-toolbar',
      '.catalogue-table',
      '.app-shell.test-shell',
      '.test-main',
      '.map-tools',
      '.test-panel__collapse',
      '.diagnostics-readiness__meter',
      '.diagnostics-checklist',
      '.catalogue-history',
      '.catalogue-group__header',
      '.catalogue-detail',
      '.feature-details__table',
      '.feature-details__primary',
      '.diagnostics-readiness',
      '.test-preferences',
      '.preferences-actions',
      '.preferences-reset-sections',
      '.diagnostics-history',
      '.diagnostics-deploy',
      '.diagnostics-cache',
      '@media (prefers-reduced-motion: reduce)'
    ]
  },
  {
    file: 'test/sw.js',
    required: [
      'TEST_MAX_CACHE_BYTES',
      'trimCacheBytes',
      'TEST_PMTILES_CACHE'
    ]
  },
  {
    file: 'test/metadata/test-to-main-promotion-checklist.md',
    required: [
      'Non-Data Gates',
      'Data Gates',
      'Cutover Steps',
      'Rollback Conditions',
      'Supporting Runbooks'
    ]
  },
  {
    file: 'test/metadata/rollback-runbook.md',
    required: [
      'Immediate Containment',
      'Verification',
      'Communication'
    ]
  },
  {
    file: 'test/metadata/cutover-pr-checklist.md',
    required: [
      'Required Checks',
      'PR Requirements',
      'Do Not Cut Over If'
    ]
  },
  {
    file: 'test/metadata/cdn-cache-invalidation-procedure.md',
    required: [
      'Version Discipline',
      'Invalidation Steps',
      'Evidence To Record'
    ]
  },
  {
    file: 'test/metadata/security-dependency-review.md',
    required: [
      'Dependency Policy',
      'Runtime Guardrails',
      'Automated Evidence'
    ]
  },
  {
    file: 'test/metadata/production-observability.md',
    required: [
      'Signals',
      'Privacy and Safety',
      'Promotion Requirement'
    ]
  },
  {
    file: 'scripts/visual-regression-test-shell.mjs',
    required: [
      'visual-snapshots',
      'header height parity',
      'test catalogue visible'
    ]
  },
  {
    file: 'scripts/validate-test-mobile-performance.mjs',
    required: [
      'mobile-performance-report',
      'frameRate',
      'memory'
    ]
  },
  {
    file: 'scripts/validate-test-security.mjs',
    required: [
      'npmAuditDecision',
      'Clipboard writes use guarded helper',
      'Telemetry is sanitized'
    ]
  },
  {
    file: 'scripts/validate-test-production-route.mjs',
    required: [
      'Scoped service worker before cutover',
      'Versioned bundle references',
      'Pages/R2 separation documented'
    ]
  }
];

const failures = [];

for (const check of checks) {
  const content = await readFile(check.file, 'utf8');
  for (const needle of check.required) {
    if (!content.includes(needle)) failures.push(`${check.file}: missing ${needle}`);
  }
}

const testIndex = await readFile('test/index.html', 'utf8');
for (const forbidden of ['MapLibre rewrite', 'MapLibre Test</a>', 'class="test-header"']) {
  if (testIndex.includes(forbidden)) failures.push(`test/index.html: should not expose separate test shell marker ${forbidden}`);
}
for (const requiredShell of ['class="app-shell test-shell"', 'class="app-main test-main"', 'class="pane pane--info test-sidebar"', 'class="pane pane--map test-map-wrap"', 'class="catalogue-sticky-shell test-catalogue-shell"', 'class="map-tools"']) {
  if (!testIndex.includes(requiredShell)) failures.push(`test/index.html: missing main-shell parity structure ${requiredShell}`);
}

const packageJson = JSON.parse(await readFile('package.json', 'utf8'));
if (!String(packageJson.scripts?.['check:test'] || '').includes('validate-test-shell-parity.mjs')) {
  failures.push('package.json: check:test does not run validate-test-shell-parity.mjs');
}

const metadata = JSON.parse(await readFile('test/metadata/maps-test.json', 'utf8'));
const portPlan = JSON.parse(await readFile('test/metadata/main-site-port-plan.json', 'utf8'));
const loadable = metadata.layers.filter((layer) => layer.loadable !== false);
const unconverted = portPlan.rows.filter((row) => row.conversionStatus !== 'converted');
if (!metadata.categories?.length) failures.push('maps-test.json: categories are missing');
if (!loadable.length) failures.push('maps-test.json: no loadable layers');
if (!unconverted.length) failures.push('main-site-port-plan.json: no unconverted catalogue entries for runtime metadata normalization');

if (failures.length) {
  console.error('Test shell parity validation failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('PASS: /test main-shell parity guardrails are present.');
console.log(`- catalogue layers: ${metadata.layers.length}`);
console.log(`- loadable layers: ${loadable.length}`);
console.log(`- unconverted entries: ${unconverted.length}`);
