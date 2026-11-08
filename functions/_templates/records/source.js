/**
 * The server-rendered source page: /browse/sources/<slug>, from the browse_sources record.
 */
import { html } from '../../../packages/core/src/html.js';
import { dateText, numberText, safeUrl } from '../../../packages/core/src/format.js';
import { badges, citations, facts, link } from '../components/index.js';

const asList = (value) => (Array.isArray(value) ? value : value ? [value] : []).filter(Boolean);

function licenceText(licence) {
  if (!licence) return '';
  if (typeof licence === 'string') return licence;
  return [licence.name || licence.status, licence.note].filter(Boolean).join(': ');
}

/** Where a related record lives on the site, when that is known. */
function relatedHref(item) {
  const id = encodeURIComponent(item.slug || item.id || '');
  if (!id) return '';
  if (item.kind === 'browse-source') return `/browse/sources/${id}`;
  if (item.kind === 'browse-map') return `/browse/maps/${id}`;
  return '';
}

/**
 * @param {any} record
 * @param {{ canonical?: string }} [options]
 */
export function sourceBody(record, { canonical } = {}) {
  const title = record.title || record.slug;
  const providers = asList(record.provider);
  const viewport = record.viewport || {};
  const links = [
    { label: 'The source, at its publisher', url: record.url },
    viewport.canonicalDatasetUrl && viewport.canonicalDatasetUrl !== record.url ? { label: 'The dataset page', url: viewport.canonicalDatasetUrl } : null,
    viewport.waybackUrl ? { label: 'Copies in the Internet Archive', url: viewport.waybackUrl } : null,
  ].filter((item) => item && safeUrl(item.url));

  const body = html`
<header class="cg-record-header">
<p class="cg-kicker">Source</p>
<h1>${title}</h1>
${record.subtitle ? html`<p class="cg-lede">${record.subtitle}</p>` : ''}
${badges(asList(record.statusChips))}
</header>
${record.description ? html`<p>${record.description}</p>` : ''}
${record.shortCitation ? html`<blockquote class="cg-citation-block"><p>${record.shortCitation}</p></blockquote>` : ''}
${facts([
    { label: 'Category', value: record.category },
    { label: 'Published by', value: providers.join(', ') },
    { label: 'Date', value: record.date ? dateText(record.date) : '' },
    { label: 'Licence', value: licenceText(record.license) },
    { label: 'Status', value: record.status },
    { label: 'Part of', value: record.parentTitle },
    { label: 'Filed under', value: asList(record.sourceHierarchy).join(' › ') },
    { label: 'Cited by', value: record.referenceCount ? `${numberText(record.referenceCount)} ${record.referenceCount === 1 ? 'record' : 'records'}` : '' },
    { label: 'Keywords', value: asList(record.keywords).join(', ') },
  ])}
${record.interactiveUrl ? html`<p><a class="cg-button cg-button--primary" href="${safeUrl(record.interactiveUrl)}">Open on the map</a></p>` : ''}
${links.length ? html`<h2 id="links">Links</h2>
${citations(links)}` : ''}
${record.relatedRecords?.length ? html`<h2 id="related">Related records</h2>
<ul>${record.relatedRecords.map((item) => html`<li>${relatedHref(item) ? link(relatedHref(item), item.title || item.id) : item.title || item.id}</li>`)}</ul>` : ''}
${record.mergedFrom?.length ? html`<h2 id="merged">Also catalogued as</h2>
<ul>${record.mergedFrom.map((item) => html`<li>${item.title || item.slug || item.id}</li>`)}</ul>` : ''}
`;

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'CreativeWork',
    name: title,
    ...(canonical ? { url: canonical } : {}),
    ...(record.description ? { description: record.description } : {}),
    ...(providers.length ? { publisher: providers.map((name) => ({ '@type': 'Organization', name })) } : {}),
    ...(/^\d{4}/.test(String(record.date || '')) ? { datePublished: String(record.date) } : {}),
    ...(safeUrl(record.url) ? { sameAs: [record.url] } : {}),
  };
  return { body, jsonLd };
}
