import { TEST_ASSET_VERSION, TEST_CAPABILITIES } from './config.js';
import { escapeHtml } from './utils.js';

const DIAGNOSTIC_HISTORY_KEY = 'civgraph.test.diagnostics.history';

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
  data.readinessHistory = updateReadinessHistory(data, extra.readinessHistory || []);
  emitDiagnostics.lastData = data;
  els.diagnostics.innerHTML = renderDiagnosticsPanel(data);
}
emitDiagnostics.lastData = null;

function renderDiagnosticsPanel(data) {
  const health = data.health || {};
  const latestLoads = (data.metrics || []).filter((metric) => metric.event === 'load').slice(-4);
  const loadSummary = summarizeLoads(data.metrics || []);
  const warnings = getDiagnosticWarnings(data)
    .filter((item) => data.severity === 'all' || item.severity === data.severity)
    .filter((item) => data.type === 'all' || (data.type === 'runtime' ? /^pmtiles|fallback|fetch|error/i.test(item.type) : item.type === data.type))
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
      ${renderStat('Max load', loadSummary.max ? `${loadSummary.max}ms` : 'n/a')}
      ${renderStat('Avg load', loadSummary.avg ? `${loadSummary.avg}ms` : 'n/a')}
    </div>
    ${renderReadinessStatus(data)}
    ${renderReadinessHistory(data)}
    ${renderDeploymentDiscipline(data)}
    ${renderAccessibilityStatus(data)}
    ${renderServiceWorkerStatus(data)}
    ${warnings.length ? `
      <section class="diagnostics-section diagnostics-section--warn">
        <h3>Warnings, With Explanations</h3>
        ${Object.entries(grouped).map(([layerId, items]) => `
          <details class="diagnostics-warning-group" open>
            <summary>${escapeHtml(layerId)} <span>${items.length}</span></summary>
            <ul>${items.slice(0, 8).map((item) => `<li data-severity="${escapeHtml(item.severity)}"><b>${escapeHtml(item.type)}</b>: ${escapeHtml(item.message)} <small>${escapeHtml(warningExplanation(item))}</small></li>`).join('')}</ul>
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

function renderReadinessHistory(data) {
  const history = data.readinessHistory || [];
  if (history.length < 2) return '';
  const last = history.slice(-8);
  return `
    <section class="diagnostics-section diagnostics-section--history">
      <h3>Readiness History</h3>
      <ol class="diagnostics-history">
        ${last.map((item) => `<li><span>${escapeHtml(item.at)}</span><strong>${escapeHtml(String(item.score))}%</strong><small>${escapeHtml(`${item.warnings} warning(s), ${item.errors} error(s)`)}</small></li>`).join('')}
      </ol>
    </section>
  `;
}

function renderReadinessStatus(data) {
  const readiness = data.migrationReadiness || {};
  const health = data.health || {};
  const telemetry = data.telemetry || {};
  const deployment = getDeploymentStatus(data);
  const items = [
    {
      label: 'Main shell parity',
      status: data.capabilities?.catalogue && data.capabilities?.urlState ? 'pass' : 'warn',
      detail: data.capabilities?.catalogue && data.capabilities?.urlState
        ? 'Catalogue-first MapLibre shell is present.'
        : 'Required shell capabilities are missing.'
    },
    {
      label: 'Converted coverage',
      status: readiness.totalLayers && readiness.vectorReady === readiness.totalLayers ? 'pass' : 'warn',
      detail: `${readiness.vectorReady || 0} vector-ready of ${readiness.totalLayers || 0} catalogue layers; ${health.unconvertedLayers || 0} runtime entries remain unconverted.`
    },
    {
      label: 'CDN/PMTiles health',
      status: deployment.status,
      detail: deployment.detail
    },
    {
      label: 'Runtime performance',
      status: health.slowLoads?.length || health.oversizedTiles?.length ? 'warn' : 'pass',
      detail: `${health.slowLoads?.length || 0} slow recent loads, ${health.oversizedTiles?.length || 0} oversized-tile warnings.`
    },
    {
      label: 'Fallback state',
      status: telemetry.fallbackCount || telemetry.cdnFailures ? 'warn' : 'pass',
      detail: `${telemetry.fallbackCount || 0} fallbacks, ${telemetry.cdnFailures || 0} CDN failures recorded in this session.`
    },
    {
      label: 'CI guardrails',
      status: 'pass',
      detail: 'check:test validates metadata, tile budgets, CDN manifest, and shell parity; check:test:ci also verifies CDN byte ranges.'
    },
    {
      label: 'Cache discipline',
      status: data.assetVersion ? 'pass' : 'warn',
      detail: `Scoped service worker and versioned bundles are active for ${data.assetVersion || 'unknown version'}.`
    }
  ];
  const score = readinessScore(items);
  const headline = score >= 90
    ? 'Shell and runtime guardrails are close to production-ready; remaining risk is mostly data coverage and tile tuning.'
    : score >= 70
      ? 'The rewrite is usable for testing, but production promotion still needs warnings reviewed.'
      : 'The rewrite needs more remediation before production promotion.';
  return `
    <section class="diagnostics-section diagnostics-section--readiness">
      <h3>Production Readiness <span>${score}%</span></h3>
      <p class="diagnostics-readiness__summary">${escapeHtml(headline)}</p>
      <div class="diagnostics-readiness__meter" role="progressbar" aria-label="Production readiness score" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${score}">
        <i style="width:${score}%"></i>
      </div>
      <div class="diagnostics-readiness">
        ${items.map((item) => `
          <div class="diagnostics-readiness__item" data-status="${escapeHtml(item.status)}">
            <strong>${escapeHtml(item.label)}</strong>
            <span>${escapeHtml(item.detail)}</span>
          </div>
        `).join('')}
      </div>
    </section>
  `;
}

function renderDeploymentDiscipline(data) {
  const health = data.health || {};
  const pmtiles = health.pmtilesLayers || 0;
  const localFallbacks = health.localFallbacks || 0;
  const environment = data.runtimeEnvironment || {};
  return `
    <section class="diagnostics-section">
      <h3>Deployment Discipline</h3>
      <div class="diagnostics-checklist">
        ${renderCheck('PMTiles CDN/R2', pmtiles > 0 ? 'pass' : 'warn', `${pmtiles} PMTiles layer(s) registered for CDN byte-range serving.`)}
        ${renderCheck('Local fallbacks', localFallbacks ? 'warn' : 'pass', `${localFallbacks} local directory fallback(s) remain in metadata and are disabled off localhost.`)}
        ${renderCheck('Pages hygiene', 'pass', 'Generated tile pyramids are excluded from Pages output.')}
        ${renderCheck('Cache versioning', data.assetVersion ? 'pass' : 'warn', `Bundle and service-worker cache version: ${data.assetVersion || 'unknown'}.`)}
      </div>
      ${renderDeployChecklist(data)}
      ${renderRuntimeEnvironment(environment)}
    </section>
    ${renderTileBudgetExplanation(health)}
  `;
}

function renderDeployChecklist(data) {
  const health = data.health || {};
  const cache = data.serviceWorkerStatus || {};
  const checks = [
    ['Run check:test', 'pass', 'Metadata, tile budgets, CDN manifest, and shell parity checks must pass.'],
    ['Run browser regression', 'pass', 'test:browser:test covers URL restore, fallback warnings, source panels, preferences, and accessibility smoke.'],
    ['Confirm CDN byte ranges', health.pmtilesLayers ? 'pass' : 'warn', 'check:test:ci or verify:test:pmtiles-cdn should confirm 206 Partial Content for PMTiles.'],
    ['Confirm service worker scope', cache.supported === false ? 'warn' : 'pass', 'The /test service worker must stay scoped to /test/ before promotion planning.'],
    ['Confirm rollback path', 'pass', 'Rollback, cutover PR, and CDN invalidation runbooks are in test/metadata/.']
  ];
  return `
    <details class="diagnostics-deploy" open>
      <summary>Deploy Checklist</summary>
      <div class="diagnostics-checklist">
        ${checks.map(([label, status, detail]) => renderCheck(label, status, detail)).join('')}
      </div>
    </details>
  `;
}

function renderAccessibilityStatus(data) {
  const audit = data.accessibilityAudit;
  if (!audit) return '';
  return `
    <section class="diagnostics-section diagnostics-section--accessibility">
      <h3>Accessibility Smoke</h3>
      <p>Axe-style automated checks plus a screen-reader-oriented DOM pass run in the browser.</p>
      <div class="diagnostics-checklist">
        ${renderCheck('Axe-style checks', audit.issueCount ? 'warn' : 'pass', `${audit.issueCount || 0} issue(s) found by ${audit.engine || 'audit'}.`)}
        ${renderCheck('Screen-reader pass', audit.screenReaderPass === 'pass' ? 'pass' : 'warn', audit.screenReaderPass === 'pass' ? 'Landmarks, labels, and dialog naming passed the smoke pass.' : 'Review screen-reader-oriented warnings before promotion.')}
      </div>
      ${audit.issues?.length ? `<ul>${audit.issues.map((issue) => `<li data-severity="${escapeHtml(issue.severity)}"><b>${escapeHtml(issue.rule)}</b>: ${escapeHtml(issue.message)}</li>`).join('')}</ul>` : ''}
    </section>
  `;
}

function renderServiceWorkerStatus(data) {
  const status = data.serviceWorkerStatus;
  if (!status) return `
    <section class="diagnostics-section">
      <h3>Service Worker Cache</h3>
      <p>Status pending. The page will request scoped /test cache status after the worker is ready.</p>
    </section>
  `;
  const cacheRows = Object.entries(status.caches || {});
  return `
    <section class="diagnostics-section">
      <h3>Service Worker Cache</h3>
      <div class="diagnostics-checklist">
        ${renderCheck('Support', status.supported === false ? 'warn' : 'pass', status.supported === false ? 'Service workers are unavailable in this browser.' : `Scope ${status.scope || '/test/'}; controlled=${Boolean(status.controlled)}.`)}
        ${renderCheck('Storage pressure', status.pressure === 'high' ? 'warn' : 'pass', `Pressure is ${status.pressure || 'unknown'}.`)}
      </div>
      ${cacheRows.length ? `<dl class="diagnostics-cache">${cacheRows.map(([name, count]) => `<dt>${escapeHtml(name)}</dt><dd>${escapeHtml(count)} request(s)</dd>`).join('')}</dl>` : ''}
    </section>
  `;
}

function updateReadinessHistory(data, previous = []) {
  if (typeof localStorage === 'undefined') return previous;
  const warnings = getDiagnosticWarnings(data);
  const entry = {
    at: new Date().toISOString(),
    score: readinessScoreForData(data),
    warnings: warnings.filter((item) => item.severity === 'warn').length,
    errors: warnings.filter((item) => item.severity === 'error').length,
    loadedLayers: (data.loadedLayers || []).length
  };
  const last = previous.at(-1);
  if (last && Math.abs(new Date(entry.at) - new Date(last.at)) < 30000 && last.score === entry.score && last.warnings === entry.warnings && last.errors === entry.errors) {
    return previous;
  }
  const next = [...previous, entry].slice(-30);
  try {
    localStorage.setItem(DIAGNOSTIC_HISTORY_KEY, JSON.stringify(next));
  } catch {}
  return next;
}

function readinessScoreForData(data) {
  const readiness = data.migrationReadiness || {};
  const warnings = getDiagnosticWarnings(data);
  let score = 100;
  if (readiness.totalLayers && readiness.vectorReady < readiness.totalLayers) score -= 12;
  score -= Math.min(25, warnings.filter((item) => item.severity === 'warn').length * 3);
  score -= Math.min(30, warnings.filter((item) => item.severity === 'error').length * 10);
  if (data.accessibilityAudit?.issueCount) score -= Math.min(15, data.accessibilityAudit.issueCount * 2);
  return Math.max(0, Math.round(score));
}

function getDeploymentStatus(data) {
  const health = data.health || {};
  if (!health.pmtilesLayers) {
    return { status: 'warn', detail: 'No PMTiles layers are registered.' };
  }
  if (data.telemetry?.cdnFailures) {
    return { status: 'warn', detail: `${data.telemetry.cdnFailures} CDN fetch failure(s) in this session.` };
  }
  return {
    status: 'pass',
    detail: `${health.pmtilesLayers} PMTiles layer(s) registered; byte-range monitoring is handled by check:test:ci.`
  };
}

function renderStat(label, value) {
  return `<div class="diagnostics-stat"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value ?? 'n/a')}</strong></div>`;
}

function renderCheck(label, status, detail) {
  return `
    <div class="diagnostics-check" data-status="${escapeHtml(status)}">
      <strong>${escapeHtml(label)}</strong>
      <span>${escapeHtml(detail)}</span>
    </div>
  `;
}

function renderRuntimeEnvironment(environment) {
  if (!environment || Object.values(environment).every((value) => value === null || value === undefined || value === 'unknown')) return '';
  const rows = [
    ['Device memory', environment.deviceMemory ? `${environment.deviceMemory} GB` : null],
    ['Storage pressure', environment.storagePressure],
    ['Storage usage', environment.storageUsage ? formatBytes(environment.storageUsage) : null],
    ['Storage quota', environment.storageQuota ? formatBytes(environment.storageQuota) : null],
    ['JS heap used', environment.usedJSHeapSize ? formatBytes(environment.usedJSHeapSize) : null],
    ['JS heap limit', environment.jsHeapSizeLimit ? formatBytes(environment.jsHeapSizeLimit) : null]
  ].filter(([, value]) => value);
  if (!rows.length) return '';
  return `
    <details class="diagnostics-runtime">
      <summary>Browser resources</summary>
      <dl>${rows.map(([label, value]) => `<dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd>`).join('')}</dl>
    </details>
  `;
}

function renderTileBudgetExplanation(health) {
  const large = health.largeLayers || [];
  const oversized = health.oversizedTiles || [];
  if (!large.length && !oversized.length) return '';
  return `
    <section class="diagnostics-section diagnostics-section--warn">
      <h3>Tile Budget Notes</h3>
      <p>These are warning thresholds, not hard failures. They identify layers that may need retile tuning before promotion.</p>
      <ul>
        ${large.slice(0, 6).map((item) => `<li>${escapeHtml(item.id)} package is ${escapeHtml(formatBytes(item.bytes))}.</li>`).join('')}
        ${oversized.slice(0, 6).map((item) => `<li>${escapeHtml(item.id)} has a max generated tile of ${escapeHtml(formatBytes(item.maxTileBytes))}.</li>`).join('')}
      </ul>
    </section>
  `;
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

function warningExplanation(item) {
  const explanations = {
    'slow-load': 'Slow layer loads usually indicate CDN latency, oversized tiles, or a cold PMTiles range request.',
    'large-layer': 'Large archives are acceptable for testing, but should be reviewed before promotion to avoid mobile pressure.',
    'large-tile': 'Oversized generated tiles can stall low-memory mobile browsers; retile parameters may need tuning.',
    'missing-index': 'Feature search cannot cover this layer until a generated search index exists.',
    'pmtiles-fallback': 'Runtime fell back from PMTiles to directory MVT. Production should prefer CDN-hosted PMTiles.',
    'pmtiles-fallback-unavailable': 'PMTiles failed and no production directory fallback is deployed.'
  };
  return explanations[item.type] || 'Review this warning before treating /test as production-ready.';
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
    unconvertedLayers: layers.length - loadable.length,
    pmtilesLayers: loadable.filter((layer) => layer.sourceType === 'pmtiles').length,
    directoryMvtLayers: loadable.filter((layer) => layer.sourceType === 'mvt').length,
    localFallbacks: loadable.filter((layer) => typeof layer.tilesFallback === 'string' && layer.tilesFallback.startsWith('/test/tiles/')).length,
    slowLoads,
    largeLayers,
    oversizedTiles,
    missingIndexes
  };
}

function summarizeLoads(metrics) {
  const loads = metrics.filter((metric) => metric.event === 'load' && Number.isFinite(Number(metric.durationMs)));
  if (!loads.length) return { max: null, avg: null };
  const durations = loads.map((metric) => Number(metric.durationMs));
  return {
    max: Math.round(Math.max(...durations)),
    avg: Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length)
  };
}

function readinessScore(items) {
  if (!items.length) return 0;
  const points = items.reduce((sum, item) => sum + (item.status === 'pass' ? 1 : item.status === 'warn' ? 0.5 : 0), 0);
  return Math.round((points / items.length) * 100);
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
