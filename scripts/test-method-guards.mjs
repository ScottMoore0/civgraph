#!/usr/bin/env node
/**
 * Every API route must answer a wrong HTTP verb with 405, not with a page.
 *
 * WHY THIS IS A PERMANENT CHECK AND NOT A ONE-OFF
 *
 * A Pages Function module exporting only `onRequestPost` has no handler for a
 * GET. The runtime does not answer 405 itself -- it moves on, and what it moves
 * on to is the static asset layer, which on this project has an SPA-shaped
 * fallback that answers HTTP 200. That is the trap this codebase has already hit
 * twice: a missing thing served as index.html at 200, which every status-code
 * check reads as healthy. See functions/data/graph/[[path]].js.
 *
 * Nine routes each carried a hand-written six-line guard against that, and none
 * of them said why, so it read as ceremony. Consolidating them into
 * functions/_api/_method.js gave the reason one home -- but a refactor of nine
 * files on the auth path, verified once by a script that was then deleted, is a
 * worse position than the duplication it replaced. This is that verification,
 * kept.
 *
 * Offline: the handlers are imported and called directly with a stub context.
 * No network, no wrangler, no bindings.
 */
import { methodGuard, textNotAllowed } from '../functions/_api/_method.js';
import { jsonNotAllowed } from '../functions/_api/_auth.js';

const ROUTES = [
  // file, allowed verb, a verb that must be refused, JSON body expected
  ['functions/_api/contributions/submit.js', 'POST', 'GET', true],
  ['functions/_api/contributions/decide.js', 'POST', 'GET', true],
  ['functions/_api/contributions/list.js', 'GET', 'POST', true],
  ['functions/_api/contributions/intake.js', 'POST', 'GET', true],
  ['functions/_api/contributions/whoami.js', 'GET', 'DELETE', true],
  ['functions/_api/contributions/schema.js', 'GET', 'POST', true],
  ['functions/_api/contributions/login.js', 'GET', 'POST', false],
  ['functions/_api/auth/status.js', 'GET', 'PUT', true],
  ['functions/_api/rum.js', 'POST', 'GET', false],
];

let passed = 0;
const failures = [];

function check(name, condition, detail) {
  if (condition) { passed += 1; return; }
  failures.push(detail ? `${name} — ${detail}` : name);
}

for (const [file, allow, wrong, isJson] of ROUTES) {
  const mod = await import(new URL(`../${file}`, import.meta.url));

  check(`${file} exports onRequest`, typeof mod.onRequest === 'function');
  if (typeof mod.onRequest !== 'function') continue;

  const res = await mod.onRequest({
    request: new Request('https://civgraph.net/x', { method: wrong }),
    env: {},
  });

  check(`${file}: ${wrong} is refused with 405`, res.status === 405, `got ${res.status}`);
  check(`${file}: names the allowed verb`, res.headers.get('Allow') === allow,
    `Allow: ${res.headers.get('Allow')}`);

  // The body type matters: the JSON routes must not start answering in plain
  // text, because browse/browse.js parses every one of these as JSON.
  const contentType = res.headers.get('Content-Type') || '';
  check(`${file}: refusal body is ${isJson ? 'JSON' : 'text'}`,
    isJson ? contentType.includes('json') : !contentType.includes('json'),
    `Content-Type: ${contentType}`);
}

// NEGATIVE CONTROL, in both directions.
//
// Every assertion above passes if methodGuard simply returns 405 for everything,
// which would take the whole API offline while looking perfectly healthy here.
// So: the correct verb must get through to the handler.
const login = await import('../functions/_api/contributions/login.js');
const allowed = await login.onRequest({
  request: new Request('https://civgraph.net/_api/contributions/login?return=/browse/', { method: 'GET' }),
  env: {},
});
check('the correct verb still reaches the handler (login redirects, 302)',
  allowed.status === 302, `got ${allowed.status}`);

// And the guard itself must refuse, so a broken helper cannot pass by accident.
const guarded = methodGuard('POST', async () => new Response('handler ran'), textNotAllowed);
const refused = await guarded({ request: new Request('https://x/', { method: 'GET' }), env: {} });
check('methodGuard refuses the wrong verb', refused.status === 405);
const admitted = await guarded({ request: new Request('https://x/', { method: 'POST' }), env: {} });
check('methodGuard admits the right verb', admitted.status === 200);
check('jsonNotAllowed carries the Allow header', jsonNotAllowed('PATCH').headers.get('Allow') === 'PATCH');

if (failures.length) {
  console.error(`FAIL: ${failures.length} of ${passed + failures.length} method-guard checks failed:`);
  for (const f of failures) console.error(`  - ${f}`);
  console.error('');
  console.error('  A route that does not answer 405 falls through to the static asset');
  console.error('  layer, where the SPA fallback answers 200. Every status-code check');
  console.error('  then reads the route as healthy while it serves a page.');
  process.exit(1);
}

console.log(`PASS: ${passed} method-guard checks across ${ROUTES.length} routes.`);
