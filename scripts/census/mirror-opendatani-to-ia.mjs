#!/usr/bin/env node
/**
 * Mirror the planned Open Data NI resource files to the Internet Archive, one
 * item at a time. Streams download -> `ia upload --no-derive` -> delete
 * (disk-safe), and is resumable: per item it skips files already present in the
 * live item metadata, so re-running (here or on a droplet) continues where it
 * stopped. Writes a per-item mirrored manifest consumed by
 * reenrich-opendatani-with-ia.mjs.
 *
 * Usage:
 *   node scripts/census/mirror-opendatani-to-ia.mjs [planPath] [--start N] [--items K]
 *
 * Requires the `ia` client authenticated (ia configure / ia.ini).
 */
import { readFileSync, writeFileSync, existsSync, unlinkSync, mkdtempSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';

function arg(name, def) { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : def; }
const PLAN = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'data/census/candidates/opendatani-ia-mirror-plan.json';
const START = Number(arg('--start', '0'));
const NITEMS = Number(arg('--items', '999'));
const OUTDIR = 'data/census/candidates/opendatani-ia';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';
// ArcGIS-hosted resources are dynamically-generated async exports (need per-file
// polling) and already sit on Esri/ArcGIS durable infrastructure — out of scope
// for this static-file durability mirror; logged as skipped so a droplet pass
// could poll them later if desired.
const isDynamic = (url) => /arcgis\.com|tiles-eu1|utility\.arcgis/i.test(url);

const META = [
  'title:Open Data NI data files (mirror)',
  'mediatype:data',
  'licenseurl:https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/',
  'description:Durability mirror of Open Data NI (opendatani.gov.uk) public-sector data files, released under the Open Government Licence v3.0. Source: https://www.opendatani.gov.uk',
  'subject:Open Data NI', 'subject:Northern Ireland', 'subject:open data',
];

const plan = JSON.parse(readFileSync(PLAN, 'utf8'));
const items = plan.items.slice(START, START + NITEMS);
mkdirSync(OUTDIR, { recursive: true });
const tmp = mkdtempSync(path.join(tmpdir(), 'odni-ia-'));

function existingNames(item) {
  try {
    const m = JSON.parse(execFileSync('curl', ['-s', '--max-time', '60', `https://archive.org/metadata/${item}`]).toString());
    return new Set((m.files || []).map((f) => f.name));
  } catch { return new Set(); }
}

let gUp = 0, gSkip = 0, gFail = 0;
for (const it of items) {
  const already = existingNames(it.itemId);
  let firstUpload = already.size === 0;
  const mirrored = [];
  let up = 0, skip = 0, fail = 0;
  for (const f of it.files) {
    const remote = f.remoteName;
    const iaUrl = `https://archive.org/download/${it.itemId}/${remote.split('/').map(encodeURIComponent).join('/')}`;
    if (already.has(remote)) { skip += 1; mirrored.push({ sourceUrl: f.url, item: it.itemId, remoteName: remote, iaUrl, status: 'already' }); continue; }
    if (isDynamic(f.url)) { skip += 1; mirrored.push({ sourceUrl: f.url, item: it.itemId, remoteName: remote, iaUrl, status: 'skipped-dynamic' }); continue; }
    const local = path.join(tmp, 'f.bin');
    try {
      execFileSync('curl', ['-sL', '--fail', '-A', UA, '--max-time', '240', f.url, '-o', local], { stdio: 'ignore' });
      const a = ['upload', it.itemId, local, `--remote-name=${remote}`, '--no-derive', '--retries', '4'];
      if (firstUpload) { for (const m of META) a.push(`--metadata=${m}`); firstUpload = false; }
      execFileSync('ia', a, { stdio: 'ignore' });
      mirrored.push({ sourceUrl: f.url, item: it.itemId, remoteName: remote, iaUrl, status: 'uploaded' });
      up += 1;
    } catch (e) {
      fail += 1;
      mirrored.push({ sourceUrl: f.url, item: it.itemId, remoteName: remote, iaUrl, status: 'failed', error: String(e.message || e).slice(0, 100) });
    } finally { if (existsSync(local)) unlinkSync(local); }
    if ((up + skip + fail) % 25 === 0) process.stderr.write(`\r  ${it.itemId}: ${up} up, ${skip} skip, ${fail} fail`);
  }
  writeFileSync(path.join(OUTDIR, `${it.itemId}.json`), JSON.stringify({ item: it.itemId, itemUrl: it.itemUrl, counts: { uploaded: up, skipped: skip, failed: fail, total: it.files.length }, mirrored }, null, 0) + '\n');
  gUp += up; gSkip += skip; gFail += fail;
  console.log(`\n${it.itemId}: uploaded ${up}, skipped ${skip}, failed ${fail} (of ${it.files.length})`);
}
console.log(`\nTOTAL uploaded ${gUp}, skipped ${gSkip}, failed ${gFail} across ${items.length} items.`);
