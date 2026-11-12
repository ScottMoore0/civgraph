// The Independent PRONI Search record page as HTML: one module for the browser app
// (site/apps/proni-search/app.js, which imports it at /pkg/ui/src/templates/proni/record-view.js,
// packages/served.json) and the server, which renders /proni/<reference> before any script runs (packages/api/src/
// handlers/proni/page.js). Both write the same markup, so the app keeps the server's page on load
// rather than drawing it again. Pure string functions: no DOM, no fetch.
import { escapeHtml } from '../../../../core/src/html.js';
/**
 * The record answer of /_api/proni/node (node.js loadNode); the server's has `childCount`.
 * @typedef {import('../../../../types/index.js').ApiV1.ProniNodeNodeAnswer & { childCount?: number }} ProniNodeAnswer
 */
/**
 * The sibling navigation node.js sends with a record (`nav`; the v1 contract leaves it open).
 * @typedef {{ parent?: string, first?: string | null, last?: string | null, prev?: string | null, next?: string | null, total?: number, position?: number }} ProniSiblingNav
 */
/**
 * A record's Extracted Dates (node.js `item.extractedDates`, Civgraph's Additional Data).
 * @typedef {{ display: string, startYear?: number | null, endYear?: number | null, circa: boolean, estimated: boolean, bound: string, undated: boolean }} ProniExtractedDates
 */

/** How many children the record page lists. */
export const CHILD_CAP = 200;

/** HTML-escapes a value: core's escapeHtml (the same five characters, null and undefined as ''). */
export const esc = escapeHtml;
// Clean URL for a reference: /proni/AA/3 — slashes stay as path separators,
// each segment is percent-encoded so spaces/odd chars survive.
export const refToPath = (/** @type {string} */ ref) => '/proni/' + String(ref).split('/').map(encodeURIComponent).join('/');

// The reference widget: heavier ref + copy-to-clipboard on one row, with a
// "View on PRONI eCatalogue" link below. `withLabel` prefixes "PRONI Ref:" (used
// on cards; omitted on the record page where the table row already labels it).
/** @param {string} ref @param {boolean} withLabel */
export function refWidget(ref, withLabel) {
  const rid = esc(ref);
  return `<div class="ps-refwidget">
    <div class="ps-refwidget__row">
      ${withLabel ? '<span class="ps-refwidget__label">PRONI Ref:</span>' : ''}
      <span class="ps-ref">${rid}</span>
      <button type="button" class="ps-copy" data-copy="${rid}" title="Copy reference to clipboard" aria-label="Copy PRONI reference to clipboard">⧉ Copy</button>
      <button type="button" class="ps-copy ps-source" data-ecat="${rid}" title="How to view this record on the official PRONI eCatalogue" aria-label="View this record's source on the official PRONI eCatalogue">↗ Source</button>
    </div>
  </div>`;
}

/** @param {ProniSiblingNav} nav */
export function pager(nav) {
  const btn = (/** @type {string} */ label, /** @type {string | null | undefined} */ target, /** @type {boolean} */ disabled) => disabled || !target
    ? `<span class="ps-pager__btn is-disabled">${label}</span>`
    : `<a class="ps-pager__btn" href="${refToPath(target)}" data-go="${refToPath(target)}">${label}</a>`;
  return `<div class="ps-pager" role="navigation" aria-label="Sibling records">
    ${btn('« First', nav.first, !nav.prev)}
    ${btn('‹ Previous', nav.prev, !nav.prev)}
    <span class="ps-pager__count">[${nav.position || 0} – ${nav.total || 0}]</span>
    ${btn('Next ›', nav.next, !nav.next)}
    ${btn('Last »', nav.last, !nav.next)}
  </div>`;
}

// The levels between this record and the top of the archive, shown vertically
// with each level's title (not just its reference) and linking to that level.
/** @param {ProniNodeAnswer['ancestors'] | undefined} ancestors @param {ProniNodeAnswer['item']} it */
export function levelsNav(ancestors, it) {
  const rows = (ancestors || []).map((a) =>
    `<a class="ps-levels__item" href="${refToPath(a.ref)}" data-go="${refToPath(a.ref)}"><span class="ps-ref">${esc(a.ref)}</span> <span class="ps-levels__t">${esc(a.title || '')}</span></a>`).join('');
  return `<nav class="ps-levels" aria-label="Levels above this record">
    ${rows}
    <span class="ps-levels__current"><span class="ps-ref">${esc(it.ref)}</span> <span class="ps-levels__t">${esc(it.title || '')}</span></span>
  </nav>`;
}

