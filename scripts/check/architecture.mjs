#!/usr/bin/env node
/**
 * check:architecture: the mechanical half of docs/ARCHITECTURE-RULES.md, in one runner with one
 * baseline and one escape hatch.
 *
 *   node scripts/check/architecture.mjs                    report (and enforce from the date below)
 *   node scripts/check/architecture.mjs --all              C6 reads every line, not just the diff
 *   node scripts/check/architecture.mjs --verbose          every finding, not the first 15 per check
 *   node scripts/check/architecture.mjs --only C4,C7       just these checks
 *   node scripts/check/architecture.mjs --write-baseline   prune the baseline to what still occurs
 *   node scripts/check/architecture.mjs --init-baseline    take today's findings as the baseline (once)
 *   node scripts/check/architecture.mjs --enforce|--report force either mode
 *
 * REPORT-ONLY UNTIL config/architecture.json `enforceFrom`. Before that date the runner prints
 * its report and exits 0 whatever it finds, so the checks can be tuned for a week without
 * blocking anyone. From that date (or with --enforce) it fails on:
 *   - a finding beyond the baseline (a file with more findings of a check than the baseline allows);
 *   - a stale baseline entry (a file now under its count: run --write-baseline to shrink it);
 *   - a malformed escape hatch (`arch-ok` without `R<n>: reason`).
 *
 * THE BASELINE, config/architecture-baseline.json, holds today's debt as a count per check per
 * file. It may only shrink: tests/unit/architecture-baseline.test.mjs fails when a count grows
 * or an entry appears compared with main. Checks with no baseline (C1, C2, C6, C13) must be clean.
 *
 * THE ESCAPE HATCH is a comment on the finding's line or the line above it:
 *   // arch-ok R6: month names are the formatter's own table
 * It excuses that finding of that rule only. Every marker is counted and listed in the report.
 *
 * Every step is offline and reads only tracked files. A full run takes a few seconds; the report
 * is also written to tmp/architecture-report.json.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { C1, C2 } from './architecture/boundary-checks.mjs';
import { C13 } from './architecture/charter.mjs';
import { C3 } from './architecture/copies.mjs';
import { C9 } from './architecture/contracts.mjs';
import { changedSince, createContext, excusedBy, markerOn } from './architecture/lib.mjs';
import { C7 } from './architecture/lifecycle.mjs';
import { C10, C5, C8 } from './architecture/literals.mjs';
import { C12, C6 } from './architecture/state.mjs';
import { C11 } from './architecture/types.mjs';
import { C4 } from './architecture/vocabulary.mjs';

/** @typedef {import('./architecture/lib.mjs').Finding} Finding @typedef {import('./architecture/lib.mjs').Context} Context */
/** @typedef {{ id: string, rule: string, title: string, diffScoped?: boolean, run: (ctx: Context) => Finding[] | Promise<Finding[]> }} Check */
/** @typedef {Record<string, Record<string, number>>} Baseline */
/** @typedef {{ check: Check, findings: Array<Finding & { excused?: { line: number, reason: string } | null }>, notes: string[], skipped?: string }} Result */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const CONFIG_PATH = 'config/architecture.json';
export const BASELINE_PATH = 'config/architecture-baseline.json';

/** @type {readonly Check[]} */
export const CHECKS = Object.freeze([C1, C2, C3, C4, C5, C6, C7, C8, C9, C10, C11, C12, C13]);

/**
 * Run the checks; mark each finding excused when an arch-ok marker of its rule covers it.
 * @param {Context} ctx
 * @param {readonly Check[]} checks
 * @returns {Promise<Result[]>}
 */
export async function runChecks(ctx, checks = CHECKS) {
  /** @type {Result[]} */
  const results = [];
  for (const check of checks) {
    if (check.diffScoped && ctx.changedLines === null && !ctx.options.all) {
      results.push({ check, findings: [], notes: [], skipped: 'no base branch to diff against (pass --all to read every line)' });
      continue;
    }
    const found = await check.run(ctx);
    const notes = /** @type {Finding[] & { notes?: string[] }} */ (found).notes || [];
    const findings = found.map((f) => ({ ...f, excused: f.line > 0 ? excusedBy(ctx.lines(f.file), f.line, check.rule) : null }));
    results.push({ check, findings, notes });
  }
  return results;
}

/**
 * The counted (not excused) findings of a result, per file.
 * @param {Result} result
 */
export function countsOf(result) {
  /** @type {Record<string, number>} */
  const counts = {};
  for (const f of result.findings) if (!f.excused) counts[f.file] = (counts[f.file] || 0) + 1;
  return counts;
}

/**
 * Compare results with the baseline: per check, what is new (beyond the baseline) and what is stale.
 * @param {Result[]} results
 * @param {Baseline} baseline
 * @param {readonly string[]} noBaseline  checks that must be clean
 */
