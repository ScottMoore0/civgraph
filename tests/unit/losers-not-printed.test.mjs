/**
 * A contest file's `losersNotPrinted: true` says the source printed only the members elected
 * (scripts/build/build-test2-election-manifest.mjs carries it into the contest's record; the
 * Elections app's site/apps/elections/lib/limits.js notes it). It holds only while the file has
 * no more candidates than seats: once defeated candidates are found and entered, the flag is
 * stale and must go (16 such flags were cleared on 27 Nov 2026, owner-approved).
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ELECTIONS = fileURLToPath(new URL('../../data/elections-source/data/elections/', import.meta.url));

/** @param {string} dir @returns {string[]} every .json file under dir */
function jsonFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return jsonFiles(p);
    return e.name.endsWith('.json') ? [p] : [];
  });
}

test('losersNotPrinted stands only on contests with as many candidates as seats', () => {
  const stale = [];
  let flagged = 0;
  for (const file of jsonFiles(ELECTIONS)) {
    const text = readFileSync(file, 'utf8');
    if (!text.includes('"losersNotPrinted"')) continue;
    const doc = JSON.parse(text);
    if (doc.losersNotPrinted !== true) continue;
    flagged += 1;
    const seats = Number(doc.Constituency?.countInfo?.Number_Of_Seats);
    const rows = Array.isArray(doc.Constituency?.countGroup) ? doc.Constituency.countGroup : [];
    const candidates = new Set(rows.map((/** @type {{ id?: unknown, candidateName?: string }} */ r) => String(r.id ?? r.candidateName))).size;
    if (candidates !== seats) stale.push(`${path.relative(ELECTIONS, file)}: ${candidates} candidates, ${seats} seats`);
  }
  assert.ok(flagged > 0, 'no contest file carries losersNotPrinted: the walk found nothing to test');
  assert.deepEqual(stale, [], 'losersNotPrinted on a contest whose candidates differ from its seats (remove the flag once the defeated are entered)');
});
