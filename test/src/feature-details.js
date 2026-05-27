import { getFeatureLabel } from './labels.js';
import { escapeHtml, formatValue } from './utils.js';

export function renderFeatureDetails(els, selection) {
  if (!selection) {
    els.featureDetails.textContent = 'Click a rendered feature.';
    return;
  }

  const { layer, feature } = selection;
  const props = feature.properties || {};
  const keys = layer.popupProperties || Object.keys(props);
  const rows = keys.map((key) => {
    const value = props[key];
    return `<dt>${escapeHtml(key)}</dt><dd>${escapeHtml(formatValue(value))}</dd>`;
  }).join('');
  const sourceHtml = renderFeatureSource(layer);

  els.featureDetails.innerHTML = `
    <h3>${escapeHtml(getFeatureLabel(layer, props) || layer.name)}</h3>
    ${sourceHtml}
    <dl>${rows}</dl>
  `;
}

function renderFeatureSource(layer) {
  const bits = [layer.provider, layer.sourceMapId].filter(Boolean);
  if (!bits.length) return '';
  return `<p class="feature-details__source">${bits.map(escapeHtml).join(' · ')}</p>`;
}
