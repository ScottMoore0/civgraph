#!/usr/bin/env node
/**
 * The site from the working tree, with the rebuilt catalogue switched on, for review.
 *
 *   node tools/dev-site/server.mjs [--port 8790] [--catalogue next|current]
 *   open http://localhost:8790/maps/
 *
 * Serves the working tree as the static site does, answers the records API (/_api/parties,
 * /_api/persons, /_api/elections ...) from the local records build when there is one
 * (packages/loader/src/local-api.mjs: the real Functions against tmp/records), proxies /_r/ (CDN)
 * and the rest of /_api/ (the live API) as the site expects on localhost, and sets
 * window.CIVGRAPH_CATALOGUE on every page so the catalogue pane mounts the new implementation (src/catalogue/) instead of the current
 * one. The live site is unaffected: without that setting, or ?catalogue=next, it renders the
 * current pane exactly as before.
 *
 * The map and catalogue APIs of data design phase 3 (/_api/layers, /_api/catalogue) are answered
 * here, not upstream: the real Functions run over an in-memory records database built from the
 * working tree's maps.json, maps-test.json and catalogue documents (packages/loader/src/ingest-maps.mjs),
 * rebuilt when one of them changes, so the site shows the tree's maps, not production's.
 */
import { createServer } from 'node:http';
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SITE } from '../../packages/config/src/node.mjs';
import { localPathForUrl, BROWSE_DIR } from '../../packages/loader/src/paths.mjs';
import { createDatabase, TableWriter, transaction } from '../../packages/loader/src/db.mjs';
import { ingestMaps, MAP_SOURCES } from '../../packages/loader/src/ingest-maps.mjs';
import { d1, installCaches } from '../../tests/records/d1-shim.mjs';
import * as layersApi from '../../packages/api/src/handlers/layers/[[path]].js';
import * as catalogueApi from '../../packages/api/src/handlers/catalogue/index.js';
import { answerRecordApi, sendResponse } from '../../packages/loader/src/local-api.mjs';
import { sourceOf } from '../../scripts/build/site.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
/**
 * The value after a command-line flag, or the fallback when the flag is absent.
 * @template T
 * @param {string} name
 * @param {T} fallback
 * @returns {string | T}
 */
const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : fallback; };
const PORT = Number(arg('--port', process.env.PORT || 8790));
const CATALOGUE = arg('--catalogue', 'next');

/** @type {Record<string, string>} */
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
  '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml', '.pdf': 'application/pdf', '.fgb': 'application/octet-stream', '.pmtiles': 'application/octet-stream',
  '.geojson': 'application/geo+json', '.webmanifest': 'application/manifest+json', '.map': 'application/json',
};
const FLAG = `<script>window.CIVGRAPH_CATALOGUE=${JSON.stringify(CATALOGUE)};</script>`;

// ---- the phase-3 map APIs, from the working tree
/** @type {ReturnType<typeof d1> | null} */
let mapsDb = null;
let mapsStamp = '';
function mapSourcesStamp() {
  const files = [MAP_SOURCES.maps, MAP_SOURCES.layers, ...Object.values(MAP_SOURCES.documents)];
  return files.map((f) => { try { return statSync(path.join(ROOT, f)).mtimeMs; } catch { return 0; } }).join(',');
}
function mapsEnv() {
  const stamp = mapSourcesStamp();
  if (!mapsDb || stamp !== mapsStamp) {
    const db = createDatabase(':memory:');
    const { docs } = ingestMaps(db, { root: ROOT, browseDir: existsSync(BROWSE_DIR) ? BROWSE_DIR : null });
    transaction(db, () => { const w = new TableWriter(db, 'documents'); for (const d of docs) w.add(d); });
    mapsDb = d1(db);
    mapsStamp = stamp;
  }
  return { ELECTIONS_DB: mapsDb };
}
installCaches();

/**
 * A request's Node headers as fetch Headers: a repeated header's values joined by commas, as
 * Request itself did when it was handed the Node headers object.
 * @param {import('node:http').IncomingHttpHeaders} incoming
 */
