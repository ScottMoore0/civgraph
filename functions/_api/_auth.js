const ACCESS_EMAIL_HEADERS = [
  'CF-Access-Authenticated-User-Email',
  'Cf-Access-Authenticated-User-Email',
  'cf-access-authenticated-user-email'
];

const ACCESS_JWT_HEADERS = [
  'CF-Access-Jwt-Assertion',
  'Cf-Access-Jwt-Assertion',
  'cf-access-jwt-assertion'
];

export function jsonResponse(body, init = {}) {
  return new Response(JSON.stringify(body, null, 2), {
    ...init,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...(init.headers || {})
    }
  });
}

/**
 * The 405 body for routes that answer in JSON. Lives here rather than in
 * _method.js so that _method.js stays dependency-free and this stays next to the
 * jsonResponse envelope every JSON route already shares.
 */
export function jsonNotAllowed(method) {
  return jsonResponse({ ok: false, error: 'Method Not Allowed' }, { status: 405, headers: { Allow: method } });
}

export function getContributorAuth(context) {
  const request = context.request;
  const env = context.env || {};
  const jwtAssertion = firstHeader(request, ACCESS_JWT_HEADERS);
  const jwtPresent = Boolean(jwtAssertion);
  const email = firstHeader(request, ACCESS_EMAIL_HEADERS)
    || emailFromAccessJwt(jwtAssertion)
    || devEmail(env);
  // One name each. This used to accept CONTRIBUTOR_EMAILS/BROWSE_CONTRIBUTORS and
  // CONTRIBUTOR_ADMINS/BROWSE_ADMINS as fallbacks, from before the CIVGRAPH_
  // prefix settled. Nothing set them: verified 2026-08-17 against wrangler.toml,
  // the workflows, and the live endpoint, which reported 2 contributors and 1
  // admin from the CIVGRAPH_ names alone.
  //
  // Three accepted spellings for one secret is not tolerance, it is three places
  // a typo can hide: set BROWSE_ADMINS by mistake and the allowlist silently
  // reads empty, which now fails closed and looks like a permissions bug.
  const allowlist = parseList(env.CIVGRAPH_CONTRIBUTORS);
  const adminList = parseList(env.CIVGRAPH_ADMINS);
  const normalizedEmail = normalizeEmail(email);
  const authenticated = Boolean(normalizedEmail);
  const allowlistConfigured = allowlist.length > 0 || adminList.length > 0;
  const isAdmin = authenticated && adminList.includes(normalizedEmail);

  // FAIL CLOSED. This previously read:
  //
  //   allowed = authenticated && (!allowlistConfigured || allowlist.includes(...) || isAdmin)
  //
  // so with neither list set, ANY Access-authenticated identity could submit.
  // Cloudflare Access commonly issues one-time PINs to any address that asks,
  // which made an unset allowlist equivalent to an open endpoint -- and the
  // moment of maximum exposure was exactly the moment Access was switched on,
  // before anyone had got round to setting the lists.
  //
  // Contribution is now limited to named addresses only. An empty allowlist
  // means nobody, which is the correct reading of "no one has been granted
  // access yet".
  const allowed = authenticated && (allowlist.includes(normalizedEmail) || isAdmin);

  return {
    authenticated,
    allowed,
    isAdmin,
    email: authenticated ? normalizedEmail : null,
    source: authenticated ? (devEmail(env) ? 'dev' : 'cloudflare-access') : 'anonymous',
    accessJwtPresent: jwtPresent,
    allowlistConfigured,
    // COUNTS ONLY, never the addresses.
    //
    // Secrets are write-only: `wrangler pages secret put` reports success and
    // there is no way to read the value back. Without these, setting the lists
    // is an unverifiable operation -- allowlistConfigured is a boolean, so it
    // reads true whether the secret holds one address or five, and a typo that
    // dropped an entry would look identical to success. Setting a secret and
    // then redeploying is also two steps, and the first one silently does
    // nothing to the running deployment.
    //
    // A count discloses nothing useful: it says how many people can propose
    // changes, not who they are.
    contributorCount: allowlist.length,
    adminCount: adminList.length,
    loginUrl: accessLoginUrl(request),
    logoutUrl: accessLogoutUrl(request),
    setupRequired: !authenticated
  };
}

