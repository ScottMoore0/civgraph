import { getContributorAuth, jsonResponse, sanitizeAuth } from '../_auth.js';

/**
 * Who is signed in. Must live INSIDE the Access-protected prefix.
 *
 * THE PROBLEM THIS SOLVES
 *
 * Cloudflare Access injects CF-Access-Authenticated-User-Email only on requests
 * that fall inside an Access application. Ours covers the path
 * `_api/contributions` and nothing else, deliberately, so that the public Browse
 * page stays public.
 *
 * /_api/auth/status is outside that path. It therefore NEVER sees the identity
 * header, and reports authenticated:false for everybody -- including a fully
 * signed-in contributor. On 2026-08-15 that made the contributor panel look
 * broken: sign-in completed correctly, the visitor was returned to Browse, and
 * the panel still said "Log in" because the endpoint it consults is structurally
 * incapable of knowing otherwise.
 *
 * This route is the answer. It sits inside the application, so Access has
 * already authenticated anyone who reaches it and the header is present.
 *
 * WHY IT DOES NOT REQUIRE THE ALLOWLIST
 *
 * getContributorAuth, not requireContributor. Somebody who signs in but is not
 * on the contributor list must still get their identity back, so the panel can
 * tell them which address arrived and that it is not on the list. Returning 403
 * here would leave them staring at the same "Log in" button that just worked,
 * which is the exact confusion this file exists to end.
 *
 * Callers should treat any non-200 -- including an opaque redirect to the Access
 * login -- as "not signed in". That is the normal anonymous case, not an error.
 */
export async function onRequestGet(context) {
  const auth = getContributorAuth(context);
  return jsonResponse({
    ok: true,
    auth: sanitizeAuth(auth),
    capabilities: {
      browse: true,
      proposeEdits: auth.allowed,
      submitMapRequests: auth.allowed,
      approveSubmissions: auth.isAdmin,
    },
  });
}

export async function onRequest(context) {
  if (context.request.method !== 'GET') {
    return jsonResponse({ ok: false, error: 'Method Not Allowed' }, { status: 405, headers: { Allow: 'GET' } });
  }
  return onRequestGet(context);
}
