import { jsonResponse, jsonNotAllowed } from '../_auth.js';
import { methodGuard } from '../_method.js';
import { describeSchema, VALID_KINDS } from './_schema.js';

/**
 * The editable-field list, served from the module that enforces it.
 *
 * browse/browse.js builds its edit form from this, so the fields a contributor
 * is offered and the fields the server accepts cannot drift apart. Copying the
 * list into the client would have meant a mismatch showing up only as somebody
 * else's rejected submission, which is the slowest possible way to find out.
 *
 * INTENDED to be unauthenticated -- it describes the API's own shape, which
 * field names exist and what type each takes, and carries no data about the
 * site, its records, or who may contribute.
 *
 * IN PRACTICE IT IS BEHIND ACCESS. Verified 2026-08-15: the Cloudflare Access
 * application protects the path `_api/contributions`, which necessarily catches
 * this sibling route, and an anonymous request gets a 302 to the Access login
 * rather than the 200 the comment above once promised.
 *
 * That is harmless, and deliberately left alone. browse.js only calls this from
 * openEditSubmissionForm, and the contributor panel that opens it is gated on
 * auth.allowed -- so the only callers are already signed in and carry the Access
 * cookie. An anonymous visitor never reaches the fetch.
 *
 * If it ever needs to be genuinely public (a third-party client building a form
 * before sign-in, say), move it out from under the protected prefix rather than
 * widening the Access policy -- narrowing the policy path is what keeps
 * /_api/auth/status reachable, and that one MUST stay public or the Browse page
 * breaks for everyone.
 */
export async function onRequestGet() {
  return jsonResponse({
    ok: true,
    kinds: [...VALID_KINDS],
    entityTypes: describeSchema(),
    limits: { maxStringLength: 4000, maxArrayItems: 200, maxBodyBytes: 96 * 1024 },
    note: 'Submissions are queued for review and never applied automatically.',
    // no-cache, not max-age. This document describes the shape of the API, so it
    // changes exactly when the API changes -- at deploy time. It was briefly
    // served with max-age=300, and on 2026-08-15 that meant the edit form built
    // itself from a five-minute-old copy that still called `references` a plain
    // array, rendering a textarea where the structured group belongs. The
    // symptom was indistinguishable from the client code being wrong.
    //
    // It is a couple of kilobytes and fetched once per form open. no-cache still
    // permits a conditional request, so the cost of correctness here is an ETag
    // round trip.
  }, { headers: { 'Cache-Control': 'no-cache' } });
}

export const onRequest = methodGuard('GET', onRequestGet, jsonNotAllowed);
