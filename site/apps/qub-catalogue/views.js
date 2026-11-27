/**
 * The Independent QUB Catalogue's markup: pure string functions (no DOM, no fetch), so
 * tests/unit/qub-app.test.mjs checks them and app.js only puts them on the page (rule R12).
 * Every record row and record page links to the record in QUB's catalogue: the condition of
 * QUB's metadata reuse policy.
 */
import { escapeHtml as esc } from '../../pkg/core/src/html.js';
import { siteNumber } from '../../pkg/core/src/format.js';
import { recordPath } from './url-state.js';

/** @typedef {import('./api.js').ResultRow} ResultRow */
/** @typedef {import('./api.js').RecordAnswer} RecordAnswer */
/** @typedef {import('./api.js').StatsAnswer} StatsAnswer */

/** Topic names by letter, from the stats answer (the server's one list, _query.js QUB_TAGS). */
/** @type {Map<string, string>} */
const TAG_NAMES = new Map();
/** @param {StatsAnswer['tags']} tags */
export function setTagNames(tags) {
  for (const t of tags) TAG_NAMES.set(t.tag, t.name);
}
/** @param {string} tag */
export const tagName = (tag) => TAG_NAMES.get(tag) || tag;

/** @param {string[]} tags */
export const tagChips = (tags) => tags.map((t) => `<span class="qc-tag" title="${esc(tagName(t))}">${esc(t)} <span class="qc-tag__name">${esc(tagName(t))}</span></span>`).join('');

/** @param {boolean} inScope */
export const scopeBadge = (inScope) => (inScope
  ? '<span class="qc-scope qc-scope--in">Within Civgraph scope</span>'
  : '<span class="qc-scope qc-scope--out">Outside of Civgraph scope</span>');

/**
 * One result card.
 * @param {ResultRow} r
 */
export function resultCard(r) {
  const meta = [r.author, r.imprint || (r.year ? String(r.year) : '')].filter(Boolean).map(esc).join(' · ');
  return `<li class="qc-result">
    <a class="qc-result__title" href="${esc(recordPath(r.mmsId))}" data-go="${esc(recordPath(r.mmsId))}">${esc(r.title)}</a>
    ${meta ? `<div class="qc-result__meta">${meta}</div>` : ''}
    <div class="qc-result__foot">${scopeBadge(r.inScope)}${tagChips(r.tags)}
      <a class="qc-result__qub" href="${esc(r.qubUrl)}" target="_blank" rel="noopener">QUB catalogue record ↗</a></div>
  </li>`;
}

/**
 * The line above the results.
 * @param {number | null} total
 * @param {boolean} capped
 * @param {string} scope
 */
export function summaryLine(total, capped, scope) {
  if (total === null) return '';
  if (total === 0) return 'No records match.';
  const n = `${capped ? 'More than ' : ''}${siteNumber(total)}`;
  const which = scope === 'in' ? ' within Civgraph scope' : scope === 'out' ? ' outside of Civgraph scope' : '';
  return `${n} record${total === 1 && !capped ? '' : 's'}${which}`;
}

/**
 * The home figures and the topic filter's counts.
 * @param {StatsAnswer} s
 */
export function statsHtml(s) {
  return `<p class="qc-stats">${siteNumber(s.total)} records in the QUB Library catalogue snapshot (harvested November 2026);
    <strong>${siteNumber(s.inScope)}</strong> within Civgraph scope.</p>`;
}

/**
 * The topic checkboxes.
 * @param {StatsAnswer['tags']} tags
 * @param {string[]} selected
 */
export function tagFilters(tags, selected) {
  return tags.map((t) => `<label class="qc-tagfilter"><input type="checkbox" name="tag" value="${esc(t.tag)}"${selected.includes(t.tag) ? ' checked' : ''}>
    <span class="qc-tag">${esc(t.tag)}</span> ${esc(t.name)} <span class="qc-tagfilter__n">${siteNumber(t.count)}</span></label>`).join('');
}

