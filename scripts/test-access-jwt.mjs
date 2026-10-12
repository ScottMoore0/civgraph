#!/usr/bin/env node
/**
 * verifyAccessJwt (functions/_api/_auth.js) accepts only a Cloudflare Access token that is
 * genuine: signed by one of the team's keys, issued by the team, unexpired, and for this
 * application when CIVGRAPH_ACCESS_AUD is set. Tokens are signed here with a throwaway RSA key
 * whose public half stands in for the team's published certs (fetch is stubbed), so the check
 * runs offline.
 *
 *   node scripts/test-access-jwt.mjs
 */
import { verifyAccessJwt, getContributorAuth } from '../functions/_api/_auth.js';

const TEAM = 'icy-mouse-ce2a.cloudflareaccess.com';
const failures = [];
const check = (name, ok) => { if (!ok) failures.push(name); };

const b64url = (bytes) => Buffer.from(bytes).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const enc = (obj) => b64url(new TextEncoder().encode(JSON.stringify(obj)));

const pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
const other = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
const jwk = { ...(await crypto.subtle.exportKey('jwk', pair.publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };
globalThis.fetch = async (url) => {
  check('fetches the team certs', String(url) === `https://${TEAM}/cdn-cgi/access/certs`);
  return { ok: true, json: async () => ({ keys: [jwk] }) };
};

const now = Math.floor(Date.now() / 1000);
async function token(claims, { key = pair.privateKey, kid = 'k1', alg = 'RS256' } = {}) {
  const head = enc({ alg, kid, typ: 'JWT' });
  const body = enc({ iss: `https://${TEAM}`, aud: ['app-aud'], email: 'Editor@Example.org', exp: now + 600, iat: now, ...claims });
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(`${head}.${body}`));
  return `${head}.${body}.${b64url(new Uint8Array(sig))}`;
}

check('a genuine token gives its email', (await verifyAccessJwt(await token({})))?.email === 'Editor@Example.org');
check('the audience is checked when configured', (await verifyAccessJwt(await token({}), { CIVGRAPH_ACCESS_AUD: 'app-aud' })) !== null);
check('another application\'s token is refused', (await verifyAccessJwt(await token({}), { CIVGRAPH_ACCESS_AUD: 'other-aud' })) === null);
check('a token signed by another key is refused', (await verifyAccessJwt(await token({}, { key: other.privateKey }))) === null);
check('an unknown key id is refused', (await verifyAccessJwt(await token({}, { kid: 'nope' }))) === null);
check('an expired token is refused', (await verifyAccessJwt(await token({ exp: now - 120 }))) === null);
check('a token from another issuer is refused', (await verifyAccessJwt(await token({ iss: 'https://evil.cloudflareaccess.com' }))) === null);
check('alg "none" is refused', (await verifyAccessJwt(`${enc({ alg: 'none', kid: 'k1' })}.${enc({ iss: `https://${TEAM}`, email: 'a@b.c', exp: now + 600 })}.`)) === null);
const genuine = await token({});
const [h, , s] = genuine.split('.');
check('a token whose claims were altered is refused', (await verifyAccessJwt(`${h}.${enc({ iss: `https://${TEAM}`, email: 'admin@example.org', exp: now + 600 })}.${s}`)) === null);

// End to end: a forged token is no identity, even with an email header beside it.
const ctx = (headers, env = {}) => ({ request: { url: 'https://civgraph.net/_api/contributions/whoami', headers: { get: (n) => headers[String(n).toLowerCase()] ?? null } }, env: { CIVGRAPH_CONTRIBUTORS: 'editor@example.org', ...env } });
const forged = await token({}, { key: other.privateKey });
const auth1 = await getContributorAuth(ctx({ 'cf-access-jwt-assertion': forged, 'cf-access-authenticated-user-email': 'editor@example.org' }));
check('a forged token with an email header is not signed in', auth1.authenticated === false && auth1.allowed === false);
const auth2 = await getContributorAuth(ctx({ 'cf-access-jwt-assertion': genuine }));
check('a genuine token signs the contributor in', auth2.authenticated && auth2.allowed && auth2.accessJwtVerified);
const auth3 = await getContributorAuth(ctx({ 'cf-access-authenticated-user-email': 'editor@example.org' }));
check('an email header alone is not trusted', auth3.authenticated === false);

if (failures.length) {
  console.error(`FAIL: ${failures.length} Access JWT check(s):\n  - ${failures.join('\n  - ')}`);
  process.exit(1);
}
console.log('PASS: Access JWTs are verified (signature, key, issuer, expiry, audience); forged or bare-header identities are refused.');
