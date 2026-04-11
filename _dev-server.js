/**
 * Local dev server with CORS proxy for data.civgraph.net.
 * Serves local files and proxies remote FGB requests through localhost.
 *
 * Usage: node _dev-server.js
 */
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = 3000;
const ROOT = __dirname;
const REMOTE_HOST = 'data.civgraph.net';

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.fgb': 'application/octet-stream', '.wasm': 'application/wasm',
  '.map': 'application/json', '.geojson': 'application/json',
  '.ico': 'image/x-icon', '.webp': 'image/webp', '.gif': 'image/gif',
  '.xml': 'text/xml', '.txt': 'text/plain',
};

const server = http.createServer((req, res) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Range',
    });
    res.end();
    return;
  }

  const parsed = url.parse(req.url);
  const pathname = decodeURIComponent(parsed.pathname);

  // Proxy requests to /data/ that would normally go to data.civgraph.net
  // The app's data-service resolves remote URLs, but the FGB worker fetches them directly.
  // We intercept /_r/ prefix as a proxy route.
  if (pathname.startsWith('/_r/')) {
    const remotePath = pathname.slice(3);
    proxyRequest(`https://${REMOTE_HOST}${remotePath}`, req, res);
    return;
  }

  // Local file serving
  let filePath = path.join(ROOT, pathname);
  if (filePath.endsWith(path.sep) || pathname === '/') {
    filePath = path.join(ROOT, 'index.html');
  }

  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const ext = path.extname(filePath).toLowerCase();
    const mime = MIME[ext] || 'application/octet-stream';
    const stat = fs.statSync(filePath);
    const headers = {
      'Content-Type': mime,
      'Content-Length': stat.size,
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-cache',
    };
    res.writeHead(200, headers);
    fs.createReadStream(filePath).pipe(res);
  } else {
    res.writeHead(404);
    res.end('Not found');
  }
});

function proxyRequest(remoteUrl, req, res) {
  const options = {
    headers: {
      'User-Agent': 'CivGraph-DevServer/1.0',
    }
  };
  // Forward range headers for FGB streaming
  if (req.headers.range) {
    options.headers['Range'] = req.headers.range;
  }

  https.get(remoteUrl, options, (proxyRes) => {
    if (proxyRes.statusCode >= 300 && proxyRes.statusCode < 400 && proxyRes.headers.location) {
      proxyRequest(proxyRes.headers.location, req, res);
      return;
    }
    const headers = {
      'Content-Type': proxyRes.headers['content-type'] || 'application/octet-stream',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Expose-Headers': 'Content-Length, Content-Range',
    };
    if (proxyRes.headers['content-length']) headers['Content-Length'] = proxyRes.headers['content-length'];
    if (proxyRes.headers['content-range']) headers['Content-Range'] = proxyRes.headers['content-range'];
    res.writeHead(proxyRes.statusCode, headers);
    proxyRes.pipe(res);
  }).on('error', (err) => {
    console.error(`Proxy error: ${remoteUrl}: ${err.message}`);
    res.writeHead(502);
    res.end('Proxy error');
  });
}

server.listen(PORT, () => {
  console.log(`\nDev server running at http://localhost:${PORT}`);
  console.log(`Remote proxy: /_r/... -> https://${REMOTE_HOST}/...`);
  console.log(`Serving from: ${ROOT}\n`);
});