/** A definition-list row, or '' when empty. @param {string} label @param {string | string[] | null | undefined} value */
function row(label, value) {
  const list = Array.isArray(value) ? value.filter(Boolean) : value ? [value] : [];
  if (!list.length) return '';
  const body = list.length === 1 ? esc(list[0]) : `<ul>${list.map((v) => `<li>${esc(v)}</li>`).join('')}</ul>`;
  return `<div class="qc-field"><dt>${esc(label)}</dt><dd>${body}</dd></div>`;
}

/**
 * The record page.
 * @param {RecordAnswer} a
 */
export function recordHtml(a) {
  const it = a.item;
  const contributors = it.contributors.map((c) => (c.role ? `${c.name} (${c.role})` : c.name));
  const holdings = it.holdings.map((h) => [h.library, h.location, h.callNumber, h.availability].filter(Boolean).join(' · '));
  const online = it.online.map((o) => `<li><a href="${esc(o.url)}" target="_blank" rel="noopener nofollow">${esc(o.label || o.url)}</a></li>`).join('');
  return `<article class="qc-record">
    <p class="qc-back"><a href="/qub" data-back>← Back to search</a></p>
    <h1 class="qc-record__title">${esc(it.title)}</h1>
    ${it.responsibility ? `<p class="qc-record__resp">${esc(it.responsibility)}</p>` : ''}
    <p class="qc-record__qub"><a class="qc-button" href="${esc(a.qubUrl)}" target="_blank" rel="noopener">View this record in QUB Library’s catalogue ↗</a></p>
    <section class="qc-scopebox" aria-label="Civgraph scope">
      ${scopeBadge(it.inScope)} ${tagChips(it.tags)}
      ${it.scopeReason ? `<p class="qc-scopebox__why">${esc(it.scopeReason)} <span class="qc-scopebox__method">(${esc(it.scopeMethod)})</span></p>` : ''}
    </section>
    <dl class="qc-fields">
      ${row('Author', it.author)}
      ${row('Other names', contributors)}
      ${row('Uniform title', it.uniformTitle)}
      ${row('Other titles', it.variantTitles)}
      ${row('Edition', it.edition)}
      ${row('Published', it.imprint)}
      ${row('Date', it.dateText || (it.year ? String(it.year) : ''))}
      ${row('Description', it.extent)}
      ${row('Format', it.format)}
      ${row('Language', it.language)}
      ${row('Series', it.series)}
      ${row('Notes', it.notes)}
      ${row('Contents', it.contents)}
      ${row('Summary', it.summary)}
      ${row('Subjects', it.subjects)}
      ${row('Places', it.places)}
      ${row('ISBN', it.isbn)}
      ${row('ISSN', it.issn)}
      ${row('Government document number', it.govDocNumber)}
      ${row('Library of Congress class', it.lcClass)}
      ${row('Dewey class', it.dewey)}
      ${row('Shelf mark', it.shelfMark)}
      ${row('Held at QUB', holdings)}
      ${row('MMS ID', it.mmsId)}
    </dl>
    ${online ? `<section class="qc-online"><h2>Online</h2><ul>${online}</ul></section>` : ''}
    <footer class="qc-credit">
      <p>${esc(a.credit)}</p>
      ${a.sharedSource ? '<p>This record derives at least in part from a shared cataloguing source (such as OCLC WorldCat).</p>' : ''}
      <p><a href="${esc(a.qubUrl)}" target="_blank" rel="noopener">The record in QUB Library’s catalogue</a> is the authoritative version.</p>
    </footer>
  </article>`;
}

/** The record page for an id the catalogue does not hold. @param {string} id */
export const recordMissing = (id) => `<article class="qc-record"><p class="qc-back"><a href="/qub" data-back>← Back to search</a></p>
  <h1 class="qc-record__title">Record not found</h1><p>The QUB catalogue snapshot holds no record ${esc(id)}.</p></article>`;
