import { getFeatureLabel } from './labels.js';
import { escapeHtml, formatValue } from './utils.js';

const FIELD_ALIASES = {
  name: 'Name',
  Name: 'Name',
  NAME: 'Name',
  label_name: 'Label',
  name_en: 'English name',
  official_name: 'Official name',
  county: 'County',
  province: 'Province',
  source: 'Source',
  provider: 'Provider',
  year: 'Year',
  date: 'Date'
};

export function renderFeatureDetails(els, selection) {
  if (!selection) {
    els.featureDetails.textContent = 'Click a rendered feature.';
    return;
  }

  const { layer, feature } = selection;
  const props = feature.properties || {};
  const groups = groupProperties(layer, props);
  const sourceHtml = renderFeatureSource(layer);
  const label = getFeatureLabel(layer, props) || layer.name;

  els.featureDetails.innerHTML = `
    <div class="feature-details__header">
      <h3>${escapeHtml(label)}</h3>
      <div class="feature-details__actions">
        <button type="button" data-copy-feature>Copy feature</button>
        <button type="button" data-copy-layer>Copy layer</button>
      </div>
    </div>
    ${sourceHtml}
    ${renderLayerContext(layer)}
    ${renderPrimaryFields(groups.primary)}
    ${renderPropertyGroup('Details', groups.visible)}
    ${renderPropertyGroup('Source context', groups.source)}
    ${renderTechnicalGroup(groups.technical)}
  `;
  els.featureDetails.querySelector('[data-copy-feature]')?.addEventListener('click', async (event) => {
    const url = new URL(location.href);
    url.hash = makeFeatureHash(layer.id, feature.id ?? props[layer.promoteId] ?? props.id);
    try {
      await navigator.clipboard.writeText(url.toString());
      event.currentTarget.textContent = 'Copied';
    } catch {
      event.currentTarget.textContent = 'Failed';
    }
  });
  els.featureDetails.querySelector('[data-copy-layer]')?.addEventListener('click', async (event) => {
    const url = new URL(location.href);
    const params = new URLSearchParams(location.hash.replace(/^#/, ''));
    params.set('layers', [...new Set([...(params.get('layers') || '').split(',').filter(Boolean), layer.id])].join(','));
    url.hash = params.toString();
    try {
      await navigator.clipboard.writeText(url.toString());
      event.currentTarget.textContent = 'Copied';
    } catch {
      event.currentTarget.textContent = 'Failed';
    }
  });
}

function renderFeatureSource(layer) {
  const provider = Array.isArray(layer.provider) ? layer.provider.join(', ') : layer.provider;
  const bits = [provider, layer.sourceMapId].filter(Boolean);
  if (!bits.length) return '';
  return `<p class="feature-details__source">${bits.map(escapeHtml).join(' - ')}</p>`;
}

function groupProperties(layer, props) {
  const orderedKeys = [...new Set([...(layer.popupProperties || []), ...Object.keys(props)])];
  const primary = [];
  const source = [];
  const visible = [];
  const technical = [];
  for (const key of orderedKeys) {
    if (!(key in props)) continue;
    const row = { key, value: props[key] };
    row.label = fieldLabel(layer, key);
    if (isPrimaryKey(layer, key)) primary.push(row);
    else if (isSourceKey(key)) source.push(row);
    else if (isTechnicalKey(key)) technical.push(row);
    else visible.push(row);
  }
  return {
    primary: primary.slice(0, 6),
    visible: visible.slice(0, 18),
    source: source.slice(0, 12),
    technical: [...technical, ...visible.slice(18)]
  };
}

function isPrimaryKey(layer, key) {
  const labelKeys = [
    layer.labelProperty,
    ...(layer.labelProperties || []),
    'name',
    'Name',
    'NAME',
    'label',
    'Label',
    'label_name',
    'name_en',
    'official_name'
  ].filter(Boolean);
  return labelKeys.includes(key) || /^(name|label|title)(_|$)/i.test(key);
}

function isSourceKey(key) {
  return /source|provider|credit|reference|download|date|year|map|sheet|authority|cso|osi|osni/i.test(key);
}

function isTechnicalKey(key) {
  return /^(id|fid|gid|ogc_fid|objectid|globalid|shape|shape_|geom|geometry|bbox|area|length|perimeter|x|y|lat|lon|lng)$/i.test(key)
    || /(_id|_fid|_gid|_area|_length|_perimeter)$/i.test(key);
}

function renderPrimaryFields(rows) {
  if (!rows.length) return '';
  return `
    <div class="feature-details__primary">
      ${rows.map((row) => `
        <div>
          <span>${escapeHtml(row.label || row.key)}</span>
          <strong>${escapeHtml(formatValue(row.value))}</strong>
        </div>
      `).join('')}
    </div>
  `;
}

function renderPropertyGroup(title, rows) {
  if (!rows.length) return '';
  return `
    <section class="feature-details__group">
      <h4>${escapeHtml(title)}</h4>
      <div class="feature-details__table" role="table" aria-label="${escapeHtml(title)} fields">
        ${rows.map((row) => `
          <div role="row">
            <span role="rowheader">${escapeHtml(row.label || row.key)}</span>
            <strong role="cell">${escapeHtml(formatValue(row.value))}</strong>
          </div>
        `).join('')}
      </div>
    </section>
  `;
}

function renderTechnicalGroup(rows) {
  if (!rows.length) return '';
  return `
    <details class="feature-details__technical">
      <summary>Technical fields <span>${rows.length}</span></summary>
      <dl>${renderRows(rows)}</dl>
    </details>
  `;
}

function renderRows(rows) {
  return rows.map((row) => `<dt>${escapeHtml(row.label || row.key)}</dt><dd>${escapeHtml(formatValue(row.value))}</dd>`).join('');
}

function makeFeatureHash(layerId, featureId) {
  const params = new URLSearchParams(location.hash.replace(/^#/, ''));
  if (layerId) params.set('layers', [...new Set([...(params.get('layers') || '').split(',').filter(Boolean), layerId])].join(','));
  if (layerId && featureId !== undefined && featureId !== null && featureId !== '') params.set('selected', `${layerId}:${featureId}`);
  return params.toString();
}

function fieldLabel(layer, key) {
  const aliases = layer.fieldAliases || layer.propertyAliases || {};
  return aliases[key] || FIELD_ALIASES[key] || key
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
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
