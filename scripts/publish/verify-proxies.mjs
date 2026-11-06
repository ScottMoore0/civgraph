#!/usr/bin/env node
/**
 * Prove that each R2-backed prefix is being served BY ITS FUNCTION, and not by
 * something that merely looks healthy.
 *
 * WHY A STATUS CODE IS NOT ENOUGH
 *
 * Three separate things can answer 200 for these paths, and only one of them is
 * correct:
 *
 *   1. the Pages Function, reading R2                     <- the only right answer
 *   2. a committed static copy of the same file           <- shadows the Function
 *      Cloudflare Pages serves a matching static asset IN PREFERENCE to a
 *      Function. That is not a race or a cache; it is the routing order. It kept
 *      functions/data/graph/[[path]].js completely inert from 2026-08-11 to
 *      2026-08-12 while every probe returned a healthy 200 with correct bytes.
 *   3. Cloudflare's edge cache, still holding the old object after a deploy
 *      On 2026-08-12 this made data/documents look like it was still deployed
 *      for hours after it had been correctly removed -- with
 *      cf-cache-status: REVALIDATED, which reads like proof of a live origin.
 *
 * All three return 200. All three return the right bytes. The ONLY thing that
 * separates them is the response headers, because each Function sets a cache
 * policy no other path produces. So that is what this asserts.
 *
 * It also checks the deployment ORIGIN (*.pages.dev) rather than the custom
 * domain for the shadow test, because the origin bypasses both the edge cache
 * and anything configured at the zone. If the origin still serves the file as a
 * static asset, the Function is shadowed no matter what the public URL says.
 *
 * Network-dependent, so deliberately NOT part of `npm run check`. Run it after
 * any deploy that moves data to R2:  npm run verify:proxies
 */
const SITE = process.env.VERIFY_SITE || 'https://civgraph.net';
const ORIGIN = process.env.VERIFY_ORIGIN || 'https://boundaries-website.pages.dev';

/**
 * One entry per proxied prefix. `cacheControl` is the signature the Function
 * sets and nothing else does -- if it does not match, something other than the
 * Function answered.
 */
const PROXIES = [
  {
    name: 'data/maps',
    fn: 'functions/data/maps/[[path]].js',
    key: 'data/maps/agriculture/ni-livestock-bovine.fgb',
    cacheControl: 'public, max-age=86400, stale-while-revalidate=604800',
  },
  {
    name: 'data/graph',
    fn: 'functions/data/graph/[[path]].js',
    key: 'data/graph/manifest.json',
    cacheControl: 'public, max-age=86400, stale-while-revalidate=604800',
    miss: 'data/graph/entity-shards/entities-999999.json',
  },
  {
    name: 'data/browse',
    fn: 'functions/data/browse/[[path]].js',
    key: 'data/browse/index.json',
    cacheControl: 'public, max-age=0, must-revalidate',
    miss: 'data/browse/details/maps/definitely-not-a-real-map.json',
    // Browse must answer 304 to a conditional request. Without it,
    // `must-revalidate` re-downloads the body every time, and
    // source-index-shards/sources-000.json alone is 6 MB per visit.
    expectConditional: true,
  },
];

const encode = (key) => key.split('/').map(encodeURIComponent).join('/');

const failures = [];
const note = (msg) => console.log(`  ${msg}`);

for (const proxy of PROXIES) {
  console.log(`\n${proxy.name}  (${proxy.fn})`);
  const url = `${SITE}/${encode(proxy.key)}`;

  let res;
  try {
    res = await fetch(url, { redirect: 'follow' });
  } catch (error) {
    failures.push(`${proxy.name}: request failed — ${error.message}`);
    note(`FAIL  unreachable: ${error.message}`);
    continue;
  }

  if (!res.ok) {
    failures.push(`${proxy.name}: ${res.status} for a key that should exist (${proxy.key})`);
    note(`FAIL  ${res.status} for ${proxy.key}`);
    continue;
  }

  const actual = res.headers.get('cache-control');
  if (actual !== proxy.cacheControl) {
    failures.push(
      `${proxy.name}: answered by something other than its Function.\n` +
      `      expected Cache-Control: ${proxy.cacheControl}\n` +
      `      actual   Cache-Control: ${actual}\n` +
      '      A static copy in the deploy shadows the Function; an edge-cached ' +
      'object outlives it. Both return 200 with correct bytes.'
    );
    note(`FAIL  Cache-Control mismatch: got "${actual}"`);
  } else {
    note(`ok    served by the Function (${actual})`);
  }

  // The shadow test, on the deployment origin so the edge cache cannot flatter it.
  //
  // This CANNOT be a status check. Functions run on *.pages.dev exactly as they do
  // on the custom domain, so a 200 here is equally consistent with "the Function
  // answered" and "a static copy shadowed it" -- the first draft of this script
  // asserted `!originRes.ok` and reported two false failures against a deployment
  // that was in fact correct. The header is the only discriminator, same as above.
  try {
    const originRes = await fetch(`${ORIGIN}/${encode(proxy.key)}`, { redirect: 'follow' });
    const originCache = originRes.headers.get('cache-control');
    if (originRes.ok && originCache !== proxy.cacheControl) {
      failures.push(
        `${proxy.name}: the deployment origin serves ${proxy.key} from something other than ` +
        `the Function (Cache-Control: ${originCache}). A committed static copy shadows it. ` +
        'Exclude the prefix in .cfignore as a DIRECTORY pattern — glob patterns are not honoured.'
      );
      note(`FAIL  origin shadowed by a static copy (${originCache})`);
    } else if (originRes.ok) {
      note('ok    origin also answered by the Function, so nothing shadows it');
    } else {
      note(`ok    nothing on the origin for this key (${originRes.status})`);
    }
  } catch (error) {
    note(`warn  origin check skipped: ${error.message}`);
  }

  if (proxy.miss) {
    const missRes = await fetch(`${SITE}/${encode(proxy.miss)}`, { redirect: 'follow' });
    if (missRes.ok) {
      failures.push(
        `${proxy.name}: a missing key returned ${missRes.status} instead of 404. ` +
        'Pages can answer a missing asset with index.html at HTTP 200, which every ' +
        'status-code check reads as healthy.'
      );
      note(`FAIL  missing key returned ${missRes.status}, expected 404`);
    } else {
      note(`ok    missing key 404s (${missRes.status})`);
    }
  }

  if (proxy.expectConditional) {
    const etag = res.headers.get('etag');
    if (!etag) {
      failures.push(`${proxy.name}: no ETag, so must-revalidate re-downloads the whole body every time.`);
      note('FAIL  no ETag on a must-revalidate response');
    } else {
      const conditional = await fetch(url, { headers: { 'If-None-Match': etag } });
      if (conditional.status !== 304) {
        failures.push(`${proxy.name}: conditional request returned ${conditional.status}, expected 304.`);
        note(`FAIL  conditional request returned ${conditional.status}, expected 304`);
      } else {
        note('ok    conditional request answers 304');
      }
    }
  }
}

console.log('');
if (failures.length) {
  console.error(`FAIL: ${failures.length} problem(s) with R2 proxy serving:`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log(`PASS: all ${PROXIES.length} R2-backed prefixes are served by their own Function.`);
