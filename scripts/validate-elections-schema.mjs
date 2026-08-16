#!/usr/bin/env node
/**
 * Keep data/database/elections-schema.sql honest about the live D1 database.
 *
 * WHY
 *
 * civgraph-elections holds 40.3 MB of election data, and until 2026-08-16 its
 * structure existed nowhere in the repository -- docs/cloudflare-inventory.md
 * recorded it as *inferred from the queries in functions/_api/elections/index.js*.
 * If the database were lost, its shape would have had to be reverse-engineered
 * from four SQL queries before anything could be restored. Top-scored item in
 * docs/review/TECH-DEBT-AUDIT.md.
 *
 * A tracked schema only helps if it is still true, and a dumped file rots the
 * moment someone runs an ALTER against production. Hence this.
 *
 * NETWORK-DEPENDENT, so it is NOT in `npm run check`, which is offline by
 * design. It sits with verify:proxies and verify:map-tokens under `npm run
 * verify`. That is a real limitation: nothing runs it automatically, so a drift
 * is caught when someone looks. Better than the previous state, which was that
 * there was nothing to look at.
 *
 * Usage:
 *   node scripts/validate-elections-schema.mjs            # compare with live D1
 *   node scripts/validate-elections-schema.mjs --write    # regenerate the file
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const SCHEMA = 'data/database/elections-schema.sql';
const DATABASE = 'civgraph-elections';
const WRITE = process.argv.includes('--write');

// Same Windows accommodations as scripts/apply-contributions.mjs: a bare `npx`
// does not resolve (PATHEXT), and Node 20+ refuses to spawn a .cmd directly
// (CVE-2024-27980), so it has to go through a shell. Every argument here is a
// literal in this file.
const IS_WINDOWS = process.platform === 'win32';

function liveObjects() {
  const sql = "SELECT type, name, sql FROM sqlite_master WHERE sql IS NOT NULL "
    + "ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END, name";

  // --command, QUOTED FOR THE SHELL. Two dead ends are recorded here because
  // both look like the obvious fix:
  //
  //   unquoted --command   wrangler runs through a shell on Windows (npx is a
  //                        .cmd and Node 20+ will not spawn one directly), so a
  //                        SQL string containing spaces is word-split before it
  //                        arrives: `Unknown arguments: type,, name,, sql, ...`
  //   --file <path>        avoids quoting entirely, and is what the KV write in
  //                        apply-contributions.mjs uses -- but for d1 execute it
  //                        returns EXECUTION STATS ("Rows written", "Database
  //                        size (MB)") instead of the rows a SELECT produced.
  //
  // So the query has to go on the command line, quoted. The SQL below contains
  // single quotes and no double quotes, which is what makes this safe; keep it
  // that way if you edit it.
  const command = IS_WINDOWS ? `"${sql}"` : sql;
  const raw = execFileSync(IS_WINDOWS ? 'npx.cmd' : 'npx',
    ['wrangler', 'd1', 'execute', DATABASE, '--remote', '--json', '--command', command],
    { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, shell: IS_WINDOWS });
  // wrangler prints progress ("Checking if file needs uploading") and ANSI colour
  // codes to stdout alongside the --json payload, so the response cannot be
  // parsed from the first '[' -- that one is inside the chatter. Strip the escape
  // codes, then take from the first line that BEGINS a JSON array.
  const clean = raw.replace(/^﻿/, '').replace(/\[[0-9;]*m/g, '');
  const start = clean.search(/^\[/m);
  if (start < 0) throw new Error(`no JSON array in wrangler output:\n${clean.slice(0, 400)}`);
  const parsed = JSON.parse(clean.slice(start));
  const rows = (parsed[0] || {}).results || [];
  // Cloudflare-internal and SQLite-internal objects are not ours and change
  // without us.
  return rows.filter((r) => !r.name.startsWith('_cf_') && !r.name.startsWith('sqlite_'));
}

/** Compare on normalised SQL, so whitespace and formatting are not differences. */
function normalise(sql) {
  return String(sql).trim().replace(/\s+/g, ' ').replace(/;$/, '');
}

/**
 * Statements are stored with their ORIGINAL formatting and separated by ";\n\n".
 *
 * Both halves of that matter, and the first attempt got both wrong. Collapsing
 * each statement onto one line turns an inline `-- comment` into one that
 * swallows everything after it -- the `counts` table has exactly that, a trailing
 * `-- countGroup row ordinal; preserved rather than re-derived`. And splitting
 * the file on ";" alone splits inside that same comment, because it contains a
 * semicolon. The result was a file that could not round-trip through its own
 * validator.
 */
const SEPARATOR = ';\n\n';

function statementsFrom(file) {
  const text = readFileSync(file, 'utf8');
  // The header is a comment block; the schema starts at the first CREATE.
  const start = text.search(/^CREATE /m);
  if (start < 0) return [];
  return text.slice(start).split(SEPARATOR).map(normalise).filter(Boolean);
}

function renderSchema(objects, previousHeader) {
  const tables = objects.filter((r) => r.type === 'table').length;
  const indexes = objects.filter((r) => r.type === 'index').length;
  const header = previousHeader.replace(/-- Tables: \d+ {3}Indexes: \d+/, `-- Tables: ${tables}   Indexes: ${indexes}`);
  return `${header}\n${objects.map((r) => String(r.sql).trim()).join(SEPARATOR)};\n`;
}

const live = liveObjects();

if (WRITE) {
  const existing = existsSync(SCHEMA) ? readFileSync(SCHEMA, 'utf8') : '';
  const headerEnd = existing.search(/^CREATE /m);
  const header = headerEnd > 0 ? existing.slice(0, headerEnd).trimEnd() : '-- Tables: 0   Indexes: 0';
  writeFileSync(SCHEMA, renderSchema(live, header));
  console.log(`Wrote ${SCHEMA}: ${live.filter((r) => r.type === 'table').length} table(s), `
    + `${live.filter((r) => r.type === 'index').length} index(es).`);
  process.exit(0);
}

if (!existsSync(SCHEMA)) {
  console.error(`FAIL: ${SCHEMA} does not exist. Create it with --write.`);
  process.exit(1);
}

const recorded = new Set(statementsFrom(SCHEMA));
const actual = new Set(live.map((r) => normalise(r.sql)));

const missing = [...actual].filter((s) => !recorded.has(s));   // live but unrecorded
const extra = [...recorded].filter((s) => !actual.has(s));     // recorded but gone

if (missing.length || extra.length) {
  console.error('FAIL: the live elections database does not match the recorded schema.');
  for (const s of missing) console.error(`  + live, not in the file : ${s.slice(0, 110)}`);
  for (const s of extra) console.error(`  - in the file, not live : ${s.slice(0, 110)}`);
  console.error('');
  console.error('  If the database changed on purpose, re-record it:');
  console.error('    node scripts/validate-elections-schema.mjs --write');
  console.error('  If it did not, something altered production without going through the repo.');
  process.exit(1);
}

console.log(`PASS: elections D1 matches ${SCHEMA} (${live.length} objects).`);
