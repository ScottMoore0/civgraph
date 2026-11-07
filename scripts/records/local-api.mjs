#!/usr/bin/env node
/**
 * The records API answered on this machine: the real Pages Functions (functions/_api/elections,
 * parties, persons, sources, register-interests, graph, stats, votes) run against the records
 * build's database (tmp/records/civgraph-records.sqlite) through the storage adapter: the D1
 * binding shape (toD1) over the SQLite record store (openSqlite), as tests/unit/storage.test.mjs
 * runs the real handlers. Production is untouched: there the same Functions read D1.
 *
 * The local servers are static, so without this the map app's party and person pages
 * (src/map/app/entity-bridge.js fetches /_api/parties and /_api/persons) found no record.
 *
 *   answerRecordApi(url, { method, headers })  a Response, or null when the URL is not a
 *                                              records route or there is no records build
 *   node scripts/records/local-api.mjs --port <n> [--exit-with-stdin]
 *                                              the same over HTTP, for scripts/dev/test-server.py;
 *                                              prints "ready <port>" once listening, and with
 *                                              --exit-with-stdin exits when its stdin closes
 *                                              (the parent server has gone)
 *
 * Nothing is proxied and nothing is written: the database is opened read-only.
 */
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { RECORDS_DB, REPO_ROOT } from './paths.mjs';
import { toD1 } from '@civgraph/storage/store.js';
import { openSqlite } from '@civgraph/storage/node';

/** The /_api/ routes whose Functions read only the records database (binding ELECTIONS_DB). */
export const RECORD_API_ROUTES = ['elections', 'graph', 'parties', 'persons', 'register-interests', 'sources', 'stats', 'votes'];
const ROUTE = new RegExp(`^/_api/(${RECORD_API_ROUTES.join('|')})/?$`);

/** The route name for a pathname (/_api/parties -> 'parties'), or null. */
export function recordApiRoute(pathname) {
  const match = ROUTE.exec(String(pathname || ''));
  return match ? match[1] : null;
}

const modules = new Map();
const envs = new Map();

async function functionModule(route) {
  if (!modules.has(route)) {
    modules.set(route, import(pathToFileURL(path.join(REPO_ROOT, 'functions', '_api', route, 'index.js')).href));
  }
  return modules.get(route);
}

/**
 * Answer a records API request from the local build. `url` is absolute or a path; `dbFile`
 * defaults to the records build. GET and HEAD only, as the app uses them.
 */
export async function answerRecordApi(url, { method = 'GET', headers = {}, dbFile = RECORDS_DB } = {}) {
  const requestUrl = new URL(url, 'http://127.0.0.1');
  const route = recordApiRoute(requestUrl.pathname);
  if (!route || !existsSync(dbFile)) return null;
  if (method !== 'GET' && method !== 'HEAD') {
    return new Response(JSON.stringify({ error: 'method not allowed' }), { status: 405, headers: { Allow: 'GET, HEAD' } });
  }
  if (!envs.has(dbFile)) envs.set(dbFile, { ELECTIONS_DB: toD1(openSqlite(dbFile, { readOnly: true })) });
  const mod = await functionModule(route);
  const handler = mod.onRequestGet || mod.onRequest;
  const pending = [];
  const context = {
    request: new Request(requestUrl.toString(), { method: 'GET', headers }),
    env: envs.get(dbFile),
    params: {},
    waitUntil: (p) => pending.push(p),
    next: async () => new Response('not found', { status: 404 }),
  };
  return handler(context);
}

/** Write a fetch Response to a node:http ServerResponse. */
export async function sendResponse(res, response, { head = false } = {}) {
  const body = Buffer.from(await response.arrayBuffer());
  const out = {};
  response.headers.forEach((value, key) => { out[key] = value; });
  out['content-length'] = body.length;
  res.writeHead(response.status, out);
  res.end(head ? undefined : body);
}

async function serve(port, exitWithStdin) {
  const server = createServer(async (req, res) => {
    try {
      const headers = {};
      for (const h of ['accept', 'if-none-match']) if (req.headers[h]) headers[h] = req.headers[h];
      const response = await answerRecordApi(req.url, { method: req.method, headers });
      if (!response) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('not found');
        return;
      }
      await sendResponse(res, response, { head: req.method === 'HEAD' });
    } catch (error) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(String(error?.stack || error));
    }
  });
  server.listen(port, '127.0.0.1', () => {
    console.log(`ready ${/** @type {import('node:net').AddressInfo} */ (server.address()).port}`);
  });
  if (exitWithStdin) {
    process.stdin.on('end', () => process.exit(0));
    process.stdin.on('close', () => process.exit(0));
    process.stdin.resume();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const i = process.argv.indexOf('--port');
  serve(i > 0 ? Number(process.argv[i + 1]) : 0, process.argv.includes('--exit-with-stdin'));
}
