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
import { SITE } from '../../packages/config/src/node.mjs';
import { sourceOf } from '../../scripts/build/site.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const STATE = path.join(HERE, 'state');
const portArg = process.argv.indexOf('--port');
const PORT = Number(portArg > 0 ? process.argv[portArg + 1] : process.env.PORT || 8780);

mkdirSync(STATE, { recursive: true });

/** @type {Record<string, string>} */
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
  '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml', '.pdf': 'application/pdf', '.fgb': 'application/octet-stream', '.pmtiles': 'application/octet-stream',
  '.geojson': 'application/geo+json', '.webmanifest': 'application/manifest+json', '.map': 'application/json',
};
const INJECT = '<link rel="stylesheet" href="/__editor/editor.css"><script src="/__editor/editor.js" defer></script>';

const stateFile = (/** @type {string} */ name) => path.join(STATE, `${name}.json`);
/**
 * A state file's JSON (it is sent on as it is), or the fallback when there is none yet.
 * @param {string} name
 * @param {unknown} fallback
 * @returns {unknown}
 */
function readState(name, fallback) {
  try { return JSON.parse(readFileSync(stateFile(name), 'utf8')); } catch { return fallback; }
}
/** @param {string} name @param {unknown} value */
function writeState(name, value) {
  writeFileSync(stateFile(name), JSON.stringify(value, null, 2) + '\n');
  appendFileSync(path.join(STATE, 'history.jsonl'), JSON.stringify({ at: new Date().toISOString(), file: name, value }) + '\n');
}

/**
 * @param {import('node:http').IncomingMessage} req
 * @returns {Promise<string>}
 */
function readBody(req) {
  return new Promise((resolve, reject) => {
    /** @type {Buffer[]} */
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/**
 * @param {import('node:http').ServerResponse} res
 * @param {number} status
 * @param {string | Buffer} body
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
    // The editor's own files and its state.
    if (p === '/__editor/editor.js' || p === '/__editor/editor.css') {
      return send(res, 200, readFileSync(path.join(HERE, path.basename(p))), TYPES[path.extname(p)]);
    }
    if (p === '/__editor/state') {
      return send(res, 200, JSON.stringify({ edits: readState('edits', null), notes: readState('notes', []) }), TYPES['.json']);
    }
    if ((p === '/__editor/state/edits' || p === '/__editor/state/notes') && method === 'PUT') {
      const value = JSON.parse(await readBody(req));
      writeState(path.basename(p), value);
      return send(res, 200, '{"ok":true}', TYPES['.json']);
    }

    // On localhost the site sends CDN requests through /_r/ (the CDN's CORS policy does not
    // allow localhost; see src/cdn-url.js), and its API calls to /_api/: both are fetched here.
    if (p.startsWith('/_r/') || p.startsWith('/_api/') || p.startsWith('/api/')) {
      const upstream = p.startsWith('/_r/')
        ? `${SITE.dataOrigin}/${p.slice(4)}${url.search}`
        : `${SITE.origin}${p}${url.search}`;
      /** @type {Record<string, string>} */
      const headers = { 'User-Agent': 'civgraph-catalogue-editor' };
      for (const h of /** @type {const} */ (['range', 'content-type', 'accept', 'if-none-match'])) { const v = req.headers[h]; if (v) headers[h] = v; }
      const body = ['GET', 'HEAD'].includes(method) ? undefined : await readBody(req);
      const r = await fetch(upstream, { method, headers, body, redirect: 'follow' });
      /** @type {Record<string, string | number>} */
      const out = { 'Cache-Control': 'no-store' };
      for (const h of ['content-type', 'content-range', 'content-length', 'accept-ranges', 'etag', 'content-encoding']) {
        const v = r.headers.get(h);
        if (v && !(h === 'content-encoding' || h === 'content-length')) out[h] = v;
      }
      const buf = Buffer.from(await r.arrayBuffer());
      out['content-length'] = buf.length;
      res.writeHead(r.status, out);
      return res.end(method === 'HEAD' ? undefined : buf);
    }

    // The site, from the working tree (site/, packages and data dirs: sourceOf).
    let file = path.join(ROOT, sourceOf(p));
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
    send(res, 500, String(err && /** @type {Error} */ (err).stack || err));
  }
}).listen(PORT, '127.0.0.1', () => {
  console.log(`Catalogue editor: http://localhost:${PORT}/maps/  (state in ${path.relative(ROOT, STATE)})`);
});
