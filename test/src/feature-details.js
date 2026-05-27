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
    ${renderLayerContext(layer)}
    <dl>${rows}</dl>
  `;
}

function renderFeatureSource(layer) {
  const provider = Array.isArray(layer.provider) ? layer.provider.join(', ') : layer.provider;
  const bits = [provider, layer.sourceMapId].filter(Boolean);
  if (!bits.length) return '';
  return `<p class="feature-details__source">${bits.map(escapeHtml).join(' - ')}</p>`;
}

function renderLayerContext(layer) {
  const links = [
    ...(layer.references || []).slice(0, 3).map((ref, index) => `<a href="${escapeHtml(ref.url || ref.file || '#')}" target="_blank" rel="noopener">${escapeHtml(ref.label || `Reference ${index + 1}`)}</a>`),
    ...(layer.sourceDownloads || []).slice(0, 3).map((download) => `<a href="${escapeHtml(download.file || '#')}" target="_blank" rel="noopener">${escapeHtml(download.label || 'Source download')}</a>`)
  ];
  const credits = (layer.sourceCredits || []).filter(Boolean);
  const facts = [layer.category, layer.group, layer.dateEffective || layer.date, layer.dateAdded ? `added ${layer.dateAdded}` : null, layer.status].filter(Boolean);
  if (!links.length && !facts.length && !credits.length) return '';
  return `
    <div class="feature-details__context">
      ${facts.length ? `<p>${facts.map(escapeHtml).join(' - ')}</p>` : ''}
      ${credits.length ? `<p>${escapeHtml(`Credit: ${credits.join(', ')}`)}</p>` : ''}
      ${links.length ? `<div>${links.join('')}</div>` : ''}
    </div>
  `;
}
