/**
 * The body of a PRONI record page (/proni/<reference>), rendered on the server.
 *
 * The app shell (functions/_proni-shell.js) is the same HTML for every address, so a record's
 * page used to arrive empty: a crawler, a link preview or a reader without JavaScript saw no
 * record, and every address answered 200, real or not (QA 2026-11-11, M7). This renders the
 * record into the shell's #viewRecord with the app's own markup (site/apps/proni-search/
 * record-view.js) and answers 404 for a reference the catalogue does not hold. The app keeps the
 * server's page on load (data-ssr-ref) and goes on as before from there.
 *
 * The shell's <head> (title, description, canonical, share tags) is the shell's business; this
 * only fills the body and sets the status. A record that cannot be looked up (no binding, a
 * failed query) gets the shell as it is, so an outage never turns real records into 404s.
 */
import { binding } from '../../../../config/src/config.js';
import { siteNumber } from '../../../../core/src/format.js';
import { reportError } from '../_error.js';
import { proniReader } from './_read.js';
import { loadNode } from './node.js';
import { CHILD_CAP, esc, recordHtml, recordNotFound } from '../../../../../site/apps/proni-search/record-view.js';

/**
 * The reference a /proni/... address names, read as the app reads it (app.js currentRef), or null
 * for the search page and for an address that does not decode.
 * @param {string} pathname
 * @returns {string | null}
 */
export function refFromPath(pathname) {
  let path;
  try { path = decodeURIComponent(pathname); } catch { return null; }
  if (!path.startsWith('/proni/')) return null;
  return path.slice('/proni/'.length).replace(/\/+$/, '') || null;
}

/**
 * Put a rendered body into the shell: #viewRecord shown and filled, the search view hidden. A
 * shell that no longer has the expected markup comes back unchanged (the app still renders).
 * @param {string} html the shell
 * @param {string} body #viewRecord's content
 * @param {string} ref
 */
export function fillRecordView(html, body, ref) {
  const record = '<div id="viewRecord" hidden></div>';
  const search = '<div id="viewSearch">';
  if (!html.includes(record) || !html.includes(search)) return html;
  return html
    .replace(search, '<div id="viewSearch" hidden>')
    .replace(record, () => `<div id="viewRecord" data-ssr-ref="${esc(ref)}">${body}</div>`);
}

/**
 * The record with its first CHILD_CAP children; null when it is not in the catalogue, undefined
 * when that cannot be told.
 * @param {CivgraphEnv} env
 * @param {string} ref
 */
export async function lookupRecord(env, ref) {
  const bound = binding(env, 'PRONI_DB');
  if (!bound) return undefined;
  try {
    return await loadNode(proniReader(/** @type {D1Database} */ (bound)), ref, { childLimit: CHILD_CAP });
  } catch (error) {
    reportError(env, 'proni-page', error);
    return undefined;
  }
}

/**
 * A /proni/<reference> answer: the shell `serveShell` gives, with the record rendered into its
 * body, or the "not found" body and status 404. Other addresses get the shell untouched.
 * @param {FunctionContext} context
 * @param {(context: FunctionContext) => Promise<Response>} serveShell
 * @returns {Promise<Response>}
 */
export async function serveRecordPage(context, serveShell) {
  const url = new URL(context.request.url);
  const ref = refFromPath(url.pathname);
  // ?ecat= is the "view on the PRONI eCatalogue" guide, drawn by the app over any address
  if (!ref || url.searchParams.has('ecat')) return serveShell(context);

  const [shell, node] = await Promise.all([serveShell(context), lookupRecord(context.env, ref)]);
  if (node === undefined || shell.status !== 200 && shell.status !== 404) return shell;
  const html = await shell.text();
  const headers = new Headers(shell.headers);
  if (node === null) {
    headers.set('Cache-Control', 'public, max-age=60');
    return new Response(fillRecordView(html, recordNotFound(ref), ref), { status: 404, headers });
  }
  const body = recordHtml(/** @type {Parameters<typeof recordHtml>[0]} */ (/** @type {unknown} */ (node)), { fmt: (n) => siteNumber(n) });
  return new Response(fillRecordView(html, body, ref), { status: 200, headers });
}