export function requireContributor(context) {
  const auth = getContributorAuth(context);
  if (!auth.authenticated) {
    return { auth, response: jsonResponse({ ok: false, error: 'Authentication required', auth }, { status: 401 }) };
  }
  if (!auth.allowed) {
    // Name the address that was actually asserted. The identity provider is
    // GitHub, which asserts the account's PRIMARY VERIFIED EMAIL -- not
    // necessarily the address the person gave the site owner, and not the
    // ...@users.noreply.github.com address that appears in their commits. When
    // those differ, the allowlist misses and the symptom is an unexplained 403
    // that looks like a permissions bug rather than an identity mismatch.
    //
    // Saying which address arrived turns a support conversation into a one-line
    // fix. It discloses nothing: the caller has already authenticated as this
    // address, so it is telling them something they necessarily know.
    return {
      auth,
      response: jsonResponse({
        ok: false,
        error: 'Contributor access denied',
        assertedEmail: auth.email,
        hint: auth.allowlistConfigured
          ? `Signed in as ${auth.email}, which is not on the contributor list. GitHub asserts your PRIMARY email (GitHub -> Settings -> Emails); ask the site owner to add that exact address.`
          : 'No contributor list is configured yet, so nobody is permitted. This is the expected state before contributions are switched on.',
        auth: sanitizeAuth(auth),
      }, { status: 403 }),
    };
  }
  return { auth, response: null };
}

/**
 * Approval is owner-only, and separately gated from submission.
 *
 * isAdmin is already fail-closed -- it requires the address to appear in
 * CIVGRAPH_ADMINS, so an empty list denies everyone including the owner. That is
 * the right default for a decision that changes what the site publishes.
 *
 * Note the deliberate asymmetry with requireContributor: being allowed to
 * PROPOSE never implies being allowed to APPROVE. The two lists are separate and
 * an admin must be named explicitly in the admin one.
 */
export function requireAdmin(context) {
  const auth = getContributorAuth(context);
  if (!auth.authenticated) {
    return { auth, response: jsonResponse({ ok: false, error: 'Authentication required', auth }, { status: 401 }) };
  }
  if (!auth.isAdmin) {
    return {
      auth,
      response: jsonResponse({
        ok: false,
        error: 'Approval is restricted to site administrators',
        auth: sanitizeAuth(auth),
      }, { status: 403 }),
    };
  }
  return { auth, response: null };
}

export function sanitizeAuth(auth) {
  return {
    authenticated: auth.authenticated,
    allowed: auth.allowed,
    isAdmin: auth.isAdmin,
    email: auth.email,
    source: auth.source,
    allowlistConfigured: auth.allowlistConfigured,
    contributorCount: auth.contributorCount,
    adminCount: auth.adminCount,
    // Diagnostic. Distinguishes "Access is not in front of this route" from
    // "Access authenticated the caller but no identity could be read", which
    // otherwise look identical from outside and cost an afternoon on 2026-08-15.
    accessJwtPresent: auth.accessJwtPresent,
    loginUrl: auth.loginUrl,
    logoutUrl: auth.logoutUrl
  };
}

