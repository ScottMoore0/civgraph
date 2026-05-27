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
        <span>${escapeHtml(record.config.sourceType)} - z${record.config.minzoom}-${record.config.maxzoom}</span>
      </div>
      <label>
        Opacity
        <input data-control="opacity" type="range" min="0" max="1" step="0.05" value="${record.opacity ?? record.config.style?.fillOpacity ?? 0.18}">
      </label>
      ${record.config.sourceType !== 'raster' ? `
        <label>
          Line
          <input data-control="line-color" type="color" value="${escapeHtml(record.color || record.config.style?.color || '#5B21B6')}">
        </label>
        ${record.config.geometryType !== 'line' && record.config.geometryType !== 'point' ? `
          <label>
            Fill
            <input data-control="fill-color" type="color" value="${escapeHtml(record.fillColor || record.config.style?.fillColor || '#7C3AED')}">
          </label>
        ` : ''}
      ` : ''}
      <label>
        Attribute style
        <select data-control="gradient-attribute">
          <option value="">None</option>
          ${getNumericCandidateOptions(record.config).map((key) => `<option value="${escapeHtml(key)}">${escapeHtml(key)}</option>`).join('')}
        </select>
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
    row.querySelector('[data-control="line-color"]')?.addEventListener('input', (event) => {
      controller.setLayerColor(id, event.target.value);
      options.onRendered?.();
    });
    row.querySelector('[data-control="fill-color"]')?.addEventListener('input', (event) => {
      controller.setLayerFillColor(id, event.target.value);
      options.onRendered?.();
    });
    row.querySelector('[data-control="gradient-attribute"]')?.addEventListener('change', (event) => {
      const attribute = event.target.value;
      if (!attribute) {
        options.conditionalStyling?.clear(id);
      } else {
        options.conditionalStyling?.applyGradient(id, {
          attribute,
          min: 0,
          max: 100,
          lowColor: '#3182ce',
          highColor: '#e53e3e',
          noDataColor: '#cccccc'
        });
      }
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

function getNumericCandidateOptions(layer) {
  const props = layer.numericProperties || layer.popupProperties || [];
  return props.filter((key) => !/^name|label|id|source|province/i.test(key)).slice(0, 12);
}
