/**
 * Serves the Independent PRONI Search single-page app shell for every /proni
 * and /proni/<reference> URL, so deep links like /proni/AA/3 load the app and
 * its client-side router renders the right view. The app's assets are absolute
 * (/apps/proni-search/…), so the same HTML works under any /proni/* path.
 */
const SHELL_VERSION = 'v3';

export async function serveShell(context) {
  const cache = caches.default;
  const keyUrl = new URL(context.request.url);
  const cacheKey = new Request(`https://shell.invalid/proni-shell/${SHELL_VERSION}`, { method: 'GET' });
  const hit = await cache.match(cacheKey);
  if (hit) return hit;

  const asset = await fetch(new URL('/apps/proni-search/index.html', keyUrl.origin));
  const html = await asset.text();
  const resp = new Response(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=300, s-maxage=3600',
    },
  });
  if (asset.status === 200) context.waitUntil(cache.put(cacheKey, resp.clone()));
  return resp;
}
