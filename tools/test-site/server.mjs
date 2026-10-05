#!/usr/bin/env node
/**
 * The site from the working tree, with the rebuilt catalogue switched on, for review.
 *
 *   node tools/test-site/server.mjs [--port 8790] [--catalogue next|current]
 *   open http://localhost:8790/maps/
 *
 * Serves the working tree as the static site does, proxies /_r/ (CDN) and /_api/ (the live
 * API) as the site expects on localhost, and sets window.CIVGRAPH_CATALOGUE on every page so
 * the catalogue pane mounts the new implementation (src/catalogue/) instead of the current
 * one. The live site is unaffected: without that setting, or ?catalogue=next, it renders the
 * current pane exactly as before.
 */
import { createServer } from 'node:http';
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : fallback; };
const PORT = Number(arg('--port', process.env.PORT || 8790));
const CATALOGUE = arg('--catalogue', 'next');

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
  '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml', '.pdf': 'application/pdf', '.fgb': 'application/octet-stream', '.pmtiles': 'application/octet-stream',
  '.geojson': 'application/geo+json', '.webmanifest': 'application/manifest+json', '.map': 'application/json',
};
const FLAG = `<script>window.CIVGRAPH_CATALOGUE=${JSON.stringify(CATALOGUE)};</script>`;

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
function send(res, status, body, type = 'text/plain; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(body);
}

createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const p = decodeURIComponent(url.pathname);
  try {
    // On localhost the site sends CDN requests through /_r/ (src/cdn-url.js) and its API
    // calls to /_api/: both are fetched upstream here.
    if (p.startsWith('/_r/') || p.startsWith('/_api/') || p.startsWith('/api/')) {
      const upstream = p.startsWith('/_r/')
        ? `https://data.civgraph.net/${p.slice(4)}${url.search}`
        : `https://civgraph.net${p}${url.search}`;
      const headers = { 'User-Agent': 'civgraph-test-site' };
      for (const h of ['range', 'content-type', 'accept', 'if-none-match']) if (req.headers[h]) headers[h] = req.headers[h];
      const body = ['GET', 'HEAD'].includes(req.method) ? undefined : await readBody(req);
      const r = await fetch(upstream, { method: req.method, headers, body, redirect: 'follow' });
      const out = { 'Cache-Control': 'no-store' };
      for (const h of ['content-type', 'content-range', 'accept-ranges', 'etag']) {
        const v = r.headers.get(h);
        if (v) out[h] = v;
      }
      const buf = Buffer.from(await r.arrayBuffer());
      out['content-length'] = buf.length;
      res.writeHead(r.status, out);
      return res.end(req.method === 'HEAD' ? undefined : buf);
    }

    let file = path.join(ROOT, p);
    if (!file.startsWith(ROOT)) return send(res, 403, 'forbidden');
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
      return send(res, 200, readFileSync(file, 'utf8').replaceAll('https://data.civgraph.net/', '/_r/'), TYPES['.json']);
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
    send(res, 500, String((err && err.stack) || err));
  }
}).listen(PORT, '127.0.0.1', () => {
  console.log(`Test site (catalogue: ${CATALOGUE}): http://localhost:${PORT}/maps/`);
});
