#!/usr/bin/env node
/**
 * Fetch files that contributors cited as Google Drive links, into quarantine.
 *
 * Contributors cannot upload geometry through the site -- the submission body is
 * capped at 96 KB -- so a map submission arrives as a link. Six arrived on
 * 2026-08-16, each a Drive link to a corrected Local Authorities layer. This
 * turns those links into verified local files with a provenance record, so the
 * conversion work starts from something checksummed rather than something
 * downloaded by hand at an unrecorded moment.
 *
 * TWO FETCH PATHS, ONE INTERFACE
 *
 *   With GOOGLE_API_KEY   Drive API v3. Gives name, size, mimeType and Google's
 *                         own md5Checksum BEFORE downloading, and streams the
 *                         file with no interstitial at any size.
 *   Without               The public uc?export=download endpoint, following the
 *                         virus-scan confirmation form that Google interposes
 *                         above roughly 100 MB.
 *
 * The keyless path is deliberately the fallback, not the design. It depends on
 * the shape of a Google HTML page, which changed in 2024 and will change again.
 * Set GOOGLE_API_KEY in .env.local and this switches over with no other change.
 *
 * WHY THE PAYLOAD IS CHECKED RATHER THAN TRUSTED
 *
 * The keyless path's most likely failure is receiving a success-shaped HTML page
 * -- a consent screen, a quota notice, a sign-in wall -- with HTTP 200. Saved
 * blindly, that produces five corrupt archives with plausible filenames and no
 * error anywhere. So every download is inspected: content type, magic bytes, and
 * size against what the metadata promised. Anything that is not the file is
 * refused loudly.
 *
 * Usage:
 *   node scripts/fetch-submission-attachments.mjs --probe            # no downloads
 *   node scripts/fetch-submission-attachments.mjs --probe --url <link>
 *   node scripts/fetch-submission-attachments.mjs --fetch            # writes to quarantine
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import path from 'node:path';

const QUARANTINE = 'data/quarantine/submissions';
const KV_BINDING = 'CIVGRAPH_CONTRIBUTION_QUEUE';
const MAX_BYTES = 2 * 1024 * 1024 * 1024; // 2 GB: boundary archives get large
const IS_WINDOWS = process.platform === 'win32';

const argv = process.argv.slice(2);
const PROBE = argv.includes('--probe');
const FETCH = argv.includes('--fetch');
const urlArg = argv[argv.indexOf('--url') + 1];
const EXPLICIT_URLS = argv.includes('--url') && urlArg ? [urlArg] : null;

// Read .env.local without a dependency: the API key lives there, never in git.
function loadEnvLocal() {
  if (!existsSync('.env.local')) return;
  for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^["']|["']$/g, '');
  }
}
loadEnvLocal();
const API_KEY = process.env.GOOGLE_API_KEY || process.env.GOOGLE_DRIVE_API_KEY || null;

/** Every Drive URL shape seen in the wild reduces to one file id. */
export function driveFileId(url) {
  const value = String(url || '');
  if (!/(^|\.)google\.com/.test(value)) return null;
  const patterns = [
    /\/file\/d\/([A-Za-z0-9_-]{10,})/,
    /[?&]id=([A-Za-z0-9_-]{10,})/,
    /\/document\/d\/([A-Za-z0-9_-]{10,})/,
    /\/spreadsheets\/d\/([A-Za-z0-9_-]{10,})/,
  ];
  for (const pattern of patterns) {
    const found = value.match(pattern);
    if (found) return found[1];
  }
  return null;
}

// Google-native documents are not files: alt=media returns an error and the
// export endpoints produce a conversion, never the original. A boundary layer is
// never one of these, so treat them as a mistake rather than converting silently.
const GOOGLE_NATIVE = /^application\/vnd\.google-apps\./;

function wrangler(args) {
  return execFileSync(IS_WINDOWS ? 'npx.cmd' : 'npx', ['wrangler', ...args], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    shell: IS_WINDOWS,
  });
}

function pendingSubmissions() {
  const keys = JSON.parse(wrangler(['kv', 'key', 'list', '--binding', KV_BINDING, '--prefix', 'submissions/', '--remote']));
  const out = [];
  for (const key of keys) {
    const record = JSON.parse(wrangler(['kv', 'key', 'get', key.name, '--binding', KV_BINDING, '--remote']));
    if (record.status === 'rejected') continue;
    for (const url of record.sourceUrls || []) {
      const id = driveFileId(url);
      if (id) out.push({ submissionId: record.id, title: record.title || record.mapRequest?.title || '(untitled)', url, id });
    }
  }
  return out;
}

