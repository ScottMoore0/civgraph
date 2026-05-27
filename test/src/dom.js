export function getElements() {
  return {
    catalogue: document.getElementById('catalogue'),
    activeLayers: document.getElementById('activeLayers'),
    diagnostics: document.getElementById('diagnostics'),
    featureDetails: document.getElementById('featureDetails'),
    featureResults: document.getElementById('featureResults'),
    mapSearch: document.getElementById('mapSearch'),
    sourceFilter: document.getElementById('sourceFilter'),
    sourcePanel: document.getElementById('sourcePanel'),
    timeSeriesPanel: document.getElementById('timeSeriesPanel'),
    toast: document.getElementById('toast')
  };
}
