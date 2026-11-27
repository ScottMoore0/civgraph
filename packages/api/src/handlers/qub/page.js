/**
 * /qub and /qub/<mms_id>: the Independent QUB Catalogue app shell (site/apps/qub-catalogue/
 * index.html), with a record's own <title> and description on its page, and 404 for an id the
 * catalogue does not hold (the app still loads and says so).
 *
 * The app is LOCAL ONLY until the owner approves its deployment (LANDING/qub-app): without a
 * QUB_DB binding every /qub address answers 404, so landing this code publishes nothing.
 */
import { binding } from '@civgraph/config';
import { fromD1 } from '@civgraph/storage/d1.js';
import { reportError } from '../_error.js';
import { QUB } from '../../queries/qub.js';
import { isMmsId } from './_query.js';

export const SHELL_PATH = '/apps/qub-catalogue/index.html';
const DESCRIPTION_LIMIT = 300;

const htmlEscape = (/** @type {unknown} */ value) => String(value ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/**
 * The MMS ID a /qub/... address names, '' for the search page, null for anything else.
 * @param {string} pathname
 * @returns {string | null}
 */
export function mmsIdFromPath(pathname) {
  const m = /^\/qub(?:\/([^/]*))?\/?$/.exec(pathname);
  if (!m) return null;
  return m[1] ? decodeURIComponent(m[1]).trim() : '';
}

/** Cut at a word boundary. @param {unknown} text @param {number} [limit] */
export function clip(text, limit = DESCRIPTION_LIMIT) {
  const value = String(text || '').replace(/\s+/g, ' ').trim();
  if (value.length <= limit) return value;
  const cut = value.slice(0, limit - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > limit * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,;:.-]+$/, '')}…`;
}

/**
 * A record's head: "<title> – QUB catalogue record – Civgraph".
 * @param {{ title?: unknown, author?: unknown, imprint?: unknown }} item
 */
export function recordHead(item) {
  const name = clip(item.title || 'Untitled', 110);
  const facts = [item.author, item.imprint].map((v) => String(v || '').trim()).filter(Boolean).join('. ');
  return {
    title: `${name} – QUB catalogue record – Civgraph`,
    description: clip(`${name}${facts ? `. ${facts}` : ''}. A record of Queen’s University Belfast Library’s catalogue, in Civgraph’s Independent QUB Catalogue.`),
  };
}

/**
 * Write a record's head into the shell; a pattern that no longer matches leaves it as it was.
 * @param {string} html
 * @param {{ title: string, description: string }} head
 */
export function renderShell(html, head) {
  return html
    .replace(/<title>[^<]*<\/title>/i, `<title>${htmlEscape(head.title)}</title>`)
    .replace(/<meta\s+name="description"\s+content="[^"]*"\s*\/?>/i, `<meta name="description" content="${htmlEscape(head.description)}">`);
}

/** @param {FunctionContext} context @param {URL} url */
async function fetchShell(context, url) {
  const assets = binding(context.env, 'ASSETS');
  const req = new Request(new URL(SHELL_PATH, url.origin));
  return assets?.fetch ? assets.fetch(req) : fetch(req);
}

/** @param {FunctionContext} context */
export async function serveQub(context) {
  const url = new URL(context.request.url);
  const id = mmsIdFromPath(url.pathname);
  const bound = binding(context.env, 'QUB_DB');
  if (!bound || id === null) return new Response('Not found', { status: 404, headers: { 'Content-Type': 'text/plain' } });
  const shell = await fetchShell(context, url);
  const html = await shell.text();
  const headers = { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache', 'X-Robots-Tag': 'noindex' };
  if (!id) return new Response(html, { status: shell.status, headers });
  if (!isMmsId(id)) return new Response(html, { status: 404, headers });
  try {
    const row = await fromD1(bound).first(QUB.item, [id]);
    if (!row) return new Response(html, { status: 404, headers });
    return new Response(renderShell(html, recordHead(row)), { status: 200, headers });
  } catch (error) {
    reportError(context.env, 'qub-page', error);
    return new Response(html, { status: 200, headers });
  }
}
