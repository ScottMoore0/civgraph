#!/usr/bin/env node
/**
 * Generate data/browse/proni-roots.json from the PRONI D1 database.
 *
 * Runs as the first step of `npm run build:browse`, NOT of `npm run build`. It reads D1,
 * and `npm run build` is what Cloudflare Pages executes on a clean checkout with no
 * database access -- putting a network-dependent step there fails the deploy, which is
 * exactly how build-site-stats.mjs broke production earlier this month.
 *
 * WHY THIS EXISTS
 *
 * Tech-debt item 7. The file is 1.4 MB of top-level PRONI records, fetched by
 * browse/browse.js with a silent `.catch(() => null)`, and nothing in scripts/
 * produced it. If it were lost, a Browse section would empty with no error and no
 * way to rebuild it -- the only thing standing between the site and that was a
 * `.gitignore` negation and a comment.
 *
 * It turns out to be entirely derivable. The 9,404 entries are exactly the rows
 * the catalogue calls "top-level": `parent = ''`, which is the same predicate
 * functions/_api/proni/_query.js already uses for letter-browse. So this is not a
 * new source of truth, it is a projection of one that was being maintained by
 * hand.
 *
 * PAGINATED, because 9,404 rows in one D1 response is asking for a truncation
 * nobody notices. Pages of 1,000 by key (ref > the last ref, through the proni_parent
 * (parent, ref) index), so each statement reads its own 1,000 rows and no more, never an
 * OFFSET that re-reads every earlier page; at most MAX_PAGES statements, 1 s apart.
 *
 * Usage:
 *   node scripts/build-proni-roots.mjs                    # regenerate (reads remote D1)
 *   node scripts/build-proni-roots.mjs --check            # offline: the committed file is whole
 *   node scripts/build-proni-roots.mjs --check --remote   # opt-in: and it matches remote D1
 *                                                         # (npm run verify:proni-roots)
 *
 * `--check` alone is in `npm run check` and reads no database: it checks the committed file's
 * shape (count equals its rows, every ref unique and in ref order, every row's fields). The
 * comparison with the live catalogue is `verify:proni-roots`, in the opt-in `npm run verify`.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const OUT = 'data/browse/proni-roots.json';
const DATABASE = 'proni-catalogue';
const PAGE = 1000;
const CHECK = process.argv.includes('--check');
const REMOTE = process.argv.includes('--remote');
// 9,404 roots today: twenty pages leave room to double before the check says so.
const MAX_PAGES = 20;

// Same Windows accommodation as validate-elections-schema.mjs: wrangler goes
// through a shell, so a --command containing spaces must arrive quoted. The SQL
// below uses single quotes only, which is what makes that safe.
const IS_WINDOWS = process.platform === 'win32';

function query(sql) {
  const command = IS_WINDOWS ? `"${sql}"` : sql;
  const raw = execFileSync(IS_WINDOWS ? 'npx.cmd' : 'npx',
    ['wrangler', 'd1', 'execute', DATABASE, '--remote', '--json', '--command', command],
    { encoding: 'utf8', maxBuffer: 128 * 1024 * 1024, shell: IS_WINDOWS });
  const clean = raw.replace(/^﻿/, '').replace(/\[[0-9;]*m/g, '');
  const start = clean.search(/^\[/m);
  if (start < 0) throw new Error(`no JSON in wrangler output:\n${clean.slice(0, 400)}`);
  return (JSON.parse(clean.slice(start))[0] || {}).results || [];
}

async function fetchRoots() {
  const roots = [];
  for (let pageNo = 0; ; pageNo += 1) {
    if (pageNo >= MAX_PAGES) throw new Error(`more than ${MAX_PAGES * PAGE} top-level records: raise MAX_PAGES`);
    if (pageNo) await sleep(1000);
    const after = roots.length ? roots[roots.length - 1].ref : '';
    if (/'/.test(after)) throw new Error(`a ref with a quote: ${after}`);
    const page = query(
      "SELECT ref, slug, title, level, dates, has_children AS hasChildren "
      + `FROM proni WHERE parent = '' AND ref > '${after}' ORDER BY ref `
      + `LIMIT ${PAGE}`,
    );
    for (const row of page) {
      roots.push({
        ref: row.ref,
        slug: row.slug,
        title: row.title,
        level: row.level || '',
        dates: row.dates || '',
        hasChildren: Boolean(row.hasChildren),
      });
    }
    if (page.length < PAGE) break;
  }
  return roots;
}

/** The committed file's own consistency: what `npm run check` can know without a database. */
function checkFile() {
  if (!existsSync(OUT)) {
    console.error(`FAIL: ${OUT} does not exist. Generate it with: node scripts/build-proni-roots.mjs`);
    process.exit(1);
  }
  const doc = JSON.parse(readFileSync(OUT, 'utf8'));
  const roots = Array.isArray(doc.roots) ? doc.roots : null;
  const problems = [];
  if (!roots) problems.push('no roots array');
  else {
    if (doc.count !== roots.length) problems.push(`count ${doc.count} but ${roots.length} roots`);
    if (!roots.length) problems.push('no roots');
    const seen = new Set();
    roots.forEach((r, i) => {
      const where = `roots[${i}] (${r?.ref})`;
      if (!r || typeof r.ref !== 'string' || !r.ref) { problems.push(`${where}: no ref`); return; }
      if (seen.has(r.ref)) problems.push(`${where}: ref repeated`);
      seen.add(r.ref);
      // D1 orders by ref in byte order (BINARY), as Buffer.compare does.
      if (i && Buffer.compare(Buffer.from(roots[i - 1].ref), Buffer.from(r.ref)) >= 0) problems.push(`${where}: not in ref order`);
      for (const k of ['slug', 'title', 'level', 'dates']) if (typeof r[k] !== 'string') problems.push(`${where}: ${k} is not a string`);
      if (typeof r.hasChildren !== 'boolean') problems.push(`${where}: hasChildren is not a boolean`);
    });
  }
  if (problems.length) {
    console.error(`FAIL: ${OUT}:\n  ${problems.slice(0, 10).join('\n  ')}`);
    process.exit(1);
  }
  console.log(`PASS: ${OUT} is whole (${roots.length} top-level records; compare with D1: npm run verify:proni-roots).`);
}

