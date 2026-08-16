import { jsonResponse, jsonNotAllowed, requireAdmin } from '../_auth.js';
import { methodGuard } from '../_method.js';

/**
 * Record an approve/reject decision on a queued contribution. Administrators only.
 *
 * WHAT THIS DOES NOT DO
 *
 * Approving does not apply anything. It sets `status` on the queued record and
 * nothing else: no catalogue write, no R2 write, no commit. Turning an approved
 * submission into a change is done by scripts/apply-contributions.mjs, run by
 * the owner on their own machine, which produces a git branch for review.
 *
 * That split is deliberate and is the whole security model. If approval wrote
 * directly to the catalogue, the boundary between "requesting" and "enacting"
 * would rest on this file being correct -- on requireAdmin, on the allowlist
 * parsing, on there being no way to reach the endpoint with a forged header.
 * Instead the boundary rests on who can push to main, which GitHub enforces and
 * which no bug in this file can weaken. The worst a flaw here can do is mark a
 * submission approved that the owner never wanted; they still have to run the
 * apply step and merge the result.
 *
 * Usage:  POST /_api/contributions/decide
 *         { "key": "submissions/2026-08-13/sub_...json",
 *           "decision": "approved" | "rejected", "note": "..." }
 */
const VALID_DECISIONS = new Set(['approved', 'rejected']);

export async function onRequestPost(context) {
  const { auth, response } = requireAdmin(context);
  if (response) return response;

  let payload;
  try {
    payload = await context.request.json();
  } catch {
    return jsonResponse({ ok: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  const key = String(payload?.key || '').trim();
  const decision = String(payload?.decision || '').trim();
  const note = String(payload?.note || '').replace(/\s+/g, ' ').trim().slice(0, 2000);

  // Constrain the key rather than trusting it. Without this, `key` is an
  // arbitrary path into the namespace and a decide call could overwrite any
  // object the binding can reach.
  if (!/^submissions\/\d{4}-\d{2}-\d{2}\/sub_[A-Za-z0-9_]+\.json$/.test(key)) {
    return jsonResponse({ ok: false, error: 'Invalid submission key' }, { status: 400 });
  }
  if (!VALID_DECISIONS.has(decision)) {
    return jsonResponse({ ok: false, error: 'decision must be "approved" or "rejected"' }, { status: 400 });
  }

  const env = context.env || {};
  const queue = env.CIVGRAPH_CONTRIBUTION_QUEUE;
  const bucket = env.CIVGRAPH_SUBMISSIONS;
  if (!queue?.get && !bucket?.get) {
    return jsonResponse({ ok: false, error: 'Contribution queue is not configured.' }, { status: 503 });
  }

  const rawValue = queue?.get ? await queue.get(key) : await (await bucket.get(key))?.text();
  if (!rawValue) return jsonResponse({ ok: false, error: 'Submission not found' }, { status: 404 });

  let submission;
  try {
    submission = JSON.parse(rawValue);
  } catch {
    return jsonResponse({ ok: false, error: 'Stored submission is not valid JSON' }, { status: 500 });
  }

  // Decisions are recorded, not overwritten. An audit trail matters more here
  // than a tidy record: "who approved this and when" is the question that gets
  // asked after something goes wrong, and it is unanswerable if each decision
  // silently replaces the last.
  submission.status = decision;
  submission.decisions = Array.isArray(submission.decisions) ? submission.decisions : [];
  submission.decisions.push({
    decision,
    note,
    decidedBy: auth.email,
    decidedAt: new Date().toISOString(),
  });

  const body = JSON.stringify(submission, null, 2);
  const metadata = {
    kind: submission.kind,
    entityType: submission.entityType || '',
    entityId: submission.entityId || '',
    submittedBy: submission.submittedBy || '',
    status: submission.status,
  };

  if (queue?.put) await queue.put(key, body, { metadata });
  else await bucket.put(key, body, { httpMetadata: { contentType: 'application/json' } });

  return jsonResponse({
    ok: true,
    key,
    status: submission.status,
    decidedBy: auth.email,
    applied: false,
    note: decision === 'approved'
      ? 'Recorded as approved. Nothing has been changed yet: run `npm run contributions:apply` locally to produce a branch, then review and merge it.'
      : 'Recorded as rejected. Nothing was changed.',
  });
}

export const onRequest = methodGuard('POST', onRequestPost, jsonNotAllowed);
