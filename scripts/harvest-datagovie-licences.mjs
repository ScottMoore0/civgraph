#!/usr/bin/env node
/**
 * Establish the licence of every data.gov.ie package Civgraph has mirrored.
 *
 * WHY THIS IS THE GATE ON PUBLISHING THAT MIRROR
 *
 * scripts/mirror_datagovie.py and a later reconcile pass pulled 30,252 files (144.5 GB) across
 * 20,700 packages to a local mirror. Nothing in it records a licence, so the mirror has no
 * publication basis of its own.
 *
 * READ THE PACKAGE SET FROM THE TREE, NOT _manifest.csv. The manifest is from the first run
 * and covers 4,947 resources across 3,050 packages -- about a sixth of what is on disk. A
 * harvest driven from it produced a licence split that read as if it covered the corpus and
 * covered a fraction, while the rest was already public on R2. Pass --root.
 *
 * data.gov.ie is a CKAN catalogue that FEDERATES other bodies' data: the licence belongs to
 * each publishing organisation and varies per package, and the files themselves were fetched
 * from publisher hosts rather than from the portal, so the portal's own terms do not govern
 * them. That is the difference from the CSO PxStat corpus, where one collection licence
 * covers all 12,528 cubes and a single determination was enough.
 *
 * CKAN answers this per package via package_show, so the determination is mostly mechanical.
 * What it cannot do is decide the residue: packages with a missing, custom or non-open
 * licence are reported for a human to rule on, never guessed.
 *
 * ONLY packages actually mirrored are looked up, not the portal's full 22,013 -- a licence for
 * something we hold no copy of decides nothing.
 *
 * RESUMABLE by re-reading its own output; re-running costs only the packages still missing.
 * Read-only against a public API, 6 concurrent, with a retry on transient failure.
 *
 *   node scripts/harvest-datagovie-licences.mjs --root <mirror>
 *   node scripts/harvest-datagovie-licences.mjs --root <mirror> --summary-only
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';

const args = process.argv.slice(2);
const argOf = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};

const MANIFEST = argOf('--manifest');
const ROOT = argOf('--root');
const OUT = argOf('--out', 'data/external/datagovie-licences.json');
const SUMMARY = argOf('--summary', 'data/database/datagovie-licence-summary.json');
const CONCURRENCY = Number(argOf('--concurrency', '6'));
const SUMMARY_ONLY = args.includes('--summary-only');
const API = 'https://data.gov.ie/api/3/action/package_show?id=';

if (!MANIFEST && !ROOT) {
  console.error('FAIL: pass --root <mirror dir> (preferred) or --manifest <_manifest.csv>.');
  console.error('  --root derives the package set from the tree, which cannot go stale the way');
  console.error('  the manifest did. The mirror lives outside the repo, so the path is passed in.');
  process.exit(1);
}

// CKAN license_id values that are unambiguously open. Anything not listed is reported for a
// human decision rather than assumed -- an unrecognised licence is the whole point of this.
const OPEN = new Map([
  ['cc-by', 'CC BY 4.0'],
  ['cc-by-4.0', 'CC BY 4.0'],
  ['cc-by-sa', 'CC BY-SA 4.0'],
  ['cc-by-sa-4.0', 'CC BY-SA 4.0'],
  ['cc-zero', 'CC0 1.0'],
  ['cc0-1.0', 'CC0 1.0'],
  ['odc-by', 'ODC-By 1.0'],
  ['odc-pddl', 'ODC-PDDL 1.0'],
  ['odc-odbl', 'ODbL 1.0'],
  ['uk-ogl', 'OGL v3.0'],
  ['ogl', 'OGL v3.0'],
  ['other-open', 'other-open (needs naming)'],
  ['notspecified', null],
  ['', null],
]);

function parseCsv(text) {
  // Minimal RFC4180 reader: the manifest has quoted fields containing commas (titles, errors).
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 1; } else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (ch !== '\r') field += ch;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const header = rows.shift() || [];
  return rows.filter((r) => r.length > 1).map((r) => Object.fromEntries(header.map((h, i) => [h, r[i]])));
}

const packages = new Map();

if (ROOT) {
  // Derive the package set from the MIRROR ITSELF, layout <organisation>/<package>/<file>.
  //
  // WHY NOT THE MANIFEST. _manifest.csv is from an early run and lists 4,947 completed
  // resources across 3,050 packages. A later reconcile pass grew the mirror to 30,436
  // expected resources -- see _reconcile_summary.txt -- so the manifest describes about a
  // sixth of what is on disk. Harvesting from it produced a licence split that looked like
  // it covered the corpus and covered a fraction, while the rest was already published.
  // The directory cannot go stale in that way: it is what will actually be uploaded.
  for (const org of readdirSync(ROOT, { withFileTypes: true })) {
    if (!org.isDirectory()) continue;
    for (const pkg of readdirSync(`${ROOT}/${org.name}`, { withFileTypes: true })) {
      if (!pkg.isDirectory()) continue;
      const entry = packages.get(pkg.name) || { organisation: org.name, resources: 0, bytes: 0 };
      const walk = (dir) => {
        for (const item of readdirSync(dir, { withFileTypes: true })) {
          if (item.isDirectory()) walk(`${dir}/${item.name}`);
          else { entry.resources += 1; entry.bytes += statSync(`${dir}/${item.name}`).size; }
        }
      };
      walk(`${ROOT}/${org.name}/${pkg.name}`);
      packages.set(pkg.name, entry);
    }
  }
} else {
  const DONE = new Set(['ok', 'done', 'complete', 'completed', 'success']);
  const manifest = parseCsv(readFileSync(MANIFEST, 'utf8')).filter((r) => DONE.has((r.status || '').toLowerCase()));
  for (const row of manifest) {
    if (!row.package_name) continue;
    if (!packages.has(row.package_name)) packages.set(row.package_name, { organisation: row.organization, resources: 0, bytes: 0 });
    const entry = packages.get(row.package_name);
    entry.resources += 1;
    entry.bytes += Number(row.downloaded_size || 0);
  }
}

const known = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : { packages: {} };
const todo = [...packages.keys()].filter((name) => !known.packages[name]);

console.log(`${packages.size} mirrored package(s); ${known.packages ? Object.keys(known.packages).length : 0} already looked up, ${todo.length} to fetch.`);

async function lookup(name) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(API + encodeURIComponent(name), { headers: { accept: 'application/json' } });
      if (response.status === 404) return { licenceId: null, licenceTitle: null, licenceUrl: null, missing: true };
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = await response.json();
      const result = body.result || {};
      return {
        licenceId: result.license_id || null,
        licenceTitle: result.license_title || null,
        licenceUrl: result.license_url || null,
        title: result.title || null,
      };
    } catch (error) {
      if (attempt === 2) return { error: error.message };
      await new Promise((resolve) => { setTimeout(resolve, 800 * (attempt + 1)); });
    }
  }
  return { error: 'unreachable' };
}

if (!SUMMARY_ONLY && todo.length) {
  let done = 0;
  const queue = [...todo];
  const workers = Array.from({ length: Math.max(1, CONCURRENCY) }, async () => {
    for (;;) {
      const name = queue.shift();
      if (!name) return;
      known.packages[name] = { ...packages.get(name), ...(await lookup(name)) };
      done += 1;
      if (done % 250 === 0) {
        console.log(`  ${done}/${todo.length}`);
        mkdirSync('data/external', { recursive: true });
        writeFileSync(OUT, JSON.stringify(known, null, 1));
      }
    }
  });
  await Promise.all(workers);
  mkdirSync('data/external', { recursive: true });
  writeFileSync(OUT, JSON.stringify(known, null, 1));
}

// ---- summary: the part that is committed, and the part a decision is made from ----
const byLicence = new Map();
let openResources = 0;
let openBytes = 0;
let undecidedResources = 0;
let undecidedBytes = 0;
const undecidedOrgs = new Map();

for (const [name, entry] of Object.entries(known.packages)) {
  const id = (entry.licenceId || '').toLowerCase();
  const mapped = OPEN.has(id) ? OPEN.get(id) : undefined;
  const bucket = mapped || (mapped === null ? '(none recorded)' : `UNRECOGNISED: ${entry.licenceId || entry.error || 'error'}`);
  if (!byLicence.has(bucket)) byLicence.set(bucket, { packages: 0, resources: 0, bytes: 0, licenceTitle: entry.licenceTitle || null });
  const row = byLicence.get(bucket);
  row.packages += 1;
  row.resources += entry.resources || 0;
  row.bytes += entry.bytes || 0;
  if (mapped) { openResources += entry.resources || 0; openBytes += entry.bytes || 0; } else {
    undecidedResources += entry.resources || 0;
    undecidedBytes += entry.bytes || 0;
    undecidedOrgs.set(entry.organisation, (undecidedOrgs.get(entry.organisation) || 0) + 1);
    if (!Array.isArray(row.examples)) row.examples = [];
    if (row.examples.length < 5) row.examples.push(name);
  }
}

const summary = {
  schemaVersion: 1,
  generatedFrom: 'data.gov.ie CKAN package_show, for packages present in the local mirror manifest',
  note: 'Licence per PACKAGE, from the publishing body via CKAN. Buckets marked UNRECOGNISED or '
    + '(none recorded) have NO publication basis and must not be uploaded until one is decided. '
    + 'Open buckets are a mechanical reading of license_id, not a rights review of the content.',
  packagesLookedUp: Object.keys(known.packages).length,
  clearlyOpen: { resources: openResources, gigabytes: Number((openBytes / 1e9).toFixed(2)) },
  undecided: { resources: undecidedResources, gigabytes: Number((undecidedBytes / 1e9).toFixed(2)) },
  byLicence: Object.fromEntries([...byLicence].sort((a, b) => b[1].resources - a[1].resources)
    .map(([k, v]) => [k, { ...v, gigabytes: Number((v.bytes / 1e9).toFixed(2)), bytes: undefined }])),
  undecidedTopOrganisations: Object.fromEntries([...undecidedOrgs].sort((a, b) => b[1] - a[1]).slice(0, 12)),
};

writeFileSync(SUMMARY, `${JSON.stringify(summary, null, 2)}\n`);
console.log(`\nWrote ${SUMMARY}`);
console.log(`  clearly open : ${openResources} resources, ${(openBytes / 1e9).toFixed(2)} GB`);
console.log(`  undecided    : ${undecidedResources} resources, ${(undecidedBytes / 1e9).toFixed(2)} GB`);
for (const [licence, row] of [...byLicence].sort((a, b) => b[1].resources - a[1].resources)) {
  console.log(`    ${String(row.resources).padStart(5)} res  ${(row.bytes / 1e9).toFixed(2).padStart(6)} GB  ${licence}`);
}
