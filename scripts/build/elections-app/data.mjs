#!/usr/bin/env node
/**
 * The Civgraph Elections app's build-time data, read from the local records build
 * (tmp/records/civgraph-records.sqlite, `npm run records:build`). It never reads live D1.
 *
 *   node scripts/build/elections-app/data.mjs --audit
 *       Phase 0: per body and decade, what the records hold (stage counts, transfers,
 *       electorate, turnout, unopposed returns, party labels, person links, provenance), written
 *       to docs/tasks/elections-app-data-audit.md (--out to change).
 *   node scripts/build/elections-app/data.mjs --extracts [--out-dir DIR] [--no-parquet]
 *       Phase 2: one pivot extract per body (one row per candidacy, model.mjs EXTRACT_COLUMNS),
 *       as CSV and, through the local Python DuckDB, Parquet, plus index.json naming them.
 *       Default DIR is tmp/elections-app/extracts (gitignored). The extracts are PRIVATE until
 *       the owner approves the app: they are never uploaded to R2 and are not under site/.
 *       `--out-dir dist/apps/elections/extracts` after `npm run build:site` puts them beside a
 *       local build for testing.
 *
 * Options: --db FILE (default the records build), --body SLUG (repeatable; extracts only).
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openSqliteHandle } from '../../../packages/storage/src/sqlite.mjs';
import {
  EXTRACT_COLUMNS, contestFacts, decadeOf, electedPersons, emptyTally, extractRow, parseMeta, pct,
  tallyContest, tallyElection, toCsv,
} from './model.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const args = process.argv.slice(2);
const opt = (/** @type {string} */ name, /** @type {string | null} */ dflt = null) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
};
const many = (/** @type {string} */ name) => args.flatMap((a, i) => (a === name && args[i + 1] ? [args[i + 1]] : []));

const DB_FILE = path.resolve(REPO, opt('--db', 'tmp/records/civgraph-records.sqlite') || '');

/**
 * Walk every election in body, date order with its contests and candidacies.
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {(el: any, contests: Array<{ row: any, meta: any, cands: any[], provenance: string | null }>) => void} visit
 * @param {{ bodies?: string[] }} [filter]
 */
function walk(db, visit, filter = {}) {
  const elections = /** @type {any[]} */ (db.prepare(
    'SELECT key, slug, body_slug, body, display_title, contest_type, kind, voting_system, contest_status, date, year, previous_key, placeholder FROM r_elections ORDER BY body_slug, date, key',
  ).all());
  const contestsOf = db.prepare('SELECT seq, name, slug, seats_total, electorate, quota, turnout_pct, meta FROM contests WHERE election_key = ? ORDER BY seq');
  const candsOf = db.prepare('SELECT contest_seq, ord, person_id, name, party_label, first_prefs, final_votes, elected, excluded, status, gender, meta FROM candidacies WHERE election_key = ? ORDER BY contest_seq, ord');
  const provOf = db.prepare('SELECT contest_seq, status FROM contest_provenance WHERE election_key = ?');
  for (const el of elections) {
    if (filter.bodies?.length && !filter.bodies.includes(el.body_slug)) continue;
    /** @type {Map<number, any[]>} */
    const bySeq = new Map();
    for (const c of /** @type {any[]} */ (candsOf.all(el.key))) {
      c.meta = parseMeta(c.meta);
      if (!bySeq.has(c.contest_seq)) bySeq.set(c.contest_seq, []);
      /** @type {any[]} */ (bySeq.get(c.contest_seq)).push(c);
    }
    const prov = new Map(/** @type {any[]} */ (provOf.all(el.key)).map((r) => [r.contest_seq, r.status]));
    const contests = /** @type {any[]} */ (contestsOf.all(el.key)).map((row) => {
      const meta = parseMeta(row.meta);
      return { row: { ...row, meta }, meta, cands: bySeq.get(row.seq) || [], provenance: prov.get(row.seq) ?? null };
    });
    visit(el, contests);
  }
}

/** @param {import('node:sqlite').DatabaseSync} db */
function labelMap(db) {
  return new Map(/** @type {any[]} */ (db.prepare('SELECT label, party_slug FROM party_label_map').all()).map((r) => [r.label, r.party_slug]));
}

// ------------------------------------------------------------------ audit

export const DECISIONS_MARKER = '<!-- decisions: hand-written below this line, kept when the audit is regenerated -->';

