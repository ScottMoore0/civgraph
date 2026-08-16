import { jsonResponse, jsonNotAllowed, requireContributor, sanitizeAuth } from '../_auth.js';
import { methodGuard } from '../_method.js';
import { VALID_KINDS, VALID_ENTITY_TYPES, dryRunPatch } from './_schema.js';

/**
 * Accept a contribution as a TYPED PATCH, dry-run it, and queue it for review.
 *
 * Nothing here enacts anything. A submission is a request: it lands in the queue
 * with status "pending-review" and only scripts/apply-contributions.mjs, run by
 * the owner on their own machine, can turn it into a change. There is
 * deliberately no code path from this endpoint to the catalogue, to R2, or to
 * the repository -- see docs/contributions.md for why enactment is kept behind
 * a git merge rather than behind application logic in this file.
 *
 * WHAT CHANGED FROM THE PROSE VERSION
 *
 * `fields` used to be free text: every value coerced to a string, objects
 * JSON.stringify'd into a blob. A reviewer had to read the description and
 * retype the change. Now `patch` is a typed object validated against
 * _schema.js, so an approved submission is applied mechanically and the reviewer
 * spends their attention on whether the change is RIGHT rather than on
 * transcription.
 *
 * The response carries the dry-run result, which is the thing contributors most
 * lacked: they now find out immediately that a value is the wrong shape, in the
 * same way `npm run check` tells the owner. A submission that fails validation
 * is rejected outright rather than queued, because a queue of known-broken
 * proposals costs review attention for no possible benefit.
 */

const MAX_JSON_BYTES = 96 * 1024;
const MAX_QUARANTINE_KEYS = 20;

