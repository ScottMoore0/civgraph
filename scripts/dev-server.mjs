#!/usr/bin/env node
/**
 * Local preview server that behaves like production where it matters.
 *
 * The preview used to be `python -m http.server`, which fell short in three ways:
 *   - map tiles never drew: data.civgraph.net's CORS policy allows https://civgraph.net
 *     and not localhost, so every .pmtiles request was blocked and only the layout could
 *     be checked, not the map;
 *   - it served one request at a time, so the app's parallel loads queued behind each
 *     other and a page took 20-30 s to open;
 *   - /_api did not exist, so nothing could be compared against the live databases.
 *
 * This serves the working tree concurrently, proxies the R2 bucket at /_r/ (the path
 * src/cdn-url.js already uses on localhost) with Range requests passed through, and
 * rewrites https://data.civgraph.net/ to /_r/ in the HTML, JS, CSS and JSON it serves, so
 * tile, FGB and thumbnail URLs written into the metadata all go through the proxy. The live
 * bucket's CORS settings are left alone.
 *
 *   node scripts/dev-server.mjs                 http://localhost:8793, /_api answered 404 so
 *                                               the app falls back to the LOCAL static data
 *                                               (what a change will look like once published)
 *   node scripts/dev-server.mjs --api live      /_api GETs proxied to https://civgraph.net
 *                                               (what production serves now)
 *   node scripts/dev-server.mjs --port 8794
 *
 * Read-only: the proxies forward GET and HEAD only.
 */
import http from 'node:http';
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const PORT = Number(opt('--port', '8793'));
const API = opt('--api', 'static');
const ROOT = process.cwd();
const CDN = 'https://data.civgraph.net';
const SITE = 'https://civgraph.net';
const USER_AGENT = 'civgraph-dev-preview (+https://civgraph.net)';

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.pmtiles': 'application/octet-stream', '.fgb': 'application/octet-stream',
  '.pbf': 'application/x-protobuf', '.geojson': 'application/geo+json', '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml', '.webmanifest': 'application/manifest+json', '.pdf': 'application/pdf'
};
const REWRITE = new Set(['.html', '.js', '.mjs', '.css', '.json']);

async function proxy(req, res, upstream) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405).end('read-only preview');
    return;
  }
  const headers = { 'user-agent': USER_AGENT };
  if (req.headers.range) headers.range = req.headers.range;
  try {
    const response = await fetch(upstream, { method: req.method, headers });
    const out = {};
    for (const name of ['content-type', 'content-length', 'content-range', 'accept-ranges', 'etag', 'last-modified']) {
      const value = response.headers.get(name);
      if (value) out[name] = value;
    }
    out['cache-control'] = 'no-store';
    res.writeHead(response.status, out);
    if (req.method === 'HEAD' || !response.body) return res.end();
    for await (const chunk of response.body) res.write(chunk);
    res.end();
  } catch (error) {
    res.writeHead(502).end(`proxy error: ${error.message}`);
  }
}

function serveFile(req, res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const type = TYPES[ext] || 'application/octet-stream';
  if (REWRITE.has(ext)) {
    const body = readFileSync(filePath, 'utf8').replaceAll(`${CDN}/`, '/_r/');
    res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' });
    return res.end(req.method === 'HEAD' ? undefined : body);
  }
  const size = statSync(filePath).size;
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
  if (range) {
    const start = range[1] ? Number(range[1]) : size - Number(range[2]);
    const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    res.writeHead(206, { 'content-type': type, 'content-range': `bytes ${start}-${end}/${size}`, 'content-length': end - start + 1, 'accept-ranges': 'bytes', 'cache-control': 'no-store' });
    return req.method === 'HEAD' ? res.end() : createReadStream(filePath, { start, end }).pipe(res);
  }
  res.writeHead(200, { 'content-type': type, 'content-length': size, 'accept-ranges': 'bytes', 'cache-control': 'no-store' });
  return req.method === 'HEAD' ? res.end() : createReadStream(filePath).pipe(res);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = decodeURIComponent(url.pathname);
  if (pathname.startsWith('/_r/')) return proxy(req, res, `${CDN}/${pathname.slice(4)}${url.search}`);
  if (pathname.startsWith('/_api/')) {
    if (API === 'live') return proxy(req, res, `${SITE}${pathname}${url.search}`);
    return res.writeHead(404, { 'content-type': 'application/json' }).end('{"error":"no API in the static preview"}');
  }
  let filePath = path.normalize(path.join(ROOT, pathname));
  if (!filePath.startsWith(ROOT)) return res.writeHead(403).end();
  if (existsSync(filePath) && statSync(filePath).isDirectory()) filePath = path.join(filePath, 'index.html');
  if (!existsSync(filePath)) return res.writeHead(404).end('not found');
  return serveFile(req, res, filePath);
});

server.listen(PORT, () => {
  console.log(`civgraph preview on http://localhost:${PORT}  (API: ${API === 'live' ? 'live civgraph.net' : 'local static data'})`);
});