export function compare(results, baseline, noBaseline) {
  return results.map((result) => {
    const id = result.check.id;
    const counts = countsOf(result);
    const allowed = noBaseline.includes(id) ? {} : (baseline[id] || {});
    /** @type {Array<{ file: string, count: number, allowed: number }>} */
    const over = [];
    /** @type {Array<{ file: string, count: number, allowed: number }>} */
    const stale = [];
    for (const [file, count] of Object.entries(counts)) if (count > (allowed[file] || 0)) over.push({ file, count, allowed: allowed[file] || 0 });
    if (!result.skipped) for (const [file, n] of Object.entries(allowed)) if ((counts[file] || 0) < n) stale.push({ file, count: counts[file] || 0, allowed: n });
    const newCount = over.reduce((s, o) => s + o.count - o.allowed, 0);
    const excused = result.findings.filter((f) => f.excused).length;
    const baselined = Object.values(allowed).reduce((s, n) => s + n, 0);
    return { id, rule: result.check.rule, title: result.check.title, found: result.findings.length, excused, baselined, newCount, over, stale, skipped: result.skipped };
  });
}

/**
 * Every arch-ok marker in the files the checks read (the checker's own files left out).
 * @param {Context} ctx
 * @param {readonly string[]} exclude  path prefixes
 */
export function markers(ctx, exclude) {
  const valid = [];
  const malformed = [];
  for (const file of ctx.readFiles()) {
    if (exclude.some((p) => file.startsWith(p)) || file.endsWith('.md')) continue;
    const lines = ctx.lines(file);
    for (let i = 0; i < lines.length; i++) {
      const m = markerOn(lines[i]);
      if (!m) continue;
      if ('malformed' in m) malformed.push({ file, line: i + 1, text: lines[i].trim().slice(0, 120) });
      else valid.push({ file, line: i + 1, rule: m.rule, reason: m.reason.slice(0, 120) });
    }
  }
  return { valid, malformed };
}

/**
 * Where a baseline grew against an older one (a new entry or a higher count): the shrink rule.
 * @param {Baseline} older
 * @param {Baseline} newer
 */
export function baselineGrowth(older, newer) {
  const out = [];
  for (const [id, files] of Object.entries(newer)) {
    if (id === '//') continue;
    for (const [file, n] of Object.entries(files)) {
      const was = older[id]?.[file] ?? 0;
      if (n > was) out.push(`${id} ${file}: ${was} -> ${n}`);
    }
  }
  return out;
}

/**
 * The baseline to write: today's counts, never above the existing baseline (unless initialising).
 * @param {Result[]} results
 * @param {Baseline | null} existing
 * @param {readonly string[]} noBaseline
 */
export function nextBaseline(results, existing, noBaseline) {
  /** @type {Baseline} */
  const out = {};
  for (const result of results) {
    const id = result.check.id;
    if (noBaseline.includes(id) || result.skipped) continue;
    const counts = countsOf(result);
    /** @type {Record<string, number>} */
    const files = {};
    for (const file of Object.keys(counts).sort()) {
      const n = existing ? Math.min(counts[file], existing[id]?.[file] ?? 0) : counts[file];
      if (n > 0) files[file] = n;
    }
    out[id] = files;
  }
  return out;
}

