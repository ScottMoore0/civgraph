/**
 * /analysis/* is gone. The border-poll dry run left the repository and the site on
 * 2026-11-06 (it had been served by accident). Pages kept answering the old paths from
 * its own asset cache after the files were removed from the deployment, and a zone
 * cache purge does not reach that layer, so these paths are routed here (see
 * _routes.json) and answered 410 Gone with no caching.
 */
export function onRequest() {
  return new Response('Gone', {
    status: 410,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex',
    },
  });
}
