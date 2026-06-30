/**
 * Mirror agency map layers (the .fgb on R2 + any source originals) to a per-agency
 * Internet Archive item. Each file is downloaded to a temp dir on D:, uploaded to IA
 * (idempotent: files already on the item are skipped), recorded in
 * data/database/agency-ia-mirrors.json, then DELETED from the temp dir.
 *
 *   no-duplication: each map's files go to exactly ONE agency IA item; re-runs skip
 *   files already present (by remote path). Maps already on IA (archive.org ref) are skipped.
 *
 * Usage:
 *   node scripts/build-agency-ia-mirror.mjs [--limit N] [--agency osni] [--map <id>] [--dry-run]
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { join, basename } from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = process.cwd();
const MAPS_PATH = join(ROOT, 'data/database/maps.json');
const SIDECAR = join(ROOT, 'data/database/agency-ia-mirrors.json');
const TMP = process.env.IA_TMP || 'D:/civgraph-ia-temp';
const IA = process.env.IA_CLI || 'ia.exe';
const IA_DL = 'https://archive.org/download';

const args = process.argv.slice(2);
const opt = (k) => args.includes(k) ? args[args.indexOf(k) + 1] : null;
const LIMIT = opt('--limit') ? Number(opt('--limit')) : null;
const ONLY_AGENCY = opt('--agency');
const ONLY_MAP = opt('--map');
const DRY = args.includes('--dry-run');

// order = priority for maps attributed to multiple agencies (one IA item per map)
const AGENCIES = [
  ['osni',   /OSNI|Ordnance Survey of Northern/i,      'civgraph-osni-maps',           'OSNI map layers mirrored by Civgraph'],
  ['nisra',  /NISRA/i,                                  'civgraph-nisra-maps',          'NISRA map layers mirrored by Civgraph'],
  ['cso',    /\bCSO\b|Central Statistics/i,             'civgraph-cso-maps',            'CSO (Ireland) map layers mirrored by Civgraph'],
  ['tailte', /Tailte/i,                                 'civgraph-tailte-eireann-maps', 'Tailte Éireann map layers mirrored by Civgraph'],
  ['osi',    /\bOSI\b|Ordnance Survey Ireland/i,        'civgraph-osi-maps',            'OSI (Ireland) map layers mirrored by Civgraph'],
];

function agencyOf(provider) {
  const p = String(provider || '');
  for (const [key, pat, id, title] of AGENCIES) if (pat.test(p)) return { key, id, title };
  return null;
}
function run(cmd, a, o = {}) { return spawnSync(cmd, a, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...o }); }

function existingIaFiles(identifier) {
  const r = run(IA, ['list', identifier]);
  if (r.status !== 0) return new Set(); // item not created yet / transient; --checksum dedups IA-side
  return new Set(r.stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean));
}

function fileUrlsFor(map) {
  const out = [];
  const push = (url, kind) => { if (url && /^https?:\/\//i.test(url)) out.push({ url, kind }); };
  if (map.files?.fgb) push(map.files.fgb, 'fgb');
  if (map.files?.pmtiles) push(map.files.pmtiles, 'pmtiles');
  for (const sd of map.sourceDownloads || []) push(sd.file || sd.url, 'source');
  for (const r of map.references || []) {
    const u = r.url || '';
    if (/\.(zip|geojson|json|gpkg|gpkg\.zip|shp|shp\.zip|csv|xlsx|fgb)(\?|$)/i.test(u)) push(u, 'reference');
  }
  // drop ArcGIS service endpoints (not files) and dedupe by url
  const seen = new Set();
  return out.filter((x) => !/\/(MapServer|FeatureServer|rest\/services)\b/i.test(x.url) && !seen.has(x.url) && seen.add(x.url));
}

function download(url, dest) {
  const enc = encodeURI(url).replace(/%25/g, '%'); // encode spaces etc., don't double-encode
  const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';
  const r = run('curl', ['-sSL', '--fail', '-A', UA, '-o', dest, enc], { stdio: 'pipe' });
  return r.status === 0 && existsSync(dest) && statSync(dest).size > 0;
}

function main() {
  const db = JSON.parse(readFileSync(MAPS_PATH, 'utf8'));
  const sidecar = existsSync(SIDECAR) ? JSON.parse(readFileSync(SIDECAR, 'utf8')) : { schemaVersion: 1, items: {} };
  sidecar.items ||= {};
  mkdirSync(TMP, { recursive: true });

  let pool = db.maps.filter((m) => agencyOf(m.provider));
  if (ONLY_AGENCY) pool = pool.filter((m) => agencyOf(m.provider).key === ONLY_AGENCY);
  if (ONLY_MAP) pool = pool.filter((m) => m.id === ONLY_MAP);
  // skip maps already mirrored to IA (ad-hoc items) to avoid a map on IA twice
  pool = pool.filter((m) => !JSON.stringify(m).includes('archive.org'));
  if (LIMIT) pool = pool.slice(0, LIMIT);

  console.log(`Mirroring ${pool.length} agency map layer(s) to IA (tmp=${TMP}${DRY ? ', DRY' : ''})`);
  const iaFilesCache = {};
  let uploaded = 0, skipped = 0, mapsDone = 0;

  for (const map of pool) {
    const ag = agencyOf(map.provider);
    const urls = fileUrlsFor(map);
    if (!urls.length) { console.log(`  - ${map.id}: no file urls`); continue; }
    iaFilesCache[ag.id] ??= existingIaFiles(ag.id);
    const existing = iaFilesCache[ag.id] || new Set();
    const recorded = [];
    for (const { url, kind } of urls) {
      const fname = basename(url.split('?')[0]) || `${map.id}.bin`;
      const remote = `${map.id}/${fname}`;
      const iaUrl = `${IA_DL}/${ag.id}/${encodeURI(remote)}`;
      if (existing.has(remote)) { skipped++; recorded.push({ kind, name: fname, iaUrl, status: 'already-on-ia' }); continue; }
      if (DRY) { console.log(`    [dry] ${map.id} <- ${url} -> ia:${ag.id}/${remote}`); recorded.push({ kind, name: fname, iaUrl, status: 'dry' }); continue; }
      const tmp = join(TMP, `${map.id}__${fname}`);
      if (!download(url, tmp)) { console.warn(`    ! download failed: ${url}`); continue; }
      const up = run(IA, ['upload', ag.id, tmp, `--remote-name=${remote}`, '--checksum', '--no-derive', '--retries', '5',
        '--metadata=collection:opensource', `--metadata=title:${ag.title}`, '--metadata=mediatype:data',
        `--metadata=subject:${ag.key}`, '--metadata=subject:civgraph']);
      rmSync(tmp, { force: true });
      if (up.status !== 0) { console.warn(`    ! ia upload failed ${map.id}/${fname}: ${(up.stderr||'').slice(-200)}`); continue; }
      uploaded++; (iaFilesCache[ag.id] ||= new Set()).add(remote);
      recorded.push({ kind, name: fname, iaUrl, status: 'uploaded' });
      console.log(`    ✓ ${map.id}/${fname} -> ${ag.id}`);
    }
    if (recorded.length) {
      sidecar.items[map.id] = { agency: ag.key, iaItem: ag.id, files: recorded, mirroredAt: 'pending-stamp' };
      mapsDone++;
      if (!DRY) writeFileSync(SIDECAR, JSON.stringify(sidecar, null, 2) + '\n');
    }
  }
  console.log(`Done. maps=${mapsDone} uploaded=${uploaded} skipped=${skipped}`);
}
main();
