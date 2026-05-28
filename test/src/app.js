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
import { copyText, showToast } from './utils.js';
import { TestTelemetry } from './telemetry.js';

const PANEL_PREF_KEY = 'civgraph.test.panels.collapsed';
const DIAGNOSTIC_PREF_KEY = 'civgraph.test.diagnostics.preferences';
const DIAGNOSTIC_HISTORY_KEY = 'civgraph.test.diagnostics.history';
const CATALOGUE_COLLAPSE_KEY = 'civgraph.test.catalogue.collapsed';
const CATALOGUE_PREF_KEY = 'civgraph.test.catalogue.preferences';
const LAYER_ORDER_KEY = 'civgraph:test:layer-order';
const PREFERENCE_PROFILES_KEY = 'civgraph.test.preference.profiles';
const PREFERENCE_SCHEMA_VERSION = 1;
let lastMobileMenuFocus = null;
let runtimeEnvironment = null;
let serviceWorkerStatus = null;

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
      type: els.diagnosticsType?.value || 'all',
      sort: els.diagnosticsSort?.value || 'severity',
      readinessHistory: readDiagnosticHistory(),
      migrationReadiness: assessMigrationReadiness(metadata, controller),
      featureSearchIndexes: featureSearch.featureIndexes.size,
      timeSeriesChains: timeSeries.getChains().length,
      electionCatalogues: elections.getCatalogues().length,
      conditionalStyles: conditionalStyling.activeStyles.size,
      runtimeEnvironment: awaitRuntimeEnvironment(),
      serviceWorkerStatus,
      accessibilityAudit: runAccessibilityAudit(els),
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
      announce(els, selection ? `Selected ${selection.layer?.name || 'feature'}.` : 'Feature selection cleared.');
    },
    onMetric: (metric) => telemetry.record(metric),
    onFallback: (event) => {
      telemetry.record({ ...event, event: 'pmtiles-fallback-visible' });
      renderFallbackAlerts(els, controller);
      const name = event.layerName || event.layerId;
      showToast(els, event.fallbackUnavailable
        ? `${name} PMTiles failed; no production directory fallback is deployed.`
        : `${name} fell back to directory tiles.`);
      announce(els, `${name} PMTiles fallback warning.`);
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
  setupThemeToggle(els);
  setupSupportModal(els);
  setupPanelState(els);
  restoreDiagnosticPreferences(els);
  setupKeyboardShortcuts(els);
  setupMobileSidebarGesture(els);
  markActiveNavRoutes();
  els.sourceFilter?.addEventListener('input', () => {
    writeShellHashState('sourceQ', els.sourceFilter.value || null);
    renderSecondaryPanels();
  });
  els.diagnosticsSeverity?.addEventListener('change', () => {
    saveDiagnosticPreferences(els);
    writeShellHashState('diagSeverity', els.diagnosticsSeverity.value || null);
    renderDiagnostics();
  });
  els.diagnosticsType?.addEventListener('change', () => {
    saveDiagnosticPreferences(els);
    writeShellHashState('diagType', els.diagnosticsType.value === 'all' ? null : els.diagnosticsType.value);
    renderDiagnostics();
  });
  els.diagnosticsSort?.addEventListener('change', () => {
    saveDiagnosticPreferences(els);
    writeShellHashState('diagSort', els.diagnosticsSort.value || null);
    renderDiagnostics();
  });
  els.diagnosticsClearHistory?.addEventListener('click', () => {
    localStorage.removeItem(DIAGNOSTIC_HISTORY_KEY);
    showToast(els, 'Diagnostics history cleared.');
    renderDiagnostics();
  });
  els.copyDiagnostics?.addEventListener('click', async () => {
    const report = JSON.stringify(window.__civgraphTest?.diagnostics?.() || {}, null, 2);
    try {
      await copyText(report);
      showToast(els, 'Diagnostics copied.');
    } catch {
      showToast(els, 'Diagnostics copy failed.');
    }
  });
  els.sidebarToggle?.addEventListener('click', () => {
    const open = !document.body.classList.contains('test-sidebar-open');
    document.body.classList.toggle('test-sidebar-open', open);
    els.sidebarToggle.setAttribute('aria-expanded', String(open));
    writeShellHashState('sidebar', open ? '1' : null);
    if (open) {
      closeMobileMenu(els);
      els.mapSearch?.focus();
    } else {
      els.sidebarToggle?.focus();
    }
  });
  els.mobileMenuBtn?.addEventListener('click', () => {
    const open = els.mobileMenu?.classList.contains('hidden');
    els.mobileMenu?.classList.toggle('hidden', !open);
    els.mobileMenuBtn.setAttribute('aria-expanded', String(open));
    if (open) {
      lastMobileMenuFocus = document.activeElement;
      focusFirstMenuItem(els);
    } else {
      lastMobileMenuFocus?.focus?.();
    }
  });
  els.mobileSupportBtn?.addEventListener('click', () => openSupportModal(els));
  els.mobileMenuSupport?.addEventListener('click', () => {
    closeMobileMenu(els);
    openSupportModal(els);
  });
  els.mobileMenuTheme?.addEventListener('click', () => {
    closeMobileMenu(els);
    toggleTheme(els);
  });
  document.addEventListener('click', (event) => {
    if (els.mobileMenu?.classList.contains('hidden')) return;
    if (els.mobileMenu.contains(event.target) || els.mobileMenuBtn?.contains(event.target)) return;
    closeMobileMenu(els);
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      document.body.classList.remove('test-sidebar-open');
      els.sidebarToggle?.setAttribute('aria-expanded', 'false');
      writeShellHashState('sidebar', null);
      closeMobileMenu(els, { restoreFocus: true });
      closeSupportModal(els);
    }
    if (event.key === 'Tab' && !els.mobileMenu?.classList.contains('hidden')) {
      trapFocus(event, els.mobileMenu);
    }
    if (event.key === 'Tab' && !els.supportModal?.classList.contains('hidden')) {
      trapFocus(event, els.supportModal);
    }
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
  setupPreferenceTools(els, () => catalogue, renderDiagnostics);

  urlState = new UrlStateController(controller, metadataService, conditionalStyling);
  await urlState.restore();
  restoreShellHashState(els);
  restorePanelState(els);
  renderActiveLayers(els, controller, { onRendered: renderDiagnostics, conditionalStyling });
  renderFeatureDetails(els, null);
  renderSecondaryPanels();
  renderDiagnostics();
  void readRuntimeEnvironment().then(() => renderDiagnostics());
  setupServiceWorkerStatus(renderDiagnostics);

  window.__civgraphTest = {
    controller,
    metadataService,
    catalogue,
    featureSearch,
    timeSeries,
    elections,
    conditionalStyling,
    telemetry,
    diagnostics: () => emitDiagnostics.lastData || {},
    assessMigrationReadiness: () => assessMigrationReadiness(metadata, controller)
  };
}

function setupPreferenceTools(els, getCatalogue, renderDiagnostics) {
  renderPreferenceProfiles(els);
  renderPreferenceStatus(els);
  els.preferencesSaveProfile?.addEventListener('click', () => {
    const name = (els.preferencesProfileName?.value || '').trim() || `Profile ${new Date().toISOString().slice(0, 10)}`;
    const profiles = readPreferenceProfiles();
    profiles[name] = exportPreferences();
    localStorage.setItem(PREFERENCE_PROFILES_KEY, JSON.stringify(profiles));
    renderPreferenceProfiles(els, name);
    renderPreferenceStatus(els, `Saved preference profile "${name}".`);
    renderDiagnostics?.();
  });
  els.preferencesApplyProfile?.addEventListener('click', () => {
    const name = els.preferencesProfileSelect?.value || '';
    const profile = readPreferenceProfiles()[name];
    if (!profile) {
      renderPreferenceStatus(els, 'Choose a saved profile first.');
      return;
    }
    const count = importPreferences(JSON.stringify(profile));
    getCatalogue()?.applyHashState?.();
    getCatalogue()?.render?.();
    renderPreferenceStatus(els, `Applied profile "${name}" with ${count} value(s). Reload to apply every default.`);
    renderDiagnostics?.();
  });
  els.preferencesExport?.addEventListener('click', async () => {
    const payload = JSON.stringify(exportPreferences(), null, 2);
    if (els.preferencesPayload) els.preferencesPayload.value = payload;
    try {
      await copyText(payload);
      renderPreferenceStatus(els, 'Exported preferences and copied JSON.');
    } catch {
      renderPreferenceStatus(els, 'Exported preferences. Clipboard copy failed.');
    }
    renderDiagnostics?.();
  });
  els.preferencesImport?.addEventListener('click', () => {
    try {
      const count = importPreferences(els.preferencesPayload?.value || '');
      getCatalogue()?.applyHashState?.();
      getCatalogue()?.render?.();
      renderPreferenceStatus(els, `Imported ${count} preference value(s).`);
    } catch (err) {
      renderPreferenceStatus(els, `Import failed: ${err.message}`);
    }
    renderDiagnostics?.();
  });
  els.preferencesReset?.addEventListener('click', () => {
    const count = clearTestPreferences();
    renderPreferenceStatus(els, `Reset ${count} preference value(s). Reload to apply every default.`);
    renderDiagnostics?.();
  });
  els.preferencesResetShell?.addEventListener('click', () => {
    const count = clearPreferenceSection('shell');
    renderPreferenceStatus(els, `Reset ${count} shell preference value(s).`);
    renderDiagnostics?.();
  });
  els.preferencesResetCatalogue?.addEventListener('click', () => {
    const count = clearPreferenceSection('catalogue');
    getCatalogue()?.render?.();
    renderPreferenceStatus(els, `Reset ${count} catalogue preference value(s).`);
    renderDiagnostics?.();
  });
  els.preferencesResetLayers?.addEventListener('click', () => {
    const count = clearPreferenceSection('layers');
    renderPreferenceStatus(els, `Reset ${count} layer/style preference value(s). Reload to apply every default.`);
    renderDiagnostics?.();
  });
  els.preferencesDeviceDefaults?.addEventListener('click', () => {
    applyDeviceDefaults();
    renderPreferenceStatus(els, `Applied ${deviceProfile()} defaults. Reload to apply every default.`);
    renderDiagnostics?.();
  });
}

function exportPreferences() {
  const values = {};
  for (const key of collectPreferenceKeys()) {
    const value = localStorage.getItem(key);
    if (value !== null) values[key] = value;
  }
  return {
    schemaVersion: PREFERENCE_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    deviceProfile: deviceProfile(),
    values
  };
}

function importPreferences(payload) {
  const parsed = JSON.parse(payload || '{}');
  const values = parsed.values || parsed;
  if (!values || typeof values !== 'object' || Array.isArray(values)) {
    throw new Error('Expected an object with preference values.');
  }
  let count = 0;
  for (const [key, value] of Object.entries(values)) {
    if (!isAllowedPreferenceKey(key)) continue;
    localStorage.setItem(key, String(value));
    count += 1;
  }
  return count;
}

function clearTestPreferences() {
  const keys = collectPreferenceKeys();
  for (const key of keys) localStorage.removeItem(key);
  return keys.length;
}

function clearPreferenceSection(section) {
  const keys = collectPreferenceKeys().filter((key) => {
    if (section === 'shell') return key === 'theme' || key === PANEL_PREF_KEY || key === DIAGNOSTIC_PREF_KEY || key === DIAGNOSTIC_HISTORY_KEY;
    if (section === 'catalogue') return key === CATALOGUE_COLLAPSE_KEY || key === CATALOGUE_PREF_KEY;
    if (section === 'layers') return key === LAYER_ORDER_KEY || /^civgraph:test:(style|controls):/.test(key);
    return false;
  });
  for (const key of keys) localStorage.removeItem(key);
  return keys.length;
}

function applyDeviceDefaults() {
  const mobile = isMobileViewport();
  localStorage.setItem(CATALOGUE_PREF_KEY, JSON.stringify({
    viewMode: 'compact',
    sortMode: 'order'
  }));
  localStorage.setItem(DIAGNOSTIC_PREF_KEY, JSON.stringify({
    severity: 'all',
    sort: 'severity'
  }));
  localStorage.setItem(PANEL_PREF_KEY, JSON.stringify(mobile
    ? ['time', 'feature', 'sources', 'diagnostics']
    : ['time']));
  localStorage.setItem('theme', window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
}

function collectPreferenceKeys() {
  const fixed = new Set([
    'theme',
    PANEL_PREF_KEY,
    DIAGNOSTIC_PREF_KEY,
    DIAGNOSTIC_HISTORY_KEY,
    CATALOGUE_COLLAPSE_KEY,
    CATALOGUE_PREF_KEY,
    LAYER_ORDER_KEY,
    PREFERENCE_PROFILES_KEY
  ]);
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i);
    if (isAllowedPreferenceKey(key)) fixed.add(key);
  }
  return [...fixed].filter((key) => localStorage.getItem(key) !== null);
}

