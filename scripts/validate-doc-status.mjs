#!/usr/bin/env node
/**
 * Every plan, runbook and review must declare its status.
 *
 * Principle 13 in docs/CIVGRAPH_PRINCIPLES.md. An undated document that reads as
 * current is a trap: on 2026-08-16 a triage of docs/ found one describing the
 * contributor allowlist as fail-OPEN, which had been true when written and had
 * been false for three days. Someone reasoning about who can contribute would
 * have reached the wrong answer from a document that looked authoritative.
 *
 * All qualifying documents carried a banner when this was written. The check
 * exists so the NEXT one does too -- that is the only moment at which this is
 * cheap.
 *
 * A banner is a blockquote line beginning `> **Status:` within the first 14
 * lines, so it survives a title and a blank line but cannot be buried.
 *
 * Deliberately NOT checked: whether the status is accurate. No validator can
 * know that. This asserts only that a claim was made, which at least makes a
 * wrong claim correctable rather than absent.
 */
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';

const HEAD_LINES = 14;
const MARKER = /^>\s*\*\*Status:/;

/**
 * Subdirectories of docs/ that are NOT yet held to this rule.
 *
 * This check originally read only the top level of docs/, which meant the
 * review outputs in docs/review/ -- the documents this rule most obviously
 * exists for -- were exempt by accident, and the check reported PASS without
 * ever looking at them. It now recurses, so anything added under docs/ is
 * covered by default.
 *
 * That exposed a backlog of 35 pre-existing documents in the two directories
 * below. They are named here rather than skipped silently: an exemption someone
 * has to delete a line to remove is a decision, and an unlisted directory that
 * happens not to be scanned is an accident waiting to repeat. Clearing them is
 * tracked as tech-debt "220 UX findings of unknown status" -- the same problem,
 * which is that nobody knows whether these handoff packs are live or spent.
 */
const EXEMPT_DIRS = new Set([
  'performance-improvement-handoff',   // 33 files, status unknown, see above
  'advanced-styling',                  // 2 files, status unknown, see above
]);

// Reference material and instructions rather than plans: they describe how to
// work, not the state of a piece of work, so "is this still true" does not apply
// in the same way.
const EXEMPT = new Set([
  'README.md',
  'CLAUDE.md',
  'AGENTS.md',
  'CONTRIBUTING.md',
  'LICENSE.md',
  'NOTICE.md',
  'token-discipline-guide.md',
  'session-ses_20bb.md',
  'recovered-election-controller-from-browser.md',
]);

function walkDocs(dir, out) {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      if (!EXEMPT_DIRS.has(name)) walkDocs(full, out);
      continue;
    }
    if (name.endsWith('.md') && !EXEMPT.has(name)) out.push(full);
  }
}

function candidates() {
  const out = [];
  if (existsSync('docs')) walkDocs('docs', out);
  for (const name of readdirSync('.')) {
    if (!name.endsWith('.md') || EXEMPT.has(name)) continue;
    // Root-level markdown counts only when it reads as a plan or review, which
    // is what the naming convention here already signals.
    if (/PLAN|REVIEW|AUDIT|PRINCIPLES|RUNBOOK/i.test(name)) out.push(name);
  }
  return out.sort();
}

const missing = [];
const files = candidates();

for (const file of files) {
  const head = readFileSync(file, 'utf8').split(/\r?\n/).slice(0, HEAD_LINES);
  if (!head.some((line) => MARKER.test(line))) missing.push(file);
}

if (missing.length) {
  console.error(`FAIL: ${missing.length} document(s) do not declare a status:`);
  for (const file of missing) console.error(`  - ${file}`);
  console.error('');
  console.error(`  Add a line beginning "> **Status:" within the first ${HEAD_LINES} lines.`);
  console.error('  Use one of: current / completed / superseded / point-in-time,');
  console.error('  and say what supersedes it or what to verify before acting.');
  console.error('  See docs/CIVGRAPH_PRINCIPLES.md, principle 13.');
  process.exit(1);
}

console.log(`PASS: all ${files.length} plan/review document(s) declare a status.`);
