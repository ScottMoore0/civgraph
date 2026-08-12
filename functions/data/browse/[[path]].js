/**
 * Serve the Browse indexes and detail pages from R2.
 *
 * 2,386 files, 351 MB, all JSON: the data behind browse/browse.js. Almost all of
 * it is build output of scripts/build-browse-indexes.mjs.
 *
 * TWO THINGS HERE ARE DELIBERATELY NOT COPIED FROM functions/data/graph.
 *
 * 1. THE CACHE POLICY. The graph proxy sends max-age=86400 because graph shards
 *    are immutable -- each build writes a whole new set and the client reaches
 *    them through a manifest. Browse is the opposite: index.json, persons.json
 *    and the shard files live at FIXED urls and are rewritten by every build. A
 *    day of caching there would serve a stale Browse for a day after each
 *    deploy, with no way to bust it. Pages currently sends
 *    `public, max-age=0, must-revalidate` for this tree, so that is what this
 *    sends. The migration moves where the bytes live; it is not the place to
 *    change how they are cached.
 *
 * 2. ETAG AND CONDITIONAL REQUESTS. `must-revalidate` only stays cheap if
 *    revalidation can answer 304. Without an ETag every revalidation transfers
 *    the whole body, and source-index-shards/sources-000.json alone is 6 MB --
 *    this would have turned a free 304 into a 6 MB download on every Browse
 *    visit, which is worse than not migrating at all. R2 evaluates the
 *    precondition itself via `onlyIf`; a body-less result means "not modified".
 *
 * NO FALL-THROUGH ON A MISS, unlike the graph proxy. The graph one needed it
 * because it was deployed while its files were still tracked. Here the exclusion
 * and the untracking land in the same commit as this file, so there is never a
 * static copy to fall back to and a miss is a genuine miss.
 *
 * Note that Pages serves a matching static asset IN PREFERENCE to a Function.
 * That is why data/browse/ must stay in .cfignore: re-deploying those files
 * would shadow this Function completely and silently, exactly as happened to the
 * graph proxy between 2026-08-11 and 2026-08-12.
 */
const CACHE_CONTROL = 'public, max-age=0, must-revalidate';

export async function onRequestGet(context) {
  const bucket = context.env.MAPS_BUCKET;
  if (!bucket) return context.next();

  const key = `data/browse/${context.params.path.map(decodeURIComponent).join('/')}`;

  const object = await bucket.get(key, { onlyIf: context.request.headers });
  if (!object) {
    return new Response('Not found', {
      status: 404,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }

  const headers = new Headers({
    'Cache-Control': CACHE_CONTROL,
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json; charset=utf-8',
  });
  if (object.httpEtag) headers.set('ETag', object.httpEtag);

  // R2 returns the object WITHOUT a body when the caller's If-None-Match or
  // If-Modified-Since already matched. `body` is the only reliable signal that
  // this happened, so it is what decides 304 rather than re-parsing the headers.
  if (!('body' in object) || object.body === null || object.body === undefined) {
    return new Response(null, { status: 304, headers });
  }

  return new Response(object.body, { headers });
}
