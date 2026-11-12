#!/usr/bin/env node
/**
 * Flag people whose recorded activity falls outside their life (QA launch-readiness H3,
 * 11 Nov 2026: Lord Craigavon, who died on 24 November 1940, had a Stormont vote dated
 * 28 January 1941).
 *
 * Reads the local records database (the one `npm run records:build` writes and the site's D1 is
 * loaded from; CIVGRAPH_RECORDS_DB or --db) and, for every person whose card gives a date of
 * death or birth (person_cards.card.died / born, the dates the person page shows: History of
 * Parliament, Wikidata or a reference work), lists:
 *
 *   after-death   a candidacy (its election's date), a vote in a division, or an office whose
 *                 start is dated after the death. FAILS the check.
 *   before-18     a candidacy or a vote dated before the person's 18th birthday. FAILS.
 *   office-ends-after-death
 *                 an office whose end is after the death (often an office record that runs to
 *                 the end of a term). Listed for review; does not fail.
 *   vote-before-first-election
 *                 a vote in a parliament before the person was first returned to it at any
 *                 election Civgraph holds (a by-election may be missing). Listed; does not fail.
 *
 * A date of death known only to the year ("1940") rules out 1941, not December 1940; to the
 * month, the next month. Exceptions the owner has reviewed go in
 * data/elections/persons/lifespan-exceptions.json ({ "exceptions": [{ "personId", "kind",
 * "date", "reason" }] }) and are not reported.
 *
 *   node scripts/check/rules/person-activity-after-death.mjs [--db FILE] [--report FILE.csv] [--json]
 *
 * Without a records database (a clean checkout, CI) it prints SKIP and exits 0: it is a records
 * check, run after a records build (CHECKS.md), not part of the offline `check` chain.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildVar } from '../../../packages/config/src/node.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const EXCEPTIONS = path.join(ROOT, 'data', 'elections', 'persons', 'lifespan-exceptions.json');

/** Division bodies (divisions.body) -> the election body whose members vote in them. */
export const VOTING_BODY_ELECTIONS = {
  stormont: 'parliament-of-northern-ireland',
  dail: 'dail-eireann',
  commons: 'house-of-commons-of-the-united-kingdom',
  assembly: 'northern-ireland-assembly',
};

/**
 * True when an ISO date (YYYY-MM-DD, or shorter) falls after a date given at year, month or day
 * precision: "1940" rules out 1941 but not 1940-12-01.
 * @param {string | null | undefined} date
 * @param {string | null | undefined} limit
 */
export function isAfter(date, limit) {
  const d = String(date || '');
  const l = String(limit || '');
  if (!d || !/^\d{4}(-\d{2}){0,2}$/.test(l)) return false;
  return d.slice(0, l.length) > l;
}

/**
 * True when an ISO date falls before the 18th birthday of someone born on `born` (at its own
 * precision: born "1950" is 18 in 1968, so only dates before 1968 count).
 * @param {string | null | undefined} date
 * @param {string | null | undefined} born
 */
export function isBefore18(date, born) {
  const d = String(date || '');
  const b = String(born || '');
  if (!d || !/^\d{4}(-\d{2}){0,2}$/.test(b)) return false;
  const eighteen = `${Number(b.slice(0, 4)) + 18}${b.slice(4)}`;
  return d.slice(0, eighteen.length) < eighteen;
}

/**
 * Every finding over a records database.
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {{ exceptions?: Array<{ personId: string | number, kind: string, date?: string }> }} [options]
 * @returns {Array<{ kind: string, personId: string, name: string, born: string, died: string, date: string, what: string, detail: string }>}
 */
