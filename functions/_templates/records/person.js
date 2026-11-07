/**
 * The server-rendered person page: /browse/persons/<slug>.
 *
 * Reads only the browse_persons record (the JSON the Browse app renders from), so this page
 * and the client show the same facts. Everything is in the HTML; nothing needs JavaScript.
 */
import { html } from '../../_lib/html.js';
import { dateText, numberText, percentText, slugify, yearSpan } from '../../_lib/format.js';
import { badges, citations, dataTable, facts, link, notice } from '../components/index.js';

const counted = (rows) => (rows || [])
  .filter((row) => row?.name)
  .map((row) => (row.count > 1 ? `${row.name} (${numberText(row.count)})` : row.name))
  .join(', ');

/** The election page and the contest page a candidacy belongs to. */
export function candidacyLinks(row) {
  if (!row?.key) return { election: '', contest: '' };
  const election = `/browse/elections/${slugify(row.key)}`;
  let place = row.constituency ? slugify(row.constituency) : '';
  if (place === 'northern-ireland' && /^northern-ireland-forum/.test(row.key)) place = 'regional-list';
  return { election, contest: place ? `${election}-${place}` : '' };
}

function candidacyRows(record) {
  return (record.elections || []).map((row) => {
    const links = candidacyLinks(row);
    const party = row.partyAsPrinted && row.partyAsPrinted !== row.party
      ? html`${row.party || ''} <span class="cg-muted">(printed: ${row.partyAsPrinted})</span>`
      : row.party || '';
    const result = row.elected
      ? html`<span class="cg-elected-mark" aria-hidden="true">&#10003;</span> ${row.status || 'Elected'}`
      : row.status || '';
    return {
      className: row.elected ? 'cg-elected' : null,
      cells: [
        row.date ? dateText(row.date) : row.year || '',
        links.election ? link(links.election, row.title || row.key) : row.title || '',
        links.contest && row.constituency ? link(links.contest, row.constituency) : row.constituency || '',
        party,
        numberText(row.firstPrefs),
        percentText(row.share),
        result,
      ],
    };
  });
}

function sourceItems(record) {
  const items = [];
  for (const p of record.officialProfiles || []) items.push({ label: p.label || p.source, url: p.url, licence: p.licence });
  for (const h of record.historyOfParliament || []) items.push({ label: [h.title, h.heading].filter(Boolean).join(': '), url: h.url, note: h.edition });
  for (const f of record.formalNames || []) if (f.source) items.push({ label: f.source, url: f.url, note: `formal name ${f.name}` });
  if (record.bornSource) items.push({ label: record.bornSource, note: 'date of birth' });
  if (record.diedSource && record.diedSource !== record.bornSource) items.push({ label: record.diedSource, note: 'date of death' });
  return items;
}

/**
 * @param {object} record  a browse_persons record
 * @returns {{ body: import('../../_lib/html.js').SafeHtml, jsonLd: object }}
 */
/**
 * @param {any} record
 * @param {{ canonical?: string }} [options]
 */
export function personBody(record, { canonical } = {}) {
  const name = record.name || record.title || record.slug;
  const totals = record.totals || {};
  const stood = Number(totals.stood) || (record.elections || []).length;
  const elected = Number(totals.elected) || 0;
  const wikidataUrl = record.wikidata ? `https://www.wikidata.org/wiki/${encodeURIComponent(record.wikidata)}` : '';

  const body = html`
<header class="cg-record-header">
<p class="cg-kicker">Person</p>
<h1>${name}</h1>
${record.subtitle ? html`<p class="cg-lede">${record.subtitle}</p>` : ''}
${badges([
    stood ? `${numberText(stood)} ${stood === 1 ? 'contest' : 'contests'}` : '',
    elected ? { label: `elected ${numberText(elected)} ${elected === 1 ? 'time' : 'times'}`, tone: 'success' } : '',
  ])}
</header>
${record.spanImplausible || record.reviewNote ? notice({ title: 'This record may combine more than one person', body: record.reviewNote || 'Its candidacies span longer than a career.', tone: 'warning' }) : ''}
${facts([
    { label: 'Born', value: record.born ? dateText(record.born) : '' },
    { label: 'Died', value: record.died ? dateText(record.died) : '' },
    { label: 'Parties', value: counted(record.parties) },
    { label: 'Constituencies', value: counted(record.constituencies) },
    { label: 'Bodies', value: (record.bodies || []).join(', ') },
    { label: 'Years', value: yearSpan(record.firstYear, record.lastYear) },
    { label: 'First preferences', value: totals.firstPrefs ? numberText(totals.firstPrefs) : '' },
    { label: 'Formal names', value: (record.formalNames || []).map((f) => f.name).filter(Boolean).join('; ') },
    { label: 'Also known as', value: (record.knownAliases || []).join('; ') },
    { label: 'Also stood as', value: (record.alsoStoodAs || []).join('; ') },
    { label: 'Wikidata', value: wikidataUrl ? link(wikidataUrl, record.wikidata) : '' },
  ])}
${record.interactiveUrl ? html`<p><a class="cg-button cg-button--primary" href="${record.interactiveUrl}">Open the latest election on the map</a></p>` : ''}
${record.elections?.length ? html`<h2 id="candidacies">Candidacies</h2>
${dataTable({
    label: 'Candidacies',
    className: 'cg-table--sticky-first',
    columns: [
      { label: 'Date', rowHeader: true }, { label: 'Election' }, { label: 'Constituency' }, { label: 'Party' },
      { label: 'First preferences', num: true }, { label: 'Share', num: true }, { label: 'Result' },
    ],
    rows: candidacyRows(record),
  })}` : ''}
${record.officesHeld?.length ? html`<h2 id="offices">Offices held</h2>
${dataTable({
    label: 'Offices held',
    columns: [{ label: 'Office', rowHeader: true }, { label: 'From' }, { label: 'To' }, { label: 'Source' }],
    rows: record.officesHeld.map((o) => [o.office, o.start ? dateText(o.start) : '', o.end ? dateText(o.end) : '', o.source || '']),
  })}` : ''}
${record.seatsHeld?.length ? html`<h2 id="seats">Seats held</h2>
${dataTable({
    label: 'Seats held',
    columns: [{ label: 'Constituency', rowHeader: true }, { label: 'Dates' }, { label: 'Source' }],
    rows: record.seatsHeld.map((s) => [s.constituency, s.dates || '', s.source ? link(s.source, 'History of Parliament') : '']),
  })}` : ''}
${record.relatives?.length ? html`<h2 id="relatives">Relatives</h2>
<ul>${record.relatives.map((r) => html`<li>${r.relation ? html`${r.relation}: ` : ''}${r.slug ? link(`/browse/persons/${encodeURIComponent(r.slug)}`, r.name || r.slug) : r.name}${r.source ? html` <span class="cg-muted">(${r.source})</span>` : ''}</li>`)}</ul>` : ''}
${sourceItems(record).length ? html`<h2 id="sources">Sources</h2>
${citations(sourceItems(record))}` : ''}
`;

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Person',
    name,
    ...(canonical ? { url: canonical } : {}),
    ...(record.born ? { birthDate: record.born } : {}),
    ...(record.died ? { deathDate: record.died } : {}),
    ...(wikidataUrl ? { sameAs: [wikidataUrl] } : {}),
  };
  return { body, jsonLd };
}