function isAllowedPreferenceKey(key) {
  return key === 'theme'
    || key === PANEL_PREF_KEY
    || key === DIAGNOSTIC_PREF_KEY
    || key === DIAGNOSTIC_HISTORY_KEY
    || key === CATALOGUE_COLLAPSE_KEY
    || key === CATALOGUE_PREF_KEY
    || key === LAYER_ORDER_KEY
    || key === PREFERENCE_PROFILES_KEY
    || /^civgraph:test:(style|controls):/.test(key);
}

function readPreferenceProfiles() {
  try {
    const profiles = JSON.parse(localStorage.getItem(PREFERENCE_PROFILES_KEY) || '{}');
    return profiles && typeof profiles === 'object' && !Array.isArray(profiles) ? profiles : {};
  } catch {
    return {};
  }
}

function renderPreferenceProfiles(els, selected = '') {
  if (!els.preferencesProfileSelect) return;
  const profiles = readPreferenceProfiles();
  const names = Object.keys(profiles).sort((a, b) => a.localeCompare(b));
  els.preferencesProfileSelect.innerHTML = [
    '<option value="">Saved profiles</option>',
    ...names.map((name) => `<option value="${escapeAttribute(name)}" ${name === selected ? 'selected' : ''}>${escapeAttribute(name)}</option>`)
  ].join('');
}

