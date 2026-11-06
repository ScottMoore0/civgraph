/**
 * HTML templates as plain functions that return strings, escaped by default.
 *
 *   html`<h1>${title}</h1>`                      title is escaped
 *   html`<ul>${items.map((i) => html`<li>${i}</li>`)}</ul>`   arrays are joined
 *   html`<div>${raw(trustedMarkup)}</div>`       raw() opts out, for markup we wrote
 *
 * null, undefined and false render as nothing, so `${cond && html`...`}` works. Every
 * template returns a SafeHtml, which a parent template inserts unescaped; anything else
 * (a string from D1, a number, a URL) is escaped. That is the whole security model: data
 * can only reach the page through an interpolation, and an interpolation is escaped unless
 * the code, not the data, says otherwise.
 *
 * Shared by the server-rendered pages in Functions (functions/_templates/) and the build
 * step that stamps the same shell into static pages, so it imports nothing.
 * See D:\civgraph-intake\site-restructure-2026-11-06\frontend-plan.md section 4.
 */

export class SafeHtml {
  constructor(value) {
    this.value = String(value);
  }

  toString() {
    return this.value;
  }
}

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ESCAPES[ch]);
}

/** Markup the code vouches for. Never pass it data read from D1, R2 or a request. */
export const raw = (value) => (value instanceof SafeHtml ? value : new SafeHtml(value ?? ''));

export const isSafeHtml = (value) => value instanceof SafeHtml;

function render(value) {
  if (value === null || value === undefined || value === false) return '';
  if (value instanceof SafeHtml) return value.value;
  if (Array.isArray(value)) return value.map(render).join('');
  return escapeHtml(value);
}

export function html(strings, ...values) {
  let out = strings[0];
  for (let i = 0; i < values.length; i += 1) out += render(values[i]) + strings[i + 1];
  return new SafeHtml(out);
}

/**
 * Attributes from an object: `<a${attrs({ href, 'aria-current': current && 'page' })}>`.
 * null, undefined and false drop the attribute; true writes it bare; other values are
 * escaped. Keys are written as given, so they must come from code.
 */
export function attrs(map) {
  let out = '';
  for (const [key, value] of Object.entries(map || {})) {
    if (value === null || value === undefined || value === false) continue;
    out += value === true ? ` ${key}` : ` ${key}="${escapeHtml(value)}"`;
  }
  return new SafeHtml(out);
}

/** Join rendered items with a separator (itself rendered, so it may be html``). */
export function join(items, separator = '') {
  const sep = render(separator);
  return new SafeHtml((items || []).map(render).filter((s) => s !== '').join(sep));
}

/** The string a template produced, for a Response body. */
export const toHtmlString = (value) => render(value);
