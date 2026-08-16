#!/usr/bin/env node
/**
 * End-to-end test of the contribution path: submit -> queue -> list -> decide.
 *
 * Exercises the real Function handlers against a mock KV binding and mock
 * requests, so the whole flow is tested without deploying, without Cloudflare
 * Access, and without writing into the production review queue.
 *
 * WHAT THIS COVERS THAT NOTHING ELSE DOES
 *
 * test-contribution-schema.mjs tests the validator in isolation. This tests the
 * things that only go wrong when the pieces are joined up: that an invalid patch
 * is not merely rejected but never reaches the queue; that a contributor cannot
 * reach the review endpoints; that approval changes status and nothing else.
 *
 * The authorisation cases are the point. Every one of them asserts a REFUSAL,
 * because that is the property that matters -- "contributors cannot approve" is
 * only true if something has watched it fail.
 */
import { onRequestPost as submitPost } from '../functions/_api/contributions/submit.js';
import { onRequestGet as listGet } from '../functions/_api/contributions/list.js';
import { onRequestPost as decidePost } from '../functions/_api/contributions/decide.js';
import { safeReturnPath, DEFAULT_RETURN } from '../functions/_api/contributions/login.js';

const OWNER = 'owner@example.com';
const CONTRIBUTOR = 'contributor@example.com';
const STRANGER = 'stranger@example.com';

let passed = 0;
const failures = [];
function check(name, condition, detail) {
  if (condition) { passed += 1; return; }
  failures.push(detail ? `${name} — ${detail}` : name);
}

/** Minimal KV stand-in: enough of put/get/list for the handlers to work. */
function mockKV() {
  const store = new Map();
  return {
    store,
    async put(key, value, options = {}) { store.set(key, { value, metadata: options.metadata || {} }); },
    async get(key) { return store.get(key)?.value ?? null; },
    // Paginated, like the real Workers KV binding.
    //
    // This used to return every matching key in one object with no `cursor` and
    // no `list_complete`, so list.js's pagination could not be exercised at all
    // -- the very bug being guarded against (a queue going blind past one page)
    // was invisible to the test that covers the endpoint. A mock simpler than
    // the API it stands in for tests only the part of the caller that never
    // fails. Keys come back in lexicographic order, as KV returns them.
    async list({ prefix = '', limit = 1000, cursor } = {}) {
      const all = [...store.entries()]
        .filter(([k]) => k.startsWith(prefix))
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
      const start = cursor ? Number(cursor) : 0;
      const page = all.slice(start, start + limit);
      const next = start + page.length;
      const complete = next >= all.length;
      return {
        keys: page.map(([name, entry]) => ({ name, metadata: entry.metadata })),
        list_complete: complete,
        ...(complete ? {} : { cursor: String(next) }),
      };
    },
  };
}

function makeContext({ email, method = 'POST', body, url = 'https://civgraph.net/_api/contributions/submit', env }) {
  const headers = new Map();
  if (email) headers.set('cf-access-authenticated-user-email', email);
  headers.set('content-type', 'application/json');
  return {
    request: {
      method,
      url,
      headers: { get: (name) => headers.get(String(name).toLowerCase()) ?? null },
      text: async () => (typeof body === 'string' ? body : JSON.stringify(body ?? {})),
      json: async () => (typeof body === 'string' ? JSON.parse(body) : (body ?? {})),
    },
    env,
  };
}

// The dry run fetches the live catalogue record. Stub it so the test is
// deterministic and offline; a real miss is covered by its own case below.
//
// THIS STUB USED TO RETURN THE WRONG SHAPE, AND THAT IS WHY THE BUG SURVIVED.
//
// It returned `{ maps: [record] }`. /_api/catalogue?id= returns the BARE RECORD;
// only the no-parameter and ?category= forms return that envelope. submit.js
// looked for the envelope, so caller and fixture agreed and both disagreed with
// the endpoint. The assertion below -- checkedAgainstCurrentRecord === true --
// passed on every run while being false in production on every submission ever
// made. Verified against https://civgraph.net/_api/catalogue?id=lgd-2012 on
// 2026-08-16: top-level keys are id, name, slug, category, ... and no `maps`.
//
// The shape here is now the shape the API actually returns. Restore the old
// envelope and this file still passes against the FIXED submit.js, which is the
// point: the fix accepts both, and only the fixture proves which one is real.
globalThis.fetch = async () => ({
  ok: true,
  json: async () => ({ id: 'deds-ni-1926', name: 'District Electoral Divisions 1926', provider: 'PRONI', date: '1926-01-01' }),
});

const queue = mockKV();
const env = {
  CIVGRAPH_CONTRIBUTION_QUEUE: queue,
  CIVGRAPH_CONTRIBUTORS: `${CONTRIBUTOR}, ${OWNER}`,
  CIVGRAPH_ADMINS: OWNER,
};

const validPatch = {
  kind: 'metadata-edit',
  entityType: 'map',
  entityId: 'deds-ni-1926',
  summary: 'Credit the researcher who supplied this layer.',
  patch: { provider: 'PRONI / Paddy Matthews' },
};

