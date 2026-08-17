#!/usr/bin/env node
/**
 * Every book the catalogue offers a file for must have that file.
 *
 * WHY THIS IS A CHECK AND NOT A CLEANUP
 *
 * UX audit item T0-04b: "5 of 6 sampled book PDFs return text/html (the
 * homepage)". Measured again on 2026-08-17, sixteen days later, all five were
 * still advertised:
 *
 *   dea-prov-1992, dublin-reorganisation-1992, lgb-revised-1992,
 *   dea-final-1992, harrison-1984
 *
 * The status codes had improved -- they 404 honestly now rather than serving the
 * homepage at 200, a side effect of the 404 page landing -- but the catalogue was
 * still offering a download for each. Two of the five are also in `.cfignore`,
 * so they were deliberately undeployed AND still advertised, which is the worst
 * of both.
 *
 * check:asset-refs passes with "every referenced asset exists" and does not read
 * books.json. That is why this survived: the check whose name covers the problem
 * never looked at the file. Deleting five entries would have fixed today and left
 * the sixth to be discovered by a reader clicking a dead link.
 *
 * TOLERATES DELIBERATE ABSENCE, LOUDLY
 *
 * A book may legitimately have no file -- 49 of 67 entries have no `file` field at
 * all, and those are records rather than downloads. What is not legitimate is a
 * `file` pointing at nothing. If a PDF is intentionally withheld, remove the
 * field or set `fileWithheld` with a reason; do not leave a path that 404s.
 */
import { readFileSync, existsSync } from 'node:fs';

const CATALOGUE = 'data/database/books.json';

const raw = JSON.parse(readFileSync(CATALOGUE, 'utf8'));
const books = Array.isArray(raw) ? raw : (raw.books || []);

const missing = [];
const withheld = [];
let offered = 0;
let noFile = 0;

for (const book of books) {
  // fileWithheld FIRST. Withholding is done by removing `file` and recording the
  // reason, so testing for `file` before `fileWithheld` made the withheld branch
  // unreachable -- the five entries withheld on 2026-08-17 were counted as
  // "offers no download" and the reasons never printed. The check still passed,
  // which is how a dead branch survives.
  if (book.fileWithheld) {
    withheld.push(`${book.id} — ${book.fileWithheld}`);
    continue;
  }

  const file = book.file || book.pdf;
  if (!file) { noFile += 1; continue; }

  offered += 1;
  if (!existsSync(file)) missing.push(`${book.id} -> ${file}`);
}

if (missing.length) {
  console.error(`FAIL: ${missing.length} book(s) offer a file that does not exist:`);
  for (const m of missing) console.error(`  - ${m}`);
  console.error('');
  console.error('  Each of these renders a download the reader cannot have. Either add the');
  console.error('  file, remove the `file` field, or set `fileWithheld` to a reason.');
  console.error(`  See ${CATALOGUE} and UX-REMEDIATION-PLAN.md item T0-04b.`);
  process.exit(1);
}

console.log(`PASS: all ${offered} offered book file(s) exist `
  + `(${noFile} entries offer no download; ${withheld.length} withheld).`);
for (const w of withheld) console.log(`  ${w}`);
