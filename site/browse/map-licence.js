/**
 * The "Licence and sources" block of a Browse map page: who made the map, its licence (linked
 * to the matching section of Civgraph's Licence page, and to the licence's own terms), the
 * attribution statement the licence asks for, and the credits of the map's sources.
 *
 * The builder (scripts/build/build-browse-indexes.mjs buildMaps, through
 * scripts/lib/map-licence.mjs) puts `licence` ({ name, url?, page }), `licenceNote`,
 * `attribution` and `sourceCredits` on each map record. Pure, so the browse-map-licence unit
 * test holds it; browse.js only places the rows.
 */
import { escapeHtml } from '../pkg/core/src/html.js';

/** The Licence page, where a map with no licence of its own sends the reader. */
export const LICENCE_PAGE = '/pages/licence';

/**
 * @typedef {{ name?: unknown, url?: unknown, page?: unknown }} LicenceFact
 * @typedef {{ provider?: unknown, licence?: LicenceFact | null, licenceNote?: unknown, attribution?: unknown, sourceCredits?: unknown }} MapRightsRecord
 */

/** @param {unknown} value @returns {string} */
function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

/** @param {unknown} value @returns {string[]} */
function list(value) {
  return (Array.isArray(value) ? value : [value]).map(text).filter(Boolean);
}

/** A same-site path or an http(s) address, or '' for anything else. @param {unknown} value */
function safeHref(value) {
  const href = text(value);
  return /^(\/(?!\/)|https?:\/\/)/.test(href) ? href : '';
}

/** @param {string} href @param {string} label */
function link(href, label) {
  const external = /^https?:\/\//.test(href);
  return `<a href="${escapeHtml(href)}"${external ? ' target="_blank" rel="noopener noreferrer"' : ''}>${escapeHtml(label)}</a>`;
}

/**
 * The block's rows, [label, HTML], in reading order. A map that records no licence still gets the
 * Licence row, pointing at the Licence page; the other rows appear only when the map has them.
 * @param {MapRightsRecord} item
 * @returns {[string, string][]}
 */
export function mapLicenceRows(item) {
  /** @type {[string, string][]} */
  const rows = [];
  const credit = list(item.provider);
  if (credit.length) rows.push(['Credit', escapeHtml(credit.join(', '))]);
  const licence = item.licence || null;
  const name = text(licence?.name);
  if (name) {
    const page = safeHref(licence?.page) || LICENCE_PAGE;
    const terms = safeHref(licence?.url);
    rows.push(['Licence', `${link(page, name)}${terms ? ` (${link(terms, 'licence terms')})` : ''}`]);
  } else {
    rows.push(['Licence', link(LICENCE_PAGE, 'Not recorded for this map: see the Licence page')]);
  }
  const note = text(item.licenceNote);
  if (note) rows.push(['Licence note', escapeHtml(note)]);
  const attribution = text(item.attribution);
  if (attribution) rows.push(['Attribution', escapeHtml(attribution)]);
  const sources = list(item.sourceCredits);
  if (sources.length) rows.push(['Sources', escapeHtml(sources.join('; '))]);
  return rows;
}

/**
 * The block as HTML: a heading and the rows as a definition list.
 * @param {MapRightsRecord} item
 */
export function renderMapLicenceBlock(item) {
  const rows = mapLicenceRows(item);
  return `
    <section class="browse-detail__panel browse-map-licence" aria-labelledby="browse-map-licence-title">
      <h2 id="browse-map-licence-title">Licence and sources</h2>
      <dl class="browse-reader-facts">${rows.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${value}</dd></div>`).join('')}</dl>
    </section>
  `;
}
