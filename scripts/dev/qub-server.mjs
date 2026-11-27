#!/usr/bin/env node
/**
 * The Independent QUB Catalogue, answered on this machine: the site's static files (as
 * scripts/dev/dev-server.mjs serves them, packages/served.json mapped by sourceOf) plus /qub,
 * /qub/<mms_id> and /_api/qub/* through the real handlers (packages/api/src/handlers/qub/, the
 * same modules functions/qub.js and functions/_api/qub/* re-export), with QUB_DB the D1 binding
 * shape (toD1) over a LOCAL SQLite file (openSqlite, read-only). No Cloudflare resource, no
 * network: the database is the private intake's build (scripts/records/qub/build-qub-db.py).
 *
 *   node scripts/dev/qub-server.mjs --db <qub-catalogue.sqlite> [--port 8796]
 *   (or QUB_DB_FILE=<path>)                                    prints "ready <port>" once listening
 *
 * Runs the app locally over a SQLite copy of the qub-catalogue database (bound in production since 27 Nov 2026).
 */
import http from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { toD1 } from '@civgraph/storage/store.js';
import { openSqlite } from '@civgraph/storage/node';
import { serveQub, SHELL_PATH } from '@civgraph/api/handlers/qub/page.js';
import { onRequestGet as search } from '@civgraph/api/handlers/qub/search.js';
import { onRequestGet as record } from '@civgraph/api/handlers/qub/record.js';
import { onRequestGet as exportCsv } from '@civgraph/api/handlers/qub/export.js';
import { sourceOf } from '../build/site.mjs';

const args = process.argv.slice(2);
const opt = (/** @type {string} */ name, /** @type {string} */ fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? String(args[i + 1]) : fallback;
};
const PORT = Number(opt('--port', '8796'));
const DB_FILE = opt('--db', process.env['QUB_DB_FILE'] || '');
const ROOT = process.cwd();
if (!DB_FILE || !existsSync(DB_FILE)) {
  console.error('qub-server: give the catalogue database with --db <file> (scripts/records/qub/build-qub-db.py builds it)');
  process.exit(2);
}

/** @type {Record<string, string>} */
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.woff2': 'font/woff2', '.ico': 'image/x-icon', '.webp': 'image/webp' };

/** A static file of the site, or null. @param {string} pathname */
function staticFile(pathname) {
  const file = path.normalize(path.join(ROOT, sourceOf(pathname)));
  if (!file.startsWith(ROOT) || !existsSync(file) || !statSync(file).isFile()) return null;
  return file;
}

/** The ASSETS binding: a static file as a Response. */
const ASSETS = {
  /** @param {Request} request */
  async fetch(request) {
    const file = staticFile(new URL(request.url).pathname);
    if (!file) return new Response('not found', { status: 404 });
    const body = /** @type {ReadableStream} */ (Readable.toWeb(createReadStream(file)));
    return new Response(body, { headers: { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' } });
  },
};
const env = { QUB_DB: toD1(openSqlite(DB_FILE, { readOnly: true })), ASSETS, CIVGRAPH_VERBOSE_ERRORS: 'true' };

/** @type {Record<string, (context: any) => Promise<Response>>} */
const API = { '/_api/qub/search': search, '/_api/qub/record': record, '/_api/qub/export': exportCsv };

/** @param {http.ServerResponse} res @param {Response} response @param {string} method */
async function send(res, response, method) {
  /** @type {Record<string, string>} */
  const headers = {};
  response.headers.forEach((v, k) => { headers[k] = v; });
  headers['cache-control'] = 'no-store';
  res.writeHead(response.status, headers);
  if (method === 'HEAD' || !response.body) { res.end(); return; }
  for await (const chunk of /** @type {AsyncIterable<Uint8Array>} */ (/** @type {unknown} */ (response.body))) res.write(chunk);
  res.end();
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://localhost:${PORT}`);
  const method = req.method || 'GET';
  if (method !== 'GET' && method !== 'HEAD') { res.writeHead(405).end('read-only'); return; }
  /** @type {Promise<unknown>[]} */
  const pending = [];
  const context = { request: new Request(url), env, params: {}, waitUntil: (/** @type {Promise<unknown>} */ p) => { pending.push(p); },
    next: async () => new Response('not found', { status: 404 }) };
  try {
    const handler = API[url.pathname];
    if (handler) return await send(res, await handler(context), method);
    if (url.pathname === '/qub' || url.pathname.startsWith('/qub/')) return await send(res, await serveQub(context), method);
    if (url.pathname === '/' ) { res.writeHead(302, { location: '/qub' }).end(); return; }
    if (url.pathname === SHELL_PATH) { res.writeHead(302, { location: '/qub' }).end(); return; }
    return await send(res, await ASSETS.fetch(new Request(url)), method);
  } catch (error) {
    res.writeHead(500, { 'content-type': 'text/plain' }).end(String(/** @type {Error} */ (error)?.stack || error));
  }
});

server.listen(PORT, '127.0.0.1', () => { console.log(`ready ${PORT}  (Independent QUB Catalogue on http://localhost:${PORT}/qub, local database ${DB_FILE})`); });
