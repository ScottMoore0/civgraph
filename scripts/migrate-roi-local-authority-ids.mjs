#!/usr/bin/env node
/**
 * One-off migration: `roi-local-authorities-*` -> `local-authorities-*`.
 *
 * WHY THE PREFIX IS WRONG
 *
 * The family spans 1915 to 2024 and the jurisdiction changes underneath it. Four of the
 * 26 layers cover the WHOLE ISLAND -- 1915 and the three 1920 dates, all before
 * partition -- and the rest cover the 26 counties. None of them covers a republic before
 * 1949. So `roi-` is wrong for four outright, anachronistic for a dozen more, and
 * accurate only for the recent ones.
 *
 * The fix is not a better jurisdiction prefix. It is not having one: an id is a stable
 * identifier, the display name already carries the scope ("(Ireland — all-island)",
 * "(26 counties)"), and encoding a jurisdiction that changes over the life of the series
 * is precisely what went wrong. `local-authorities-<date>` is unambiguous -- checked
 * against every existing id, no collisions.
 *
 * OLD URLS KEEP WORKING. The id appears in `#layers=` share links, so the app carries an
 * alias map rather than breaking them. See ID_ALIASES in app/src/app.js.
 *
 *   node scripts/migrate-roi-local-authority-ids.mjs --dry-run
 *   node scripts/migrate-roi-local-authority-ids.mjs --write
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, statSync } from 'node:fs';

const WRITE = process.argv.includes('--write');
if (!WRITE && !process.argv.includes('--dry-run')) {
  console.error('Pass --dry-run or --write.');
  process.exit(2);
}

const OLD = 'roi-local-authorities-';
const NEW = 'local-authorities-';
const BINARY = /\.(png|jpg|jpeg|webp|gif|ico|pdf|fgb|pmtiles|mbtiles|zip|gz|br|woff2?|ttf|eot|svg|db|sqlite)$/i;

const files = execFileSync('git', ['ls-files'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  .split('\n').map((f) => f.trim()).filter(Boolean)
  .filter((f) => !BINARY.test(f))
  // Historical record; see migrate-test-to-render.mjs for the same reasoning.
  .filter((f) => !f.startsWith('tasks/'))
  // Registry URLs carry package names as path segments. Rewriting them 404s every CI
  // job, which is not a hypothetical -- it happened on 2026-08-22.
  .filter((f) => f !== 'package-lock.json');

let total = 0;
const touched = [];

for (const file of files) {
  try { if (statSync(file).size > 200 * 1024 * 1024) continue; } catch { continue; }
  let text;
  try { text = readFileSync(file, 'utf8'); } catch { continue; }
  if (!text.includes(OLD)) continue;
  const hits = text.split(OLD).length - 1;
  const next = text.split(OLD).join(NEW);
  total += hits;
  touched.push([file, hits]);
  if (WRITE) writeFileSync(file, next);
}

for (const [file, hits] of touched.sort((a, b) => b[1] - a[1]).slice(0, 20)) {
  console.log(`  ${String(hits).padStart(5)}  ${file}`);
}
if (touched.length > 20) console.log(`  ... and ${touched.length - 20} more file(s)`);
console.log(`\n${WRITE ? 'Rewrote' : 'Would rewrite'} ${total} reference(s) across ${touched.length} file(s).`);
