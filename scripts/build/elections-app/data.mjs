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
 *       (npm run build:elections-app) Phase 2: one pivot extract per body (one row per candidacy,
 *       model.mjs EXTRACT_COLUMNS), as Parquet through the local Python DuckDB (one thread, so the
 *       same records build gives the same bytes), named by content (<body>-<sha256:12>.parquet),
 *       with index.json (bodies, rows, file names: what the app reads) and manifest.json (every
 *       file's name, bytes and SHA-256, and a fingerprint of the rows each body was built from).
 *       Default DIR is site/apps/elections/extracts (gitignored, so never in dist/ or a commit;
 *       the local servers serve it). Production reads the R2 copy (site/apps/elections/config.js),
 *       uploaded only with the owner's approval by scripts/publish/elections-app-r2-upload.mjs.
 *   node scripts/build/elections-app/data.mjs --check [--out-dir DIR] [--strict]
 *       (npm run check:elections-app-extracts) The extracts are current: rebuilt in memory from
 *       the records build, every body's rows hash as the manifest says, every file on disk is the
 *       manifest's bytes and SHA-256, the columns are the reviewed publishable set, and no value
 *       looks like an address, email or phone number. Without a records build or extracts it
 *       skips (exit 0), unless --strict (the upload script runs it so).
 *
 * Options: --db FILE (default the records build), --body SLUG (repeatable; extracts only).
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { recordPaths } from '../../../packages/config/src/node.mjs';
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

const DB_FILE = path.resolve(REPO, opt('--db', recordPaths().RECORDS_DB) || '');

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

/**
 * The columns an extract may carry, reviewed for publication on 11 Nov 2026: every one is a field
 * the records API already serves for the same candidacy (packages/api/src/queries/elections.js).
 * No address, agent, proposer, occupation, note, source file or citation: none of those is read.
 * A new column is a review: add it here with a reason, never only in model.mjs.
 */
export const PUBLISHABLE_COLUMNS = Object.freeze([
  'election_key', 'election_slug', 'election', 'body', 'body_slug', 'kind', 'voting_system', 'date', 'year', 'decade',
  'contest_seq', 'area', 'area_slug', 'candidate', 'person_id', 'party', 'party_slug', 'gender', 'incumbent',
  'outcome', 'unopposed',
  'votes', 'share', 'final_votes', 'transfers_received', 'seats', 'stages', 'electorate', 'turnout_pct', 'quota', 'valid_poll',
]);

/** Values that must never be in an extract: a postcode (UK or Eircode), an email address, a phone number, a street address. */
export const PRIVATE_VALUE_PATTERNS = Object.freeze(/** @type {Array<[string, RegExp]>} */ ([
  ['UK postcode', /\b(?:BT|[A-PR-UWYZ][A-HK-Y]?)[0-9][0-9A-Z]? ?[0-9][ABD-HJLNP-UW-Z]{2}\b/],
  ['Eircode', /\b(?:[AC-FHKNPRTV-Y][0-9]{2}|D6W) ?[0-9AC-FHKNPRTV-Y]{4}\b/],
  ['email address', /[^\s@]+@[^\s@]+\.[a-z]{2,}/i],
  ['phone number', /(?:\+44|\+353|\b0)[0-9 ()-]{9,}[0-9]\b/],
  ['street address', /\b\d+[A-Z]?,? [A-Z][a-z]+ (?:Street|Road|Avenue|Lane|Terrace|Park|Drive|Gardens|Crescent|Place)\b/],
]));

/** The string columns scanned for private values (names, labels, titles; not slugs or numbers). */
const SCANNED = ['election', 'body', 'area', 'candidate', 'party', 'kind', 'voting_system', 'outcome'];

const sha256 = (/** @type {string | Buffer} */ b) => createHash('sha256').update(b).digest('hex');

/** @param {string} p */
const posix = (p) => p.replace(/\\/g, '/');

/**
 * Every body's extract rows, in memory, from the records build (bodies in slug order).
 * @param {import('node:sqlite').DatabaseSync} db @param {string[]} [bodies]
 * @returns {Map<string, { name: string, rows: any[], elections: number }>}
 */
function extractRows(db, bodies = []) {
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
  }, { bodies });
  return new Map([...byBody.entries()].filter(([, b]) => b.rows.length).sort((x, y) => (x[0] < y[0] ? -1 : 1)));
}

/** The CSV a body's rows make, and its SHA-256: the fingerprint of what the extract was built from. @param {any[]} rows */
function csvOf(rows) {
  const csv = toCsv([...EXTRACT_COLUMNS], rows);
  return { csv, sha: sha256(csv) };
}

/**
 * Problems with what an extract would publish: columns outside the reviewed set, private-looking values.
 * @param {Map<string, { rows: any[] }>} byBody
 * @param {readonly string[]} [columns]
 * @returns {string[]}
 */
