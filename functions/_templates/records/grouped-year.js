/**
 * The Browse page of a grouped local-election year: /browse/elections/ni-local-1946 (Northern
 * Ireland's council elections of a year, from 1921) and /browse/elections/ireland-local-1911 (the
 * island's, before 1921). A year is not an election in r_elections: it is a list of council
 * rounds (src/ni-local-groups.mjs), so the page is made from the year's own data:
 *
 *   the Browse card       D1 election_cards (title, description, map link), by slug
 *   the year file         /render/metadata/ni-local/<year>.json (its rounds, their completeness,
 *                         the rounds missing or held back), a committed static file
 *   the coverage file     /render/metadata/ni-local-coverage.json (the hatched areas per level)
 *
 * The hero carries the whole summary, server-rendered: the rounds with a link to each round's
 * own page, the completeness and hatching lines, and the map link. The Browse client replaces
 * the hero with its own rendering when it runs, so nothing is shown twice.
 */
import { html } from '../../_lib/html.js';
import { dateText, numberText, slugify } from '../../_lib/format.js';

/** ni-local-1946, ni-local__1946, ireland-local-1911, ireland-local__1911. */
export const GROUPED_YEAR = /^(ni-local|ireland-local)(?:-|__)(\d{4})$/;

export function groupedYearKey(slug) {
  const m = GROUPED_YEAR.exec(String(slug || '').toLowerCase());
  return m ? { key: `${m[1]}__${m[2]}`, slug: `${m[1]}-${m[2]}`, year: Number(m[2]) } : null;
}

const LEVELS = [
  ['ded', 'wards and DEDs'],
  ['ced', 'county electoral divisions'],
  ['towns', 'towns'],
  ['districts', 'districts'],
  ['counties', 'counties'],
];

const plural = (n, one, many) => `${numberText(n)} ${n === 1 ? one : many}`;

/** The round's own page: its key with "__" made "-", as every election slug. */
export const roundHref = (key) => `/browse/elections/${encodeURIComponent(slugify(key))}`;

/**
 * The hero's markup.
 * @param {object} p
 * @param {object} p.card       the year's Browse card (election_cards.card)
 * @param {object} [p.yearFile] /render/metadata/ni-local/<year>.json
 * @param {object} [p.coverage] the year's entry in ni-local-coverage.json
 */
export function groupedYearHero({ card, yearFile = null, coverage = null }) {
  const rounds = Array.isArray(yearFile?.rounds) ? yearFile.rounds : [];
  const missing = Array.isArray(yearFile?.missing) ? yearFile.missing : [];
  const partial = rounds.filter((r) => r.status && r.status !== 'complete');
  const contests = rounds.reduce((n, r) => n + (Array.isArray(r.contests) ? r.contests.length : 0), 0);
  const heldBack = missing.filter((m) => /held back/i.test(m.reason || '')).length;

  const summary = rounds.length ? [
    `${plural(rounds.length, 'council round', 'council rounds')}${contests ? `, ${plural(contests, 'contest', 'contests')}` : ''}`,
    `${numberText(rounds.length - partial.length)} complete, ${numberText(partial.length)} partial`,
    missing.length ? `${plural(missing.length, 'round', 'rounds')} not yet available${heldBack ? ` (${numberText(heldBack)} held back in review)` : ''}` : '',
  ].filter(Boolean).join('; ') : '';

  const levels = coverage?.levels || {};
  const hatched = LEVELS
    .filter(([id]) => levels[id]?.available && Number(levels[id]?.hatched) > 0)
    .map(([id, label]) => (Number(levels[id].areas) > 0
      ? `${numberText(levels[id].hatched)} of ${numberText(levels[id].areas)} ${label}`
      : `${numberText(levels[id].hatched)} ${label}`));

  const mapUrl = card.interactiveUrl || '';
  const roundItems = rounds.map((r) => {
    const status = r.status && r.status !== 'complete'
      ? html` <span class="browse-note">(${r.status}${r.note ? `: ${r.note}` : ''})</span>`
      : '';
    const when = r.date ? ` ${/^\d{4}-\d{2}-\d{2}$/.test(r.date) ? dateText(r.date) : r.date}` : '';
    return html`<li><a href="${roundHref(r.key)}">${r.body || r.key}</a>${when}${status}</li>`;
  });

  return html`<p class="browse-kicker">Election</p>
<h1 class="browse-title">${card.title}</h1>
${card.description ? html`<p class="browse-description">${card.description}</p>` : ''}
${summary ? html`<p class="browse-note browse-completeness-note" role="note">${summary}.</p>` : ''}
${hatched.length ? html`<p class="browse-note">Hatched on the map, where results are not available or incomplete: ${hatched.join(', ')}.</p>` : ''}
${mapUrl ? html`<p><a href="${mapUrl}">Open the year on the map</a></p>` : ''}
${roundItems.length ? html`<h2>Council rounds</h2><ul class="browse-year-rounds">${roundItems}</ul>` : ''}`;
}