function renderPreferenceStatus(els, message = '') {
  if (!els.preferencesStatus) return;
  const count = collectPreferenceKeys().length;
  els.preferencesStatus.textContent = message || `${count} saved preference value(s) on this ${deviceProfile()} device.`;
}

function deviceProfile() {
  if (isMobileViewport()) return 'mobile';
  if (window.innerWidth <= 1024) return 'tablet';
  return 'desktop';
}

function isMobileViewport() {
  return window.matchMedia?.('(max-width: 760px)').matches || window.innerWidth <= 760;
}

function setupThemeToggle(els) {
  if (!els.themeToggle) return;
  const savedTheme = localStorage.getItem('theme');
  const systemPrefersDark = Boolean(window.matchMedia?.('(prefers-color-scheme: dark)').matches);
  const initialTheme = savedTheme || (systemPrefersDark ? 'dark' : 'light');
  document.documentElement.dataset.theme = initialTheme;
  els.themeToggle.setAttribute('aria-pressed', String(initialTheme === 'dark'));
  els.themeToggle.addEventListener('click', () => toggleTheme(els));
}

function toggleTheme(els) {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  localStorage.setItem('theme', next);
  els.themeToggle?.setAttribute('aria-pressed', String(next === 'dark'));
}

function setupSupportModal(els) {
  if (!els.supportBtn || !els.supportModal) return;
  els.supportBtn.addEventListener('click', () => openSupportModal(els));
  els.supportModal.querySelector('.support-modal__backdrop')?.addEventListener('click', () => closeSupportModal(els));
  els.supportModal.querySelector('.support-modal__close')?.addEventListener('click', () => closeSupportModal(els));
}

