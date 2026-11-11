/**
 * Serves the Independent PRONI Search single-page app shell for every /proni
 * and /proni/<reference> URL, so deep links like /proni/AA/3 load the app and
 * its client-side router renders the right view. The app's assets are absolute
 * (/apps/proni-search/…), so the same HTML works under any /proni/* path.
 *
 * A record's address (/proni/LA/7/1/CA/1/3) gets the record's own head: <title>, meta
 * description, canonical link, Open Graph and Twitter card, from its PRONI_DB row, so a
 * search engine or a pasted link sees the record rather than the generic search page
 * (QA 2026-11-11, H1 and M7). A reference that is certainly not in the catalogue answers
 * 404 (the app still loads and says so); one that cannot be looked up (no binding, a failed
 * query) answers 200 with the generic head, so an outage never turns real records into 404s.
 */
import { binding, SITE } from '../packages/config/src/config.js';
import { fromD1 } from '../packages/storage/src/d1.js';
import { PRONI } from '../packages/api/src/queries/proni.js';
import { withShareTags } from '../packages/ui/src/templates/share.js';
import { reportError } from '../packages/api/src/handlers/_error.js';

// Bump when apps/proni-search/index.html changes in a way the edge copy must not outlive.
const SHELL_VERSION = 'v19';
export const SITE_ORIGIN = SITE.origin;
const DESCRIPTION_LIMIT = 300;

const htmlEscape = (/** @type {unknown} */ value) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

/**
 * @typedef {object} ProniItem
 * @property {string} ref
 * @property {string | null} [title]
 * @property {string | null} [level]
 * @property {string | null} [dates]
 * @property {string | null} [description]
 */

/** The record's reference from the path (/proni/LA/7/1/CA/1/3 -> LA/7/1/CA/1/3), or null. @param {string} pathname */
export function proniRefFromPath(pathname) {
  let path = pathname;
  try { path = decodeURIComponent(pathname); } catch { /* keep it encoded */ }
  if (!path.startsWith('/proni/')) return null;
  const ref = path.slice('/proni/'.length).replace(/\/+$/, '').trim();
  return ref || null;
}

/** The canonical address of a record, slashes kept as path separators. @param {string} ref */
export function proniRecordUrl(ref) {
  return `${SITE_ORIGIN}/proni/${String(ref).split('/').map(encodeURIComponent).join('/')}`;
}

/** Cut at a word boundary. @param {unknown} text @param {number} [limit] */
function clip(text, limit = DESCRIPTION_LIMIT) {
  const value = String(text || '').replace(/\s+/g, ' ').trim();
  if (value.length <= limit) return value;
  const cut = value.slice(0, limit - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > limit * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,;:.-]+$/, '')}…`;
}

/**
 * A record's head: "Register of Members (LA/7/1/CA/1/3) – PRONI record – Civgraph".
 * @param {ProniItem} item
 */
export function proniRecordHead(item) {
  const ref = String(item.ref);
  const name = String(item.title || '').replace(/\s+/g, ' ').trim();
  const title = name && name !== ref ? `${clip(name, 110)} (${ref}) – PRONI record – Civgraph` : `${ref} – PRONI record – Civgraph`;
  const facts = [item.level, item.dates].map((v) => String(v || '').trim()).filter(Boolean).join(', ');
  const lead = `PRONI ${ref}${name && name !== ref ? `: ${name}` : ''}${facts ? ` (${facts})` : ''}.`;
  const body = String(item.description || '').replace(/\s+/g, ' ').trim();
  return {
    title,
    description: clip(`${lead}${body ? ` ${body}` : ' A record in the Public Record Office of Northern Ireland catalogue, on Civgraph.'}`),
    url: proniRecordUrl(ref),
  };
}

/**
 * Write a record's head into the app shell. String edits on our own file: a pattern that no
 * longer matches leaves the shell as it was, which still works.
 * @param {string} html
 * @param {{ title: string, description: string, url: string }} head
 */
export function renderProniShell(html, head) {
  let out = html.replace(/<title>[^<]*<\/title>/i, `<title>${htmlEscape(head.title)}</title>`);
  out = out.replace(/<meta\s+name="description"\s+content="[^"]*"\s*\/?>/i,
    `<meta name="description" content="${htmlEscape(head.description)}">`);
  return withShareTags(out, { title: head.title, description: head.description, url: head.url });
}

/**
 * The record, null when it is certainly not there, undefined when that cannot be told.
 * @param {CivgraphEnv} env
 * @param {string} ref
 * @returns {Promise<ProniItem | null | undefined>}
 */
export async function lookupProniItem(env, ref) {
  const bound = binding(env, 'PRONI_DB');
  if (!bound) return undefined;
  const rows = /** @type {ProniItem[]} */ (await fromD1(/** @type {D1Database} */ (bound)).all(PRONI.item, [ref]));
  return rows[0] || null;
}

/** @param {FunctionContext} context @param {URL} url */
async function fetchShell(context, url) {
  const assetUrl = new URL('/apps/proni-search/index.html', url.origin);
  const assets = binding(context.env, 'ASSETS');
  return assets?.fetch ? assets.fetch(new Request(assetUrl)) : fetch(assetUrl);
}

/** The static shell, from the edge cache when it is there. @param {FunctionContext} context @param {URL} url */
async function shellHtml(context, url) {
  const cache = typeof caches !== 'undefined' ? caches.default : null;
  const cacheKey = new Request(`https://shell.invalid/proni-shell/${SHELL_VERSION}`, { method: 'GET' });
  const hit = cache ? await cache.match(cacheKey) : null;
  if (hit) return { ok: true, html: await hit.text() };
  const asset = await fetchShell(context, url);
  const html = await asset.text();
  if (asset.status === 200 && cache) {
    context.waitUntil(cache.put(cacheKey, new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })));
  }
  return { ok: asset.status === 200, html };
}

/** @param {FunctionContext} context */
export async function serveShell(context) {
  const url = new URL(context.request.url);
  const { html } = await shellHtml(context, url);
  const ref = proniRefFromPath(url.pathname);

  /** @type {ProniItem | null | undefined} */
  let item;
  if (ref) {
    try {
      item = await lookupProniItem(context.env, ref);
    } catch (error) {
      reportError(context.env, 'proni-shell', error);
      item = undefined;
    }
  }

  const page = item ? renderProniShell(html, proniRecordHead(item)) : html;
  const missing = Boolean(ref) && item === null;
  return new Response(page, {
    status: missing ? 404 : 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': missing ? 'public, max-age=60' : 'public, max-age=300, s-maxage=3600',
    },
  });
}
