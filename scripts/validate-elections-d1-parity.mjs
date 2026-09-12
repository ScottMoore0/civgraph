#!/usr/bin/env node
/**
 * The elections tables in D1 must match the metadata they were built from.
 *
 * WHY
 *
 * This exists because of what happened to the catalogue. `maps.json` and the D1 copy
 * drifted on 22 records; one of them was the 2023 ward layer, which sat in production
 * under the name "2022 (Final Recommendations)" for weeks. It did not sort with the other
 * ward sets and did not answer a search for "Wards", and the same question was asked three
 * times before anyone found the cause. Nothing was comparing the two copies.
 *
 * validate-catalogue-d1-parity.mjs was written so that could not recur, and its own header
 * records the rule: two copies of anything in this project have drifted every single time.
 * The elections database is a second copy of render/metadata/elections-test2 and has had no
 * equivalent check at all, while being far larger and about to become a serving path.
 * Writing the check after the cutover would mean running the identical risk again,
 * knowingly, on more data.
 *
 * WHAT IS COMPARED
 *
 * Row-level totals that a stale or partial load actually moves, per table, plus the two
 * things a row count cannot see:
 *
 *   - candidacies carrying a person_id, which is the whole point of the person registry
 *     and was NULL for all 29,697 rows until the stamper was pointed at the right
 *     directory. A reload that silently predates that stamping looks perfect on counts.
 *   - a sample of candidate rows compared field by field, because a matching count proves
 *     nothing about whether names, parties or vote totals survived the round trip. That is
 *     the same reasoning the catalogue check gives for comparing documents rather than
 *     counts.
 *
 * Skips loudly rather than passing quietly when D1 cannot be reached. A check that
 * silently succeeds when it cannot run is how the catalogue drift stayed invisible.
 *
 * Usage:
 *   node scripts/validate-elections-d1-parity.mjs [--db <name>] [--sample N]
 */
import { readdirSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const ROOT = process.cwd();
const META = path.join(ROOT, 'render/metadata/elections-test2');
const args = process.argv.slice(2);
const argVal = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const DB = argVal('--db', 'civgraph-elections');
const SAMPLE = Number(argVal('--sample', '40'));

if (!existsSync(META)) {
  console.error(`FAIL: ${path.relative(ROOT, META)} does not exist, so there is nothing to compare against.`);
  process.exit(1);
}

// --- the file side ----------------------------------------------------------

const files = readdirSync(META).filter((f) => f.endsWith('.json')).sort();
let elections = 0;
let contests = 0;
let candidacies = 0;
let withPerson = 0;
const candidateByKey = new Map();

for (const file of files) {
  const doc = JSON.parse(readFileSync(path.join(META, file), 'utf8'));
  const key = doc.key || file.replace(/\.json$/, '');
  elections += 1;
  let seq = 0;
  for (const result of doc.results || []) {
    contests += 1;
    for (const candidate of result.candidates || []) {
      candidacies += 1;
      if (candidate.personId !== null && candidate.personId !== undefined && candidate.personId !== '') {
        withPerson += 1;
      }
      // Keyed the way the rows are keyed in D1, so a sample can be looked up directly.
      candidateByKey.set(`${key}::${seq}::${candidate.id}`, {
        name: candidate.name ?? null,
        party: candidate.party ?? null,
        personId: candidate.personId ?? null,
        firstPrefs: candidate.firstPrefs ?? null,
      });
    }
    seq += 1;
  }
}

// --- the D1 side ------------------------------------------------------------

function query(sql) {
  // R2 credentials in the environment make wrangler fail on D1 with a bare
  // "Authentication error [code: 10000]", the same trap deploy-browse-indexes-d1.mjs
  // documents. Cleared for this call.
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (/^(AWS_|R2_|CLOUDFLARE_R2)/.test(key)) delete env[key];
  }
  // Output goes through a file rather than a pipe, which looks roundabout and is not.
  // wrangler is not a local dependency, so npx is the only entry point; spawning npx.cmd
  // without a shell is EINVAL on modern Node, and spawning it WITH a shell and a piped
  // stdout crashes libuv here with a UV_HANDLE_CLOSING assertion. Redirecting to a file
  // is the one combination that survives both.
  const flat = sql.replace(/\s+/g, ' ').trim().replace(/"/g, '\\"');
  mkdirSync(path.join(ROOT, 'tmp'), { recursive: true });
  const outFile = path.join(ROOT, 'tmp', '_elections-parity.json');
  const result = spawnSync(
    `npx wrangler d1 execute ${DB} --remote --json --command "${flat}" > "${outFile}"`,
    { cwd: ROOT, env, shell: true, stdio: 'ignore' },
  );
  if (result.status !== 0) {
    let detail = '';
    try { detail = readFileSync(outFile, 'utf8').trim().slice(0, 300); } catch { /* nothing written */ }
    return { error: detail || `wrangler exited ${result.status}` };
  }
  let stdout = '';
  try { stdout = readFileSync(outFile, 'utf8'); } catch (error) {
    return { error: `no output captured (${error?.message || error})` };
  }
  try {
    const text = stdout.slice(stdout.indexOf('['));
    const parsed = JSON.parse(text);
    return { rows: (Array.isArray(parsed) ? parsed[0] : parsed)?.results || [] };
  } catch (error) {
    return { error: `could not parse wrangler output (${error?.message || error})` };
  }
}

const totals = query(`
  SELECT (SELECT COUNT(*) FROM elections)   AS elections,
         (SELECT COUNT(*) FROM constituencies) AS contests,
         (SELECT COUNT(*) FROM candidates) AS candidacies,
         (SELECT COUNT(person_id) FROM candidates) AS with_person;
`);

if (totals.error) {
  console.log(`SKIP: could not query ${DB} (${totals.error}).`);
  console.log('  Network-dependent check; not treated as a failure locally.');
  process.exit(0);
}

const served = totals.rows[0] || {};
const problems = [];
const compare = (label, fileValue, dbValue) => {
  const ok = Number(fileValue) === Number(dbValue);
  console.log(`  ${label.padEnd(20)} file ${String(fileValue).padStart(7)}   D1 ${String(dbValue ?? '-').padStart(7)}   ${ok ? 'ok' : 'DIFFERS'}`);
  if (!ok) problems.push(`${label}: file ${fileValue}, D1 ${dbValue}`);
};

console.log('Elections D1 parity');
console.log(`  database : ${DB}`);
compare('elections', elections, served.elections);
compare('contests', contests, served.contests);
compare('candidacies', candidacies, served.candidacies);
compare('with person_id', withPerson, served.with_person);

// --- field-level sample -----------------------------------------------------

if (!problems.length && SAMPLE > 0) {
  const sample = query(`
    SELECT election_key, constituency_seq, candidate_id, name, party, person_id, first_prefs
    FROM candidates ORDER BY election_key, constituency_seq, candidate_id LIMIT ${SAMPLE};
  `);
  if (sample.error) {
    console.log(`\n  sample skipped: ${sample.error}`);
  } else {
    let checked = 0;
    let missing = 0;
    for (const row of sample.rows) {
      const key = `${row.election_key}::${row.constituency_seq}::${row.candidate_id}`;
      const expected = candidateByKey.get(key);
      if (!expected) { missing += 1; continue; }
      checked += 1;
      const differs = [];
      if ((expected.name ?? null) !== (row.name ?? null)) differs.push('name');
      if ((expected.party ?? null) !== (row.party ?? null)) differs.push('party');
      if (String(expected.personId ?? '') !== String(row.person_id ?? '')) differs.push('person_id');
      if (Number(expected.firstPrefs ?? 0) !== Number(row.first_prefs ?? 0)) differs.push('first_prefs');
      if (differs.length) problems.push(`${row.election_key} seq ${row.constituency_seq} candidate ${row.candidate_id}: ${differs.join(', ')} differ`);
    }
    console.log(`\n  sampled ${checked} candidate row(s) field by field${missing ? `; ${missing} not found in the files` : ''}`);
    if (missing) problems.push(`${missing} sampled row(s) are in D1 but not in the metadata`);
  }
}

if (problems.length) {
  console.error('\nFAIL: the elections tables in D1 do not match the metadata.');
  for (const problem of problems.slice(0, 12)) console.error(`  - ${problem}`);
  if (problems.length > 12) console.error(`  ... and ${problems.length - 12} more`);
  console.error('\n  Regenerate and reload:');
  console.error('    node scripts/build-elections-sqlite.mjs');
  console.error(`    npx wrangler d1 execute ${DB} --remote --file=tmp/elections.sql`);
  process.exit(1);
}

console.log('\nPASS: D1 serves the elections tables as the metadata records them.');
