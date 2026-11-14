/**
 * "Data checked" dates (stream el-tables, 14 Nov 2026). A contest's source carries a date when
 * Civgraph fetched it and compared it with the contest figure by figure: the `accessed` day of
 * the web-check citations (data/elections/web-checked-sources.json, carried into the citations
 * table and given by the citations view as `accessed`). The contest page shows the latest day
 * among the sources that agreed with every figure compared, beside its figures, and each source
 * its own day. Pure (no DOM): tests/unit/elections-app-methods.test.mjs.
 */
import { escapeHtml as esc } from '../../../pkg/core/src/html.js';
import { formatDisplayDate } from '../../../pkg/core/src/date-format.mjs';

/** The fixed words (keys of data/i18n/strings/elections.txt). */
export const CHECKED_TEXT = Object.freeze({
  label: 'Data checked',
  sources: 'see the sources',
  compared: 'Compared on',
});

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The latest day a source that agreed with every compared figure was checked, or null.
 * @param {Array<{ checked?: boolean | number | null, accessed?: string | null }>} citations
 * @returns {string | null}  YYYY-MM-DD
 */
export function latestCheck(citations) {
  let best = null;
  for (const c of citations || []) {
    if (!(c.checked === true || c.checked === 1)) continue;
    const day = String(c.accessed || '');
    if (DAY.test(day) && (best === null || day > best)) best = day;
  }
  return best;
}

/** A day as a <time> element, written the one way Civgraph writes a date. @param {string} day */
export const dayHtml = (day) => `<time datetime="${esc(day)}">${esc(formatDisplayDate(day))}</time>`;

/**
 * The "Data checked" fact of a contest: its term and description (a <dt> and a <dd>), or '' when
 * no checked source carries a day.
 * @param {Parameters<typeof latestCheck>[0]} citations
 * @param {string} [sourcesHref]  where the sources are listed on the page
 */
export function checkedFact(citations, sourcesHref = '#el-sources') {
  const day = latestCheck(citations);
  if (!day) return '';
  return `<dt>${esc(CHECKED_TEXT.label)}</dt><dd data-checked="${esc(day)}">${dayHtml(day)} (<a href="${esc(sourcesHref)}">${esc(CHECKED_TEXT.sources)}</a>)</dd>`;
}

/**
 * One source's own day, for its entry in the list: '' when it carries none.
 * @param {{ accessed?: string | null }} citation
 */
export function comparedOn(citation) {
  const day = String(citation.accessed || '');
  return DAY.test(day) ? ` <span class="el-muted el-compared"><span>${esc(CHECKED_TEXT.compared)}</span> ${dayHtml(day)}</span>` : '';
}
