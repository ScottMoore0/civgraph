import { jsonResponse, jsonNotAllowed, requireAdmin } from '../_auth.js';
import { methodGuard } from '../_method.js';

/**
 * List queued contributions. Administrators only.
 *
 * status.js has advertised `approveSubmissions: auth.isAdmin` since the
 * contribution code was first written, with no endpoint behind it. This and
 * decide.js make that capability real.
 *
 * Admin-gated rather than contributor-gated because the queue contains other
 * people's submissions, including their email addresses. A contributor has no
 * business reading it, and "they can already see their own" is not a reason to
 * hand over everyone else's.
 *
 * Usage:  GET /_api/contributions/list?status=pending-review&limit=50
 */
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

// Ceiling on keys walked in one request. The status filter runs after the fetch,
// so answering "what is pending" can require reading past a lot of decided
// submissions; this bounds that without reintroducing a silent cut-off, because
// `complete: false` in the response says the bottom was not reached.
const MAX_SCAN = 2000;

export async function onRequestGet(context) {
  const { auth, response } = requireAdmin(context);
  if (response) return response;

  const url = new URL(context.request.url);
  const wantStatus = url.searchParams.get('status') || 'pending-review';
  const limit = Math.min(MAX_LIMIT, Math.max(1, Number(url.searchParams.get('limit')) || DEFAULT_LIMIT));
  const env = context.env || {};

  const queue = env.CIVGRAPH_CONTRIBUTION_QUEUE;
  const bucket = env.CIVGRAPH_SUBMISSIONS;

  if (!queue?.list && !bucket?.list) {
    return jsonResponse({
      ok: false,
      error: 'Contribution queue is not configured. Add a KV binding named CIVGRAPH_CONTRIBUTION_QUEUE or an R2 binding named CIVGRAPH_SUBMISSIONS.',
    }, { status: 503 });
  }

  const items = [];
  let scanned = 0;
  let complete = true;

  if (queue?.list) {
    // KV list returns per-key metadata, so the common case -- "what is waiting for
    // me" -- is answered without reading a single value.
    //
    // PAGINATED, because the status filter runs after the fetch.
    //
    // This used to request a single page of MAX_LIMIT keys and filter within it,
    // never reading `cursor` or `list_complete`. KV lists lexicographically and
    // the keys are `submissions/YYYY-MM-DD/...`, so that ordering is OLDEST
    // FIRST: past 200 submissions the newest could never appear, whatever their
    // status, and the endpoint still answered `ok: true` with a short list. The
    // review queue would have gone quietly blind while looking healthy.
    //
    // The scan is bounded so a large queue cannot turn one request into an
    // unbounded walk; `complete` reports whether the bottom was reached, so a
    // truncated answer says so instead of impersonating an empty one.
    let cursor;
    for (;;) {
      const listing = await queue.list({ prefix: 'submissions/', limit: MAX_LIMIT, cursor });
      for (const key of listing.keys || []) {
        scanned += 1;
        const meta = key.metadata || {};
        if (wantStatus !== 'all' && meta.status !== wantStatus) continue;
        items.push({ key: key.name, ...meta });
        if (items.length >= limit) break;
      }
      cursor = listing.list_complete ? undefined : listing.cursor;
      if (!cursor) break;                              // reached the end
      if (items.length >= limit) break;                // asked-for page is full
      if (scanned >= MAX_SCAN) break;                  // ceiling
    }
    // Complete means "there is nothing further to find". Anything else -- more
    // keys behind a cursor, a full page, the scan ceiling -- means the caller is
    // holding a partial answer and must be told so.
    complete = !cursor;
  } else {
    const listing = await bucket.list({ prefix: 'submissions/', limit: MAX_LIMIT });
    for (const object of listing.objects || []) {
      scanned += 1;
      items.push({ key: object.key, size: object.size, uploaded: object.uploaded });
      if (items.length >= limit) break;
    }
    // The R2 fallback has never been paginated either. It is a fallback for a
    // binding that is not configured, so it is left as-is rather than grown a
    // second cursor implementation -- but it must not claim completeness it has
    // not established.
    complete = Boolean(listing.truncated) === false;
  }

  return jsonResponse({
    ok: true,
    status: wantStatus,
    count: items.length,
    items,
    // Say whether this is the whole answer. Without it a partial list is
    // indistinguishable from an empty queue, which is how a review backlog goes
    // unnoticed.
    complete,
    scanned,
    reviewedBy: auth.email,
    note: complete
      ? 'Approving here records a decision only. Run `npm run contributions:apply` locally to turn approved submissions into a branch.'
      : `Partial list: ${scanned} keys scanned and more remain. Raise limit, or narrow status, to see the rest.`,
  });
}

export const onRequest = methodGuard('GET', onRequestGet, jsonNotAllowed);
