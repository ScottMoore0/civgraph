/**
 * Small templates shared by the record pages: facts, data table, citations, notice, badges,
 * party chip. Each returns html`` (escaped by default) and matches a stylesheet in
 * assets/ui/components/.
 */
import { attrs, html } from '../../_lib/html.js';
import { safeUrl } from '../../_lib/format.js';

const present = (value) => value !== null && value !== undefined && value !== '' && value !== false
  && !(Array.isArray(value) && !value.length);

/** A <dl> of record facts; rows whose value is empty are left out. rows: [{ label, value }] */
export function facts(rows) {
  const shown = (rows || []).filter((row) => present(row.value));
  if (!shown.length) return '';
  return html`<dl class="cg-facts">${shown.map((row) => html`<dt>${row.label}</dt><dd>${row.value}</dd>`)}</dl>`;
}

/**
 * A complete data table.
 * columns: [{ label, num?: boolean, rowHeader?: boolean }]
 * rows: arrays of cells (strings, numbers or html``), one per column; or { cells, className }
 * @param {{ caption?: string, columns: Array<{ label: string, num?: boolean, rowHeader?: boolean }>, rows: any[], className?: string, label?: string }} options
 */
export function dataTable({ caption, columns, rows, className = '', label }) {
  if (!rows?.length) return '';
  const head = html`<thead><tr>${columns.map((c) => html`<th scope="col"${attrs({ class: c.num ? 'cg-num' : null })}>${c.label}</th>`)}</tr></thead>`;
  const body = rows.map((row) => {
    const cells = Array.isArray(row) ? row : row.cells;
    return html`<tr${attrs({ class: Array.isArray(row) ? null : row.className || null })}>${cells.map((cell, i) => {
      const col = columns[i] || {};
      const cls = col.num ? 'cg-num' : null;
      return col.rowHeader ? html`<th scope="row"${attrs({ class: cls })}>${cell}</th>` : html`<td${attrs({ class: cls })}>${cell}</td>`;
    })}</tr>`;
  });
  return html`<div class="cg-table-wrap"${attrs({ role: label ? 'region' : null, 'aria-label': label || null, tabindex: label ? '0' : null })}><table${attrs({ class: `cg-table ${className}`.trim() })}>${caption ? html`<caption>${caption}</caption>` : ''}${head}<tbody>${body}</tbody></table></div>`;
}

/** A link when the URL is safe, plain text otherwise. */
export function link(url, text, extra = {}) {
  const href = safeUrl(url);
  if (!href) return html`${text}`;
  const external = /^https?:/i.test(href);
  return html`<a${attrs({ href, rel: external ? 'noopener' : null, ...extra })}>${text}</a>`;
}

/** A citation list. items: [{ label, url?, licence?, note? }] */
export function citations(items) {
  const shown = (items || []).filter((item) => item && (item.label || item.url));
  if (!shown.length) return '';
  return html`<ol class="cg-citations">${shown.map((item) => html`<li>${link(item.url, item.label || item.url)}${item.note ? html` – ${item.note}` : ''}${item.licence ? html` <span class="cg-citations__licence">(${item.licence})</span>` : ''}</li>`)}</ol>`;
}

/**
 * A callout. tone: info | warning | danger | success
 * @param {{ title?: any, body: any, tone?: string }} options
 */
export function notice({ title, body, tone = 'info' }) {
  return html`<div${attrs({ class: tone === 'info' ? 'cg-notice' : `cg-notice cg-notice--${tone}`, role: tone === 'danger' ? 'alert' : null })}>${title ? html`<strong class="cg-notice__title">${title}</strong>` : ''}<p>${body}</p></div>`;
}

/** A list of pills. items: strings or { label, tone } */
export function badges(items) {
  const shown = (items || []).filter(Boolean);
  if (!shown.length) return '';
  return html`<ul class="cg-badge-list">${shown.map((item) => {
    const { label, tone } = typeof item === 'string' ? { label: item } : item;
    return html`<li><span${attrs({ class: tone ? `cg-badge cg-badge--${tone}` : 'cg-badge' })}>${label}</span></li>`;
  })}</ul>`;
}

/**
 * A party name with its swatch. The colour is data from the palette module; only a plain
 * hex colour is written into the style attribute.
 */
export function partyChip(name, colour) {
  if (!name) return '';
  const safe = /^#[0-9a-f]{3,8}$/i.test(String(colour || '')) ? colour : null;
  return html`<span class="cg-party">${safe ? html`<span class="cg-party__swatch"${attrs({ style: `--party-colour:${safe}` })}></span>` : ''}${name}</span>`;
}
