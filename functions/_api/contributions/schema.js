import { jsonResponse } from '../_auth.js';
import { describeSchema, VALID_KINDS } from './_schema.js';

/**
 * The editable-field list, served from the module that enforces it.
 *
 * browse/browse.js builds its edit form from this, so the fields a contributor
 * is offered and the fields the server accepts cannot drift apart. Copying the
 * list into the client would have meant a mismatch showing up only as somebody
 * else's rejected submission, which is the slowest possible way to find out.
 *
 * Unauthenticated on purpose. It is a description of the API's own shape --
 * which field names exist and what type each takes -- and carries no data about
 * the site, its records, or who may contribute. Requiring auth would mean the
 * form could not be built until after sign-in, for no benefit.
 */
export async function onRequestGet() {
  return jsonResponse({
    ok: true,
    kinds: [...VALID_KINDS],
    entityTypes: describeSchema(),
    limits: { maxStringLength: 4000, maxArrayItems: 200, maxBodyBytes: 96 * 1024 },
    note: 'Submissions are queued for review and never applied automatically.',
  }, { headers: { 'Cache-Control': 'public, max-age=300' } });
}

export async function onRequest(context) {
  if (context.request.method !== 'GET') {
    return jsonResponse({ ok: false, error: 'Method Not Allowed' }, { status: 405, headers: { Allow: 'GET' } });
  }
  return onRequestGet(context);
}