export function findLifespanProblems(db, { exceptions = [] } = {}) {
  /** @type {Map<string, { name: string, born: string, died: string, offices: Array<{ office?: string, start?: string, end?: string }> }>} */
  const people = new Map();
  for (const row of db.prepare('SELECT id, card FROM person_cards ORDER BY ord, slug').iterate()) {
    let card;
    try { card = JSON.parse(String(row.card)); } catch { continue; }
    const born = String(card.born || '');
    const died = String(card.died || '');
    if (!born && !died) continue;
    people.set(String(row.id), { name: String(card.title || card.name || row.id), born, died, offices: Array.isArray(card.officesHeld) ? card.officesHeld : [] });
  }
  /** @type {Map<string, string>} the names of people with no dates, for the review lines */
  const names = new Map();
  for (const row of db.prepare('SELECT person_id AS id, display_name AS name FROM persons ORDER BY ord, person_id').iterate()) names.set(String(row.id), String(row.name || ''));
  const skip = new Set(exceptions.map((e) => `${e.personId}|${e.kind}|${e.date || ''}`));
  /** @type {ReturnType<typeof findLifespanProblems>} */
  const out = [];
  const add = (/** @type {string} */ kind, /** @type {string} */ personId, /** @type {string} */ date, /** @type {string} */ what, /** @type {string} */ detail) => {
    if (skip.has(`${personId}|${kind}|${date}`) || skip.has(`${personId}|${kind}|`)) return;
    const p = people.get(personId);
    out.push({ kind, personId, name: p?.name || names.get(personId) || '', born: p?.born || '', died: p?.died || '', date, what, detail });
  };

  // Candidacies, by their election's date.
  const candidacies = db.prepare(`SELECT c.person_id AS personId, e.date AS date, e.key AS electionKey, e.body_slug AS body, k.name AS contest, c.elected AS elected
    FROM candidacies c JOIN r_elections e ON e.key = c.election_key JOIN contests k ON k.election_key = c.election_key AND k.seq = c.contest_seq
    WHERE c.person_id IS NOT NULL ORDER BY c.person_id, e.date, c.election_key, c.contest_seq`);
  /** @type {Map<string, Map<string, string>>} person -> election body -> first date returned */
  const firstReturned = new Map();
  for (const row of candidacies.iterate()) {
    const personId = String(row.personId);
    if (Number(row.elected) === 1) {
      if (!firstReturned.has(personId)) firstReturned.set(personId, new Map());
      const bodies = /** @type {Map<string, string>} */ (firstReturned.get(personId));
      if (!bodies.has(String(row.body))) bodies.set(String(row.body), String(row.date));
    }
    const p = people.get(personId);
    if (!p) continue;
    if (isAfter(String(row.date), p.died)) add('after-death', personId, String(row.date), 'candidacy', `${row.electionKey}: ${row.contest}`);
    else if (isBefore18(String(row.date), p.born)) add('before-18', personId, String(row.date), 'candidacy', `${row.electionKey}: ${row.contest}`);
  }

  // Votes in divisions.
  const votes = db.prepare(`SELECT v.person_id AS personId, d.date AS date, d.division_id AS divisionId, d.body AS body, v.vote AS vote, v.entry AS entry
    FROM division_votes v JOIN divisions d ON d.division_id = v.division_id WHERE v.person_id IS NOT NULL ORDER BY v.person_id, d.date, d.division_id`);
  /** @type {Map<string, { personId: string, body: string, first: string, last: string, n: number }>} */
  const early = new Map();
  for (const row of votes.iterate()) {
    const personId = String(row.personId);
    const date = String(row.date);
    let printed = '';
    try { printed = String(JSON.parse(String(row.entry))[0] || ''); } catch { /* keep blank */ }
    const p = people.get(personId);
    if (p && isAfter(date, p.died)) add('after-death', personId, date, 'vote', `${row.divisionId} (${row.vote}), printed "${printed}"`);
    else if (p && isBefore18(date, p.born)) add('before-18', personId, date, 'vote', `${row.divisionId} (${row.vote}), printed "${printed}"`);
    const electionBody = VOTING_BODY_ELECTIONS[/** @type {keyof typeof VOTING_BODY_ELECTIONS} */ (String(row.body))];
    const first = electionBody ? firstReturned.get(personId)?.get(electionBody) : undefined;
    if (electionBody && first && date < first) {
      const k = `${personId}|${row.body}`;
      const seen = early.get(k) || { personId, body: String(row.body), first: date, last: date, n: 0 };
      seen.last = date;
      seen.n += 1;
      early.set(k, seen);
    }
  }
  for (const e of early.values()) {
    add('vote-before-first-election', e.personId, e.first, 'votes', `${e.n} ${e.body} vote(s) ${e.first} to ${e.last}, before first returned on ${firstReturned.get(e.personId)?.get(VOTING_BODY_ELECTIONS[/** @type {keyof typeof VOTING_BODY_ELECTIONS} */ (e.body)])}`);
  }

  // Offices from the reference works.
  for (const [personId, p] of people) {
    for (const office of p.offices) {
      if (isAfter(String(office.start || ''), p.died)) add('after-death', personId, String(office.start), 'office', String(office.office || ''));
      else if (isAfter(String(office.end || ''), p.died)) add('office-ends-after-death', personId, String(office.end), 'office', String(office.office || ''));
    }
  }
  return out.sort((a, b) => a.kind.localeCompare(b.kind) || Number(a.personId) - Number(b.personId) || a.date.localeCompare(b.date));
}

/** The kinds that fail the check; the others are listed for review. */
export const FAILING_KINDS = new Set(['after-death', 'before-18']);

/** @param {string} value */
const csvCell = (value) => (/[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);

async function main() {
  const args = process.argv.slice(2);
  const opt = (/** @type {string} */ name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
  const dbPath = path.resolve(ROOT, opt('--db') || buildVar('CIVGRAPH_RECORDS_DB'));
  if (!existsSync(dbPath)) {
    console.log(`SKIP person-activity-after-death: no records database at ${path.relative(ROOT, dbPath)} (run npm run records:build, or pass --db)`);
    return 0;
  }
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(dbPath, { readOnly: true });
  const exceptions = existsSync(EXCEPTIONS) ? JSON.parse(readFileSync(EXCEPTIONS, 'utf8')).exceptions || [] : [];
  const problems = findLifespanProblems(db, { exceptions });
  db.close();
  const report = opt('--report');
  if (report) {
    const header = ['kind', 'personId', 'name', 'born', 'died', 'date', 'what', 'detail'];
    writeFileSync(report, `${header.join(',')}\n${problems.map((p) => header.map((h) => csvCell(String(p[/** @type {keyof typeof p} */ (h)] ?? ''))).join(',')).join('\n')}\n`);
  }
  if (args.includes('--json')) {
    console.log(JSON.stringify(problems, null, 1));
  }
  const counts = new Map();
  for (const p of problems) counts.set(p.kind, (counts.get(p.kind) || 0) + 1);
  const failing = problems.filter((p) => FAILING_KINDS.has(p.kind));
  for (const p of failing.slice(0, 40)) console.log(`${p.kind}: ${p.name} (${p.personId}; born ${p.born || '?'}, died ${p.died || '?'}): ${p.what} ${p.date} ${p.detail}`);
  if (failing.length > 40) console.log(`... and ${failing.length - 40} more${report ? ` (all in ${report})` : ' (pass --report FILE.csv for all)'}`);
  console.log(`person-activity-after-death: ${[...counts].map(([k, n]) => `${k} ${n}`).join(', ') || 'nothing found'}`);
  if (failing.length) {
    console.error(`FAIL: ${failing.length} candidacies, votes or offices fall after a death or before an 18th birthday`);
    return 1;
  }
  console.log('OK person-activity-after-death');
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = await main();
