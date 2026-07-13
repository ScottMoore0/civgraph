#!/usr/bin/env node
/**
 * Mirror NISRA data files to an Internet Archive item. Streams
 * download -> ia upload -> delete (one file at a time; disk-safe) and is
 * resumable: it skips files already present in the item (from live item
 * metadata). Uploads with --no-derive so IA does not queue per-file derive
 * tasks (the throttle that jams large items).
 *
 * Input file list: JSON { sources: [{ slug, url }, …] } (or a bare array).
 *
 * Usage:
 *   node scripts/census/mirror-nisra-files-to-ia.mjs \
 *     --files <list.json> --item <identifier> [--limit N] [--out <mirrored.json>]
 *
 * Requires the `ia` client to be authenticated (ia configure).
 */
import { readFileSync, writeFileSync, existsSync, unlinkSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';

function arg(name, def) { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : def; }
const FILES = arg('--files');
const ITEM = arg('--item');
const LIMIT = Number(arg('--limit', '0')) || Infinity;
const OUT = arg('--out', `data/census/candidates/nisra-ia-mirrored-${ITEM}.json`);
if (!FILES || !ITEM) { console.error('usage: --files <list.json> --item <id> [--limit N] [--out <path>]'); process.exit(1); }

const META = [
  'title:NISRA statistical data files (mirror)',
  'mediatype:data',
  'licenseurl:https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/',
  'description:Mirror of Northern Ireland Statistics and Research Agency (NISRA) statistical data files, released under the Open Government Licence v3.0. Source: https://www.nisra.gov.uk/publications',
  'subject:NISRA',
  'subject:Northern Ireland',
  'subject:statistics',
];

const raw = JSON.parse(readFileSync(FILES, 'utf8'));
const files = Array.isArray(raw) ? raw : (raw.sources || raw.files || []);

// existing files already in the item (resume)
function existingNames() {
  try {
    const meta = JSON.parse(execFileSync('curl', ['-s', '--max-time', '40', `https://archive.org/metadata/${ITEM}`]).toString());
    return new Set((meta.files || []).map((f) => f.name));
  } catch { return new Set(); }
}
const already = existingNames();
const itemExists = already.size > 0;

const remoteNameFor = (slug, url) => `${slug}/${decodeURIComponent(url.split('/').pop())}`;
const tmp = mkdtempSync(path.join(tmpdir(), 'nisra-ia-'));
const mirrored = [];
let done = 0, skipped = 0, failed = 0, firstUpload = !itemExists;

for (const f of files) {
  if (done >= LIMIT) break;
  const remote = remoteNameFor(f.slug, f.url);
  const iaUrl = `https://archive.org/download/${ITEM}/${remote.split('/').map(encodeURIComponent).join('/')}`;
  if (already.has(remote)) { skipped += 1; mirrored.push({ sourceUrl: f.url, item: ITEM, remoteName: remote, iaUrl, status: 'already' }); continue; }

  const local = path.join(tmp, 'f.bin');
  try {
    execFileSync('curl', ['-sL', '--fail', '--max-time', '180', f.url, '-o', local], { stdio: 'ignore' });
    const args = ['upload', ITEM, local, `--remote-name=${remote}`, '--no-derive', '--retries', '4'];
    if (firstUpload) { for (const m of META) args.push(`--metadata=${m}`); firstUpload = false; }
    execFileSync('ia', args, { stdio: 'ignore' });
    mirrored.push({ sourceUrl: f.url, item: ITEM, remoteName: remote, iaUrl, status: 'uploaded' });
    done += 1;
  } catch (e) {
    failed += 1;
    mirrored.push({ sourceUrl: f.url, item: ITEM, remoteName: remote, iaUrl, status: 'failed', error: String(e.message || e).slice(0, 120) });
  } finally { if (existsSync(local)) unlinkSync(local); }
  if ((done + skipped) % 20 === 0) process.stderr.write(`\r${done} uploaded, ${skipped} skipped, ${failed} failed`);
}
process.stderr.write('\n');

writeFileSync(OUT, JSON.stringify({ item: ITEM, itemUrl: `https://archive.org/details/${ITEM}`, counts: { uploaded: done, skipped, failed, total: files.length }, mirrored }, null, 2) + '\n');
console.log(`item ${ITEM}: uploaded ${done}, skipped(existing) ${skipped}, failed ${failed}. Manifest -> ${OUT}`);
