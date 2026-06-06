import { copyText, escapeHtml } from './utils.js';

function isLocalTestTileTemplate(value) {
  return typeof value === 'string' && value.startsWith('/test/tiles/');
}

function localTestTilesAvailable() {
  const hostname = globalThis.location?.hostname || '';
  return globalThis.__civgraphUseLocalTileFallback === true
    && (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1');
}

export function renderSourcePanel(els, controller, options = {}) {
  if (!els.sourcePanel) return;
  const query = String(options.query || '').trim().toLowerCase();
  const active = [...controller.layers.values()].filter((record) => !query || sourceSearchText(record.config).includes(query));
  if (!active.length) {
    els.sourcePanel.textContent = controller.layers.size ? 'No active layer sources match that filter.' : 'Load a layer to inspect sources.';
    return;
  }
  els.sourcePanel.innerHTML = active
    .sort((a, b) => a.config.name.localeCompare(b.config.name))
    .map((record) => renderLayerSource(record.config))
    .join('');
  els.sourcePanel.querySelectorAll('[data-copy-link]').forEach((button) => {
    button.addEventListener('click', async () => {
      try {
        await copyText(button.dataset.copyLink || '');
        button.textContent = 'Copied';
      } catch {
        button.textContent = 'Failed';
      }
    });
  });
}

function renderLayerSource(layer) {
  const facts = [
    formatProvider(layer.provider),
    layer.sourceMapId,
    layer.dateEffective || layer.date,
    layer.status
  ].flat().filter(Boolean);
  const credits = (layer.sourceCredits || []).filter(Boolean);
  const references = (layer.references || []).map((ref, index) => ({
    type: ref.type || 'reference',
    label: ref.label || `Reference ${index + 1}`,
    href: ref.url || ref.file,
    note: ref.note || ref.description,
    accessed: ref.accessed || ref.accessDate
  }));
  const downloads = (layer.sourceDownloads || []).map((download, index) => ({
    type: download.kind || 'download',
    label: download.label || `Download ${index + 1}`,
    href: download.file || download.url,
    note: download.note || download.description
  }));
  const fallbackIsLocalOnly = isLocalTestTileTemplate(layer.tilesFallback) && !localTestTilesAvailable();
  const technical = [
    layer.metadataUrl ? { type: 'metadata', label: 'Tile metadata', href: layer.metadataUrl } : null,
    layer.tileUrl ? { type: 'pmtiles', label: 'PMTiles archive', href: layer.tileUrl } : null,
    layer.tilesFallback && !fallbackIsLocalOnly ? { type: 'fallback', label: 'Directory MVT fallback', href: layer.tilesFallback.replace('/{z}/{x}/{y}.pbf', '/metadata.json') } : null
  ].filter((link) => link?.href);
  const missing = [
    !layer.provider ? 'missing provider' : null,
    !credits.length ? 'missing credits' : null,
    !references.length ? 'no references' : null,
    !downloads.length ? 'no downloads' : null
  ].filter(Boolean);
  return `
    <article class="source-panel__layer">
      <header class="source-panel__header">
        <h3>${escapeHtml(layer.name)}</h3>
        <button type="button" data-copy-link="${escapeHtml(makeLayerHash(layer.id))}" aria-label="Copy ${escapeHtml(layer.name)} share link">Copy layer</button>
      </header>
      <div class="source-panel__badges">
        <span>${escapeHtml(layer.sourceType || 'source')}</span>
        ${layer.tilePackage?.serving ? `<span>${escapeHtml(layer.tilePackage.serving)}</span>` : ''}
        ${layer.fallbackFromPmtiles ? '<span>PMTiles fallback active</span>' : ''}
        ${fallbackIsLocalOnly ? '<span>local fallback not deployed</span>' : ''}
        ${missing.map((item) => `<span class="source-panel__badge--missing">${escapeHtml(item)}</span>`).join('')}
      </div>
      ${facts.length ? `<p>${escapeHtml(facts.join(' - '))}</p>` : ''}
      ${layer.description ? `<p>${escapeHtml(layer.description)}</p>` : ''}
      ${credits.length ? `<p>${escapeHtml(`Credit: ${credits.join(', ')}`)}</p>` : ''}
      ${renderLinkGroup('References', references, true, 'No source references are recorded for this map.')}
      ${renderLinkGroup('Downloads', downloads, true, 'No source downloads are recorded for this map.')}
      ${renderLinkGroup('Tiles', technical, true, 'No tile/package links are recorded for this map.')}
    </article>
  `;
}

function renderLinkGroup(title, links, open = false, emptyText = '') {
  if (!links.length) return `
    <details class="source-panel__group source-panel__group--empty" ${open ? 'open' : ''}>
      <summary>${escapeHtml(title)} <span>0</span></summary>
      <p>${escapeHtml(emptyText)}</p>
    </details>
  `;
  const sorted = [...links].sort((a, b) => String(a.label || '').localeCompare(String(b.label || '')));
  return `
    <details class="source-panel__group" ${open ? 'open' : ''}>
      <summary>${escapeHtml(title)} <span>${links.length}</span></summary>
      <div>${sorted.map((link) => `
        <span class="source-panel__link-row">
          <b>${escapeHtml(link.type || 'link')}</b>
          <span class="source-panel__citation">
            <a href="${escapeHtml(link.href)}" target="_blank" rel="noopener">${escapeHtml(link.label)}</a>
            ${link.note ? `<small>${escapeHtml(link.note)}</small>` : ''}
            ${link.accessed ? `<small>Accessed ${escapeHtml(link.accessed)}</small>` : ''}
          </span>
          <button type="button" data-copy-link="${escapeHtml(link.href)}" aria-label="Copy ${escapeHtml(link.label)} link">Copy</button>
        </span>
      `).join('')}</div>
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

function formatProvider(provider) {
  if (Array.isArray(provider)) return provider.join(', ');
  return provider || '';
}

function makeLayerHash(layerId) {
  const url = new URL(location.href);
  url.hash = `layers=${encodeURIComponent(layerId)}`;
  return url.toString();
}