// --- metadata ---------------------------------------------------------------

async function metadataViaApi(id) {
  const url = `https://www.googleapis.com/drive/v3/files/${id}?fields=name,mimeType,size,md5Checksum&key=${API_KEY}`;
  const response = await fetch(url);
  if (!response.ok) {
    return { ok: false, error: `Drive API ${response.status}: ${(await response.text()).slice(0, 160)}` };
  }
  const meta = await response.json();
  return {
    ok: true,
    source: 'drive-api',
    name: meta.name,
    mimeType: meta.mimeType,
    bytes: meta.size ? Number(meta.size) : null,
    md5: meta.md5Checksum || null,
  };
}

/**
 * Metadata without a key: ask for one byte.
 *
 * A ranged request returns the filename in Content-Disposition and the total
 * size in Content-Range, without transferring the file. If Google answers with
 * HTML it is the interstitial, which still proves the file exists and is shared
 * -- it just means the download needs the confirm step.
 */
async function metadataViaPublic(id) {
  const response = await fetch(`https://drive.google.com/uc?export=download&id=${id}`, {
    headers: { Range: 'bytes=0-0' },
    redirect: 'follow',
  });
  const type = response.headers.get('content-type') || '';
  if (!response.ok && response.status !== 206) {
    return { ok: false, error: `HTTP ${response.status} — file may not be shared publicly` };
  }
  if (/text\/html/i.test(type)) {
    return { ok: true, source: 'public-interstitial', name: null, mimeType: null, bytes: null, md5: null, needsConfirm: true };
  }
  const disposition = response.headers.get('content-disposition') || '';
  const nameMatch = disposition.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i);
  const range = response.headers.get('content-range') || '';
  const total = range.match(/\/(\d+)$/);
  return {
    ok: true,
    source: 'public',
    name: nameMatch ? decodeURIComponent(nameMatch[1]) : null,
    mimeType: type || null,
    bytes: total ? Number(total[1]) : null,
    md5: null,
  };
}

const getMetadata = (id) => (API_KEY ? metadataViaApi(id) : metadataViaPublic(id));

// --- download ---------------------------------------------------------------

async function downloadViaApi(id) {
  const response = await fetch(`https://www.googleapis.com/drive/v3/files/${id}?alt=media&key=${API_KEY}`);
  if (!response.ok) throw new Error(`Drive API ${response.status}`);
  return { buffer: Buffer.from(await response.arrayBuffer()), type: response.headers.get('content-type') || '' };
}

async function downloadViaPublic(id) {
  let response = await fetch(`https://drive.google.com/uc?export=download&id=${id}`, { redirect: 'follow' });
  let type = response.headers.get('content-type') || '';

  if (/text\/html/i.test(type)) {
    // The virus-scan interstitial. Google renders a form whose hidden inputs
    // carry the confirm token; resubmitting it yields the file. Parsed rather
    // than guessed, because the parameter set has changed more than once.
    const html = await response.text();
    const action = html.match(/action="([^"]+)"/)?.[1]?.replace(/&amp;/g, '&');
    if (!action) throw new Error('Interstitial returned but no form action found — Google has changed the page');
    const params = new URLSearchParams();
    for (const input of html.matchAll(/<input[^>]+type="hidden"[^>]*>/g)) {
      const name = input[0].match(/name="([^"]+)"/)?.[1];
      const value = input[0].match(/value="([^"]*)"/)?.[1];
      if (name) params.set(name, value ?? '');
    }
    if (!params.has('id')) params.set('id', id);
    response = await fetch(`${action}?${params.toString()}`, { redirect: 'follow' });
    type = response.headers.get('content-type') || '';
  }

  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return { buffer: Buffer.from(await response.arrayBuffer()), type };
}

const download = (id) => (API_KEY ? downloadViaApi(id) : downloadViaPublic(id));

/**
 * Is this the file, or a page that merely returned 200?
 *
 * Magic bytes, not the filename. The keyless path's characteristic failure is an
 * HTML page saved as an archive, and only the leading bytes can tell.
 */
function inspectPayload(buffer, type) {
  const head = buffer.subarray(0, 5).toString('latin1');
  const text = buffer.subarray(0, 400).toString('utf8').trimStart().toLowerCase();
  if (/text\/html/i.test(type) || text.startsWith('<!doctype html') || text.startsWith('<html')) {
    return { ok: false, reason: 'received an HTML page, not a file (sign-in wall, quota notice or changed interstitial)' };
  }
  if (!buffer.length) return { ok: false, reason: 'empty response' };
  if (buffer.length > MAX_BYTES) return { ok: false, reason: `exceeds ${MAX_BYTES} bytes` };
  const kind = head.startsWith('PK') ? 'zip'
    : head.startsWith('{') || head.startsWith('[') ? 'json/geojson'
      : head.startsWith('%PDF') ? 'pdf'
        : 'binary';
  return { ok: true, kind };
}