if (CHECK && !REMOTE) {
  checkFile();
  process.exit(0);
}

// A check that cannot reach D1 has nothing to compare against, so it skips rather than
// fails, the same as check:r2-parity without credentials. Regenerating is different:
// without D1 there is no file to write, so that still fails loudly.
let roots;
try {
  roots = await fetchRoots();
} catch (error) {
  if (!CHECK) throw error;
  const detail = String(error?.stdout || error?.message || error)
    .match(/"text":\s*"([^"]+)"/)?.[1] || String(error?.message || error).split('\n')[0];
  console.log(`SKIP: could not query ${DATABASE} (${detail.slice(0, 200)}).`);
  console.log('  This check compares data/browse/proni-roots.json with live D1 and needs Cloudflare credentials.');
  process.exit(0);
}
const doc = { roots, count: roots.length };

if (CHECK) {
  if (!existsSync(OUT)) {
    console.error(`FAIL: ${OUT} does not exist. Generate it with: node scripts/build-proni-roots.mjs`);
    process.exit(1);
  }
  const existing = JSON.parse(readFileSync(OUT, 'utf8'));
  const before = (existing.roots || []).length;
  if (before !== roots.length) {
    console.error(`FAIL: ${OUT} records ${before} roots; D1 has ${roots.length}.`);
    console.error('  Regenerate with: node scripts/build-proni-roots.mjs');
    process.exit(1);
  }
  // Compare on refs rather than deep-equality: the ordering and the exact field
  // set are this script's business, and a whitespace change in a title should not
  // read as a structural drift.
  const a = new Set((existing.roots || []).map((r) => r.ref));
  const missing = roots.filter((r) => !a.has(r.ref)).slice(0, 5);
  if (missing.length) {
    console.error(`FAIL: ${OUT} is missing refs present in D1, e.g. ${missing.map((r) => r.ref).join(', ')}`);
    process.exit(1);
  }
  console.log(`PASS: ${OUT} matches D1 (${roots.length} top-level records).`);
  process.exit(0);
}

writeFileSync(OUT, `${JSON.stringify(doc)}\n`);
console.log(`Wrote ${OUT}: ${roots.length} top-level PRONI records.`);
