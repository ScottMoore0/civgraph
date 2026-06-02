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
  const allowed = authenticated && (!allowlistConfigured || allowlist.includes(normalizedEmail) || isAdmin);

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

function devEmail(env) {
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