/**
 * Read the email claim out of the Access JWT.
 *
 * WHY THIS IS NEEDED AT ALL
 *
 * On 2026-08-15, with Access live and a valid session, /_api/contributions/whoami
 * returned 200 (so the request had passed Access) with authenticated:false --
 * because CF-Access-Authenticated-User-Email was not present on the request.
 * Access forwards identity as a signed JWT in Cf-Access-Jwt-Assertion whether or
 * not it also sets the convenience header, so the JWT is the reliable source.
 *
 * WHY THE SIGNATURE IS NOT VERIFIED
 *
 * The same reason the email header was trusted before it: Cloudflare strips
 * client-supplied CF-Access-* headers at the edge. That was verified by
 * experiment on 2026-08-13 -- sending CF-Access-Authenticated-User-Email by hand
 * to both civgraph.net and boundaries-website.pages.dev produced
 * authenticated:false, source "anonymous". A caller cannot forge either header,
 * so decoding is no weaker than the arrangement it replaces.
 *
 * That said, it IS a trust assumption about Cloudflare's behaviour rather than
 * something this code checks. If these endpoints ever become reachable other
 * than through Cloudflare -- a different host, a tunnel, a proxy in front --
 * verify the signature against the team's public keys at
 * https://<team>.cloudflareaccess.com/cdn-cgi/access/certs before trusting it.
 */
function emailFromAccessJwt(assertion) {
  if (!assertion) return null;
  const parts = String(assertion).split('.');
  if (parts.length < 2) return null;
  try {
    // base64url -> base64, then decode. atob is available in Workers.
    const padded = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(atob(padded + '='.repeat((4 - (padded.length % 4)) % 4)));
    const value = payload?.email || payload?.identity?.email || null;
    return typeof value === 'string' && value.includes('@') ? value : null;
  } catch {
    return null;
  }
}

function firstHeader(request, names) {
  for (const name of names) {
    const value = request.headers.get(name);
    if (value) return value;
  }
  return null;
}

function parseList(value) {
  return String(value || '')
    .split(/[,\s;]+/)
    .map(normalizeEmail)
    .filter(Boolean);
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

/**
 * Local development identity, behind an explicit second switch.
 *
 * This is a complete authentication bypass: set the variable and the API treats
 * every caller as that address, with no Cloudflare Access involved at all. It
 * used to activate on the presence of CIVGRAPH_DEV_AUTH_EMAIL alone, so one
 * mistakenly-copied production variable would have handed contributor -- or
 * with the wrong address, ADMIN -- rights to anyone who could reach the site.
 *
 * Requiring CIVGRAPH_ALLOW_DEV_AUTH=true as well means the bypass cannot be
 * enabled by accident: it takes two variables that no deploy sets together
 * unless someone meant it. Neither belongs in production under any circumstance.
 */
function devEmail(env) {
  if (String(env.CIVGRAPH_ALLOW_DEV_AUTH || '').toLowerCase() !== 'true') return null;
  return env.CIVGRAPH_DEV_AUTH_EMAIL || null;
}

/**
 * Where to send someone to sign in.
 *
 * This used to be `/cdn-cgi/access/login?redirect_url=<current page>`, which
 * returned 404 once Access went live on 2026-08-15. Cloudflare's login endpoint
 * authenticates for a SPECIFIC Access application, and the application here
 * covers only the path `_api/contributions` -- so a login URL naming /browse/
 * matched no application at all.
 *
 * The reliable way to start the flow is to navigate to a protected path and let
 * Access intercept. functions/_api/contributions/login.js is that path, and it
 * redirects back afterwards.
 */
function accessLoginUrl(request) {
  const url = new URL(request.url);
  // Return the visitor to the page they were on, not to this API route. Only the
  // path is carried; login.js re-validates it before honouring it.
  const returnTo = `${url.pathname}${url.search}`;
  const safeReturn = returnTo.startsWith('/_api/') ? '/browse/' : returnTo;
  return `/_api/contributions/login?return=${encodeURIComponent(safeReturn)}`;
}

function accessLogoutUrl(request) {
  const url = new URL(request.url);
  const returnTo = encodeURIComponent(`${url.origin}/browse/`);
  return `/cdn-cgi/access/logout?returnTo=${returnTo}`;
}