// Qualifier note for an Extracted Date: circa (approximate), estimated
// (supplied by the PRONI cataloguer), or one-sided open-ended bounds.
/** @param {ProniExtractedDates} ed */
export function extractedDateNote(ed) {
  const t = [];
  if (ed.circa) t.push('approximate');
  if (ed.estimated) t.push('cataloguer-supplied');
  if (ed.bound === 'after') t.push('open-ended (on/after)');
  if (ed.bound === 'before') t.push('open-ended (on/before)');
  return t.length ? ` <span class="ps-rec__datetags">(${t.map(esc).join('; ')})</span>` : '';
}

/** @param {string} inner the article's HTML */
export function recordShell(inner) {
  return `<div class="ps-rec__toolbar"><a class="ps-back" href="/proni" data-go="/proni">← Back to search</a></div>
    <article class="ps-rec">${inner}</article>`;
}

/** The record page's "not found" body. @param {string} ref */
export function recordNotFound(ref) {
  return recordShell(`<p class="ps-empty">No record found for reference <b>${esc(ref)}</b>.</p>`);
}

/**
 * The record page: levels above, title, sibling pager, the PRONI fields, Civgraph's Additional
 * Data, and the first CHILD_CAP records within it.
 * @param {ProniNodeAnswer} data
 * @param {{ fmt?: (n: number) => string }} [options] number formatting (the server fixes en-GB)
 */
export function recordHtml(data, { fmt = (n) => n.toLocaleString() } = {}) {
  const it = data.item;
  const nav = /** @type {ProniSiblingNav} */ (data['nav'] || {});
  const digital = it['digitalRecord'] ? 'Digitised - held by PRONI' : '';
  const rows = [
    ['Repository', 'Public Record Office of Northern Ireland'],
    ['PRONI Reference', refWidget(it.ref, false)],
    ['Level', esc(it.level)],
    ['Access', esc(it.access)],
    ['Title', esc(it.title)],
    ['Dates', esc(it.dates)],
    ['Description', it.description ? `<div class="ps-rec__desc">${esc(it.description)}</div>` : ''],
    ['Digital Record', esc(digital)],
  ];
  const table = `<table class="ps-rec__table"><tbody>${
    rows.map(([k, v]) => `<tr><th scope="row">${k}</th><td>${v || ''}</td></tr>`).join('')
  }</tbody></table>`;

  // Civgraph "Additional Data" — a layer on top of the untouched PRONI fields.
  // First field: Extracted Dates (a cleaned/structured reading of the raw Dates).
  const ed = /** @type {ProniExtractedDates | null} */ (it.extractedDates);
  const additional = ed ? `<section class="ps-rec__additional">
    <h3 class="ps-rec__addhead">Additional Data <span class="ps-rec__addtag">by Civgraph</span></h3>
    <table class="ps-rec__table"><tbody>
      <tr><th scope="row">Extracted Dates</th><td>${esc(ed.display || 'Undated')}${extractedDateNote(ed)}</td></tr>
    </tbody></table>
  </section>` : '';

  const kids = data.children || [];
  const total = typeof data.childCount === 'number' ? data.childCount : kids.length;
  const childList = total ? `<section class="ps-rec__children">
    <h3>Records within ${esc(it.ref)} <span class="ps-rec__count">(${fmt(total)})</span></h3>
    <ul>${kids.slice(0, CHILD_CAP).map((c) => `<li><a href="${refToPath(c.ref)}" data-go="${refToPath(c.ref)}"><span class="ps-ref">${esc(c.ref)}</span> ${esc(c.title || '')}</a></li>`).join('')}
      ${total > CHILD_CAP ? `<li class="ps-rec__morenote">…and ${fmt(total - CHILD_CAP)} more. Use search to find a specific record.</li>` : ''}</ul>
  </section>` : '';

  return `
    <div class="ps-rec__toolbar">
      <a class="ps-back" href="/proni" data-go="/proni">← Back to search</a>
      ${levelsNav(data.ancestors, it)}
    </div>
    <article class="ps-rec">
      <h2 class="ps-rec__title">${esc(it.title || it.ref)}</h2>
      ${pager(nav)}
      ${table}
      ${additional}
      ${pager(nav)}
      ${childList}
    </article>`;
}
