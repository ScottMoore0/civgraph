/**
 * The server-rendered party page: /browse/parties/<slug>, from party_cards.detail (the
 * details/parties/<slug>.json item, now a D1 row): summary, names it was printed as, and the
 * elections it contested.
 */
import { html } from '../../../packages/core/src/html.js';
import { dateText, numberText, yearSpan } from '../../../packages/core/src/format.js';
import { dataTable, facts, link, partyChip } from '../components/index.js';

const names = (record) => [...new Set([...(record.observedNames || []), ...(record.knownAliases || [])].map(String))]
  .filter((n) => n && n !== record.title);

/**
 * @param {any} record
 * @param {{ canonical?: string }} [options]
 */
export function partyBody(record, { canonical } = {}) {
  const title = record.title || record.canonicalName || record.slug;
  const totals = record.totals || {};
  const elections = (record.relatedElections || []).slice(0, 400);
  const rows = elections.map((e) => [
    e.date ? dateText(e.date) : e.year || '',
    e.key ? link(`/browse/elections/${String(e.key).replace(/__/g, '-')}`, e.title || e.key) : e.title || '',
    e.candidates !== undefined ? numberText(e.candidates) : '',
    e.elected !== undefined ? numberText(e.elected) : '',
  ]);
  const body = html`<header class="cg-record-header">
<p class="cg-kicker">Party / label</p>
<h1>${partyChip(title, record.colour)}</h1>
${record.subtitle ? html`<p class="cg-lede">${record.subtitle}</p>` : ''}
</header>
${facts([
    { label: 'Short name', value: record.shortName },
    { label: 'Years', value: yearSpan(record.firstYear, record.lastYear) },
    { label: 'Candidacies', value: totals.candidates !== undefined ? numberText(totals.candidates) : (record.occurrenceCount ? numberText(record.occurrenceCount) : '') },
    { label: 'Elected', value: totals.elected !== undefined ? numberText(totals.elected) : '' },
    { label: 'Also printed as', value: names(record).slice(0, 40).join(', ') },
  ])}
${record.interactiveUrl ? html`<p>${link(record.interactiveUrl, 'Open on the map')}</p>` : ''}
${dataTable({ caption: 'Elections contested', label: 'Elections contested', columns: [{ label: 'Date' }, { label: 'Election', rowHeader: true }, { label: 'Candidates', num: true }, { label: 'Elected', num: true }], rows })}`;
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'PoliticalParty',
    name: title,
    ...(canonical ? { url: canonical } : {}),
    ...(record.shortName ? { alternateName: record.shortName } : {}),
  };
  return { body, jsonLd };
}
