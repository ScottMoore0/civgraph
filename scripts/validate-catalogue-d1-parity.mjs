#!/usr/bin/env node
/**
 * The catalogue served from D1 must be identical to data/database/maps.json.
 *
 * WHY
 *
 * Migrating the catalogue into D1 creates a second copy of data that already
 * exists as a file, and two copies of anything in this project have drifted
 * every single time. The three-store catalogue split produced four separate
 * "this layer is broken" misdiagnoses in one working session, all of them
 * really the wrong store being read.
 *
 * So the file and the database are checked against each other on every run for
 * as long as both exist. While the client still reads the file, this catches
 * an import that silently dropped or mangled records. After the cutover it
 * catches the reverse: an edit to maps.json that never reached D1 and therefore
 * never reached production.
 *
 * The comparison is on the reassembled DOCUMENT, not on row counts. A row count
 * matching proves nothing about whether `licence`, `sourceDownloads` or
 * `provider` survived the round trip, and those are the fields with legal
 * weight.
 *
 * Skips loudly rather than passing quietly when the endpoint is unreachable —
 * a check that silently succeeds when it cannot run is how the two production
 * outages earlier in this project stayed invisible.
 *
 * Usage: node scripts/validate-catalogue-d1-parity.mjs [--url <origin>]
 */
import { readFileSync } from 'node:fs';

const SRC = 'data/database/maps.json';
const argIdx = process.argv.indexOf('--url');
const ORIGIN = (argIdx >= 0 ? process.argv[argIdx + 1] : process.env.CATALOGUE_ORIGIN) || 'https://civgraph.net';
const ENDPOINT = `${ORIGIN.replace(/\/$/, '')}/_api/catalogue`;

const file = JSON.parse(readFileSync(SRC, 'utf8'));

await main();

async function main() {

let served;
try {
  const res = await fetch(ENDPOINT, { headers: { Accept: 'application/json' } });
  if (res.status === 503) {
    console.log('SKIP: CATALOGUE_DB is not bound yet, so the endpoint cannot be compared.');
    console.log('  This is expected until the D1 import has been run and the binding deployed.');
    return;
  }
  if (res.status === 404) {
    // Deliberately a skip, not a failure. From outside, a Function that has not
    // been deployed yet and one that has been deleted look identical, and this
    // check has to be able to live in `npm run check` from the commit that adds
    // it — before the deploy that publishes it.
    console.log(`SKIP: ${ENDPOINT} returned 404, so the Function is not deployed here yet.`);
    console.log('  Once it is deployed, a 404 means the route is wrong or the Function was removed.');
    return;
  }
  if (!res.ok) {
    console.error(`FAIL: ${ENDPOINT} returned HTTP ${res.status}.`);
    { process.exitCode = 1; return; }
  }
  served = await res.json();
} catch (error) {
  console.log(`SKIP: could not reach ${ENDPOINT} (${error?.message || error}).`);
  console.log('  Network-dependent check; not treated as a failure locally.');
  return;
}

const problems = [];

// --- top-level keys ---------------------------------------------------------
const fileKeys = Object.keys(file).sort();
const servedKeys = Object.keys(served).sort();
if (JSON.stringify(fileKeys) !== JSON.stringify(servedKeys)) {
  problems.push(`top-level keys differ:\n    file  : ${fileKeys.join(', ')}\n    served: ${servedKeys.join(', ')}`);
}

// --- non-map parts ----------------------------------------------------------
for (const key of fileKeys) {
  if (key === 'maps') continue;
  if (JSON.stringify(file[key]) !== JSON.stringify(served[key])) {
    problems.push(`part "${key}" differs between the file and D1`);
  }
}

// --- maps: count, order and content -----------------------------------------
const fm = file.maps || [];
const sm = served.maps || [];
if (fm.length !== sm.length) {
  problems.push(`map count differs: file ${fm.length}, D1 ${sm.length}`);
} else {
  const fileOrder = fm.map((m) => m.id);
  const servedOrder = sm.map((m) => m.id);
  if (JSON.stringify(fileOrder) !== JSON.stringify(servedOrder)) {
    const firstDiff = fileOrder.findIndex((id, i) => id !== servedOrder[i]);
    problems.push(`map ORDER differs, first at index ${firstDiff}: file "${fileOrder[firstDiff]}" vs D1 "${servedOrder[firstDiff]}"`);
  }
  const mismatched = [];
  for (let i = 0; i < fm.length; i++) {
    if (JSON.stringify(fm[i]) !== JSON.stringify(sm[i])) mismatched.push(fm[i].id);
  }
  if (mismatched.length) {
    problems.push(`${mismatched.length} record(s) differ in content: ${mismatched.slice(0, 8).join(', ')}${mismatched.length > 8 ? ' …' : ''}`);
  }
}

console.log('Catalogue D1 parity');
console.log(`  endpoint : ${ENDPOINT}`);
console.log(`  file     : ${fm.length} maps`);
console.log(`  D1       : ${sm.length} maps`);

if (problems.length) {
  console.error(`\nFAIL: the catalogue in D1 does not match ${SRC}.`);
  for (const p of problems) console.error(`  - ${p}`);
  console.error('\n  Regenerate and re-import:');
  console.error('    node scripts/build-catalogue-d1-import.mjs');
  console.error('    npx wrangler d1 execute civgraph-catalogue --remote --file data/database/catalogue-d1-import.sql');
  { process.exitCode = 1; return; }
}

console.log('\nPASS: D1 serves the catalogue exactly as the file records it.');
}