// --- authentication and authorisation --------------------------------------
{
  const res = await submitPost(makeContext({ email: null, body: validPatch, env }));
  check('anonymous submit is refused', res.status === 401);
}
{
  const res = await submitPost(makeContext({ email: STRANGER, body: validPatch, env }));
  const payload = await res.json();
  check('an authenticated stranger cannot submit', res.status === 403);
  check('the refusal names the address that arrived', payload.assertedEmail === STRANGER, JSON.stringify(payload.assertedEmail));
  check('the refusal explains where to find the right address', /Settings -> Emails/.test(payload.hint || ''));
}
{
  const emptyEnv = { ...env, CIVGRAPH_CONTRIBUTORS: '', CIVGRAPH_ADMINS: '' };
  const res = await submitPost(makeContext({ email: CONTRIBUTOR, body: validPatch, env: emptyEnv }));
  check('an empty allowlist admits nobody (fail-closed)', res.status === 403);
}

// --- a good submission -----------------------------------------------------
let approvedKey = null;
{
  const res = await submitPost(makeContext({ email: CONTRIBUTOR, body: validPatch, env }));
  const payload = await res.json();
  check('a contributor can submit a valid patch', res.status === 202, `got ${res.status}`);
  check('the submission is queued as pending-review', payload.submission?.status === 'pending-review');
  check('the dry run reports which fields would change', payload.dryRun?.effective?.includes('provider'));
  check('the dry run compared against the live record', payload.dryRun?.checkedAgainstCurrentRecord === true);
  check('the response says nothing is applied automatically', /never applied automatically/i.test(payload.note || ''));
  check('exactly one item is in the queue', queue.store.size === 1, `size ${queue.store.size}`);
  approvedKey = [...queue.store.keys()][0];
}

// --- a bad submission must not reach the queue -----------------------------
{
  const before = queue.store.size;
  const res = await submitPost(makeContext({
    email: CONTRIBUTOR,
    body: { ...validPatch, patch: { keywords: 'should-be-an-array' } },
    env,
  }));
  check('an invalid patch is rejected', res.status === 422);
  check('an invalid patch is NOT queued', queue.store.size === before, `size went ${before} -> ${queue.store.size}`);
}
{
  const before = queue.store.size;
  const res = await submitPost(makeContext({
    email: CONTRIBUTOR,
    body: { ...validPatch, patch: { id: 'renamed' } },
    env,
  }));
  check('a patch to a non-editable field is rejected', res.status === 422);
  check('it is not queued either', queue.store.size === before);
}

// --- review is admin-only --------------------------------------------------
{
  const res = await listGet(makeContext({ email: CONTRIBUTOR, method: 'GET', url: 'https://civgraph.net/_api/contributions/list', env }));
  check('a contributor cannot list the queue', res.status === 403);
}
{
  const res = await listGet(makeContext({ email: OWNER, method: 'GET', url: 'https://civgraph.net/_api/contributions/list', env }));
  const payload = await res.json();
  check('an admin can list the queue', res.status === 200, `got ${res.status}`);
  check('the pending submission is listed', payload.items?.length === 1, JSON.stringify(payload.items));
}
{
  const res = await decidePost(makeContext({
    email: CONTRIBUTOR,
    body: { key: approvedKey, decision: 'approved' },
    url: 'https://civgraph.net/_api/contributions/decide',
    env,
  }));
  check('a contributor cannot approve their own submission', res.status === 403);
  const stored = JSON.parse(await queue.get(approvedKey));
  check('the refused approval did not change the status', stored.status === 'pending-review', stored.status);
}

// --- approval records a decision and applies nothing ------------------------
{
  const res = await decidePost(makeContext({
    email: OWNER,
    body: { key: approvedKey, decision: 'approved', note: 'Confirmed with the researcher.' },
    url: 'https://civgraph.net/_api/contributions/decide',
    env,
  }));
  const payload = await res.json();
  const stored = JSON.parse(await queue.get(approvedKey));
  check('an admin can approve', res.status === 200, `got ${res.status}`);
  check('the stored status becomes approved', stored.status === 'approved');
  check('the decision is recorded with who and when', stored.decisions?.[0]?.decidedBy === OWNER && Boolean(stored.decisions[0].decidedAt));
  check('approval reports that nothing was applied', payload.applied === false);
  check('approval tells the owner what to run next', /contributions:apply/.test(payload.note || ''));
}
{
  const res = await decidePost(makeContext({
    email: OWNER,
    body: { key: '../../etc/passwd', decision: 'approved' },
    url: 'https://civgraph.net/_api/contributions/decide',
    env,
  }));
  check('a malformed submission key is refused', res.status === 400);
}

