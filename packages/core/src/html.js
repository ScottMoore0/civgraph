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

/**
 * What a template may interpolate: markup (SafeHtml), text and numbers (escaped), nothing
 * (null, undefined, false) and arrays of these (joined), nested two deep (a JSDoc typedef
 * cannot refer to itself).
 * @typedef {SafeHtml | string | number | bigint | boolean | null | undefined} InterpolationValue
 * @typedef {InterpolationValue | readonly (InterpolationValue | readonly InterpolationValue[])[]} Interpolation
 */

export class SafeHtml {
  /** @param {unknown} value */
  constructor(value) {
    this.value = String(value);
  }

  toString() {
    return this.value;
  }
}

/** @type {Record<string, string>} */
const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/**
 * @param {unknown} value
 * @returns {string}
 */
export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ESCAPES[ch]);
}

/** Markup the code vouches for. Never pass it data read from D1, R2 or a request. */
export const raw = (/** @type {SafeHtml | string | null | undefined} */ value) => (value instanceof SafeHtml ? value : new SafeHtml(value ?? ''));

/** @type {(value: unknown) => value is SafeHtml} */
export const isSafeHtml = (value) => value instanceof SafeHtml;

/**
 * @param {Interpolation} value
 * @returns {string}
 */
function render(value) {
  if (value === null || value === undefined || value === false) return '';
  if (value instanceof SafeHtml) return value.value;
  if (Array.isArray(value)) return value.map(render).join('');
  return escapeHtml(value);
}

/**
 * @param {TemplateStringsArray} strings
 * @param {...Interpolation} values
 * @returns {SafeHtml}
 */
export function html(strings, ...values) {
  let out = strings[0];
  for (let i = 0; i < values.length; i += 1) out += render(values[i]) + strings[i + 1];
  return new SafeHtml(out);
}

/**
 * Attributes from an object: `<a${attrs({ href, 'aria-current': current && 'page' })}>`.
 * null, undefined and false drop the attribute; true writes it bare; other values are
 * escaped. Keys are written as given, so they must come from code.
 * @param {Record<string, string | number | boolean | null | undefined> | null | undefined} map
 * @returns {SafeHtml}
 */
export function attrs(map) {
  let out = '';
  for (const [key, value] of Object.entries(map || {})) {
    if (value === null || value === undefined || value === false) continue;
    out += value === true ? ` ${key}` : ` ${key}="${escapeHtml(value)}"`;
  }
  return new SafeHtml(out);
}

/**
 * Join rendered items with a separator (itself rendered, so it may be html``).
 * @param {readonly Interpolation[] | null | undefined} items
 * @param {Interpolation} [separator]
 * @returns {SafeHtml}
 */
export function join(items, separator = '') {
  const sep = render(separator);
  return new SafeHtml((items || []).map(render).filter((s) => s !== '').join(sep));
}

/** The string a template produced, for a Response body. */
export const toHtmlString = (/** @type {Interpolation} */ value) => render(value);
