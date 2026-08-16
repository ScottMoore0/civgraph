import { methodGuard } from '../_method.js';

/**
 * Sign-in entry point. Exists only to be BEHIND Access.
 *
 * THE BUG THIS FIXES
 *
 * _auth.js used to hand out `/cdn-cgi/access/login?redirect_url=<current page>`,
 * and browse/browse.js rendered that as the "sign in" link. On 2026-08-15, with
 * Access live, that URL returned **404**.
 *
 * The reason is that Cloudflare's login endpoint authenticates you *for a
 * specific Access application*. The Access application here covers the path
 * `_api/contributions` and nothing else -- deliberately, because widening it to
 * /browse/ would put the whole public Browse page behind a login. So a login URL
 * pointing at /browse/ names no application, and Cloudflare has nothing to
 * authenticate against.
 *
 * Navigating to a protected path is what actually starts the flow: Access
 * intercepts, redirects to the identity provider, and returns the visitor to the
 * path they asked for. This route is that path. It sits under the protected
 * prefix, so reaching it at all means Access has already authenticated the
 * caller -- at which point there is nothing to do but send them back where they
 * came from, now carrying the Access cookie.
 *
 * It deliberately does NOT call requireContributor. Somebody who authenticates
 * but is not on the allowlist should still land back on Browse and be told so by
 * the panel, rather than meeting a bare 403 from a redirect they did not know
 * they were following.
 */
export const DEFAULT_RETURN = '/browse/';

/**
 * Open-redirect guard: only same-origin, root-relative paths are honoured.
 *
 * Exported so it can be tested directly (scripts/test-contribution-flow.mjs).
 * It is one regex, it is the only security-relevant line in this file, and a
 * regex is exactly the kind of thing that looks right and is not.
 *
 * The cases that matter:
 *   //evil.example   protocol-relative -- a valid absolute URL to another host
 *                    that reads like a local path. This is the real attack.
 *   /\evil.example   backslash: several browsers normalise \ to /, making this
 *                    equivalent to the above. Backslash is not in the allowed
 *                    character class, so it is rejected.
 *   https://…        absolute URL, no leading slash, rejected.
 *   javascript:…     no leading slash, rejected.
 */
export function safeReturnPath(requested) {
  const value = String(requested || '');
  if (!value) return DEFAULT_RETURN;
  return /^\/(?!\/)[A-Za-z0-9._~\-/?=&#%+]*$/.test(value) ? value : DEFAULT_RETURN;
}

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const safePath = safeReturnPath(url.searchParams.get('return'));

  return new Response(null, {
    status: 302,
    headers: {
      Location: new URL(safePath, url.origin).toString(),
      'Cache-Control': 'no-store',
    },
  });
}

export const onRequest = methodGuard('GET', onRequestGet);
