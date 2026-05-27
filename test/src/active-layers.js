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
    const styleState = record.styleState || options.conditionalStyling?.activeStyles?.get(id) || null;
    row.className = 'active-layer';
    row.innerHTML = `
      <div>
        <strong>${escapeHtml(record.config.name)}</strong>
        <span>${escapeHtml(record.config.sourceType)} - z${record.config.minzoom}-${record.config.maxzoom}${record.config.tilePackage?.preferred ? ' - PMTiles' : ''}</span>
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
      ${!isRasterLike(record.config) ? renderStyleControls(record.config, styleState, record) : ''}
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
      ${!isRasterLike(record.config) ? renderLegend(record.config, styleState) : ''}
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
    row.querySelector('[data-action="style-reset"]')?.addEventListener('click', () => {
      options.conditionalStyling?.clear(id);
      row.querySelector('[data-control="style-mode"]').value = '';
      options.onRendered?.();
    });
    row.querySelectorAll('[data-style-preset]').forEach((button) => {
      button.addEventListener('click', () => {
        const mode = button.dataset.stylePreset || '';
        const select = row.querySelector('[data-control="style-mode"]');
        const attr = row.querySelector('[data-control="gradient-attribute"]');
        if (select) select.value = mode;
        if (attr && !attr.value) attr.value = chooseAttributeForMode(record.config, mode);
        applyStyle(row, id, options);
        options.onRendered?.();
      });
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

function renderStyleControls(layer, styleState, record) {
  const numeric = getNumericCandidateOptions(layer);
  const categorical = getCategoricalCandidateOptions(layer);
  const allAttributes = [...new Set([...numeric, ...categorical])];
  const mode = styleState?.type || '';
  const attribute = styleState?.attribute || '';
  const ramp = styleState?.rampName || rampNameFromColors(styleState);
  return `
    <div class="active-layer__presets" aria-label="Style presets">
      <button type="button" data-style-preset="">Plain</button>
      <button type="button" data-style-preset="gradient" ${numeric.length ? '' : 'disabled'}>Gradient</button>
      <button type="button" data-style-preset="categorical" ${categorical.length ? '' : 'disabled'}>Category</button>
      <button type="button" data-style-preset="party" ${categorical.length ? '' : 'disabled'}>Party</button>
      <button type="button" data-action="style-reset">Reset</button>
    </div>
    <label>
      Stroke
      <input data-control="stroke-width" type="range" min="0.2" max="8" step="0.2" value="${Number(record.strokeWidth || layer.style?.weight || 1.5)}">
    </label>
    <label>
      Style mode
      <select data-control="style-mode">
        <option value="" ${mode ? '' : 'selected'}>Plain</option>
        <option value="gradient" ${mode === 'gradient' ? 'selected' : ''}>Gradient</option>
        <option value="categorical" ${mode === 'categorical' ? 'selected' : ''}>Categorical</option>
        <option value="party" ${mode === 'party' ? 'selected' : ''}>Party colours</option>
      </select>
    </label>
    <label>
      Attribute
      <select data-control="gradient-attribute">
        <option value="">None</option>
        ${allAttributes.map((key) => `<option value="${escapeHtml(key)}" ${attribute === key ? 'selected' : ''}>${escapeHtml(key)}</option>`).join('')}
      </select>
    </label>
    <label>
      Ramp
      <select data-control="style-ramp">
        <option value="blue-red" ${ramp === 'blue-red' ? 'selected' : ''}>Blue to red</option>
        <option value="green-purple" ${ramp === 'green-purple' ? 'selected' : ''}>Green to purple</option>
        <option value="amber-blue" ${ramp === 'amber-blue' ? 'selected' : ''}>Amber to blue</option>
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
      rampName: row.querySelector('[data-control="style-ramp"]')?.value || 'blue-red',
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

function chooseAttributeForMode(layer, mode) {
  if (mode === 'gradient') return getNumericCandidateOptions(layer)[0] || '';
  return getCategoricalCandidateOptions(layer)[0] || '';
}

function getRamp(value) {
  if (value === 'green-purple') return ['#16a34a', '#7e22ce'];
  if (value === 'amber-blue') return ['#f59e0b', '#2563eb'];
  return ['#3182ce', '#e53e3e'];
}

function rampNameFromColors(styleState) {
  if (!styleState) return 'blue-red';
  if (styleState.lowColor === '#16a34a' && styleState.highColor === '#7e22ce') return 'green-purple';
  if (styleState.lowColor === '#f59e0b' && styleState.highColor === '#2563eb') return 'amber-blue';
  return 'blue-red';
}

function renderLegend(layer, styleState) {
  if (!styleState?.type) return '';
  if (styleState.type === 'gradient') {
    return `
      <div class="style-legend">
        <div class="style-legend__title">${escapeHtml(styleState.attribute)} gradient</div>
        <div class="style-legend__gradient" style="--low:${escapeHtml(styleState.lowColor || '#3182ce')};--high:${escapeHtml(styleState.highColor || '#e53e3e')}"></div>
        <div class="style-legend__scale"><span>${escapeHtml(String(styleState.min ?? 0))}</span><span>${escapeHtml(String(styleState.max ?? 100))}</span></div>
      </div>
    `;
  }
  const entries = styleState.type === 'party'
    ? Object.entries(styleState.colours || {}).slice(0, 12)
    : (styleState.values || layer.categoricalValues?.[styleState.attribute] || []).slice(0, 12).map((value, index) => [value, styleState.palette?.[index % (styleState.palette?.length || 1)] || '#4b5563']);
  return `
    <div class="style-legend">
      <div class="style-legend__title">${escapeHtml(styleState.type === 'party' ? 'Party colours' : `${styleState.attribute} categories`)}</div>
      <div class="style-legend__chips">
        ${entries.map(([label, color]) => `<span><i style="background:${escapeHtml(color)}"></i>${escapeHtml(label)}</span>`).join('')}
      </div>
    </div>
  `;
}

function isRasterLike(layer) {
  return layer.sourceType === 'raster' || layer.sourceType === 'image';
}
