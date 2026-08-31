/**
 * Enumerate the whole R2 bucket. Access-gated, contributors and admins only.
 *
 * WHY THIS IS SEPARATE FROM data-index
 *
 * There are two different questions. "What may the public see" is answered by
 * /_api/data-index, which serves only the publication allowlist. "What is actually in the
 * bucket" is this, and it deliberately ignores the allowlist -- because the point of an
 * audit view is to show the things nobody approved.
 *
 * That distinction is not hypothetical. On 2026-08-31 six prefixes were publicly readable
 * without ever passing the allowlist: data/deprivation/, data/nisra-files/,
 * data/nisra-portal/, data/pointclouds/, data/polling/ and data/thumbnails/. Finding that
 * required S3 credentials and a local script, because nothing in the deployed system could
 * answer "what is in here". This closes that gap.
 *
 * WHY IT LIVES UNDER contributions/
 *
 * It was at /_api/r2-index and was unreachable by everyone, including correctly listed
 * contributors. The Access application covers the path `_api/contributions` and nothing
 * else -- deliberately, see login.js -- so Access never intercepted /_api/r2-index, never
 * issued a JWT for it, and requireContributor found no identity to check.
 *
 * Measured on 2026-08-31, which is how the two cases are told apart:
 *
 *     /_api/contributions/whoami   302   Access intercepts, redirects to sign-in
 *     /_api/r2-index               401   falls through to the Function, no identity
 *
 * A 401 alone looks like a normal "not signed in" refusal, which is why this survived
 * review. Sitting inside the protected prefix means the protection is inherited from the
 * path rather than depending on Zero Trust config staying in step with the repo.
 *
 * ACCESS CONTROL is the same gate the rest of contributions uses: Cloudflare Access
 * supplies a signed identity, and requireContributor checks it against
 * CIVGRAPH_CONTRIBUTORS / CIVGRAPH_ADMINS. An unset allowlist means CLOSED -- see _auth.js.
 *
 * Every entry is flagged with whether it falls inside the publication allowlist, so the
 * unreviewed prefixes are obvious rather than needing to be cross-referenced by hand.
 *
 *   GET /_api/contributions/r2-index                    top level
 *   GET /_api/contributions/r2-index?prefix=data/       one level down
 *   GET /_api/contributions/r2-index?prefix=data/maps/&cursor=...&limit=500
 */
import { jsonResponse, jsonNotAllowed, requireContributor, sanitizeAuth } from '../_auth.js';
import { listLevel, normalisePrefix, parseLimit, publicUrl } from '../_r2-listing.js';
import { isPublicPrefix } from '../_public-prefixes.js';

export async function onRequest(context) {
  if (context.request.method !== 'GET') return jsonNotAllowed(context.request.method);

  const { auth, response } = requireContributor(context);
  if (response) return response;

  const bucket = context.env.MAPS_BUCKET;
  if (!bucket) {
    return jsonResponse({ ok: false, error: 'R2 binding MAPS_BUCKET is not configured.' }, { status: 500 });
  }

  const url = new URL(context.request.url);
  const prefix = normalisePrefix(url.searchParams.get('prefix'));
  if (prefix === null) {
    return jsonResponse({ ok: false, error: 'Invalid prefix.' }, { status: 400 });
  }

  let listing;
  try {
    listing = await listLevel(bucket, {
      prefix,
      cursor: url.searchParams.get('cursor') || undefined,
      limit: parseLimit(url.searchParams.get('limit')),
    });
  } catch (error) {
    return jsonResponse({ ok: false, error: `Listing failed: ${error.message}` }, { status: 502 });
  }

  const folders = listing.folders.map((folder) => ({
    ...folder,
    published: isPublicPrefix(folder.prefix),
  }));
  const files = listing.files.map((file) => ({
    ...file,
    published: isPublicPrefix(file.key),
    url: isPublicPrefix(file.key) ? publicUrl(file.key) : null,
  }));

  const unreviewed = folders.filter((folder) => !folder.published).map((folder) => folder.prefix);

  return jsonResponse({
    ok: true,
    scope: 'all',
    prefix: listing.prefix,
    folders,
    files,
    truncated: listing.truncated,
    cursor: listing.cursor,
    // Named explicitly so an audit does not depend on the reader noticing a false flag.
    unreviewedPrefixes: unreviewed,
    note: unreviewed.length
      ? 'These prefixes are in the bucket but not covered by the R2 publication allowlist.'
      : undefined,
    auth: sanitizeAuth(auth),
  }, {
    // Never cached: this is an audit surface and a stale answer is a wrong answer.
    headers: { 'Cache-Control': 'no-store' },
  });
}