function openSupportModal(els) {
  if (!els.supportModal) return;
  els.supportModal.dataset.returnFocus = document.activeElement?.id || '';
  els.supportModal.classList.remove('hidden');
  els.supportModal.querySelector('.support-modal__content')?.focus();
}

function closeSupportModal(els) {
  if (!els.supportModal || els.supportModal.classList.contains('hidden')) return;
  const returnFocus = els.supportModal.dataset.returnFocus;
  els.supportModal.classList.add('hidden');
  const target = returnFocus ? document.getElementById(returnFocus) : els.supportBtn;
  target?.focus();
}

function closeMobileMenu(els, options = {}) {
  const wasOpen = !els.mobileMenu?.classList.contains('hidden');
  els.mobileMenu?.classList.add('hidden');
  els.mobileMenuBtn?.setAttribute('aria-expanded', 'false');
  if (wasOpen && options.restoreFocus) {
    (lastMobileMenuFocus || els.mobileMenuBtn)?.focus?.();
  }
}

function focusFirstMenuItem(els) {
  window.setTimeout(() => {
    els.mobileMenu?.querySelector('a,button')?.focus();
  }, 0);
}

function trapFocus(event, root) {
  const focusables = [...root.querySelectorAll('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])')]
    .filter((item) => item.offsetParent !== null || item === document.activeElement);
  if (!focusables.length) return;
  const first = focusables[0];
  const last = focusables.at(-1);
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function markActiveNavRoutes() {
  const path = location.pathname.replace(/\/index\.html$/, '/');
  document.querySelectorAll('.app-header__link, .mobile-menu__link').forEach((link) => {
    if (!link.getAttribute('href')) return;
    const href = new URL(link.getAttribute('href'), location.origin).pathname;
    const active = href === path || (path.startsWith('/test') && href === '/test/');
    link.classList.toggle(link.classList.contains('mobile-menu__link') ? 'mobile-menu__link--active' : 'app-header__link--active', active);
  });
}

function restoreShellHashState(els) {
  const params = new URLSearchParams(location.hash.replace(/^#/, ''));
  if (params.get('sidebar') === '1') {
    document.body.classList.add('test-sidebar-open');
    els.sidebarToggle?.setAttribute('aria-expanded', 'true');
  }
  if (params.get('sourceQ') && els.sourceFilter) els.sourceFilter.value = params.get('sourceQ');
  if (params.get('diagSeverity') && els.diagnosticsSeverity) els.diagnosticsSeverity.value = params.get('diagSeverity');
  if (params.get('diagType') && els.diagnosticsType) els.diagnosticsType.value = params.get('diagType');
  if (params.get('diagSort') && els.diagnosticsSort) els.diagnosticsSort.value = params.get('diagSort');
}

function setupPanelState(els) {
  const collapsed = readCollapsedPanels();
  const hashCollapsed = readHashList('panelsCollapsed');
  hashCollapsed.forEach((name) => collapsed.add(name));
  els.panels?.forEach((panel) => {
    const panelName = panel.dataset.panel;
    const heading = panel.querySelector('.test-panel__heading') || panel.querySelector('h2');
    if (heading && panelName !== 'search') {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'test-panel__collapse';
      button.dataset.panelCollapse = panelName;
      button.setAttribute('aria-expanded', String(!collapsed.has(panelName)));
      button.textContent = collapsed.has(panelName) ? 'Show' : 'Hide';
      heading.appendChild(button);
      panel.classList.toggle('test-panel--collapsed', collapsed.has(panelName));
      button.addEventListener('click', (event) => {
        event.stopPropagation();
        togglePanelCollapsed(panel, button);
      });
    }
    panel.addEventListener('focusin', () => {
      els.panels?.forEach((item) => item.classList.remove('test-panel--active'));
      panel.classList.add('test-panel--active');
      writeShellHashState('panel', panel.dataset.panel);
    });
    panel.addEventListener('click', () => {
      els.panels?.forEach((item) => item.classList.remove('test-panel--active'));
      panel.classList.add('test-panel--active');
      writeShellHashState('panel', panel.dataset.panel);
    });
  });
}

function restorePanelState(els) {
  const params = new URLSearchParams(location.hash.replace(/^#/, ''));
  const panelName = params.get('panel');
  if (!panelName) return;
  const panel = document.querySelector(`[data-panel="${CSS.escape(panelName)}"]`);
  if (!panel) return;
  if (!els.sidebar?.contains(panel)) document.getElementById('mapTools')?.setAttribute('open', '');
  panel.classList.add('test-panel--active');
  panel.scrollIntoView({ block: 'nearest' });
}

function setupKeyboardShortcuts(els) {
  document.addEventListener('keydown', (event) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (isEditable(event.target)) return;
    if (event.key === '/') {
      event.preventDefault();
      document.body.classList.add('test-sidebar-open');
      els.sidebarToggle?.setAttribute('aria-expanded', 'true');
      writeShellHashState('sidebar', '1');
      els.mapSearch?.focus();
    } else if (event.key.toLowerCase() === 'c') {
      event.preventDefault();
      const open = !document.body.classList.contains('test-sidebar-open');
      document.body.classList.toggle('test-sidebar-open', open);
      els.sidebarToggle?.setAttribute('aria-expanded', String(open));
      writeShellHashState('sidebar', open ? '1' : null);
      if (open) els.mapSearch?.focus();
    } else if (event.key.toLowerCase() === 's') {
      event.preventDefault();
      openPanelShortcut(els, 'sources', els.sourceFilter);
    } else if (event.key.toLowerCase() === 'd') {
      event.preventDefault();
      openPanelShortcut(els, 'diagnostics', els.diagnosticsSeverity);
    } else if (event.key.toLowerCase() === 't') {
      event.preventDefault();
      toggleTheme(els);
    } else if (event.key === '?') {
      event.preventDefault();
      showToast(els, 'Shortcuts: / search, C catalogue, S sources, D diagnostics, T theme, Esc close.');
    }
  });
}

function openPanelShortcut(els, panelName, focusTarget) {
  document.body.classList.add('test-sidebar-open');
  els.sidebarToggle?.setAttribute('aria-expanded', 'true');
  writeShellHashState('sidebar', '1');
  writeShellHashState('panel', panelName);
  document.getElementById('mapTools')?.setAttribute('open', '');
  const panel = document.querySelector(`[data-panel="${CSS.escape(panelName)}"]`);
  if (panel) {
    if (panel.classList.contains('test-panel--collapsed')) {
      const button = panel.querySelector('[data-panel-collapse]');
      togglePanelCollapsed(panel, button);
    }
    els.panels?.forEach((item) => item.classList.remove('test-panel--active'));
    panel.classList.add('test-panel--active');
    panel.scrollIntoView({ block: 'nearest' });
  }
  window.setTimeout(() => focusTarget?.focus?.(), 0);
}

function togglePanelCollapsed(panel, button) {
  const collapsed = !panel.classList.contains('test-panel--collapsed');
  panel.classList.toggle('test-panel--collapsed', collapsed);
  if (button) {
    button.setAttribute('aria-expanded', String(!collapsed));
    button.textContent = collapsed ? 'Show' : 'Hide';
  }
  const names = readCollapsedPanels();
  if (collapsed) names.add(panel.dataset.panel);
  else names.delete(panel.dataset.panel);
  writeCollapsedPanels(names);
  writeShellHashState('panelsCollapsed', [...names].map(encodeURIComponent).join('|') || null);
}

function readCollapsedPanels() {
  try {
    return new Set(JSON.parse(localStorage.getItem(PANEL_PREF_KEY) || '[]'));
  } catch {
    return new Set();
  }
}

function writeCollapsedPanels(value) {
  try {
    localStorage.setItem(PANEL_PREF_KEY, JSON.stringify([...value]));
  } catch {}
}

function readHashList(key) {
  const params = new URLSearchParams(location.hash.replace(/^#/, ''));
  return new Set((params.get(key) || '').split('|').map(decodeURIComponent).filter(Boolean));
}

function restoreDiagnosticPreferences(els) {
  try {
    const prefs = JSON.parse(localStorage.getItem(DIAGNOSTIC_PREF_KEY) || '{}');
    if (prefs.severity && els.diagnosticsSeverity) els.diagnosticsSeverity.value = prefs.severity;
    if (prefs.type && els.diagnosticsType) els.diagnosticsType.value = prefs.type;
    if (prefs.sort && els.diagnosticsSort) els.diagnosticsSort.value = prefs.sort;
  } catch {}
}

function saveDiagnosticPreferences(els) {
  try {
    localStorage.setItem(DIAGNOSTIC_PREF_KEY, JSON.stringify({
      severity: els.diagnosticsSeverity?.value || 'all',
      type: els.diagnosticsType?.value || 'all',
      sort: els.diagnosticsSort?.value || 'severity'
    }));
  } catch {}
}

function readDiagnosticHistory() {
  try {
    const history = JSON.parse(localStorage.getItem(DIAGNOSTIC_HISTORY_KEY) || '[]');
    return Array.isArray(history) ? history.slice(-20) : [];
  } catch {
    return [];
  }
}

function announce(els, message) {
  if (!els.screenReaderStatus) return;
  els.screenReaderStatus.textContent = '';
  window.setTimeout(() => {
    els.screenReaderStatus.textContent = message;
  }, 20);
}

function escapeAttribute(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[char]);
}

function isEditable(target) {
  return ['INPUT', 'SELECT', 'TEXTAREA'].includes(target?.tagName) || target?.isContentEditable;
}

function setupMobileSidebarGesture(els) {
  if (!els.sidebar) return;
  let startY = null;
  els.sidebar.addEventListener('touchstart', (event) => {
    if (!document.body.classList.contains('test-sidebar-open')) return;
    startY = event.touches?.[0]?.clientY ?? null;
  }, { passive: true });
  els.sidebar.addEventListener('touchend', (event) => {
    if (startY === null) return;
    const endY = event.changedTouches?.[0]?.clientY ?? startY;
    const delta = endY - startY;
    startY = null;
    if (delta < 80) return;
    document.body.classList.remove('test-sidebar-open');
    els.sidebarToggle?.setAttribute('aria-expanded', 'false');
    writeShellHashState('sidebar', null);
  }, { passive: true });
}

function writeShellHashState(key, value) {
  const url = new URL(location.href);
  const params = new URLSearchParams(location.hash.replace(/^#/, ''));
  if (value === null || value === undefined || value === '') params.delete(key);
  else params.set(key, value);
  url.hash = params.toString();
  history.replaceState(null, '', url);
}

function awaitRuntimeEnvironment() {
  return runtimeEnvironment || {
    deviceMemory: navigator.deviceMemory || null,
    storageUsage: null,
    storageQuota: null,
    storagePressure: 'unknown',
    jsHeapSizeLimit: performance.memory?.jsHeapSizeLimit || null,
    usedJSHeapSize: performance.memory?.usedJSHeapSize || null
  };
}

async function readRuntimeEnvironment() {
  const estimate = await navigator.storage?.estimate?.().catch(() => null);
  runtimeEnvironment = {
    deviceMemory: navigator.deviceMemory || null,
    storageUsage: estimate?.usage || null,
    storageQuota: estimate?.quota || null,
    storagePressure: estimate?.usage && estimate?.quota
      ? (estimate.usage / estimate.quota > 0.8 ? 'high' : 'normal')
      : 'unknown',
    jsHeapSizeLimit: performance.memory?.jsHeapSizeLimit || null,
    usedJSHeapSize: performance.memory?.usedJSHeapSize || null
  };
  return runtimeEnvironment;
}

function setupServiceWorkerStatus(renderDiagnostics) {
  if (!navigator.serviceWorker) {
    serviceWorkerStatus = { supported: false, controlled: false, caches: {}, pressure: 'unsupported' };
    renderDiagnostics?.();
    return;
  }
  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data?.type !== 'TEST_CACHE_STATUS') return;
    serviceWorkerStatus = {
      supported: true,
      controlled: Boolean(navigator.serviceWorker.controller),
      pressure: event.data.pressure || 'unknown',
      caches: event.data.caches || {}
    };
    renderDiagnostics?.();
  });
  navigator.serviceWorker.ready
    .then((registration) => {
      serviceWorkerStatus = {
        supported: true,
        controlled: Boolean(navigator.serviceWorker.controller),
        scope: registration.scope,
        state: registration.active?.state || 'unknown',
        caches: {},
        pressure: 'unknown'
      };
      registration.active?.postMessage('TEST_CACHE_STATUS');
      renderDiagnostics?.();
    })
    .catch(() => {
      serviceWorkerStatus = { supported: true, controlled: false, error: 'Service worker status unavailable', caches: {}, pressure: 'unknown' };
      renderDiagnostics?.();
    });
}

function runAccessibilityAudit(els) {
  const issues = [];
  const add = (severity, rule, message) => issues.push({ severity, rule, message });
  const ids = new Set();
  document.querySelectorAll('[id]').forEach((node) => {
    if (ids.has(node.id)) add('error', 'duplicate-id', `Duplicate id #${node.id}.`);
    ids.add(node.id);
  });
  document.querySelectorAll('button').forEach((button) => {
    const name = button.getAttribute('aria-label') || button.textContent?.trim() || button.title;
    if (!name) add('error', 'button-name', 'Button is missing an accessible name.');
  });
  document.querySelectorAll('input,select,textarea').forEach((field) => {
    if (field.type === 'hidden') return;
    const id = field.id;
    const hasLabel = id && document.querySelector(`label[for="${CSS.escape(id)}"]`);
    const hasWrappedLabel = Boolean(field.closest('label'));
    const hasAria = field.getAttribute('aria-label') || field.getAttribute('aria-labelledby');
    if (!hasLabel && !hasWrappedLabel && !hasAria) add('warn', 'form-label', `${field.tagName.toLowerCase()}#${id || '(no id)'} is missing a label.`);
  });
  document.querySelectorAll('[aria-controls]').forEach((node) => {
    const target = node.getAttribute('aria-controls');
    if (target && !document.getElementById(target)) add('error', 'aria-controls', `${node.id || node.textContent?.trim() || node.tagName} controls missing #${target}.`);
  });
  if (!els.supportModal?.getAttribute('aria-labelledby')) add('warn', 'dialog-name', 'Support modal should keep aria-labelledby.');
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
    const sidebarTransition = getComputedStyle(els.sidebar).transitionDuration;
    if (sidebarTransition && sidebarTransition !== '0s' && sidebarTransition !== '0.01ms') {
      add('warn', 'reduced-motion', 'Reduced-motion users should not receive meaningful sidebar transitions.');
    }
  }
  const coarsePointer = window.matchMedia('(pointer: coarse)').matches;
  if (isMobileViewport() || coarsePointer) {
    const touchTargets = [...document.querySelectorAll('button,a,input,select,textarea')]
      .filter((node) => node.offsetParent !== null)
      .filter((node) => {
        const rect = node.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 && (rect.width < 40 || rect.height < 40);
      });
    if (touchTargets.length) add('warn', 'target-size', `${touchTargets.length} visible control(s) are below the mobile 40px smoke threshold.`);
  }
  return {
    engine: 'civgraph axe-style smoke',
    screenReaderPass: issues.some((issue) => issue.severity === 'error') ? 'needs review' : 'pass',
    issueCount: issues.length,
    issues: issues.slice(0, 12)
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
