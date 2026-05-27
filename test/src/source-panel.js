import { escapeHtml } from './utils.js';

export function renderSourcePanel(els, controller, options = {}) {
  if (!els.sourcePanel) return;
  const query = String(options.query || '').trim().toLowerCase();
  const active = [...controller.layers.values()].filter((record) => !query || sourceSearchText(record.config).includes(query));
  if (!active.length) {
    els.sourcePanel.textContent = controller.layers.size ? 'No active layer sources match that filter.' : 'Load a layer to inspect sources.';
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
  const references = (layer.references || []).map((ref, index) => ({ label: ref.label || `Reference ${index + 1}`, href: ref.url || ref.file }));
  const downloads = (layer.sourceDownloads || []).map((download) => ({ label: download.label || 'Download', href: download.file || download.url }));
  const technical = [
    layer.metadataUrl ? { label: 'Tile metadata', href: layer.metadataUrl } : null,
    layer.tileUrl ? { label: 'PMTiles archive', href: layer.tileUrl } : null,
    layer.tilesFallback ? { label: 'Directory MVT fallback', href: layer.tilesFallback.replace('/{z}/{x}/{y}.pbf', '/metadata.json') } : null
  ].filter((link) => link?.href);
  return `
    <article class="source-panel__layer">
      <h3>${escapeHtml(layer.name)}</h3>
      <div class="source-panel__badges">
        <span>${escapeHtml(layer.sourceType || 'source')}</span>
        ${layer.tilePackage?.serving ? `<span>${escapeHtml(layer.tilePackage.serving)}</span>` : ''}
        ${!references.length ? '<span>no references</span>' : ''}
        ${!downloads.length ? '<span>no downloads</span>' : ''}
      </div>
      ${facts.length ? `<p>${escapeHtml(facts.join(' - '))}</p>` : ''}
      ${layer.description ? `<p>${escapeHtml(layer.description)}</p>` : ''}
      ${credits.length ? `<p>${escapeHtml(`Credit: ${credits.join(', ')}`)}</p>` : ''}
      ${renderLinkGroup('References', references, true)}
      ${renderLinkGroup('Downloads', downloads, true)}
      ${renderLinkGroup('Tiles', technical, true)}
    </article>
  `;
}

function renderLinkGroup(title, links, open = false) {
  if (!links.length) return '';
  const sorted = [...links].sort((a, b) => String(a.label || '').localeCompare(String(b.label || '')));
  return `
    <details class="source-panel__group" ${open ? 'open' : ''}>
      <summary>${escapeHtml(title)} <span>${links.length}</span></summary>
      <div>${sorted.map((link) => `<a href="${escapeHtml(link.href)}" target="_blank" rel="noopener">${escapeHtml(link.label)}</a>`).join('')}</div>
    </details>
  `;
}

function sourceSearchText(layer) {
  return [
    layer.name,
    layer.provider,
    layer.sourceMapId,
    layer.description,
    layer.status,
    ...(layer.sourceCredits || []),
    ...(layer.references || []).flatMap((item) => [item.label, item.url, item.file]),
    ...(layer.sourceDownloads || []).flatMap((item) => [item.label, item.url, item.file])
  ].flat().filter(Boolean).join(' ').toLowerCase();
}
