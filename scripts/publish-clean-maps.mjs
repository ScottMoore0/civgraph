#!/usr/bin/env node
/**
 * Convert the 20 "clean" (ready-for-approval, 0 residual blockers) staged
 * boundary datasets to EPSG:4326 FlatGeobuf, upload to R2 (fgb + .br + .gz),
 * and emit maps.json entries with OGL / CC-BY-4.0 attribution.
 *
 * Sources live on D: (Open Data NI / data.gov.ie mirrors), organised as
 *   /d/<tree>/<organisation>/<slug>/...  (org resolved by glob).
 * Local FGBs are written to a scratch dir and deleted after upload.
 *
 * Usage: node scripts/publish-clean-maps.mjs [--rows 1,2,3] [--dry-run] [--no-upload]
 */
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, readdirSync, statSync } from 'fs';
import { brotliCompressSync, gzipSync, constants } from 'zlib';
import { execFileSync } from 'child_process';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
// Inline .env.local parse (avoid a dotenv dependency)
try {
  for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch {}

const TMP = (process.env.CLAUDE_JOB_DIR || '.') + '/tmp/clean-maps-fgb';
const DRY = process.argv.includes('--dry-run');
const NO_UPLOAD = process.argv.includes('--no-upload') || DRY;
const rowsArg = (process.argv.find(a => a.startsWith('--rows=')) || '').split('=')[1]
  || (process.argv.includes('--rows') ? process.argv[process.argv.indexOf('--rows') + 1] : '');
const wantRows = rowsArg ? new Set(rowsArg.split(',').map(s => s.trim())) : null;

const OGL = 'OGL v3.0';
const CCBY = 'CC BY 4.0';
const COLORS = { deas:'#8E44AD', wards:'#2E86C1', townlands:'#16A085', 'local-government':'#C0392B',
  parliamentary:'#D35400', 'electoral-divisions':'#27AE60', transport:'#34495E' };

// row, slug, tree, category, name, provider[], licence
const MANIFEST = [
  [1,'bcni2018','opendatani','parliamentary','Parliamentary Constituencies — Provisional Proposals (BCNI 2018)',['Boundary Commission for Northern Ireland'],OGL],
  [2,'mid-ulster-council-district-electoral-areas2','opendatani','deas','Mid Ulster District Electoral Areas',['Mid Ulster District Council'],OGL],
  [3,'osni-open-data-50k-boundaries-district-electoral-areas-1993','opendatani','deas','District Electoral Areas (1993) — OSNI 50k',['OSNI'],OGL],
  [4,'osni-open-data-50k-boundaries-local-government-districts-1993','opendatani','local-government','Local Government Districts (1993) — OSNI 50k',['OSNI'],OGL],
  [5,'osni-open-data-50k-boundaries-parliamentary-constituencies','opendatani','parliamentary','Parliamentary Constituencies — OSNI 50k',['OSNI'],OGL],
  [6,'osni-open-data-50k-boundaries-townlands','opendatani','townlands','Townlands — OSNI 50k',['OSNI'],OGL],
  [7,'osni-open-data-50k-boundaries-wards-1993','opendatani','wards','Wards (1993) — OSNI 50k',['OSNI'],OGL],
  [8,'osni-open-data-largescale-boundaries-local-government-districts-1993','opendatani','local-government','Local Government Districts (1993) — OSNI Largescale',['OSNI'],OGL],
  [9,'district-electoral-divisions-boundaries','datagovie','electoral-divisions','Electoral Divisions — Monaghan',['Monaghan County Council'],CCBY],
  [10,'ed-boundaries-dlr','datagovie','electoral-divisions','Electoral Divisions — Dún Laoghaire-Rathdown',['Dún Laoghaire-Rathdown County Council'],CCBY],
  [11,'townland-boundaries','datagovie','townlands','Townlands — Monaghan',['Monaghan County Council'],CCBY],
  [12,'townlands-2015-sdcc1','datagovie','townlands','Townlands (2015) — South Dublin',['South Dublin County Council'],CCBY],
  [13,'townlands-in-fcc3','datagovie','townlands','Townlands — Fingal',['Fingal County Council'],CCBY],
  [14,'townlandsfcc2','datagovie','townlands','Townlands — Fingal (set 2)',['Fingal County Council'],CCBY],
  [15,'electoral-divisions-fcc2','datagovie','electoral-divisions','Electoral Divisions — Fingal',['Fingal County Council'],CCBY],
  [16,'electoral-divisionsfcc2','datagovie','electoral-divisions','Electoral Divisions — Fingal (set 2)',['Fingal County Council'],CCBY],
  [17,'mid-ulster-council-townlands2','opendatani','townlands','Townlands — Mid Ulster',['Mid Ulster District Council'],OGL],
  [18,'mid-ulster-council-wards2','opendatani','wards','Wards — Mid Ulster',['Mid Ulster District Council'],OGL],
  [19,'osni-open-data-50k-transport-text-labelling','opendatani','transport','Transport Text Labelling — OSNI 50k',['OSNI'],OGL],
  [20,'osni-open-data-50k-transport-transport-points','opendatani','transport','Transport Points — OSNI 50k',['OSNI'],OGL],
];

const LABEL_CANDIDATES = ['Name','NAME','name','WARD','Ward','TOWNLAND','Townland','TOWNLAND_','ED_ENGLISH','ED_NAME',
  'FinalR_NAM','PC_NAME','LGDNAME','LGD_NAME','DEA_NAME','DEA','CountyName','ENGLISH','LABEL','Descriptor','SETTLEMENT'];

function sh(cmd, args) { return execFileSync(cmd, args, { encoding: 'utf8', maxBuffer: 1 << 28 }); }
function glob1(pattern) { // resolve /d/<tree>/*/<slug> via readdir (no recursive find)
  const [root, , slug] = pattern; // [ '/d/datagovie', '*', slug ]
  for (const org of readdirSync(root)) {
    const p = `${root}/${org}/${slug}`;
    if (existsSync(p)) return p;
  }
  return null;
}
function isFile(p) { try { return statSync(p).isFile(); } catch { return false; } }
function isDir(p) { try { return statSync(p).isDirectory(); } catch { return false; } }
function asGeojson(p) { // copy an extensionless geojson file to tmp with .geojson so ogr2ogr detects it
  const dest = `${TMP}/src-${Buffer.from(p).toString('hex').slice(0,10)}.geojson`;
  writeFileSync(dest, readFileSync(p)); return dest;
}
function findGeometry(folder) {
  const direct = readdirSync(folder).filter(f => /\.geojson$/i.test(f));
  if (direct.length) return `${folder}/${direct[0]}`;
  for (const sub of ['geojson','GeoJSON']) {
    const p = `${folder}/${sub}`;
    if (isDir(p)) { const g = readdirSync(p).filter(f => /\.geojson$|\.json$/i.test(f)); if (g.length) return `${p}/${g[0]}`; }
    else if (isFile(p)) return asGeojson(p); // extensionless 'geojson' file (Open Data NI council layout)
  }
  if (isDir(`${folder}/shapefile`)) {
    const s = readdirSync(`${folder}/shapefile`).filter(f => /\.shp$/i.test(f));
    if (s.length) return `${folder}/shapefile/${s[0]}`;
  }
  const shp = readdirSync(folder).filter(f => /\.shp$/i.test(f));
  if (shp.length) return `${folder}/${shp[0]}`;
  const json = readdirSync(folder).filter(f => /\.json$/i.test(f) && !/meta|schema/i.test(f));
  if (json.length) return `${folder}/${json[0]}`;
  // zip: extract ALL zips in the folder to tmp and search across them (the
  // shapefile isn't always in the "geospatial"-named archive).
  const zips = readdirSync(folder).filter(f => /\.zip$/i.test(f));
  if (zips.length) {
    const dest = `${TMP}/unzip-${Buffer.from(folder).toString('hex').slice(0,8)}`;
    mkdirSync(dest, { recursive: true });
    for (const zip of zips) {
      // Windows bsdtar (System32) reads zip; git-bash GNU tar does not.
      try { sh('C:/Windows/System32/tar.exe', ['-xf', `${folder}/${zip}`, '-C', dest]); }
      catch (e) { try { sh('powershell', ['-NoProfile','-Command', `Expand-Archive -LiteralPath '${folder}/${zip}' -DestinationPath '${dest}' -Force`]); } catch {} }
    }
    const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap(e =>
      e.isDirectory() ? walk(`${d}/${e.name}`) : [`${d}/${e.name}`]);
    const files = existsSync(dest) ? walk(dest) : [];
    return files.find(f => /\.shp$/i.test(f)) || files.find(f => /\.geojson$|\.json$/i.test(f))
        || files.find(f => /\.tab$|\.gml$/i.test(f)) || null;
  }
  return null;
}
function pickLabel(fgb) {
  try {
    const info = sh('ogrinfo', ['-al','-so', fgb]);
    const fields = [...info.matchAll(/^(\w[\w-]*):\s/gm)].map(m => m[1]);
    for (const c of LABEL_CANDIDATES) if (fields.includes(c)) return c;
    // fallback: any field whose name contains "nam" (NAME/WARDNAME/TOWNLAND_NAME/…)
    const nameish = fields.find(f => /nam/i.test(f)) || fields.find(f => /(ward|townland|ed|dea|county|desc|label)/i.test(f));
    if (nameish) return nameish;
  } catch {}
  return null;
}

const s3 = (!NO_UPLOAD) ? new S3Client({ region:'auto', endpoint:process.env.R2_S3_ENDPOINT,
  credentials:{ accessKeyId:process.env.R2_ACCESS_KEY_ID, secretAccessKey:process.env.R2_SECRET_ACCESS_KEY },
  maxAttempts:5 }) : null;
const BUCKET = process.env.R2_BUCKET || 'boundaries-data';
async function put(key, body, ct) { await s3.send(new PutObjectCommand({ Bucket:BUCKET, Key:key, Body:body, ContentType:ct })); }

mkdirSync(TMP, { recursive: true });
const entries = [], report = [];
for (const [row, slug, tree, category, name, provider, licence] of MANIFEST) {
  if (wantRows && !wantRows.has(String(row))) continue;
  const R = { row, slug, category };
  try {
    const folder = glob1([`D:/${tree}`, '*', slug]);
    if (!folder) throw new Error('source folder not found');
    const src = findGeometry(folder);
    if (!src) throw new Error('no geometry (geojson/shp/zip) in folder');
    const fgb = `${TMP}/${slug}.fgb`;
    if (existsSync(fgb)) rmSync(fgb);
    sh('ogr2ogr', ['-f','FlatGeobuf','-t_srs','EPSG:4326','-nlt','PROMOTE_TO_MULTI','-skipfailures', fgb, src]);
    const info = sh('ogrinfo', ['-al','-so', fgb]);
    const fc = (info.match(/Feature Count:\s*(\d+)/) || [])[1] || '?';
    const ext = info.match(/Extent:\s*\(([-\d.]+),\s*([-\d.]+)\)\s*-\s*\(([-\d.]+),\s*([-\d.]+)\)/);
    const bounds = ext ? [ +ext[1], +ext[2], +ext[3], +ext[4] ] : null;
    const isPoint = /Point/.test((info.match(/Geometry:\s*(.+)/) || [])[1] || '');
    const label = pickLabel(fgb);
    const bytes = readFileSync(fgb).length;
    const key = `data/maps/${category}/${slug}.fgb`;
    if (!NO_UPLOAD) {
      const body = readFileSync(fgb);
      await put(key, body, 'application/octet-stream');
      await put(key + '.br', brotliCompressSync(body, { params:{ [constants.BROTLI_PARAM_QUALITY]:5 } }), 'application/octet-stream');
      await put(key + '.gz', gzipSync(body, { level:6 }), 'application/octet-stream');
    }
    const refUrl = tree === 'opendatani'
      ? `https://admin.opendatani.gov.uk/dataset/${slug}`
      : `https://data.gov.ie/dataset/${slug}`;
    const attribution = licence === OGL
      ? 'Contains public sector information licensed under the Open Government Licence v3.0.'
      : 'Contains Irish Public Sector Data licensed under a Creative Commons Attribution 4.0 International (CC BY 4.0) licence.';
    const entry = {
      id: slug, name, slug, category, provider,
      files: { fgb: `https://data.civgraph.net/${key}` },
      style: isPoint ? { color: COLORS[category] || '#3388ff', weight:2, radius:4 } : { color: COLORS[category] || '#3388ff', weight:2 },
      keywords: [category, ...name.toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 3)].slice(0, 8),
      licence, attribution,
      ...(label ? { labelProperty: label } : {}),
      ...(bounds ? { bounds } : {}),
      references: [{ label: `${name} — ${tree === 'opendatani' ? 'Open Data NI' : 'data.gov.ie'}`, url: refUrl, note: licence }],
      useLOD: false,
    };
    entries.push(entry);
    if (!DRY && existsSync(fgb)) rmSync(fgb); // temp cleanup
    Object.assign(R, { ok:true, features:fc, mb:+(bytes/1e6).toFixed(2), label: label||'(none)', geom: isPoint?'point':'poly' });
  } catch (e) {
    Object.assign(R, { ok:false, error: String(e.message || e) });
  }
  report.push(R);
  console.log(`[${row}] ${R.ok?'OK ':'FAIL'} ${slug} ${R.ok?`(${R.features} feat, ${R.mb}MB, label=${R.label})`:`- ${R.error}`}`);
}

const outDir = 'data/review-inputs/clean-maps-publish';
mkdirSync(outDir, { recursive: true });
writeFileSync(`${outDir}/entries.json`, JSON.stringify(entries, null, 2));
writeFileSync(`${outDir}/report.json`, JSON.stringify(report, null, 2));
const ok = report.filter(r => r.ok).length;
console.log(`\n${ok}/${report.length} converted${NO_UPLOAD?' (no upload)':' + uploaded to R2'}. Entries -> ${outDir}/entries.json`);
try { rmSync(TMP, { recursive:true, force:true }); } catch {}