function fetchHeaders(incoming) {
  const headers = new Headers();
  for (const [name, value] of Object.entries(incoming)) {
    if (value !== undefined) headers.append(name, Array.isArray(value) ? value.join(',') : value);
  }
  return headers;
}

/**
 * @param {import('node:http').IncomingMessage} req
 * @param {URL} url
 * @returns {Promise<Response | null>}
 */
async function localMapApi(req, url) {
  const p = url.pathname;
  /** @type {typeof catalogueApi | typeof layersApi | null} */
  let mod = null;
  /** @type {Record<string, string[]>} */
  let params = {};
  if (p === '/_api/catalogue' || p === '/_api/catalogue/') mod = catalogueApi;
  else if (p === '/_api/layers' || p.startsWith('/_api/layers/')) {
    mod = layersApi;
    params = { path: p.slice('/_api/layers'.length).split('/').filter(Boolean) };
  }
  if (!mod) return null;
  return mod.onRequestGet({ request: new Request(`http://localhost${p}${url.search}`, { headers: fetchHeaders(req.headers) }), env: mapsEnv(), params, waitUntil: () => {}, next: async () => new Response('not found', { status: 404 }) });
}

/**
 * @param {import('node:http').IncomingMessage} req
 * @returns {Promise<Buffer>}
 */
