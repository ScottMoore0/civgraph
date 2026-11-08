/**
 * Constraints on a built records database (stage C.3). Returns { errors, warnings, facts };
 * build-records-db.mjs refuses to publish a database with errors.
 *
 *   node scripts/records/validate.mjs [file]      validate tmp/records/civgraph-records.next.sqlite
 *                                                 (or the given file) and print the result
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { openDatabase } from './db.mjs';
import { buildVar } from '../../config/src/node.mjs';
import { REPO_ROOT } from './paths.mjs';
import { MAX_VALUE_BYTES, TABLES } from '../../schema/src/schema.mjs';

// Source-file validators run as they are (stage C.3); each reads committed sources only.
export const SOURCE_VALIDATORS = [
  'scripts/check/rules/external-sources.mjs',
  'scripts/check/rules/raw-source-documents.mjs',
  'scripts/check/rules/medium-priority-sources.mjs',
  'scripts/check/rules/peatland-geoportal.mjs',
  'scripts/check/rules/ni-register-interests.mjs',
  'scripts/check/rules/election-source-enrichments.mjs',
  'scripts/check/rules/candidate-name-party.mjs',
];

/** @typedef {import('node:sqlite').SQLInputValue} SQLInputValue */
/**
 * What validateDatabase measured (build-records-db.mjs prints and keeps some of them).
 * @typedef {{ largestValue: { bytes: number, table?: string, column?: string },
 *   contestsWithoutCandidacies: number, candidaciesWithUnknownPerson: number, unstampedCandidacies: number,
 *   candidaciesWithUnknownParty: number, duplicateContestSlugs: number, provenanceUnmatched: number }} ValidateFacts
 */

/**
 * @param {import('../../storage/src/sqlite.mjs').SqliteHandle} db
 * @param {{ sourceValidators?: boolean }} [options]
 * @returns {{ errors: string[], warnings: string[], facts: ValidateFacts }}
 */
export function validateDatabase(db, { sourceValidators = false } = {}) {
  /** @type {string[]} */
  const errors = [];
  /** @type {string[]} */
  const warnings = [];
  const facts = /** @type {ValidateFacts} */ ({});
  const all = (/** @type {string} */ sql, /** @type {SQLInputValue[]} */ ...a) => db.prepare(sql).all(...a);
  /**
   * The one row of an aggregate or PRAGMA query (always present): numbers (COUNT(*) AS n,
   * max(length(...))) unless the variable it is assigned to names another shape.
   * @template [R=Record<string, number>]
   * @param {string} sql
   * @param {SQLInputValue[]} a
   * @returns {R}
   */
  const one = (sql, ...a) => /** @type {R} */ (db.prepare(sql).get(...a));

  /** @type {Record<string, string>} */
  const integrity = one('PRAGMA integrity_check');
  if (Object.values(integrity)[0] !== 'ok') errors.push(`integrity_check: ${JSON.stringify(integrity)}`);
  const fk = all('PRAGMA foreign_key_check');
  if (fk.length) errors.push(`foreign_key_check: ${fk.length} violation(s)`);

  // D1 refuses a row over 2,000,000 bytes: every TEXT value stays under 1.9 MB.
  /** @type {ValidateFacts['largestValue']} */
  let largest = { bytes: 0 };
  for (const t of TABLES) {
    const cols = t.columns.filter((c) => c.type === 'TEXT').map((c) => c.name);
    if (!cols.length) continue;
    // One scan per table: the largest value of every TEXT column at once.
    const row = one(`SELECT ${cols.map((c, i) => `max(length(CAST(${c} AS BLOB))) AS c${i}`).join(', ')} FROM ${t.name}`);
    cols.forEach((col, i) => {
      const bytes = Number(row?.[`c${i}`] || 0);
      if (bytes > largest.bytes) largest = { bytes, table: t.name, column: col };
      if (bytes > MAX_VALUE_BYTES) errors.push(`${t.name}.${col}: a value of ${bytes} bytes (limit ${MAX_VALUE_BYTES})`);
    });
  }
  facts.largestValue = largest;

  const empty = all(`SELECT k.election_key, k.seq FROM contests k JOIN r_elections e ON e.key = k.election_key
    WHERE COALESCE(e.placeholder, 0) = 0 AND COALESCE(e.candidate_rows_expected, 1) = 1
      AND NOT EXISTS (SELECT 1 FROM candidacies c WHERE c.election_key = k.election_key AND c.contest_seq = k.seq)
    ORDER BY k.election_key, k.seq`);
  facts.contestsWithoutCandidacies = empty.length;
  if (empty.length) warnings.push(`${empty.length} contest(s) expecting candidates have none (first: ${empty[0].election_key}#${empty[0].seq})`);

  const orphanPersons = one(`SELECT COUNT(*) AS n FROM candidacies c WHERE c.person_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM persons p WHERE p.person_id = c.person_id)`).n;
  facts.candidaciesWithUnknownPerson = orphanPersons;
  if (orphanPersons) warnings.push(`${orphanPersons} candidacies carry a person id the registry does not list`);
  facts.unstampedCandidacies = one("SELECT COUNT(*) AS n FROM candidacies WHERE person_id IS NULL AND COALESCE(name, '') <> ''").n;

  const orphanParties = one(`SELECT COUNT(*) AS n FROM candidacies c WHERE c.party_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM parties p WHERE p.party_id = c.party_id)`).n;
  facts.candidaciesWithUnknownParty = orphanParties;
  if (orphanParties) warnings.push(`${orphanParties} candidacies carry a party id the registry does not list`);

  // The candidate-name-party rule reads the contest source files themselves, with its baseline:
  // it runs with the source validators below (validate-candidate-name-party.mjs).

  for (const [table, col] of [['r_elections', 'slug'], ['election_cards', 'slug'], ['person_cards', 'slug'], ['sources', 'slug'], ['register_entries', 'slug'], ['party_cards', 'slug']]) {
    const dup = one(`SELECT COUNT(*) AS n FROM (SELECT ${col} FROM ${table} GROUP BY ${col} HAVING COUNT(*) > 1)`).n;
    if (dup) errors.push(`${table}.${col}: ${dup} duplicate slug(s)`);
  }
  const dupContest = one('SELECT COUNT(*) AS n FROM (SELECT election_key, slug FROM contests GROUP BY 1, 2 HAVING COUNT(*) > 1)').n;
  facts.duplicateContestSlugs = dupContest;
  if (dupContest) warnings.push(`${dupContest} contest slug(s) used twice within an election (the first by seq answers)`);

  const unmatchedProv = one('SELECT COUNT(*) AS n FROM contest_provenance WHERE election_key IS NULL').n;
  facts.provenanceUnmatched = unmatchedProv;

  if (sourceValidators) {
    for (const script of SOURCE_VALIDATORS) {
      const run = spawnSync(process.execPath, [script], {
        cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
        env: { ...process.env, CIVGRAPH_BUILD_DIR: buildVar('CIVGRAPH_BUILD_DIR') },
      });
      if (run.status !== 0) errors.push(`${script} failed: ${(run.stderr || run.stdout || '').trim().split('\n').slice(-3).join(' | ')}`);
    }
  }
  return { errors, warnings, facts };
}

if (process.argv[1] && path.basename(process.argv[1]) === 'validate.mjs') {
  const file = process.argv[2] || path.join(REPO_ROOT, 'tmp/records/civgraph-records.next.sqlite');
  const db = openDatabase(file, { readOnly: true });
  const result = validateDatabase(db, { sourceValidators: process.argv.includes('--sources') });
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.errors.length ? 1 : 0);
}
