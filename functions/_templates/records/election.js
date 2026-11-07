/**
 * Server-rendered election pages (data design stage D.8, frontend-plan F3b), from the records
 * tables: an election (its contests), its overall results (seats and votes by party), and one
 * contest (candidates and votes). The loader reads D1 once per page; templates never query.
 */
import { html } from '../../_lib/html.js';
import { dateText, numberText, percentText } from '../../_lib/format.js';
import { badges, dataTable, facts, link, partyChip } from '../components/index.js';
import { parseJson, withoutMarkers } from '../../_api/_records.js';
import { asStore } from '../../../packages/storage/src/d1.js';
import { ELECTION_PAGES } from '../../_lib/queries/pages.js';

const elected = (v) => v === 1 || v === true;

/** Everything one election page needs, or null. `meta` is lookupElection's answer for the slug. */
export async function loadElectionPage(source, meta) {
  if (!meta?.electionKey) return null;
  const db = asStore(source);
  const e = await db.first(ELECTION_PAGES.election, [meta.electionKey]);
  if (!e) return null;
  const election = { ...e, meta: withoutMarkers(parseJson(e.meta, {})) };
  if (Number.isInteger(meta.contestSeq)) {
    const [contest, candidates] = await Promise.all([
      db.first(ELECTION_PAGES.contest, [e.key, meta.contestSeq]),
      db.all(ELECTION_PAGES.candidates, [e.key, meta.contestSeq]),
    ]);
    const provenance = contest?.sourceFile
      ? await db.all(ELECTION_PAGES.citations, [String(contest.sourceFile).replace(/^data\/elections-source\/data\/elections\//, '')])
      : [];
    return { kind: 'contest', election, contest, candidates, citations: provenance };
  }
  const contests = await db.all(ELECTION_PAGES.contests, [e.key]);
  return { kind: /-overall-results$/.test(meta.slug) ? 'overall' : 'election', election, contests };
}

function personLink(row) {
  return row.personId ? link(`/browse/persons/${encodeURIComponent(row.personId)}`, row.name) : row.name;
}

/**
 * @param {any} page
 * @param {{ canonical?: string }} [options]
 */
export function electionBody(page, { canonical } = {}) {
  const { election } = page;
  const base = `/browse/elections/${election.slug}`;
  const header = html`<header class="cg-record-header">
<p class="cg-kicker">${page.kind === 'contest' ? 'Election contest' : 'Election'}</p>
<h1>${page.kind === 'contest' ? `${page.contest.name}` : election.title}</h1>
${page.kind === 'contest' ? html`<p class="cg-lede">${link(base, election.title)}</p>` : ''}
${badges([election.kind, election.votingSystem].filter(Boolean))}
</header>`;
  let body;
  if (page.kind === 'contest') {
    const { contest, candidates } = page;
    const rows = candidates.map((c) => ({
      className: elected(c.elected) ? 'cg-elected' : null,
      cells: [
        personLink(c),
        partyChip(c.party || '', c.colour),
        c.partyAsPrinted && c.partyAsPrinted !== c.party ? c.partyAsPrinted : '',
        c.firstPrefs === null ? '' : numberText(c.firstPrefs),
        elected(c.elected) ? html`<span class="cg-elected-mark" aria-hidden="true">&#10003;</span> ${c.status || 'Elected'}` : c.status || '',
      ],
    }));
    body = html`${facts([
      { label: 'Date', value: election.date ? dateText(election.date) : '' },
      { label: 'Seats', value: contest.seatsTotal ? numberText(contest.seatsTotal) : '' },
      { label: 'Electorate', value: contest.electorate ? numberText(contest.electorate) : '' },
      { label: 'Quota', value: contest.quota ? numberText(contest.quota) : '' },
      { label: 'Turnout', value: contest.turnoutPct ? percentText(contest.turnoutPct) : '' },
    ])}
${dataTable({ caption: 'Candidates', label: 'Candidates', columns: [{ label: 'Candidate', rowHeader: true }, { label: 'Party' }, { label: 'As printed' }, { label: 'Votes', num: true }, { label: 'Result' }], rows })}
${page.citations.length ? html`<h2 id="sources">Sources</h2><ol class="cg-citations">${page.citations.map((s) => html`<li>${link(s.url, s.title || s.url)}${s.publisher ? html` – ${s.publisher}` : ''}</li>`)}</ol>` : ''}
<p>${link(`/maps/#layers=election-${election.slug}`, 'Open the election on the map')}</p>`;
  } else {
    const rows = page.contests.map((k) => [
      link(`${base}-${k.slug}`, k.name),
      k.seatsTotal ? numberText(k.seatsTotal) : '',
      k.winnerName || '',
      k.winnerParty || '',
    ]);
    body = html`${facts([
      { label: 'Body', value: election.body },
      { label: 'Date', value: election.date ? dateText(election.date) : '' },
      { label: 'Contests', value: numberText(page.contests.length) },
    ])}
${election.meta.description ? html`<p>${election.meta.description}</p>` : ''}
${dataTable({ caption: 'Contests', label: 'Contests', columns: [{ label: 'Contest', rowHeader: true }, { label: 'Seats', num: true }, { label: 'Winner' }, { label: 'Winner\'s party' }], rows })}
<p>${link(`/maps/#layers=election-${election.slug}`, 'Open the election on the map')}</p>`;
  }
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Event',
    name: page.kind === 'contest' ? `${page.contest.name} – ${election.title}` : election.title,
    ...(canonical ? { url: canonical } : {}),
    ...(election.date ? { startDate: election.date } : {}),
    ...(election.body ? { organizer: { '@type': 'Organization', name: election.body } } : {}),
  };
  return { body: html`${header}${body}`, jsonLd };
}
