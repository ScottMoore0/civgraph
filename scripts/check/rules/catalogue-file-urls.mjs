#!/usr/bin/env node
/**
 * Every `files.*` value in the catalogue must be an absolute URL.
 *
 * WHY
 *
 * 78 values across 15 map records stored a repo-relative path -- `data/maps/physical/
 * ROI_Settlements_2011.fgb` -- where the other 1,900-odd stored a full
 * https://data.civgraph.net/... URL. Anything treating the field as a URL breaks on
 * those, and the breakage is shaped like a 404 on a download button rather than
 * anything that looks like a data problem.
 *
 * Found on 2026-08-22 by verify:source-cache, which could not parse them as URLs and
 * reported eight of them as unreachable. It saw only eight because the other seven had
 * no local source to compare against -- a good illustration of a check surfacing a
 * fraction of a defect and the fraction being mistaken for the whole.
 *
 * Offline, and cheap: it is a string shape, not a fetch. Whether the URL RESOLVES is
 * verify:source-cache's job.
 */
import { readFileSync } from 'node:fs';

const SRC = 'data/database/maps.json';
const doc = JSON.parse(readFileSync(SRC, 'utf8'));

const problems = [];
let checked = 0;

for (const map of doc.maps || []) {
  const files = map.files;
  if (!files || typeof files !== 'object') continue;
  for (const [key, value] of Object.entries(files)) {
    if (typeof value !== 'string' || !value) continue;
    checked += 1;
    // A site-root path is fine: it resolves against whatever origin serves the page.
    if (value.startsWith('/')) continue;
    if (/^https?:\/\//i.test(value)) continue;
    problems.push(`${map.id}.files.${key} = ${value}`);
  }
}

if (problems.length) {
  console.error(`FAIL: ${problems.length} catalogue file reference(s) are neither absolute URLs nor site-root paths:`);
  for (const p of problems.slice(0, 20)) console.error(`  - ${p}`);
  if (problems.length > 20) console.error(`  ... and ${problems.length - 20} more`);
  console.error('');
  console.error('  These are consumed as URLs. A bare relative path resolves against whatever');
  console.error('  page happens to reference it, which is a 404 on a download button and looks');
  console.error('  nothing like a catalogue problem.');
  process.exit(1);
}

console.log(`PASS: all ${checked} catalogue file reference(s) are absolute.`);
