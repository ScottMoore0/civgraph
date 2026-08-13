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

export function getContributorAuth(context) {
  const request = context.request;
  const env = context.env || {};
  const email = firstHeader(request, ACCESS_EMAIL_HEADERS) || devEmail(env);
  const jwtPresent = Boolean(firstHeader(request, ACCESS_JWT_HEADERS));
  const allowlist = parseList(env.CIVGRAPH_CONTRIBUTORS || env.CONTRIBUTOR_EMAILS || env.BROWSE_CONTRIBUTORS);
  const adminList = parseList(env.CIVGRAPH_ADMINS || env.CONTRIBUTOR_ADMINS || env.BROWSE_ADMINS);
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
    return { auth, response: jsonResponse({ ok: false, error: 'Contributor access denied', auth }, { status: 403 }) };
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
    loginUrl: auth.loginUrl,
    logoutUrl: auth.logoutUrl
  };
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
  if (env.CIVGRAPH_DEV_AUTH_EMAIL) return env.CIVGRAPH_DEV_AUTH_EMAIL;
  if (env.BROWSE_DEV_AUTH_EMAIL) return env.BROWSE_DEV_AUTH_EMAIL;
  return null;
}

function accessLoginUrl(request) {
  const url = new URL(request.url);
  const redirectUrl = encodeURIComponent(url.toString());
  return `/cdn-cgi/access/login?redirect_url=${redirectUrl}`;
}

function accessLogoutUrl(request) {
  const url = new URL(request.url);
  const returnTo = encodeURIComponent(`${url.origin}/browse/`);
  return `/cdn-cgi/access/logout?returnTo=${returnTo}`;
}
