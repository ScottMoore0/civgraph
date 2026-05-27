import { DEFAULT_TEXT_SCALE } from './config.js';
import { escapeHtml } from './utils.js';

export function renderActiveLayers(els, controller, options = {}) {
  if (controller.layers.size === 0) {
    els.activeLayers.textContent = 'No active layers.';
    options.onRendered?.();
    return;
  }

  els.activeLayers.innerHTML = '';
  for (const [id, record] of controller.layers) {
    const row = document.createElement('div');
    const hasLabels = (record.labelLayerIds || []).length > 0;
    row.className = 'active-layer';
    row.innerHTML = `
      <div>
        <strong>${escapeHtml(record.config.name)}</strong>
        <span>${escapeHtml(record.config.sourceType)} · z${record.config.minzoom}-${record.config.maxzoom}</span>
      </div>
      <label>
        Opacity
        <input data-control="opacity" type="range" min="0" max="1" step="0.05" value="${record.config.style?.fillOpacity ?? 0.18}">
      </label>
      ${hasLabels ? `
        <label class="active-layer__check">
          <input data-control="labels" type="checkbox" ${record.labelsEnabled ? 'checked' : ''}>
          <span>Labels</span>
        </label>
        <label>
          Text
          <input data-control="text-scale" type="range" min="50" max="200" step="10" value="${record.textScale || DEFAULT_TEXT_SCALE}">
        </label>
      ` : ''}
    `;
    row.querySelector('[data-control="opacity"]').addEventListener('input', (event) => {
      controller.setOpacity(id, Number(event.target.value));
      options.onRendered?.();
    });
    row.querySelector('[data-control="labels"]')?.addEventListener('change', (event) => {
      controller.setLayerLabelsEnabled(id, event.target.checked);
      options.onRendered?.();
    });
    row.querySelector('[data-control="text-scale"]')?.addEventListener('input', (event) => {
      controller.setLayerTextScale(id, Number(event.target.value));
      options.onRendered?.();
    });
    els.activeLayers.appendChild(row);
  }
  options.onRendered?.();
}
