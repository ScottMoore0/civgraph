/**
 * The server-rendered register-of-interests entry: /browse/register-interests/<slug>,
 * from the browse_register_interests record.
 *
 * The D1 record carries the entry's summary, categories and counts. The text of each
 * declared interest is still in the static detail shard the Browse app reads
 * (record.detailUrl), so the page says so and links there until D2 loads it into a table.
 */
import { html } from '../../../../core/src/html.js';
import { dateText, numberText } from '../../../../core/src/format.js';
import { badges, facts, link, notice } from '../components/index.js';

const SOURCE_KIND_LABELS = {
  'historical-pdf-register': 'historical register (PDF)',
  'historical-html-register': 'historical register (web page)',
};

function dateRange(record) {
  const start = record.dateStart || record.date;
  const end = record.dateEnd;
  if (!start) return '';
  return end && end !== start ? `${dateText(start)} to ${dateText(end)}` : dateText(start);
}

/**
 * @param {any} record
 * @param {{ canonical?: string }} [options]
 */
export function registerInterestBody(record, { canonical } = {}) {
  const title = record.title || record.memberName || record.slug;
  const member = record.memberName
    ? (record.personSlug ? link(`/browse/persons/${encodeURIComponent(record.personSlug)}`, record.memberName) : record.memberName)
    : '';
  const interests = record.interestCount
    ? `${numberText(record.interestCount)} ${record.interestCount === 1 ? 'entry' : 'entries'}${record.nonNilInterestCount !== undefined ? `, ${numberText(record.nonNilInterestCount)} declaring an interest` : ''}`
    : '';
  const kinds = (record.sourceKinds || [record.sourceKind]).filter(Boolean).map((k) => SOURCE_KIND_LABELS[k] || k);

  const body = html`
<header class="cg-record-header">
<p class="cg-kicker">Register of interests</p>
<h1>${title}</h1>
${badges([record.memberType, record.chamber || record.electedBody, record.isNone ? { label: 'Nothing to declare', tone: 'success' } : ''])}
</header>
${record.description ? html`<p>${record.description}</p>` : ''}
${facts([
    { label: 'Member', value: member },
    { label: 'Member type', value: record.memberType },
    { label: 'Body', value: record.chamber || record.electedBody },
    { label: 'Constituency', value: (record.constituencies || [record.constituency]).filter(Boolean).join(', ') },
    { label: 'Party', value: (record.parties || []).map((p) => (typeof p === 'string' ? p : p?.name)).filter(Boolean).join(', ') },
    { label: 'Date', value: dateRange(record) },
    { label: 'Interests', value: interests },
    { label: 'Sources', value: kinds.length ? `${kinds.join('; ')}${record.sourceCount ? ` (${numberText(record.sourceCount)} rows)` : ''}` : '' },
  ])}
${record.categories?.length ? html`<h2 id="categories">Categories declared</h2>
<ul>${record.categories.map((c) => html`<li>${c}</li>`)}</ul>` : ''}
${notice({ body: html`The full text of each declared interest is in ${link(`/browse/#/register-interests/${encodeURIComponent(record.slug || '')}`, 'the Browse app')}.` })}
`;

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Dataset',
    name: title,
    ...(canonical ? { url: canonical } : {}),
    ...(record.description ? { description: record.description } : {}),
    ...(record.date ? { temporalCoverage: record.dateEnd && record.dateEnd !== record.date ? `${record.dateStart || record.date}/${record.dateEnd}` : record.date } : {}),
  };
  return { body, jsonLd };
}
