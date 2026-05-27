import { escapeHtml } from './utils.js';

export function renderSourcePanel(els, controller) {
  if (!els.sourcePanel) return;
  const active = [...controller.layers.values()];
  if (!active.length) {
    els.sourcePanel.textContent = 'Load a layer to inspect sources.';
    return;
  }
  els.sourcePanel.innerHTML = active.map((record) => renderLayerSource(record.config)).join('');
}

function renderLayerSource(layer) {
  const facts = [
    layer.provider,
    layer.sourceMapId,
    layer.dateEffective || layer.date,
    layer.status
  ].flat().filter(Boolean);
  const credits = (layer.sourceCredits || []).filter(Boolean);
  const links = [
    ...(layer.references || []).map((ref, index) => ({ label: ref.label || `Reference ${index + 1}`, href: ref.url || ref.file })),
    ...(layer.sourceDownloads || []).map((download) => ({ label: download.label || 'Download', href: download.file || download.url })),
    layer.metadataUrl ? { label: 'Tile metadata', href: layer.metadataUrl } : null
  ].filter((link) => link?.href);
  return `
    <article class="source-panel__layer">
      <h3>${escapeHtml(layer.name)}</h3>
      ${facts.length ? `<p>${escapeHtml(facts.join(' - '))}</p>` : ''}
      ${credits.length ? `<p>${escapeHtml(`Credit: ${credits.join(', ')}`)}</p>` : ''}
      ${links.length ? `<div>${links.map((link) => `<a href="${escapeHtml(link.href)}" target="_blank" rel="noopener">${escapeHtml(link.label)}</a>`).join('')}</div>` : ''}
    </article>
  `;
}
