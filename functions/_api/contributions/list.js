import { jsonResponse, requireAdmin } from '../_auth.js';

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

  if (queue?.list) {
    // KV list returns per-key metadata, so the common case -- "what is waiting for
    // me" -- is answered without reading a single value.
    const listing = await queue.list({ prefix: 'submissions/', limit: MAX_LIMIT });
    for (const key of listing.keys || []) {
      const meta = key.metadata || {};
      if (wantStatus !== 'all' && meta.status !== wantStatus) continue;
      items.push({ key: key.name, ...meta });
      if (items.length >= limit) break;
    }
  } else {
    const listing = await bucket.list({ prefix: 'submissions/', limit: MAX_LIMIT });
    for (const object of listing.objects || []) {
      items.push({ key: object.key, size: object.size, uploaded: object.uploaded });
      if (items.length >= limit) break;
    }
  }

  return jsonResponse({
    ok: true,
    status: wantStatus,
    count: items.length,
    items,
    reviewedBy: auth.email,
    note: 'Approving here records a decision only. Run `npm run contributions:apply` locally to turn approved submissions into a branch.',
  });
}

export async function onRequest(context) {
  if (context.request.method !== 'GET') {
    return jsonResponse({ ok: false, error: 'Method Not Allowed' }, { status: 405, headers: { Allow: 'GET' } });
  }
  return onRequestGet(context);
}
