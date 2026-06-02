import { jsonResponse, requireContributor, sanitizeAuth } from '../_auth.js';

const MAX_JSON_BYTES = 96 * 1024;
const VALID_KINDS = new Set(['metadata-edit', 'map-submission']);
const VALID_ENTITY_TYPES = new Set(['map', 'election', 'feature', 'party', 'person', 'source', 'book', 'table']);

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

  const submission = {
    id: createSubmissionId(),
    kind: payload.kind,
    entityType: payload.entityType || null,
    entityId: payload.entityId || null,
    title: safeString(payload.title, 180),
    summary: safeString(payload.summary, 2000),
    fields: sanitizeFields(payload.fields),
    sourceUrls: sanitizeUrlList(payload.sourceUrls),
    mapRequest: sanitizeMapRequest(payload.mapRequest),
    pageUrl: safeString(payload.pageUrl, 500),
    submittedBy: auth.email,
    submittedAt: new Date().toISOString(),
    userAgent: safeString(context.request.headers.get('User-Agent'), 240),
    status: 'pending-review'
  };

  const stored = await persistSubmission(context.env || {}, submission);
  if (!stored.ok) {
    return jsonResponse({
      ok: false,
      error: stored.error,
      auth: sanitizeAuth(auth),
      submissionPreview: {
        id: submission.id,
        kind: submission.kind,
        entityType: submission.entityType,
        entityId: submission.entityId,
        submittedAt: submission.submittedAt
      }
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
      storage: stored.storage
    },
    auth: sanitizeAuth(auth)
  }, { status: 202 });
}

export async function onRequest(context) {
  if (context.request.method !== 'POST') {
    return jsonResponse({ ok: false, error: 'Method Not Allowed' }, { status: 405, headers: { Allow: 'POST' } });
  }
  return onRequestPost(context);
}

function validateSubmission(payload) {
  if (!payload || typeof payload !== 'object') return { error: 'Submission must be an object' };
  if (!VALID_KINDS.has(payload.kind)) return { error: 'Unsupported submission kind' };
  if (payload.kind === 'metadata-edit') {
    if (!VALID_ENTITY_TYPES.has(payload.entityType)) return { error: 'Unsupported entity type' };
    if (!safeString(payload.entityId, 300)) return { error: 'Entity ID is required' };
    if (!payload.fields || typeof payload.fields !== 'object' || Array.isArray(payload.fields)) return { error: 'Metadata edit fields are required' };
  }
  if (payload.kind === 'map-submission') {
    const mapRequest = payload.mapRequest || {};
    if (!safeString(mapRequest.title || payload.title, 180)) return { error: 'Map submission title is required' };
    if (!safeString(payload.summary || mapRequest.description, 2000)) return { error: 'Map submission description is required' };
  }
  return {};
}

async function persistSubmission(env, submission) {
  const key = `submissions/${submission.submittedAt.slice(0, 10)}/${submission.id}.json`;
  const body = JSON.stringify(submission, null, 2);

  if (env.CIVGRAPH_CONTRIBUTION_QUEUE?.put) {
    await env.CIVGRAPH_CONTRIBUTION_QUEUE.put(key, body, { metadata: queueMetadata(submission) });
    return { ok: true, storage: 'KV:CIVGRAPH_CONTRIBUTION_QUEUE', key };
  }
  if (env.CONTRIBUTION_QUEUE?.put) {
    await env.CONTRIBUTION_QUEUE.put(key, body, { metadata: queueMetadata(submission) });
    return { ok: true, storage: 'KV:CONTRIBUTION_QUEUE', key };
  }
  if (env.CIVGRAPH_SUBMISSIONS?.put) {
    await env.CIVGRAPH_SUBMISSIONS.put(key, body, { httpMetadata: { contentType: 'application/json' } });
    return { ok: true, storage: 'R2:CIVGRAPH_SUBMISSIONS', key };
  }
  if (env.CONTRIBUTION_SUBMISSIONS?.put) {
    await env.CONTRIBUTION_SUBMISSIONS.put(key, body, { httpMetadata: { contentType: 'application/json' } });
    return { ok: true, storage: 'R2:CONTRIBUTION_SUBMISSIONS', key };
  }

  console.warn(JSON.stringify({ evt: 'contribution_queue_missing', submissionId: submission.id, kind: submission.kind }));
  return {
    ok: false,
    error: 'Contribution queue is not configured. Add a KV binding named CIVGRAPH_CONTRIBUTION_QUEUE or an R2 binding named CIVGRAPH_SUBMISSIONS.'
  };
}

function queueMetadata(submission) {
  return {
    kind: submission.kind,
    entityType: submission.entityType || '',
    entityId: submission.entityId || '',
    submittedBy: submission.submittedBy,
    status: submission.status
  };
}

function sanitizeFields(fields) {
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) return {};
  const output = {};
  for (const [key, value] of Object.entries(fields)) {
    const safeKey = safeString(key, 80);
    if (!safeKey) continue;
    if (typeof value === 'object') {
      output[safeKey] = safeString(JSON.stringify(value), 4000);
    } else {
      output[safeKey] = safeString(value, 4000);
    }
  }
  return output;
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
    notes: safeString(value.notes, 2000)
  };
}

function sanitizeUrlList(value) {
  const values = Array.isArray(value) ? value : String(value || '').split(/\s+/);
  return values
    .map((item) => safeString(item, 500))
    .filter((item) => /^https?:\/\//i.test(item))
    .slice(0, 20);
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
