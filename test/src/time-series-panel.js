import { escapeHtml } from './utils.js';

export function renderTimeSeriesPanel(els, timeSeries, controller, options = {}) {
  if (!els.timeSeriesPanel) return;
  const activeLayerIds = [...controller.layers.keys()];
  const chainEntries = activeLayerIds
    .map((layerId) => ({ layerId, chain: timeSeries.getLayerChain(layerId) }))
    .filter((entry) => entry.chain);

  if (!chainEntries.length) {
    const totalChains = timeSeries.getChains().length;
    els.timeSeriesPanel.textContent = totalChains
      ? 'Load a converted layer that belongs to a time-series chain.'
      : 'No converted time-series chains.';
    return;
  }

  els.timeSeriesPanel.innerHTML = chainEntries.map(({ layerId, chain }) => {
    const entries = chain.maps || chain.layers || [];
    return `
      <div class="time-series-control" data-layer-id="${escapeHtml(layerId)}">
        <strong>${escapeHtml(chain.name || 'Time series')}</strong>
        <select data-control="time-series-date">
          ${entries.map((entry) => {
            const id = entry.id || entry.mapId;
            return `<option value="${escapeHtml(entry.date)}" ${id === layerId ? 'selected' : ''}>${escapeHtml(entry.date || id)}</option>`;
          }).join('')}
        </select>
      </div>
    `;
  }).join('');

  els.timeSeriesPanel.querySelectorAll('[data-control="time-series-date"]').forEach((select) => {
    select.addEventListener('change', async (event) => {
      const layerId = event.target.closest('[data-layer-id]')?.dataset.layerId;
      if (!layerId) return;
      const changed = await timeSeries.switchLayerToDate(layerId, event.target.value);
      if (changed) options.onChange?.();
    });
  });
}
