/**
 * Serve the semantic graph shards from R2.
 *
 * data/graph is 2 GB across 4,604 files, all JSON, and every byte of it is
 * currently committed to git. It is pure build output — build-semantic-graph.mjs
 * regenerates it from data/browse, the catalogue and the election data — so
 * tracking it costs repository size and history weight for no benefit.
 *
 * FALLS THROUGH ON A MISS, DELIBERATELY.
 *
 * functions/data/maps/[[path]].js returns a hard 404 when a key is absent,
 * which is correct there because data/maps is no longer in the repository and a
 * silent fallback would hide the fact that an object was never uploaded. Here
 * the opposite is wanted, because this Function has to be deployed while the
 * files are still tracked:
 *
 *   1. deploy this Function      -> R2 empty, every request falls through to
 *                                   the committed copy, nothing changes
 *   2. upload data/graph to R2   -> requests start being served from R2
 *   3. untrack data/graph        -> the fallback has nothing left to serve, and
 *                                   R2 is now the only source
 *
 * Without the fall-through, step 1 would 404 the entire graph until step 2
 * finished, which for 2 GB is a long outage for no reason. After step 3 the
 * fall-through becomes inert: Pages has no file to answer with, so a missing
 * object 404s as it should.
 *
 * The trap this avoids is the one that produced two outages in this project
 * already: a Pages SPA fallback answering a missing asset with index.html at
 * HTTP 200, which every status-code check reads as healthy. `context.next()`
 * resolves against the static assets, so a genuinely absent file yields Pages'
 * own 404 rather than a 200 that lies.
 */
export async function onRequestGet(context) {
  const bucket = context.env.MAPS_BUCKET;
  if (!bucket) return context.next();

  const key = `data/graph/${context.params.path.join('/')}`;

  // Graph shards are immutable once built: each rebuild writes the whole set and
  // the client requests them through a manifest. A day of caching with a week of
  // stale-while-revalidate matches the maps prefix rather than inventing a
  // second policy.
  const headers = {
    'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800',
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json; charset=utf-8',
  };

  const obj = await bucket.get(key);
  if (!obj) return context.next();

  return new Response(obj.body, { headers });
}