function readBody(req) {
  return new Promise((resolve, reject) => {
    /** @type {Buffer[]} */
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
/**
 * The 200 rewrites of site/_redirects (from -> to), as Pages applies them and as the browser
 * tests' server does (scripts/dev/test-server.py): an exact path, or a prefix ending in /*
 * whose target names no :splat, apart from the retired service worker's (a path ending /sw.js),
 * which is left out, as it was. /elections/... serves the Elections app's shell.
 * @type {Array<[string, string]>}
 */
const REWRITES = (() => {
  try {
    return readFileSync(path.join(ROOT, 'site', '_redirects'), 'utf8').split('\n')
      .map((line) => line.split('#', 1)[0].trim().split(/\s+/))
      .filter((f) => f.length === 3 && f[2] === '200' && !f[1].includes(':splat') && !f[0].endsWith('/sw.js'))
      .map((f) => /** @type {[string, string]} */ ([f[0], f[1]]));
  } catch {
    return [];
  }
})();

/** The path a 200 rewrite serves for a request path, or the path itself. @param {string} p */
function rewritten(p) {
  for (const [from, to] of REWRITES) if (p === from || (from.endsWith('/*') && p.startsWith(from.slice(0, -1)))) return to;
  return p;
}

/**
 * @param {import('node:http').ServerResponse} res
 * @param {number} status
 * @param {string} body
 * @param {string} [type]
 */
function send(res, status, body, type = 'text/plain; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(body);
}

createServer(async (req, res) => {
  // A server's request always has a url and a method.
  const url = new URL(/** @type {string} */ (req.url), `http://localhost:${PORT}`);
  const method = /** @type {string} */ (req.method);
  const p = decodeURIComponent(url.pathname);
  try {
    // The records API from the local build, as the record documents below are: the same
    // Functions production runs, against tmp/records. Without a build it goes upstream.
    const record = await answerRecordApi(`${url.pathname}${url.search}`, {
      method, headers: req.headers['if-none-match'] ? { 'if-none-match': req.headers['if-none-match'] } : {},
    });
    if (record) {
      const response = new Response(record.body, record);
      response.headers.set('Cache-Control', 'no-store');
      return sendResponse(res, response, { head: method === 'HEAD' });
    }

    // On localhost the site sends CDN requests through /_r/ (src/cdn-url.js) and its API
    // calls to /_api/: both are fetched upstream here.
    const local = method === 'GET' ? await localMapApi(req, url) : null;
    if (local) {
      /** @type {Record<string, string>} */
      const headers = { 'Cache-Control': 'no-store' };
      for (const h of ['content-type', 'location', 'etag']) { const v = local.headers.get(h); if (v) headers[h] = v; }
      const buf = Buffer.from(await local.arrayBuffer());
      res.writeHead(local.status, headers);
      return res.end(buf);
    }
    if (p.startsWith('/_r/') || p.startsWith('/_api/') || p.startsWith('/api/')) {
      const upstream = p.startsWith('/_r/')
        ? `${SITE.dataOrigin}/${p.slice(4)}${url.search}`
        : `${SITE.origin}${p}${url.search}`;
      /** @type {Record<string, string>} */
      const headers = { 'User-Agent': 'civgraph-test-site' };
      for (const h of /** @type {const} */ (['range', 'content-type', 'accept', 'if-none-match'])) { const v = req.headers[h]; if (v) headers[h] = v; }
      const body = ['GET', 'HEAD'].includes(method) ? undefined : await readBody(req);
      const r = await fetch(upstream, { method, headers, body, redirect: 'follow' });
      /** @type {Record<string, string | number>} */
      const out = { 'Cache-Control': 'no-store' };
      for (const h of ['content-type', 'content-range', 'accept-ranges', 'etag']) {
        const v = r.headers.get(h);
        if (v) out[h] = v;
      }
      const buf = Buffer.from(await r.arrayBuffer());
      out['content-length'] = buf.length;
      res.writeHead(r.status, out);
      return res.end(method === 'HEAD' ? undefined : buf);
    }

    // The record documents production answers from D1 through the compatibility Functions
    // (functions/render/metadata/[[path]].js, functions/data/browse, functions/data/graph): the
    // election manifest, bundles, summaries and provenance shards, and the Browse and graph trees.
    // Since the records cutover they are not files in the tree but the records build's output
    // (tmp/records, packages/loader/src/paths.mjs), byte for byte what D1 serves, so they are read
    // from there; without a build the site answers 404 for them, as a fresh checkout would.
    const RECORD_URL = /^\/(render\/metadata\/(elections-test2(\.json|-report\.json|\/|-summaries\/)|election-provenance\/)|data\/(browse|graph)\/|data\/database\/election-provenance(\.json$|-parts\/))/;
    /** @type {string | null} */
    let file = path.join(ROOT, sourceOf(rewritten(p))); // /assets/ui/ is served from packages/ui (packages/served.json)
    if (RECORD_URL.test(p) && !existsSync(file)) file = localPathForUrl(p);
    if (!file || !path.resolve(file).startsWith(ROOT)) return send(res, 403, 'forbidden');
    if (existsSync(file) && statSync(file).isDirectory()) file = path.join(file, 'index.html');
    if (!existsSync(file)) {
      if (existsSync(file + '.html')) file += '.html';
      else return send(res, 404, 'not found');
    }
    const ext = path.extname(file).toLowerCase();
    if (ext === '.html') {
      let html = readFileSync(file, 'utf8');
      html = /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (m) => `${m}${FLAG}`) : FLAG + html;
      return send(res, 200, html, TYPES['.html']);
    }
    // The book list names its files by their full CDN address, which the CDN only lets
    // civgraph.net fetch (CORS), so on localhost the book viewer could not load them. They are
    // sent through /_r/ here instead, as the site already does for its other CDN files.
    if (p === '/data/database/books.json') {
      return send(res, 200, readFileSync(file, 'utf8').replaceAll(`${SITE.dataOrigin}/`, '/_r/'), TYPES['.json']);
    }
    const size = statSync(file).size;
    const range = req.headers.range && /bytes=(\d*)-(\d*)/.exec(req.headers.range);
    if (range) {
      const start = range[1] ? Number(range[1]) : size - Number(range[2]);
      const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
      res.writeHead(206, { 'Content-Type': TYPES[ext] || 'application/octet-stream', 'Content-Range': `bytes ${start}-${end}/${size}`,
        'Content-Length': end - start + 1, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store' });
      return createReadStream(file, { start, end }).pipe(res);
    }
    res.writeHead(200, { 'Content-Type': TYPES[ext] || 'application/octet-stream', 'Content-Length': size, 'Cache-Control': 'no-store' });
    createReadStream(file).pipe(res);
  } catch (err) {
    send(res, 500, String((err && /** @type {Error} */ (err).stack) || err));
  }
}).listen(PORT, '127.0.0.1', () => {
  console.log(`Test site (catalogue: ${CATALOGUE}): http://localhost:${PORT}/maps/`);
});
