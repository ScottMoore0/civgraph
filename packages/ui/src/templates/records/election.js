/**
 * Server-rendered election pages (data design stage D.8, frontend-plan F3b), from the records
 * tables: an election (its contests), its overall results (seats and votes by party), and one
 * contest (candidates and votes). The loader (packages/api/src/pages/election.js loadElectionPage)
 * reads D1 once per page; templates never query.
 */
import { html } from '../../../../core/src/html.js';
import { dateText, numberText, percentText, personRecordPath } from '../../../../core/src/format.js';
import { badges, citations, dataTable, facts, link, partyChip } from '../components/index.js';
import { candidateReturnWithoutPoll, isUncontestedResult } from '../../../../core/src/unopposed.mjs';

/**
 * @typedef {import('../../../../api/src/pages/election.js').ElectionPage} ElectionPage
 * @typedef {import('../../../../api/src/pages/election.js').ElectionPageCandidate} ElectionPageCandidate
 * @typedef {import('../../../../api/src/pages/election.js').ElectionPageContest} ElectionPageContest
 */

/** A candidacy's `elected` flag: 1 from D1; true kept for a record built elsewhere. */
const elected = (/** @type {number | boolean | null} */ v) => v === 1 || v === true;

/**
 * A citation of the results as the citations component lists it: its title (or its site, when
 * the provenance names only a URL), linked where it has a URL, with its publisher.
 * @param {{ title?: string | null, publisher?: string | null, url?: string | null, host?: string | null }} c
 * @param {string} [note]
 * @returns {import('../components/index.js').Citation}
 */
export function citationItem(c, note) {
  const url = /^https?:\/\//i.test(String(c.url || '')) ? String(c.url) : undefined;
  const host = c.host || (url ? url.replace(/^https?:\/\/(www\.)?/i, '').split('/')[0] : '');
  const label = String(c.title || '').trim() || host || 'Source';
  const publisher = c.publisher && !label.includes(String(c.publisher)) ? String(c.publisher) : '';
  return { label, url, note: [publisher, note].filter(Boolean).join('; ') || undefined };
}

/** Civgraph's part: it compiled the record from the sources listed, which hold it. */
const COMPILED_NOTE = 'Compiled in Civgraph\u2019s election records from the sources above.';

/** What the votes column says for a seat returned without a poll (never "0"). */
const NO_POLL_LABELS = { unopposed: 'Unopposed', 'auto-returned': 'Returned automatically' };

/** @param {ElectionPageCandidate} c */
function votesCell(c) {
  const noPoll = candidateReturnWithoutPoll(c);
  if (noPoll) return NO_POLL_LABELS[noPoll];
  return c.firstPrefs === null ? '' : numberText(c.firstPrefs);
}

/**
 * A candidate's name, linked to their page by its own slug (no redirect on the way).
 * @param {Pick<ElectionPageCandidate, 'personId' | 'personSlug' | 'name'>} row
 */
function personLink(row) {
  const href = personRecordPath(row);
  return href ? link(href, row.name) : row.name;
}

/**
 * A contest's `contestStatus` ('uncontested' for a ward with no poll), from its stored meta.
 * @param {ElectionPageContest} contest
 */
function contestStatusOf(contest) {
  const meta = /** @type {unknown} */ (contest?.meta);
  if (meta && typeof meta === 'object') return /** @type {{ contestStatus?: unknown }} */ (meta).contestStatus;
  if (typeof meta !== 'string') return undefined;
  try { return JSON.parse(meta)?.contestStatus; } catch { return undefined; }
}

/**
 * A national contest's results by area (the presidential elections by Dáil constituency): the
 * election's area-results geography mode, from its stored meta, as one row an area with who led on
 * first preferences, the leader's share and the turnout. Empty when the election has none.
 * @param {ElectionPage['election']} election
 */
function areaResultsTable(election) {
  const modes = /** @type {unknown} */ (election.meta?.geographyModes);
  const mode = /** @type {{ dataKind?: string, label?: string, results?: Array<{ constituency?: string, leadingName?: string | null, leadingPct?: number | null, turnoutPct?: number | null }> } | undefined} */ (
    Array.isArray(modes) ? modes.find((m) => m?.dataKind === 'area-results') : undefined);
  if (!mode?.results?.length) return '';
  const label = String(mode.label || 'Area');
  const title = `Results by ${label.toLowerCase()}`;
  const rows = mode.results.map((r) => [
    String(r.constituency || ''),
    String(r.leadingName || ''),
    r.leadingPct === null || r.leadingPct === undefined ? '' : percentText(r.leadingPct),
    r.turnoutPct ? percentText(r.turnoutPct) : '',
  ]);
  return html`<h2 id="by-area">${title}</h2>
${dataTable({ caption: title, label: title, columns: [{ label, rowHeader: true }, { label: 'Led on first preferences' }, { label: 'Share', num: true }, { label: 'Turnout', num: true }], rows })}`;
}

/**
 * @param {ElectionPage} page  loadElectionPage's answer
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
    // No poll held: every candidate returned unopposed. No turnout, and a line saying so.
    const uncontested = isUncontestedResult({ contestStatus: contestStatusOf(contest), candidates });
    const rows = candidates.map((c) => ({
      className: elected(c.elected) ? 'cg-elected' : null,
      cells: [
        personLink(c),
        partyChip(c.party || '', c.colour),
        c.partyAsPrinted && c.partyAsPrinted !== c.party ? c.partyAsPrinted : '',
        votesCell(c),
        elected(c.elected) ? html`<span class="cg-elected-mark" aria-hidden="true">&#10003;</span> ${c.status || 'Elected'}` : c.status || '',
      ],
    }));
    body = html`${facts([
      { label: 'Date', value: election.date ? dateText(election.date) : '' },
      { label: 'Seats', value: contest.seatsTotal ? numberText(contest.seatsTotal) : '' },
      { label: 'Electorate', value: contest.electorate ? numberText(contest.electorate) : '' },
      { label: 'Poll', value: uncontested ? 'No poll: returned unopposed' : '' },
      { label: 'Quota', value: contest.quota ? numberText(contest.quota) : '' },
      { label: 'Turnout', value: !uncontested && contest.turnoutPct ? percentText(contest.turnoutPct) : '' },
    ])}
${dataTable({ caption: 'Candidates', label: 'Candidates', columns: [{ label: 'Candidate', rowHeader: true }, { label: 'Party' }, { label: 'As printed' }, { label: 'Votes', num: true }, { label: 'Result' }], rows })}
${page.citations.length ? html`<h2 id="sources">Sources</h2>${citations(page.citations.map((c) => citationItem(c)))}<p class="cg-muted">${COMPILED_NOTE}</p>` : ''}
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
${areaResultsTable(election)}
${page.sources?.length ? html`<h2 id="sources">Sources</h2>${citations(page.sources.map((s) => citationItem(s, page.contests.length > 1 ? `${numberText(s.contests)} of ${numberText(page.contests.length)} contests` : '')))}<p class="cg-muted">${COMPILED_NOTE} Each contest's page lists its own.</p>` : ''}
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