// --- main -------------------------------------------------------------------

async function main() {
  if (!PROBE && !FETCH) {
    console.error('Specify --probe (no downloads) or --fetch (writes to quarantine).');
    process.exit(1);
  }

  console.log(API_KEY
    ? 'Using the Drive API (GOOGLE_API_KEY found).'
    : 'No GOOGLE_API_KEY set — using the public endpoint. Set one in .env.local for checksums and robustness.');

  const targets = EXPLICIT_URLS
    ? EXPLICIT_URLS.map((url) => ({ submissionId: '(cli)', title: '(cli)', url, id: driveFileId(url) }))
    : pendingSubmissions();

  if (!targets.length) {
    console.log('No Google Drive links found in non-rejected submissions.');
    return;
  }

  console.log(`\n${targets.length} Drive link(s) across the queue:\n`);
  const results = [];

  for (const target of targets) {
    if (!target.id) {
      console.log(`  UNPARSEABLE  ${target.url}`);
      results.push({ ...target, ok: false, error: 'could not extract a file id' });
      continue;
    }
    let meta;
    try {
      meta = await getMetadata(target.id);
    } catch (error) {
      meta = { ok: false, error: error.message };
    }

    if (!meta.ok) {
      console.log(`  UNREACHABLE  ${target.title}\n               ${target.id}  ${meta.error}`);
      results.push({ ...target, ok: false, error: meta.error });
      continue;
    }
    if (meta.mimeType && GOOGLE_NATIVE.test(meta.mimeType)) {
      console.log(`  REFUSED      ${target.title}\n               Google-native document (${meta.mimeType}), not a data file`);
      results.push({ ...target, ok: false, error: `google-native: ${meta.mimeType}` });
      continue;
    }

    const size = meta.bytes ? `${(meta.bytes / 1048576).toFixed(1)} MB` : 'size unknown';
    const note = meta.needsConfirm ? ' (large: needs the confirm step on download)' : '';
    console.log(`  OK           ${target.title}`);
    console.log(`               ${meta.name || '(filename not disclosed until download)'}  ${size}${note}`);
    console.log(`               id=${target.id}  via=${meta.source}${meta.md5 ? `  md5=${meta.md5}` : ''}`);
    results.push({ ...target, ok: true, meta });
  }

  if (PROBE) {
    const good = results.filter((r) => r.ok).length;
    console.log(`\nProbe only — nothing downloaded. ${good}/${results.length} reachable.`);
    return;
  }

  mkdirSync(QUARANTINE, { recursive: true });
  console.log('');
  for (const result of results.filter((r) => r.ok)) {
    process.stdout.write(`  fetching ${result.id} ... `);
    try {
      const { buffer, type } = await download(result.id);
      const verdict = inspectPayload(buffer, type);
      if (!verdict.ok) { console.log(`REFUSED: ${verdict.reason}`); continue; }

      const safeName = (result.meta.name || `${result.id}.bin`).replace(/[^A-Za-z0-9._-]+/g, '-');
      const sha256 = createHash('sha256').update(buffer).digest('hex');
      const target = path.join(QUARANTINE, `${result.id}-${safeName}`);
      writeFileSync(target, buffer);
      writeFileSync(`${target}.provenance.json`, `${JSON.stringify({
        submissionId: result.submissionId,
        sourceUrl: result.url,
        driveFileId: result.id,
        filename: result.meta.name || null,
        bytes: buffer.length,
        detectedKind: verdict.kind,
        sha256,
        googleMd5: result.meta.md5 || null,
        fetchedVia: API_KEY ? 'drive-api' : 'public-endpoint',
        fetchedAt: new Date().toISOString(),
      }, null, 2)}\n`);
      console.log(`${(buffer.length / 1048576).toFixed(1)} MB ${verdict.kind}, sha256 ${sha256.slice(0, 12)}`);
    } catch (error) {
      console.log(`FAILED: ${error.message}`);
    }
  }
  console.log(`\nWritten to ${QUARANTINE}/ — quarantine only, gitignored, not served anywhere.`);
}

// Only run when executed directly. Without this, importing the module to test
// driveFileId executes the whole script -- which is how the first test run
// printed a usage message instead of testing anything.
const invokedDirectly = process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]));
if (invokedDirectly) main();