export function publicationProblems(byBody, columns = EXTRACT_COLUMNS) {
  const problems = [];
  for (const c of columns) if (!PUBLISHABLE_COLUMNS.includes(c)) problems.push(`column ${c} is not in PUBLISHABLE_COLUMNS (review it before publishing)`);
  for (const [slug, b] of byBody) {
    for (const r of b.rows) {
      for (const col of SCANNED) {
        const v = r[col];
        if (typeof v !== 'string' || !v) continue;
        for (const [what, re] of PRIVATE_VALUE_PATTERNS) if (re.test(v)) problems.push(`${slug}: ${col} "${v}" looks like a ${what}`);
      }
    }
  }
  return problems;
}

/** @param {import('node:sqlite').DatabaseSync} db @param {string} outDir @param {{ parquet: boolean, bodies: string[] }} o */
function extracts(db, outDir, o) {
  const byBody = extractRows(db, o.bodies);
  const problems = publicationProblems(byBody);
  if (problems.length) throw new Error(`the extracts would publish what they must not:\n- ${problems.slice(0, 20).join('\n- ')}`);

  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  /** @type {Array<{ body: string, slug: string, elections: number, rows: number, file: string, sourceSha256: string }>} */
  const index = [];
  for (const [slug, b] of byBody) {
    const { csv, sha } = csvOf(b.rows);
    writeFileSync(path.join(outDir, `${slug}.csv`), csv);
    index.push({ body: b.name, slug, elections: b.elections, rows: b.rows.length, file: `${slug}.csv`, sourceSha256: sha });
  }
  const ext = o.parquet ? 'parquet' : 'csv';
  let writer = 'csv';
  if (o.parquet) {
    writer = toParquet(outDir, index.map((x) => x.slug));
    // The CSVs were the hand-over to DuckDB; the browser reads the Parquet (2.3 MB, against 24 MB of CSV).
    for (const x of index) rmSync(path.join(outDir, `${x.slug}.csv`), { force: true });
  }
  // Named by content: a cache (the browser's, the CDN's) can never mix two builds of one file.
  for (const x of index) {
    const plain = path.join(outDir, `${x.slug}.${ext}`);
    x.file = `${x.slug}-${sha256(readFileSync(plain)).slice(0, 12)}.${ext}`;
    renameSync(plain, path.join(outDir, x.file));
  }
  const indexJson = `${JSON.stringify({
    schemaVersion: 1,
    note: 'Civgraph Elections pivot extracts: one file per body, one row per candidacy, built from the records build by scripts/build/elections-app/data.mjs --extracts.',
    columns: EXTRACT_COLUMNS,
    format: ext,
    bodies: index.map(({ body, slug, elections, rows, file }) => ({ body, slug, elections, rows, file })),
  }, null, 1)}\n`;
  writeFileSync(path.join(outDir, 'index.json'), indexJson);
  // No dates or paths: the same records build makes the same manifest, byte for byte.
  const files = [
    { name: 'index.json', bytes: Buffer.byteLength(indexJson), sha256: sha256(indexJson) },
    ...index.map((x) => {
      const buf = readFileSync(path.join(outDir, x.file));
      return { name: x.file, body: x.slug, rows: x.rows, bytes: buf.length, sha256: sha256(buf), sourceSha256: x.sourceSha256 };
    }),
  ];
  const manifest = {
    schemaVersion: 1,
    generatedBy: 'npm run build:elections-app (scripts/build/elections-app/data.mjs --extracts)',
    format: ext,
    writer,
    columns: EXTRACT_COLUMNS,
    // sourceSha256: the SHA-256 of the CSV of a body's rows (model.mjs toCsv). --check rebuilds the
    // rows from the records build and compares, so it knows whether the extracts are current.
    recordsFingerprint: sha256(index.map((x) => `${x.slug} ${x.sourceSha256}`).join('\n')),
    totals: { bodies: index.length, rows: index.reduce((n, x) => n + x.rows, 0), bytes: files.reduce((n, f) => n + f.bytes, 0) },
    files,
  };
  writeFileSync(path.join(outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 1)}\n`);
  return index;
}

/**
 * Whether the extracts in `outDir` are current against the records build and fit to publish.
 * @param {import('node:sqlite').DatabaseSync} db @param {string} outDir
 * @returns {{ problems: string[], checked: number }}
 */
function checkExtracts(db, outDir) {
  const problems = [];
  const manifest = JSON.parse(readFileSync(path.join(outDir, 'manifest.json'), 'utf8'));
  /** @type {Map<string, any>} */
  const byFile = new Map(manifest.files.map((/** @type {any} */ f) => [f.name, f]));
  // The files on disk are the manifest's, and nothing else is there.
  for (const f of manifest.files) {
    const abs = path.join(outDir, f.name);
    if (!existsSync(abs)) { problems.push(`${f.name}: in the manifest, not on disk`); continue; }
    if (statSync(abs).size !== f.bytes || sha256(readFileSync(abs)) !== f.sha256) problems.push(`${f.name}: bytes or SHA-256 differ from the manifest`);
  }
  for (const name of readdirSync(outDir)) if (name !== 'manifest.json' && !byFile.has(name)) problems.push(`${name}: on disk, not in the manifest`);
  if (existsSync(path.join(outDir, 'index.json'))) {
    const index = JSON.parse(readFileSync(path.join(outDir, 'index.json'), 'utf8'));
    for (const b of index.bodies) if (!byFile.has(b.file)) problems.push(`index.json names ${b.file}, which the manifest does not list`);
  }
  // The columns, then the rows, against what the records build gives now.
  if (JSON.stringify(manifest.columns) !== JSON.stringify(EXTRACT_COLUMNS)) problems.push('the extracts have other columns than model.mjs EXTRACT_COLUMNS: rebuild them');
  const byBody = extractRows(db);
  problems.push(...publicationProblems(byBody, manifest.columns));
  /** @type {Map<string, any>} */
  const built = new Map(manifest.files.filter((/** @type {any} */ f) => f.body).map((/** @type {any} */ f) => [f.body, f]));
  for (const [slug, b] of byBody) {
    const f = built.get(slug);
    if (!f) { problems.push(`${slug}: in the records build, no extract (rebuild: npm run build:elections-app)`); continue; }
    if (f.rows !== b.rows.length || f.sourceSha256 !== csvOf(b.rows).sha) problems.push(`${slug}: the records build has changed since the extract was built (${f.rows} rows then, ${b.rows.length} now): rebuild with npm run build:elections-app`);
  }
  for (const slug of built.keys()) if (!byBody.has(slug)) problems.push(`${slug}: extract for a body the records build no longer has`);
  return { problems, checked: byBody.size };
}

/**
 * CSV -> Parquet with the local Python DuckDB (the Node side has no Parquet writer; the browser
 * reads both). Column types are pinned so every body's file has the same schema.
 * @param {string} dir @param {string[]} slugs
 * @returns {string} the writer, for the manifest
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
    'con.execute("SET threads = 1")',
    'print(duckdb.__version__)',
    'spec = "{" + ", ".join("\'%s\': \'%s\'" % (k, v) for k, v in cols.items()) + "}"',
    'for s in slugs:',
    '    src = os.path.join(d, s + ".csv").replace("\\\\", "/")',
    '    dst = os.path.join(d, s + ".parquet").replace("\\\\", "/")',
    '    con.execute("COPY (SELECT * FROM read_csv(\'%s\', header=true, quote=\'\\"\', escape=\'\\"\', columns=%s)) TO \'%s\' (FORMAT parquet, COMPRESSION zstd)" % (src, spec, dst))',
  ].join('\n');
  const version = execFileSync('python', ['-P', '-c', py, dir, JSON.stringify(columns), JSON.stringify(slugs)], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trim();
  return `duckdb ${version} (Python), zstd, one thread`;
}

// ------------------------------------------------------------------ main

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const outDir = path.resolve(REPO, opt('--out-dir', 'site/apps/elections/extracts') || '');
  if (args.includes('--check')) {
    const strict = args.includes('--strict');
    const skip = (/** @type {string} */ why) => {
      console[strict ? 'error' : 'log'](`${strict ? 'FAIL' : 'SKIP'}: ${why}`);
      process.exit(strict ? 1 : 0);
    };
    if (!existsSync(DB_FILE)) skip(`no records build at ${posix(path.relative(REPO, DB_FILE))} to check the extracts against`);
    if (!existsSync(path.join(outDir, 'manifest.json'))) skip(`no extracts in ${posix(path.relative(REPO, outDir))} (npm run build:elections-app)`);
    const { problems, checked } = checkExtracts(openSqliteHandle(DB_FILE, { readOnly: true }), outDir);
    if (problems.length) {
      console.error(`FAIL: Elections app extracts (${problems.length} problem(s)):\n- ${problems.slice(0, 40).join('\n- ')}`);
      process.exit(1);
    }
    console.log(`PASS: Elections app extracts current against the records build (${checked} bodies), publishable columns only, no private values`);
    process.exit(0);
  }
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
    const index = extracts(db, outDir, { parquet: !args.includes('--no-parquet'), bodies: many('--body') });
    console.log(`extracts: ${index.length} bodies, ${index.reduce((s, x) => s + x.rows, 0)} rows -> ${posix(path.relative(REPO, outDir))} (manifest.json: every file's bytes and SHA-256)`);
  } else {
    console.error('usage: data.mjs --audit | --extracts [--out-dir DIR] [--no-parquet] [--body SLUG] | --check [--out-dir DIR] [--strict]');
    process.exit(2);
  }
}

export { audit, auditMarkdown, checkExtracts, extractRows, extracts };