/** @param {import('node:sqlite').DatabaseSync} db */
function audit(db) {
  const lm = labelMap(db);
  const total = emptyTally();
  /** @type {Map<string, { name: string, span: [string, string], tally: ReturnType<typeof emptyTally>, decades: Map<string, ReturnType<typeof emptyTally>> }>} */
  const bodies = new Map();
  walk(db, (el, contests) => {
    if (!bodies.has(el.body_slug)) bodies.set(el.body_slug, { name: el.body || el.body_slug, span: [el.date, el.date], tally: emptyTally(), decades: new Map() });
    const b = /** @type {any} */ (bodies.get(el.body_slug));
    if (el.date < b.span[0]) b.span[0] = el.date;
    if (el.date > b.span[1]) b.span[1] = el.date;
    const dec = decadeOf(el.year);
    if (!b.decades.has(dec)) b.decades.set(dec, emptyTally());
    const tallies = [total, b.tally, b.decades.get(dec)];
    for (const t of tallies) tallyElection(t, el);
    for (const c of contests) {
      const f = contestFacts(c.row, c.meta, c.cands, { contestStatus: el.contest_status, labelMap: lm });
      for (const t of tallies) tallyContest(t, f, c.provenance);
    }
  });
  return { total, bodies };
}

/** @param {ReturnType<typeof emptyTally>} t */
const cells = (t) => [
  t.elections, t.byElections, t.contests,
  pct(t.withCandidates, t.contests), pct(t.votes, t.contests), pct(t.order, t.contests), pct(t.stages, t.contests),
  pct(t.electorate, t.contests), pct(t.turnout, t.contests), t.unopposed,
  pct(t.labelled, t.candidacies), pct(t.linkedParty, t.labelled), pct(t.persons, t.candidacies), pct(t.gender, t.candidacies),
  `${pct(t.provenance.verified, t.contests)} / ${pct(t.provenance.cited, t.contests)} / ${pct(t.provenance.recorded, t.contests)}`,
];
const HEAD = ['Elections', 'By-el.', 'Contests', 'Cands', 'Votes', 'Count order', 'Stage totals', 'Electorate', 'Turnout', 'Unopposed',
  'Party label', 'Label→party', 'Person', 'Gender', 'Verified / cited / recorded'];
const row = (/** @type {unknown[]} */ xs) => `| ${xs.join(' | ')} |`;

