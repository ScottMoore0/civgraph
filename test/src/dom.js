export function getElements() {
  return {
    catalogue: document.getElementById('catalogue'),
    activeLayers: document.getElementById('activeLayers'),
    catalogueStats: document.getElementById('catalogueStats'),
    copyDiagnostics: document.getElementById('copyDiagnostics'),
    diagnostics: document.getElementById('diagnostics'),
    diagnosticsSeverity: document.getElementById('diagnosticsSeverity'),
    diagnosticsSort: document.getElementById('diagnosticsSort'),
    fallbackAlerts: document.getElementById('fallbackAlerts'),
    featureDetails: document.getElementById('featureDetails'),
    featureResults: document.getElementById('featureResults'),
    mapSearch: document.getElementById('mapSearch'),
    sourceFilter: document.getElementById('sourceFilter'),
    sourcePanel: document.getElementById('sourcePanel'),
    sidebar: document.getElementById('testSidebar'),
    sidebarToggle: document.getElementById('sidebarToggle'),
    timeSeriesPanel: document.getElementById('timeSeriesPanel'),
    toast: document.getElementById('toast')
  };
}
