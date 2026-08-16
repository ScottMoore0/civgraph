import { jsonResponse, jsonNotAllowed, requireContributor } from '../_auth.js';
import { methodGuard } from '../_method.js';

/**
 * Accept a file into QUARANTINE so a contributor can supply data, not just a
 * link to it — without ever writing to anything the site serves.
 *
 * THE POINT OF THE QUARANTINE PREFIX
 *
 * "Supply data" and "write to published storage" are separable, and this is
 * where they get separated. Objects land under `quarantine/`, in a bucket bound
 * as CIVGRAPH_QUARANTINE which MUST NOT be the public boundaries-data bucket and
 * MUST NOT have a public custom domain. Nothing reads this prefix except the
 * owner, reviewing locally. Promotion to a served location is a manual step
 * taken after a rights determination, exactly like every other publication here.
 *
 * WHY IT REFUSES TO RUN WITHOUT AN EXPLICIT BINDING
 *
 * Accepting third-party uploads makes you a host, with retention, content-type,
 * size and takedown obligations that did not previously exist. That should
 * begin with a deliberate act of configuration, not with a deploy that happens
 * to include this file. Absent the binding it returns 503 and explains itself,
 * which is the same closed-door pattern the submission queue uses.
 *
 * Usage:  POST /_api/contributions/intake?filename=boundaries.geojson
 *         (raw body; returns the quarantine key to cite in a submission)
 */

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

// Deliberately narrow: the formats this project actually ingests, plus plain
// documents. Not an attempt at malware defence -- an allowlist of extensions is
// not that -- but it keeps the obvious executable and archive shapes out of a
// bucket the owner will later open locally.
const ALLOWED_EXTENSIONS = new Set([
  'geojson', 'json', 'fgb', 'gpkg', 'kml', 'gml', 'csv', 'tsv', 'txt',
  'pdf', 'png', 'jpg', 'jpeg', 'webp', 'tif', 'tiff', 'md', 'xlsx',
]);

export async function onRequestPost(context) {
  const { auth, response } = requireContributor(context);
  if (response) return response;

  const bucket = context.env?.CIVGRAPH_QUARANTINE;
  if (!bucket?.put) {
    return jsonResponse({
      ok: false,
      error: 'File intake is not enabled. Bind a PRIVATE R2 bucket as CIVGRAPH_QUARANTINE. It must not be the public boundaries-data bucket and must not have a public custom domain.',
    }, { status: 503 });
  }

  const url = new URL(context.request.url);
  const filename = String(url.searchParams.get('filename') || '').trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9 ._-]{0,120}$/.test(filename)) {
    return jsonResponse({ ok: false, error: 'A simple filename query parameter is required' }, { status: 400 });
  }
  const extension = filename.split('.').pop()?.toLowerCase() || '';
  if (!ALLOWED_EXTENSIONS.has(extension)) {
    return jsonResponse({
      ok: false,
      error: `Unsupported file type ".${extension}". Allowed: ${[...ALLOWED_EXTENSIONS].sort().join(', ')}`,
    }, { status: 415 });
  }

  const declared = Number(context.request.headers.get('Content-Length') || 0);
  if (declared > MAX_UPLOAD_BYTES) {
    return jsonResponse({ ok: false, error: `File exceeds ${MAX_UPLOAD_BYTES} bytes` }, { status: 413 });
  }

  const body = await context.request.arrayBuffer();
  if (body.byteLength > MAX_UPLOAD_BYTES) {
    // Checked again after reading: Content-Length is a claim, not a guarantee.
    return jsonResponse({ ok: false, error: `File exceeds ${MAX_UPLOAD_BYTES} bytes` }, { status: 413 });
  }
  if (!body.byteLength) {
    return jsonResponse({ ok: false, error: 'Empty upload' }, { status: 400 });
  }

  const digest = await crypto.subtle.digest('SHA-256', body);
  const sha256 = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  const day = new Date().toISOString().slice(0, 10);
  const key = `quarantine/${day}/${sha256.slice(0, 16)}-${filename.replace(/\s+/g, '-')}`;

  await bucket.put(key, body, {
    // Stored as octet-stream regardless of the declared type. If this bucket is
    // ever exposed by mistake, nothing in it should be interpreted as HTML or a
    // script by a browser.
    httpMetadata: { contentType: 'application/octet-stream' },
    customMetadata: {
      uploadedBy: auth.email || '',
      uploadedAt: new Date().toISOString(),
      originalFilename: filename,
      sha256,
    },
  });

  return jsonResponse({
    ok: true,
    key,
    sha256,
    bytes: body.byteLength,
    note: 'Stored in quarantine. Cite this key in a submission as quarantineKeys. It is not published and is not served anywhere.',
  }, { status: 201 });
}

export const onRequest = methodGuard('POST', onRequestPost, jsonNotAllowed);