/** @param {ReturnType<typeof audit>} a @param {string} dbFile */
function auditMarkdown(a, dbFile) {
  const t = a.total;
  const lines = [];
  lines.push('# Civgraph Elections app: data audit (Phase 0)', '');
  lines.push(`Generated by \`node scripts/build/elections-app/data.mjs --audit\` from the local records build (\`${path.relative(REPO, dbFile).replace(/\\/g, '/')}\`), 11 Nov 2026. It reads the same rows D1 \`civgraph-records\` serves; it never queries live D1. Re-run it after a records rebuild; the decisions in "What each view can show" are hand-written and should be re-read against the new figures.`, '');
  lines.push('## Totals', '');
  lines.push(`- ${t.elections.toLocaleString('en-GB')} elections (${t.byElections.toLocaleString('en-GB')} by-elections, ${t.referendums} referendums or recall petitions) across ${a.bodies.size} bodies; ${t.withPrevious.toLocaleString('en-GB')} name a previous election (\`previous_key\`).`);
  lines.push(`- Voting systems: ${Object.entries(t.systems).sort((x, y) => y[1] - x[1]).map(([k, v]) => `${k} ${v.toLocaleString('en-GB')}`).join(', ')}.`);
  lines.push(`- ${t.contests.toLocaleString('en-GB')} contests; ${pct(t.withCandidates, t.contests)} have candidate rows, ${pct(t.votes, t.contests)} have votes, ${pct(t.order, t.contests)} record the count at which candidates were elected or excluded, and ${pct(t.stages, t.contests)} have stage-by-stage totals with transfers (a count padded to several stages with unchanged totals, as some Irish scraper sources are, counts as one stage).`);
  lines.push(`- Electorate on ${pct(t.electorate, t.contests)}, turnout on ${pct(t.turnout, t.contests)}, quota on ${pct(t.quota, t.contests)}, valid poll on ${pct(t.validPoll, t.contests)}, spoiled ballots on ${pct(t.spoiled, t.contests)}, seats on ${pct(t.seats, t.contests)} of contests.`);
  lines.push(`- ${t.unopposed.toLocaleString('en-GB')} contests are unopposed returns (no votes; an "Elected unopposed" candidacy, or an uncontested election).`);
  lines.push(`- ${t.candidacies.toLocaleString('en-GB')} candidacies: party label on ${pct(t.labelled, t.candidacies)} (the rest "No party recorded" or blank); ${pct(t.linkedParty, t.labelled)} of labels fold to a party record through party_label_map; person link on ${pct(t.persons, t.candidacies)}; gender on ${pct(t.gender, t.candidacies)}.`);
  lines.push(`- Provenance per contest: verified ${pct(t.provenance.verified, t.contests)}, cited ${pct(t.provenance.cited, t.contests)}, recorded ${pct(t.provenance.recorded, t.contests)}, none ${pct(t.provenance.none, t.contests)}.`);
  lines.push('');
  lines.push('Column key: **Cands** contests with candidate rows; **Votes** contests with any vote figure; **Count order** contests that record the count at which candidates were elected or excluded; **Stage totals** contests with real stage-by-stage totals (transfers recorded or totals changing between stages); **Electorate**, **Turnout** contests with that figure; **Unopposed** number of unopposed contests; **Party label** candidacies with a label other than "No party recorded"; **Label→party** labelled candidacies whose label folds to a party record; **Person** candidacies linked to a person record; **Gender** candidacies with M/F recorded; the last column is the share of contests whose provenance status is verified / cited / recorded.', '');
  lines.push('## By body', '');
  lines.push(row(['Body', 'Span', ...HEAD]));
  lines.push(row(['---', '---', ...HEAD.map(() => '---:')]));
  const sorted = [...a.bodies.entries()].sort((x, y) => y[1].tally.contests - x[1].tally.contests);
  for (const [slug, b] of sorted) lines.push(row([`${b.name} (\`${slug}\`)`, `${b.span[0].slice(0, 4)}–${b.span[1].slice(0, 4)}`, ...cells(b.tally)]));
  lines.push('');
  lines.push('## By body and decade', '');
  lines.push('Bodies with more than one decade of elections; single-decade bodies are fully described by the table above.', '');
  for (const [slug, b] of sorted) {
    if (b.decades.size < 2) continue;
    lines.push(`### ${b.name} (\`${slug}\`)`, '');
    lines.push(row(['Decade', ...HEAD]));
    lines.push(row(['---', ...HEAD.map(() => '---:')]));
    for (const [dec, dt] of [...b.decades.entries()].sort()) lines.push(row([dec, ...cells(dt)]));
    lines.push('');
  }
  return lines.join('\n');
}

// ------------------------------------------------------------------ extracts

/** @param {import('node:sqlite').DatabaseSync} db @param {string} outDir @param {{ parquet: boolean, bodies: string[] }} o */
function extracts(db, outDir, o) {
  const lm = labelMap(db);
  /** @type {Map<string, { name: string, rows: any[], elections: number }>} */
  const byBody = new Map();
  /** @type {Map<string, Set<string>>} sitting members per body, for incumbency */
  const sitting = new Map();
  walk(db, (el, contests) => {
    if (el.contest_type && el.contest_type !== 'election') return; // referendums: no candidates to pivot
    if (!byBody.has(el.body_slug)) byBody.set(el.body_slug, { name: el.body || el.body_slug, rows: [], elections: 0 });
    const b = /** @type {any} */ (byBody.get(el.body_slug));
    b.elections += 1;
    const before = sitting.get(el.body_slug) || null;
    const all = [];
    for (const c of contests) {
      const f = contestFacts(c.row, c.meta, c.cands, { contestStatus: el.contest_status });
      for (const cand of c.cands) {
        b.rows.push(extractRow(el, c.row, cand, { labelMap: lm, incumbents: before || undefined, unopposed: f.unopposed, stages: f.stages }));
        all.push(cand);
      }
    }
    const won = electedPersons(all);
    if (el.kind === 'by-election') {
      const s = sitting.get(el.body_slug) || new Set();
      for (const p of won) s.add(p);
      sitting.set(el.body_slug, s);
    } else {
      sitting.set(el.body_slug, won);
    }
  }, { bodies: o.bodies });

  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  const index = [];
  for (const [slug, b] of [...byBody.entries()].sort()) {
    if (!b.rows.length) continue;
    const csv = path.join(outDir, `${slug}.csv`);
    writeFileSync(csv, toCsv([...EXTRACT_COLUMNS], b.rows));
    index.push({ body: b.name, slug, elections: b.elections, rows: b.rows.length, file: `${slug}.parquet`, csv: `${slug}.csv` });
  }
  if (o.parquet) toParquet(outDir, index.map((x) => x.slug));
  writeFileSync(path.join(outDir, 'index.json'), `${JSON.stringify({
    schemaVersion: 1,
    note: 'Private until the owner approves the Elections app (11 Nov 2026). Built from the local records build; never uploaded.',
    columns: EXTRACT_COLUMNS,
    format: o.parquet ? 'parquet' : 'csv',
    bodies: index,
  }, null, 1)}\n`);
  return index;
}

