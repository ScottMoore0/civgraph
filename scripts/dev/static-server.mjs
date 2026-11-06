import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, resolve } from 'node:path';

export function createTestStaticServer(port, root = process.cwd()) {
  const ROOT = resolve(root);
  return createServer((req, res) => {
    const url = new URL(req.url || '/', `http://127.0.0.1:${port}`);
    let path = url.pathname === '/' ? '/index.html' : url.pathname;
    path = decodeURIComponent(path).replace(/^\/+/, '');
    let filePath = resolve(ROOT, path);
    if (existsSync(filePath) && statSync(filePath).isDirectory()) filePath = resolve(filePath, 'index.html');
    if (!filePath.startsWith(ROOT) || !existsSync(filePath) || statSync(filePath).isDirectory()) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    const buffer = readFileSync(filePath);
    const headers = {
      'content-type': contentType(filePath),
      'accept-ranges': 'bytes',
      'cache-control': 'no-store'
    };
    const range = req.headers.range;
    if (range) {
      const match = /^bytes=(\d+)-(\d*)$/.exec(range);
      if (!match) {
        res.writeHead(416, headers);
        res.end();
        return;
      }
      const start = Number(match[1]);
      const end = match[2] ? Number(match[2]) : buffer.length - 1;
      if (!Number.isFinite(start) || !Number.isFinite(end) || start >= buffer.length || end < start) {
        res.writeHead(416, { ...headers, 'content-range': `bytes */${buffer.length}` });
        res.end();
        return;
      }
      const safeEnd = Math.min(end, buffer.length - 1);
      res.writeHead(206, {
        ...headers,
        'content-length': safeEnd - start + 1,
        'content-range': `bytes ${start}-${safeEnd}/${buffer.length}`
      });
      res.end(buffer.subarray(start, safeEnd + 1));
      return;
    }
    res.writeHead(200, { ...headers, 'content-length': buffer.length });
    res.end(buffer);
  });
}

function contentType(filePath) {
  const extension = extname(filePath).toLowerCase();
  if (filePath.endsWith('.pbf')) return 'application/x-protobuf';
  if (filePath.endsWith('.pmtiles')) return 'application/octet-stream';
  if (extension === '.json') return 'application/json';
  if (extension === '.js') return 'text/javascript';
  if (extension === '.css') return 'text/css';
  if (extension === '.html') return 'text/html';
  if (extension === '.svg') return 'image/svg+xml';
  if (['.png', '.jpg', '.jpeg', '.webp'].includes(extension)) return `image/${extension.slice(1).replace('jpg', 'jpeg')}`;
  return 'application/octet-stream';
}