/** @param {string} today @param {string} enforceFrom */
export const enforcing = (today, enforceFrom) => today >= enforceFrom;

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = process.argv.slice(2);
  const flag = (/** @type {string} */ name) => args.includes(name);
  const onlyAt = args.indexOf('--only');
  const only = onlyAt >= 0 ? args[onlyAt + 1].split(',') : null;
  const config = JSON.parse(readFileSync(path.join(ROOT, CONFIG_PATH), 'utf8'));
  const baselineFile = path.join(ROOT, BASELINE_PATH);
  const baseline = existsSync(baselineFile) ? JSON.parse(readFileSync(baselineFile, 'utf8')) : null;
  const today = new Date().toISOString().slice(0, 10);
  const enforce = flag('--report') ? false : flag('--enforce') || enforcing(today, config.enforceFrom);
  const diff = flag('--all') ? { base: 'none (--all)', changed: null } : changedSince(ROOT, [process.env.ARCH_DIFF_BASE || '', 'main', 'origin/main'].filter(Boolean));
  const checkIds = CHECKS.map((c) => c.id);
  const ctx = createContext({ root: ROOT, config: config.checks, changedLines: diff.changed, all: flag('--all'), checkIds });
  const checks = only ? CHECKS.filter((c) => only.includes(c.id)) : CHECKS;
  const started = Date.now();
  const results = await runChecks(ctx, checks);
  const rows = compare(results, baseline || {}, config.noBaseline);
  const marks = markers(ctx, config.markerScanExclude);
  const verbose = flag('--verbose');

  const mode = enforce ? 'ENFORCED' : `REPORT-ONLY until ${config.enforceFrom} (exits 0; enforced from that date, ${CONFIG_PATH} enforceFrom)`;
  console.log(`check:architecture (docs/ARCHITECTURE-RULES.md): ${mode}`);
  console.log(`C6 diff base: ${diff.base ?? 'none found (C6 skipped)'}\n`);
  console.log('check rule  found  excused  baselined  new  stale  title');
  for (const r of rows) {
    const cells = [r.id.padEnd(5), r.rule.padEnd(4), String(r.found).padStart(5), String(r.excused).padStart(8), (config.noBaseline.includes(r.id) ? '-' : String(r.baselined)).padStart(10), String(r.newCount).padStart(4), String(r.stale.length).padStart(6)];
    console.log(`${cells.join(' ')}  ${r.skipped ? `(skipped: ${r.skipped}) ` : ''}${r.title}`);
  }
  for (const r of rows) {
    const result = /** @type {Result} */ (results.find((x) => x.check.id === r.id));
    if (r.newCount) {
      const overFiles = new Set(r.over.map((o) => o.file));
      const shown = result.findings.filter((f) => !f.excused && overFiles.has(f.file));
      console.log(`\n${r.id} (${r.rule}) beyond the baseline: ${r.newCount}${r.over.some((o) => o.allowed) ? ' (a file over its count lists all its findings)' : ''}`);
      for (const f of verbose ? shown : shown.slice(0, 15)) console.log(`  ${r.rule} ${f.file}${f.line ? `:${f.line}` : ''} ${f.message}`);
      if (!verbose && shown.length > 15) console.log(`  ... ${shown.length - 15} more (--verbose)`);
    }
    if (r.stale.length) {
      console.log(`\n${r.id} baseline entries now too high (run --write-baseline to shrink them):`);
      for (const s of r.stale) console.log(`  ${s.file}: ${s.allowed} -> ${s.count}`);
    }
    if (verbose && result.notes.length) for (const n of result.notes) console.log(`  note ${r.id}: ${n}`);
    else if (result.notes.length) console.log(`\n${r.id} notes: ${result.notes.length} (--verbose lists them)`);
  }
  console.log(`\narch-ok markers: ${marks.valid.length}`);
  for (const m of marks.valid) console.log(`  ${m.file}:${m.line} ${m.rule}: ${m.reason}`);
  if (marks.malformed.length) {
    console.log(`malformed arch-ok markers (need "arch-ok R<n>: reason"): ${marks.malformed.length}`);
    for (const m of marks.malformed) console.log(`  ${m.file}:${m.line} ${m.text}`);
  }
  if (ctx.parseErrors.length) console.log(`\nnot parsed (skipped by the AST checks): ${ctx.parseErrors.join(', ')}`);

  if (flag('--write-baseline') || flag('--init-baseline')) {
    const next = nextBaseline(results, flag('--init-baseline') ? null : baseline, config.noBaseline);
    const merged = { '//': 'The architecture checks\' known findings, as a count per check per file (scripts/check/architecture.mjs). It may only shrink: tests/unit/architecture-baseline.test.mjs fails when a count grows or an entry appears compared with main. Shrink it with `node scripts/check/architecture.mjs --write-baseline` after fixing findings.', ...(baseline && only ? baseline : {}), ...next };
    writeFileSync(baselineFile, `${JSON.stringify(merged, null, 2)}\n`);
    console.log(`\nwrote ${BASELINE_PATH}`);
  }

  mkdirSync(path.join(ROOT, 'tmp'), { recursive: true });
  writeFileSync(path.join(ROOT, 'tmp', 'architecture-report.json'), `${JSON.stringify({
    date: today, mode: enforce ? 'enforced' : 'report-only', enforceFrom: config.enforceFrom, diffBase: diff.base,
    checks: rows.map(({ over, stale, ...r }) => ({ ...r, over, stale })),
    findings: Object.fromEntries(results.map((r) => [r.check.id, r.findings])),
    markers: marks,
  }, null, 1)}\n`);

  const failing = rows.reduce((s, r) => s + r.newCount + r.stale.length, 0) + marks.malformed.length;
  console.log(`\n${failing ? `${failing} to fix` : 'clean against the baseline'} (${((Date.now() - started) / 1000).toFixed(1)} s; tmp/architecture-report.json)`);
  if (enforce && failing) {
    console.error('FAIL: fix the findings above, excuse one with "arch-ok R<n>: reason", or shrink the baseline (docs/ARCHITECTURE-RULES.md R14).');
    process.exit(1);
  }
}