/**
 * CSV -> Parquet with the local Python DuckDB (the Node side has no Parquet writer; the browser
 * reads both). Column types are pinned so every body's file has the same schema.
 * @param {string} dir @param {string[]} slugs
 */
function toParquet(dir, slugs) {
  const types = {
    contest_seq: 'INTEGER', year: 'INTEGER', incumbent: 'BOOLEAN', unopposed: 'BOOLEAN', votes: 'DOUBLE', share: 'DOUBLE',
    final_votes: 'DOUBLE', transfers_received: 'DOUBLE', seats: 'INTEGER', stages: 'INTEGER', electorate: 'DOUBLE',
    turnout_pct: 'DOUBLE', quota: 'DOUBLE', valid_poll: 'DOUBLE',
  };
  const columns = Object.fromEntries(EXTRACT_COLUMNS.map((c) => [c, /** @type {any} */ (types)[c] || 'VARCHAR']));
  const py = [
    'import duckdb, json, sys, os',
    'd, cols, slugs = sys.argv[1], json.loads(sys.argv[2]), json.loads(sys.argv[3])',
    'con = duckdb.connect()',
    'spec = "{" + ", ".join("\'%s\': \'%s\'" % (k, v) for k, v in cols.items()) + "}"',
    'for s in slugs:',
    '    src = os.path.join(d, s + ".csv").replace("\\\\", "/")',
    '    dst = os.path.join(d, s + ".parquet").replace("\\\\", "/")',
    '    con.execute("COPY (SELECT * FROM read_csv(\'%s\', header=true, columns=%s)) TO \'%s\' (FORMAT parquet, COMPRESSION zstd)" % (src, spec, dst))',
  ].join('\n');
  execFileSync('python', ['-I', '-c', py, dir, JSON.stringify(columns), JSON.stringify(slugs)], { stdio: 'inherit' });
}

// ------------------------------------------------------------------ main

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!existsSync(DB_FILE)) {
    console.error(`No records build at ${DB_FILE}: run npm run records:build, or pass --db.`);
    process.exit(1);
  }
  const db = openSqliteHandle(DB_FILE, { readOnly: true });
  if (args.includes('--audit')) {
    const out = path.resolve(REPO, opt('--out', 'docs/tasks/elections-app-data-audit.md') || '');
    // The hand-written decisions after DECISIONS_MARKER survive a regeneration.
    const old = existsSync(out) ? readFileSync(out, 'utf8') : '';
    const kept = old.includes(DECISIONS_MARKER) ? old.slice(old.indexOf(DECISIONS_MARKER)) : '';
    writeFileSync(out, `${auditMarkdown(audit(db), DB_FILE)}\n${kept}`);
    console.log(`audit written: ${path.relative(REPO, out)}`);
  } else if (args.includes('--extracts')) {
    const outDir = path.resolve(REPO, opt('--out-dir', 'tmp/elections-app/extracts') || '');
    const index = extracts(db, outDir, { parquet: !args.includes('--no-parquet'), bodies: many('--body') });
    console.log(`extracts: ${index.length} bodies, ${index.reduce((s, x) => s + x.rows, 0)} rows -> ${path.relative(REPO, outDir)}`);
  } else {
    console.error('usage: data.mjs --audit | --extracts [--out-dir DIR] [--no-parquet] [--body SLUG]');
    process.exit(2);
  }
}

export { audit, auditMarkdown, extracts };
