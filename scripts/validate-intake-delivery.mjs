#!/usr/bin/env node
/**
 * Every file in a recorded delivery must be ingested or explicitly deferred.
 *
 * WHY. On 2026-07-26 Phelim delivered 95 new .fgb files. Twenty were ingested on 31 July
 * and the remaining seventy-five were not. Nothing noticed for a month, because nothing
 * compared what arrived against what was taken in: the intake manifest lives under
 * render/source-cache/, which is gitignored, so there is no history of it and no review.
 * The gap surfaced only when the contributor reported that his maps had not changed.
 *
 * This reconciles data/intake/<delivery>.json -- the committed record of what arrived --
 * against the layer metadata. A delivered file counts as accounted for when some layer's
 * sourceFile names it, or when the delivery lists it under `deferred` with a reason.
 *
 * Deferring is a legitimate answer. Ingesting a file that has no catalogue record means
 * deciding where it belongs, and that can need the contributor. The point is that the
 * decision is recorded rather than implied by silence.
 *
 * Usage: node scripts/validate-intake-delivery.mjs [--intake-dir <path>] [--metadata <path>]...
 *
 * The path arguments exist so tests can point at copies under a temporary directory,
 * rather than mutating a tracked file and relying on a revert afterwards.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, join, basename } from 'node:path';

const ROOT = resolve(process.cwd());

function readPathArgs(flag) {
  const values = [];
  for (let i = 0; i < process.argv.length - 1; i += 1) {
    if (process.argv[i] === flag) values.push(process.argv[i + 1]);
  }
  return values;
}

const intakeArg = readPathArgs('--intake-dir');
const INTAKE_DIR = intakeArg.length ? resolve(intakeArg[0]) : resolve(ROOT, 'data/intake');
const metadataArgs = readPathArgs('--metadata');
const METADATA = metadataArgs.length ? metadataArgs : ['render/metadata/maps-test.json', 'render/metadata/maps-test-index.json'];

if (!existsSync(INTAKE_DIR)) {
  console.log('validate-intake-delivery: no data/intake directory; nothing to check.');
  process.exit(0);
}

const deliveries = readdirSync(INTAKE_DIR).filter((f) => f.endsWith('-delivery.json')).sort();
if (!deliveries.length) {
  console.log('validate-intake-delivery: no delivery records; nothing to check.');
  process.exit(0);
}

// Every source filename referenced by any layer, by basename -- the ingest renames files
// to canonical layer ids, so the delivered name and the cached name can differ.
const referenced = new Set();
for (const rel of METADATA) {
  const p = resolve(ROOT, rel);
  if (!existsSync(p)) continue;
  const doc = JSON.parse(readFileSync(p, 'utf8'));
  for (const layer of doc.layers || []) {
    if (typeof layer.sourceFile === 'string') referenced.add(basename(layer.sourceFile).toLowerCase());
    for (const d of layer.sourceDownloads || []) {
      if (typeof d?.file === 'string') referenced.add(basename(d.file).toLowerCase());
    }
  }
}

let problems = [];
let totalNew = 0;
let totalDeferred = 0;
for (const file of deliveries) {
  const doc = JSON.parse(readFileSync(join(INTAKE_DIR, file), 'utf8'));
  // Keyed by delivery path, not basename: the same filename appears in more than one
  // folder (1955.fgb is both a Local Authorities year and a Counties year).
  const deferred = new Map((doc.deferred || []).map((d) => [String(d.path || d.name).toLowerCase(), d.reason || '']));
  const renames = new Map((doc.renames || []).map((r) => [String(r.delivered).toLowerCase(), r.ingestAs]));
  for (const entry of doc.files || []) {
    if (entry.alreadyOnSite) continue;
    if (!/\.fgb$/i.test(entry.name)) continue;
    totalNew += 1;
    const path = String(entry.path).toLowerCase();
    if (deferred.has(path)) { totalDeferred += 1; continue; }
    if (referenced.has(entry.name.toLowerCase())) continue;
    const renamed = renames.get(path);
    if (renamed && referenced.has(`${renamed}.fgb`.toLowerCase())) continue;
    problems.push(`${file}: ${entry.path} delivered but not ingested and not deferred`);
  }
}

console.log(`Intake delivery: ${totalNew} new geometry file(s) across ${deliveries.length} delivery record(s); ${totalDeferred} deferred.`);
if (problems.length) {
  console.error(`\n${problems.length} unaccounted delivered file(s):`);
  for (const p of problems.slice(0, 40)) console.error(`- ${p}`);
  if (problems.length > 40) console.error(`  ... and ${problems.length - 40} more`);
  console.error('\nEither ingest them, or add them to "deferred" in the delivery record with a reason.');
  process.exit(1);
}
console.log('Every delivered geometry file is ingested or explicitly deferred.');
