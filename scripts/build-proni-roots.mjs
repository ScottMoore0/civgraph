#!/usr/bin/env node
/**
 * Generate data/browse/proni-roots.json from the PRONI D1 database.
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
 * nobody notices. Pages of 1,000 with an explicit total check at the end.
 *
 * Usage:
 *   node scripts/build-proni-roots.mjs            # regenerate
 *   node scripts/build-proni-roots.mjs --check    # fail if the file is stale
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const OUT = 'data/browse/proni-roots.json';
const DATABASE = 'proni-catalogue';
const PAGE = 1000;
const CHECK = process.argv.includes('--check');

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

function fetchRoots() {
  const roots = [];
  for (let offset = 0; ; offset += PAGE) {
    const page = query(
      "SELECT ref, slug, title, level, dates, has_children AS hasChildren "
      + "FROM proni WHERE parent = '' ORDER BY ref "
      + `LIMIT ${PAGE} OFFSET ${offset}`,
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

const roots = fetchRoots();
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
