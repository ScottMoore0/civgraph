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
      ${!isRasterLike(record.config) ? `
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
      ${!isRasterLike(record.config) ? renderStyleControls(record.config) : ''}
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
      applyStyle(row, id, options);
      options.onRendered?.();
    });
    row.querySelector('[data-control="style-mode"]')?.addEventListener('change', () => {
      applyStyle(row, id, options);
      options.onRendered?.();
    });
    row.querySelector('[data-control="style-ramp"]')?.addEventListener('change', () => {
      applyStyle(row, id, options);
      options.onRendered?.();
    });
    row.querySelector('[data-control="stroke-width"]')?.addEventListener('input', (event) => {
      controller.setLayerStrokeWidth(id, Number(event.target.value));
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

function getCategoricalCandidateOptions(layer) {
  const props = layer.categoricalProperties || layer.popupProperties || [];
  return props.filter((key) => !/^id|source/i.test(key)).slice(0, 12);
}

function renderStyleControls(layer) {
  const numeric = getNumericCandidateOptions(layer);
  const categorical = getCategoricalCandidateOptions(layer);
  const allAttributes = [...new Set([...numeric, ...categorical])];
  return `
    <label>
      Stroke
      <input data-control="stroke-width" type="range" min="0.2" max="8" step="0.2" value="${Number(layer.style?.weight || 1.5)}">
    </label>
    <label>
      Style mode
      <select data-control="style-mode">
        <option value="">Plain</option>
        <option value="gradient">Gradient</option>
        <option value="categorical">Categorical</option>
        <option value="party">Party colours</option>
      </select>
    </label>
    <label>
      Attribute
      <select data-control="gradient-attribute">
        <option value="">None</option>
        ${allAttributes.map((key) => `<option value="${escapeHtml(key)}">${escapeHtml(key)}</option>`).join('')}
      </select>
    </label>
    <label>
      Ramp
      <select data-control="style-ramp">
        <option value="blue-red">Blue to red</option>
        <option value="green-purple">Green to purple</option>
        <option value="amber-blue">Amber to blue</option>
      </select>
    </label>
  `;
}

function applyStyle(row, id, options) {
  const mode = row.querySelector('[data-control="style-mode"]')?.value || '';
  const attribute = row.querySelector('[data-control="gradient-attribute"]')?.value || '';
  const ramp = getRamp(row.querySelector('[data-control="style-ramp"]')?.value);
  if (!mode) {
    options.conditionalStyling?.clear(id);
    return;
  }
  if (!attribute) return;
  if (mode === 'gradient') {
    options.conditionalStyling?.applyGradient(id, {
      attribute,
      min: 0,
      max: 100,
      lowColor: ramp[0],
      highColor: ramp[1],
      noDataColor: '#cccccc'
    });
  } else if (mode === 'categorical') {
    options.conditionalStyling?.applyCategorical(id, { attribute });
  } else if (mode === 'party') {
    options.conditionalStyling?.applyPartyColours(id, { attribute });
  }
}

function getRamp(value) {
  if (value === 'green-purple') return ['#16a34a', '#7e22ce'];
  if (value === 'amber-blue') return ['#f59e0b', '#2563eb'];
  return ['#3182ce', '#e53e3e'];
}

function isRasterLike(layer) {
  return layer.sourceType === 'raster' || layer.sourceType === 'image';
}