export async function onRequestPost(context) {
  const { auth, response } = requireContributor(context);
  if (response) return response;

  const contentType = context.request.headers.get('Content-Type') || '';
  if (!contentType.includes('application/json')) {
    return jsonResponse({ ok: false, error: 'Expected application/json body' }, { status: 415 });
  }

  const raw = await context.request.text();
  if (raw.length > MAX_JSON_BYTES) {
    return jsonResponse({ ok: false, error: 'Submission body is too large' }, { status: 413 });
  }

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return jsonResponse({ ok: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  const validation = validateSubmission(payload);
  if (validation.error) {
    return jsonResponse({ ok: false, error: validation.error }, { status: 400 });
  }

  // Dry run against the live record where the kind involves a patch. The current
  // record is fetched through the same catalogue API the site uses; if that is
  // unavailable the dry run still checks shape and says so explicitly via
  // checkedAgainstCurrentRecord, rather than reporting a pass it did not earn.
  let dryRun = null;
  if (payload.kind === 'metadata-edit') {
    const current = await fetchCurrentRecord(context, payload.entityType, payload.entityId);
    dryRun = dryRunPatch(payload.entityType, payload.patch, current);
    if (!dryRun.ok) {
      return jsonResponse({
        ok: false,
        error: 'Proposed patch failed validation',
        dryRun,
        auth: sanitizeAuth(auth),
      }, { status: 422 });
    }
  }

  const submission = {
    id: createSubmissionId(),
    schemaVersion: 2,
    kind: payload.kind,
    entityType: payload.entityType || null,
    entityId: payload.entityId || null,
    title: safeString(payload.title, 180),
    summary: safeString(payload.summary, 2000),
    // The typed payload. Only one of these is populated, per kind.
    patch: payload.kind === 'metadata-edit' ? payload.patch : null,
    retire: payload.kind === 'retire' ? { reason: safeString(payload.reason, 2000) } : null,
    mapRequest: payload.kind === 'map-submission' ? sanitizeMapRequest(payload.mapRequest) : null,
    sourceUrls: sanitizeUrlList(payload.sourceUrls),
    quarantineKeys: sanitizeQuarantineKeys(payload.quarantineKeys),
    dryRun,
    pageUrl: safeString(payload.pageUrl, 500),
    submittedBy: auth.email,
    submittedAt: new Date().toISOString(),
    userAgent: safeString(context.request.headers.get('User-Agent'), 240),
    // Set here and never changed by this endpoint. Only the decide endpoint,
    // which requires admin, may move a submission out of pending-review.
    status: 'pending-review',
  };

  const stored = await persistSubmission(context.env || {}, submission);
  if (!stored.ok) {
    return jsonResponse({
      ok: false,
      error: stored.error,
      auth: sanitizeAuth(auth),
      dryRun,
      submissionPreview: { id: submission.id, kind: submission.kind, submittedAt: submission.submittedAt },
    }, { status: 503 });
  }

  return jsonResponse({
    ok: true,
    submission: {
      id: submission.id,
      kind: submission.kind,
      entityType: submission.entityType,
      entityId: submission.entityId,
      submittedAt: submission.submittedAt,
      status: submission.status,
      storage: stored.storage,
    },
    dryRun,
    note: 'Queued for review. Submissions are never applied automatically; a site administrator must approve and apply this change.',
    auth: sanitizeAuth(auth),
  }, { status: 202 });
}

export const onRequest = methodGuard('POST', onRequestPost, jsonNotAllowed);

function validateSubmission(payload) {
  if (!payload || typeof payload !== 'object') return { error: 'Submission must be an object' };
  if (!VALID_KINDS.has(payload.kind)) {
    return { error: `Unsupported submission kind. Expected one of: ${[...VALID_KINDS].join(', ')}` };
  }

  if (payload.kind === 'metadata-edit' || payload.kind === 'retire') {
    if (!VALID_ENTITY_TYPES.has(payload.entityType)) return { error: 'Unsupported entity type' };
    if (!safeString(payload.entityId, 300)) return { error: 'Entity ID is required' };
  }
  if (payload.kind === 'metadata-edit') {
    if (!payload.patch || typeof payload.patch !== 'object' || Array.isArray(payload.patch)) {
      return { error: 'A metadata-edit requires a `patch` object of field: value pairs' };
    }
  }
  if (payload.kind === 'retire') {
    // Retiring hides a layer from the public catalogue. Requiring a reason is not
    // ceremony: without it a reviewer cannot tell a duplicate from a mistake, and
    // both look identical in a diff.
    if (!safeString(payload.reason, 2000)) return { error: 'A retire request requires a `reason`' };
  }
  if (payload.kind === 'map-submission') {
    const mapRequest = payload.mapRequest || {};
    if (!safeString(mapRequest.title || payload.title, 180)) return { error: 'Map submission title is required' };
    if (!safeString(payload.summary || mapRequest.description, 2000)) return { error: 'Map submission description is required' };
  }
  return {};
}

/**
 * Read the record as it currently stands so the dry run can report what would
 * actually change. Returns null on any failure -- the dry run then reports
 * checkedAgainstCurrentRecord: false rather than pretending.
 *
 * THIS RETURNED NULL EVERY TIME, FROM THE DAY IT SHIPPED UNTIL 2026-08-16.
 *
 * /_api/catalogue answers `?id=` with the BARE RECORD. Only the no-parameter
 * and `?category=` forms return a `{ maps: [...] }` envelope. This looked for
 * the envelope, never found it, and fell through to null. So every dry run ever
 * performed was shape-only, `checkedAgainstCurrentRecord` was false on every
 * submission in the queue, and _schema.js's "Patch is valid but changes nothing"
 * could not fire -- with no current record, every field reads as changed.
 *
 * Nothing caught it, and the reason is worth more than the fix.
 * scripts/test-contribution-flow.mjs asserts `checkedAgainstCurrentRecord ===
 * true` and passed throughout, because its fetch stub returned the envelope
 * shape. The fixture agreed with the caller and both disagreed with the
 * endpoint, so the test proved only that the caller was self-consistent. A mock
 * written from the code it tests cannot fail the way production does.
 *
 * Both shapes are accepted below: `?id=` and `?category=` genuinely differ, and
 * a later caller may reasonably use either.
 */
async function fetchCurrentRecord(context, entityType, entityId) {
  if (entityType !== 'map') return null; // only the catalogue is reachable from the edge today
  try {
    const url = new URL(context.request.url);
    const res = await fetch(`${url.origin}/_api/catalogue?id=${encodeURIComponent(entityId)}`, {
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return null;
    const doc = await res.json();
    if (Array.isArray(doc?.maps)) return doc.maps.find((m) => m?.id === entityId) || null;
    return doc?.id === entityId ? doc : null;
  } catch {
    return null;
  }
}

async function persistSubmission(env, submission) {
  const key = `submissions/${submission.submittedAt.slice(0, 10)}/${submission.id}.json`;
  const body = JSON.stringify(submission, null, 2);

  if (env.CIVGRAPH_CONTRIBUTION_QUEUE?.put) {
    await env.CIVGRAPH_CONTRIBUTION_QUEUE.put(key, body, { metadata: queueMetadata(submission) });
    return { ok: true, storage: 'KV:CIVGRAPH_CONTRIBUTION_QUEUE', key };
  }
  if (env.CIVGRAPH_SUBMISSIONS?.put) {
    await env.CIVGRAPH_SUBMISSIONS.put(key, body, { httpMetadata: { contentType: 'application/json' } });
    return { ok: true, storage: 'R2:CIVGRAPH_SUBMISSIONS', key };
  }

  console.warn(JSON.stringify({ evt: 'contribution_queue_missing', submissionId: submission.id, kind: submission.kind }));
  return {
    ok: false,
    error: 'Contribution queue is not configured. Add a KV binding named CIVGRAPH_CONTRIBUTION_QUEUE or an R2 binding named CIVGRAPH_SUBMISSIONS.',
  };
}

function queueMetadata(submission) {
  return {
    kind: submission.kind,
    entityType: submission.entityType || '',
    entityId: submission.entityId || '',
    submittedBy: submission.submittedBy,
    status: submission.status,
  };
}

function sanitizeMapRequest(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return {
    title: safeString(value.title, 180),
    geography: safeString(value.geography, 180),
    dateRange: safeString(value.dateRange, 120),
    provider: safeString(value.provider, 180),
    proposedCategory: safeString(value.proposedCategory, 180),
    sourceDescription: safeString(value.sourceDescription, 1200),
    licenceClaim: safeString(value.licenceClaim || value.licenseClaim, 400),
    notes: safeString(value.notes, 2000),
  };
}

function sanitizeUrlList(value) {
  const values = Array.isArray(value) ? value : String(value || '').split(/\s+/);
  return values
    .map((item) => safeString(item, 500))
    .filter((item) => /^https?:\/\//i.test(item))
    .slice(0, 20);
}

/**
 * References to objects the contributor uploaded into the quarantine bucket.
 *
 * Only the KEY is carried, and only keys under the quarantine prefix are
 * accepted, so a submission cannot be used to point the review tooling at an
 * arbitrary object elsewhere in storage.
 */
function sanitizeQuarantineKeys(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => safeString(item, 300))
    .filter((item) => /^quarantine\/[A-Za-z0-9._\-/]+$/.test(item) && !item.includes('..'))
    .slice(0, MAX_QUARANTINE_KEYS);
}

function safeString(value, maxLength) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function createSubmissionId() {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  const random = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `sub_${Date.now().toString(36)}_${random}`;
}
