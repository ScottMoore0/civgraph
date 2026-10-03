#!/usr/bin/env node
/**
 * A local copy of the Civgraph site with an editor for the catalogue pane.
 *
 *   node tools/catalogue-editor/server.mjs [--port 8780]
 *   open http://localhost:8780/maps/
 *
 * Serves the working tree exactly as the static site does, and adds two files to every HTML
 * page: tools/catalogue-editor/editor.js and editor.css. These make the catalogue pane's
 * labels, fields and contents structure editable in place, and let a right-click leave a
 * note pinned to that point of the page. Nothing is changed on the site: every edit and note
 * is written to tools/catalogue-editor/state/ (edits.json, notes.json, and an append-only
 * history.jsonl), keyed by the catalogue's own ids, for review before anything is applied to
 * src/ui-controller.js or data/database/maps.json.
 */
import { createServer } from 'node:http';
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync, createReadStream } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const STATE = path.join(HERE, 'state');
const portArg = process.argv.indexOf('--port');
const PORT = Number(portArg > 0 ? process.argv[portArg + 1] : process.env.PORT || 8780);

mkdirSync(STATE, { recursive: true });

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
  '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml', '.pdf': 'application/pdf', '.fgb': 'application/octet-stream', '.pmtiles': 'application/octet-stream',
  '.geojson': 'application/geo+json', '.webmanifest': 'application/manifest+json', '.map': 'application/json',
};
const INJECT = '<link rel="stylesheet" href="/__editor/editor.css"><script src="/__editor/editor.js" defer></script>';

const stateFile = (name) => path.join(STATE, `${name}.json`);
function readState(name, fallback) {
  try { return JSON.parse(readFileSync(stateFile(name), 'utf8')); } catch { return fallback; }
}
function writeState(name, value) {
  writeFileSync(stateFile(name), JSON.stringify(value, null, 2) + '\n');
  appendFileSync(path.join(STATE, 'history.jsonl'), JSON.stringify({ at: new Date().toISOString(), file: name, value }) + '\n');
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
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
    // The editor's own files and its state.
    if (p === '/__editor/editor.js' || p === '/__editor/editor.css') {
      return send(res, 200, readFileSync(path.join(HERE, path.basename(p))), TYPES[path.extname(p)]);
    }
    if (p === '/__editor/state') {
      return send(res, 200, JSON.stringify({ edits: readState('edits', null), notes: readState('notes', []) }), TYPES['.json']);
    }
    if ((p === '/__editor/state/edits' || p === '/__editor/state/notes') && req.method === 'PUT') {
      const value = JSON.parse(await readBody(req));
      writeState(path.basename(p), value);
      return send(res, 200, '{"ok":true}', TYPES['.json']);
    }

    // On localhost the site sends CDN requests through /_r/ (the CDN's CORS policy does not
    // allow localhost; see src/cdn-url.js), and its API calls to /_api/: both are fetched here.
    if (p.startsWith('/_r/') || p.startsWith('/_api/') || p.startsWith('/api/')) {
      const upstream = p.startsWith('/_r/')
        ? `https://data.civgraph.net/${p.slice(4)}${url.search}`
        : `https://civgraph.net${p}${url.search}`;
      const headers = { 'User-Agent': 'civgraph-catalogue-editor' };
      for (const h of ['range', 'content-type', 'accept', 'if-none-match']) if (req.headers[h]) headers[h] = req.headers[h];
      const body = ['GET', 'HEAD'].includes(req.method) ? undefined : await readBody(req);
      const r = await fetch(upstream, { method: req.method, headers, body, redirect: 'follow' });
      const out = { 'Cache-Control': 'no-store' };
      for (const h of ['content-type', 'content-range', 'content-length', 'accept-ranges', 'etag', 'content-encoding']) {
        const v = r.headers.get(h);
        if (v && !(h === 'content-encoding' || h === 'content-length')) out[h] = v;
      }
      const buf = Buffer.from(await r.arrayBuffer());
      out['content-length'] = buf.length;
      res.writeHead(r.status, out);
      return res.end(req.method === 'HEAD' ? undefined : buf);
    }

    // The site, from the working tree.
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
      html = html.includes('</head>') ? html.replace('</head>', `${INJECT}</head>`) : html + INJECT;
      return send(res, 200, html, TYPES['.html']);
    }
    const size = statSync(file).size;
    const range = req.headers.range && /bytes=(\d*)-(\d*)/.exec(req.headers.range);
    if (range) {
      const start = range[1] ? Number(range[1]) : size - Number(range[2]);
      const end = range[1] && range[2] ? Number(range[2]) : size - 1;
      res.writeHead(206, { 'Content-Type': TYPES[ext] || 'application/octet-stream', 'Content-Range': `bytes ${start}-${end}/${size}`,
        'Content-Length': end - start + 1, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store' });
      return createReadStream(file, { start, end }).pipe(res);
    }
    res.writeHead(200, { 'Content-Type': TYPES[ext] || 'application/octet-stream', 'Content-Length': size, 'Cache-Control': 'no-store' });
    createReadStream(file).pipe(res);
  } catch (err) {
    send(res, 500, String(err && err.stack || err));
  }
}).listen(PORT, '127.0.0.1', () => {
  console.log(`Catalogue editor: http://localhost:${PORT}/maps/  (state in ${path.relative(ROOT, STATE)})`);
});