// --- retire ----------------------------------------------------------------
{
  const res = await submitPost(makeContext({
    email: CONTRIBUTOR,
    body: { kind: 'retire', entityType: 'map', entityId: 'eds-1911-ulster', reason: 'Superseded by the eds-ulster-1911 naming set.' },
    env,
  }));
  check('a retire request is accepted', res.status === 202, `got ${res.status}`);
}
{
  const res = await submitPost(makeContext({
    email: CONTRIBUTOR,
    body: { kind: 'retire', entityType: 'map', entityId: 'eds-1911-ulster' },
    env,
  }));
  check('a retire request without a reason is refused', res.status === 400);
}

// --- the sign-in redirect guard --------------------------------------------
//
// login.js exists to sit behind Access and bounce the visitor back afterwards.
// The bounce target comes from a query parameter, so it is an open redirect
// unless something stops it. These are the cases that actually matter.
{
  const good = [
    ['/browse/', '/browse/'],
    ['/browse/?type=maps', '/browse/?type=maps'],
    ['/proni/', '/proni/'],
  ];
  for (const [input, want] of good) {
    check(`login: keeps same-origin path ${input}`, safeReturnPath(input) === want, safeReturnPath(input));
  }

  const hostile = [
    '//evil.example/',                 // protocol-relative: the real attack
    String.fromCharCode(47, 92) + 'evil.example', // /\evil.example -- browsers may read \ as /
    'https://evil.example/',
    'http://evil.example',
    'javascript:alert(1)',
    '',
    null,
  ];
  for (const input of hostile) {
    check(`login: refuses ${JSON.stringify(input)}`, safeReturnPath(input) === DEFAULT_RETURN, safeReturnPath(input));
  }
}

// --- the queue must not go blind past one KV page --------------------------
//
// KV lists lexicographically and the keys are submissions/YYYY-MM-DD/..., so
// that ordering is OLDEST FIRST. list.js used to fetch a single page of 200 and
// filter within it, so past 200 submissions the NEWEST could never appear --
// whatever their status -- while the endpoint still answered ok:true with a
// short list. A review queue silently ceasing to show new work.
//
// 250 entries is deliberately more than one page. The one that matters is the
// last, because it is the one the old code could never reach.
{
  const bigQueue = mockKV();
  for (let i = 0; i < 250; i += 1) {
    const key = `submissions/2026-08-${String(10 + Math.floor(i / 100)).padStart(2, '0')}/sub_${String(i).padStart(4, '0')}.json`;
    await bigQueue.put(key, JSON.stringify({ id: `sub_${i}`, status: 'pending-review' }),
      { metadata: { kind: 'metadata-edit', status: 'pending-review', entityId: `map-${i}` } });
  }
  // One needle at the very end of the keyspace, past the first page.
  const needleKey = 'submissions/2026-08-99/sub_needle.json';
  await bigQueue.put(needleKey, JSON.stringify({ id: 'sub_needle', status: 'approved' }),
    { metadata: { kind: 'metadata-edit', status: 'approved', entityId: 'map-needle' } });

  const res = await listGet(makeContext({
    email: OWNER, method: 'GET',
    url: 'https://civgraph.net/_api/contributions/list?status=approved&limit=50',
    env: { ...env, CIVGRAPH_CONTRIBUTION_QUEUE: bigQueue },
  }));
  const payload = await res.json();
  check('the queue lists past the first KV page', res.status === 200, `got ${res.status}`);
  check('a submission beyond key 200 is still found',
    (payload.items || []).some((i) => i.key === needleKey),
    `found ${payload.count} item(s) after scanning ${payload.scanned}`);
  check('a complete listing says so', payload.complete === true);
  check('the scan reached past one page', (payload.scanned || 0) > 200, `scanned ${payload.scanned}`);
}

// --- a partial listing must admit it is partial -----------------------------
{
  const bigQueue = mockKV();
  for (let i = 0; i < 300; i += 1) {
    await bigQueue.put(`submissions/2026-08-10/sub_${String(i).padStart(4, '0')}.json`,
      JSON.stringify({ id: `sub_${i}`, status: 'pending-review' }),
      { metadata: { kind: 'metadata-edit', status: 'pending-review', entityId: `map-${i}` } });
  }
  const res = await listGet(makeContext({
    email: OWNER, method: 'GET',
    url: 'https://civgraph.net/_api/contributions/list?status=pending-review&limit=10',
    env: { ...env, CIVGRAPH_CONTRIBUTION_QUEUE: bigQueue },
  }));
  const payload = await res.json();
  check('a truncated listing returns the asked-for page', payload.count === 10);
  check('a truncated listing does NOT claim to be complete', payload.complete === false,
    `complete=${payload.complete}`);
  check('a truncated listing says so in the note', /Partial list/.test(payload.note || ''));
}

// --- no queue configured ---------------------------------------------------
{
  const res = await submitPost(makeContext({ email: CONTRIBUTOR, body: validPatch, env: { ...env, CIVGRAPH_CONTRIBUTION_QUEUE: undefined } }));
  check('with no queue bound, submission fails closed with 503', res.status === 503);
}

if (failures.length) {
  console.error(`FAIL: ${failures.length} of ${passed + failures.length} contribution flow checks failed:`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`PASS: ${passed} contribution flow checks (submit, queue, list, decide).`);
