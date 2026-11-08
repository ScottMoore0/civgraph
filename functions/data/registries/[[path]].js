/**
 * /data/registries/* : not published. The registries (councils, parties, statuses, layer types)
 * are build-time configuration; scripts/build/site.mjs keeps data/registries/ out of dist/.
 *
 * They went live by accident with the rf-registries landing on 7 Nov 2026, with a 7-day
 * s-maxage, and Cloudflare Pages kept serving those copies from its own asset store after the
 * files left the build (a zone cache purge does not reach that store). Routing the prefix here
 * puts a Function in front of the store, so every request now gets an uncached 404, as any
 * other path the site does not publish.
 */

/** @param {CatchAllContext} _context */
export function onRequest(_context) {
  return new Response('Not found', {
    status: 404,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' },
  });
}
