#!/usr/bin/env node
// @ts-check
/**
 * Read-only report of an NI councils staging folder against the round-status machine and its
 * apply gate (lib/statuses.mjs ROUND_STATUS, catalogue IN-03):
 *
 *   node scripts/intake/checks/ni-council-rounds.mjs <phase-b folder> [--json]
 *
 * It reads work/<slug>/<round>.json (status; absent means done, as tools/build.py reads it) and
 * apply-exclude.json ({rounds: [{slug, folder, reason}]}), and reports:
 *   - would-apply-wrongly: a held or no-election round NOT in apply-exclude.json, which apply.py
 *     --write would copy (exit 1);
 *   - unknown-status: a status outside the machine (exit 1);
 *   - excluded-by-choice: a done or partial round held back, with the list's reason (information:
 *     a citation to confirm or an unknown poll day is a valid reason; anything else is list drift);
 *   - counts by status, and how many statuses are implied.
 * It never writes: the staging folder belongs to its batch.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { roundGate, roundStatusOf } from '../lib/statuses.mjs';

/**
 * @param {string} phaseB
 */
export function reportRounds(phaseB) {
  const workDir = path.join(phaseB, 'work');
  if (!existsSync(workDir)) throw new Error(`no work/ folder in ${phaseB}`);
  const excludeFile = path.join(phaseB, 'apply-exclude.json');
  /** @type {Map<string, string>} */
  const excluded = new Map();
  if (existsSync(excludeFile)) {
    for (const r of JSON.parse(readFileSync(excludeFile, 'utf8')).rounds || []) excluded.set(`${r.slug}/${r.folder}`, r.reason || '');
  }
  /** @type {Record<string, number>} */
  const counts = {};
  let implied = 0;
  /** @type {Record<string, { round: string, status: string, reason?: string | undefined }[]>} */
  const byVerdict = { apply: [], 'held-back': [], 'excluded-by-choice': [], 'would-apply-wrongly': [], 'unknown-status': [] };
  for (const slug of readdirSync(workDir).sort()) {
    const dir = path.join(workDir, slug);
    if (!statSync(dir).isDirectory()) continue;
    for (const name of readdirSync(dir).sort()) {
      if (!name.endsWith('.json')) continue;
      const round = `${slug}/${name.slice(0, -5)}`;
      const record = JSON.parse(readFileSync(path.join(dir, name), 'utf8'));
      const { status, implied: isImplied } = roundStatusOf(record);
      if (isImplied) implied += 1;
      counts[status] = (counts[status] || 0) + 1;
      const { verdict } = roundGate(status, excluded.has(round));
      byVerdict[verdict].push({ round, status, ...(excluded.has(round) ? { reason: excluded.get(round) } : {}) });
    }
  }
  const seen = new Set(Object.values(byVerdict).flat().map((r) => r.round));
  const staleExclusions = [...excluded.keys()].filter((k) => !seen.has(k)).sort();
  return { counts, implied, byVerdict, staleExclusions };
}

function main() {
  const args = process.argv.slice(2);
  const dir = args.find((a) => !a.startsWith('--'));
  if (!dir) { console.error('Usage: node scripts/intake/checks/ni-council-rounds.mjs <phase-b folder> [--json]'); return 2; }
  const r = reportRounds(path.resolve(dir));
  if (args.includes('--json')) { console.log(JSON.stringify(r, null, 2)); }
  else {
    console.log(`Rounds by status: ${Object.entries(r.counts).map(([k, v]) => `${k} ${v}`).join(', ')} (${r.implied} with no status, read as done)`);
    console.log(`apply ${r.byVerdict.apply.length}, held back ${r.byVerdict['held-back'].length}, excluded by choice ${r.byVerdict['excluded-by-choice'].length}`);
    for (const x of r.byVerdict['excluded-by-choice']) console.log(`  excluded although ${x.status}: ${x.round} (${x.reason || 'no reason given'})`);
    for (const x of r.byVerdict['would-apply-wrongly']) console.log(`  ERROR ${x.status} but not excluded, apply.py --write would copy it: ${x.round}`);
    for (const x of r.byVerdict['unknown-status']) console.log(`  ERROR unknown status "${x.status}": ${x.round}`);
    for (const k of r.staleExclusions) console.log(`  note: apply-exclude.json names ${k}, which has no work record`);
  }
  return r.byVerdict['would-apply-wrongly'].length || r.byVerdict['unknown-status'].length ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main();
