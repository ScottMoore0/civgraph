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

export async function getContributorAuth(context) {
  const request = context.request;
  const env = context.env || {};
  const jwtAssertion = firstHeader(request, ACCESS_JWT_HEADERS);
  const jwtPresent = Boolean(jwtAssertion);
  // Identity comes from the Access JWT, and only once its signature, issuer and expiry check
  // out (verifyAccessJwt). A JWT that fails is no identity at all, whatever the email header
  // says. The bare email header is trusted on its own only by the offline tests, which have no
  // Access keys to sign with (CIVGRAPH_TEST_TRUST_EMAIL_HEADER, never set in production).
  const verified = jwtPresent ? await verifyAccessJwt(jwtAssertion, env) : null;
  const headerEmail = firstHeader(request, ACCESS_EMAIL_HEADERS);
  const testHeader = String(env.CIVGRAPH_TEST_TRUST_EMAIL_HEADER || '').toLowerCase() === 'true' && !jwtPresent ? headerEmail : null;
  const email = verified?.email || testHeader || devEmail(env);
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
    accessJwtVerified: Boolean(verified),
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

export async function requireContributor(context) {
  const auth = await getContributorAuth(context);
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
export async function requireAdmin(context) {
  const auth = await getContributorAuth(context);
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
    accessJwtVerified: auth.accessJwtVerified,
    loginUrl: auth.loginUrl,
    logoutUrl: auth.logoutUrl
  };
}

/**
 * The email in a Cloudflare Access JWT, once the token is shown to be genuine: signed (RS256) by
 * one of the Access team's current keys, issued by the team, not expired, and -- when
 * CIVGRAPH_ACCESS_AUD is set -- for this Access application. Anything else returns null.
 *
 * Until 2026-10-12 the token was only decoded, on the strength of Cloudflare stripping
 * client-supplied CF-Access-* headers at the edge (verified by experiment 2026-08-13). That held
 * for requests through Cloudflare, but it was a trust assumption, not a check: any other route to
 * these Functions would have accepted a hand-made token. Contributor editing on /maps widens who
 * signs in, so the token is now verified as Cloudflare recommends.
 *
 * Keys: https://<team>/cdn-cgi/access/certs, cached for an hour per Worker instance. The team
 * domain is public (docs/cloudflare-inventory.md); CIVGRAPH_ACCESS_TEAM_DOMAIN overrides it.
 */
const ACCESS_TEAM_DOMAIN = 'icy-mouse-ce2a.cloudflareaccess.com';
const KEY_CACHE_MS = 60 * 60 * 1000;
let accessKeys = { team: null, at: 0, keys: null };

async function accessSigningKeys(team) {
  if (accessKeys.team === team && accessKeys.keys && Date.now() - accessKeys.at < KEY_CACHE_MS) return accessKeys.keys;
  const res = await fetch(`https://${team}/cdn-cgi/access/certs`, { cf: { cacheTtl: 300 } });
  if (!res.ok) throw new Error(`Access certs: HTTP ${res.status}`);
  const body = await res.json();
  accessKeys = { team, at: Date.now(), keys: Array.isArray(body?.keys) ? body.keys : [] };
  return accessKeys.keys;
}

function base64UrlBytes(part) {
  const padded = String(part).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

export async function verifyAccessJwt(assertion, env = {}) {
  const parts = String(assertion || '').split('.');
  if (parts.length !== 3) return null;
  try {
    const header = JSON.parse(new TextDecoder().decode(base64UrlBytes(parts[0])));
    const payload = JSON.parse(new TextDecoder().decode(base64UrlBytes(parts[1])));
    if (header?.alg !== 'RS256') return null;
    const team = String(env.CIVGRAPH_ACCESS_TEAM_DOMAIN || ACCESS_TEAM_DOMAIN).replace(/^https?:\/\//, '').replace(/\/$/, '');
    const now = Math.floor(Date.now() / 1000);
    if (typeof payload?.exp !== 'number' || payload.exp < now - 30) return null;
    if (typeof payload?.nbf === 'number' && payload.nbf > now + 30) return null;
    if (payload?.iss !== `https://${team}`) return null;
    const aud = String(env.CIVGRAPH_ACCESS_AUD || '').trim();
    if (aud && !(Array.isArray(payload.aud) ? payload.aud : [payload.aud]).includes(aud)) return null;
    const jwk = (await accessSigningKeys(team)).find((k) => k.kid === header.kid);
    if (!jwk) return null;
    const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, base64UrlBytes(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
    if (!ok) return null;
    const email = payload.email || payload.identity?.email || null;
    return typeof email === 'string' && email.includes('@') ? { email, payload } : null;
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
