#!/usr/bin/env node
/**
 * Schema + sanity checks for the R2 publication allowlist.
 *
 * The allowlist is what stands between "a script wrote an object" and "that
 * object is on the public internet", so a malformed or over-broad entry is a
 * publication risk, not a formatting nit. Runs in check:data.
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import { loadAllowlist, isPublishable } from './lib/r2-publication-gate.mjs';

const ROOT = process.cwd();
const FILE = path.join(ROOT, 'data', 'database', 'r2-publication-allowlist.json');
const failures = [];

if (!existsSync(FILE)) {
  console.error(`Missing R2 publication allowlist: ${path.relative(ROOT, FILE)}`);
  process.exit(1);
}

const allowlist = loadAllowlist(FILE);
const seen = new Set();

for (const [i, entry] of allowlist.prefixes.entries()) {
  const where = `prefixes[${i}]${entry?.prefix ? ` (${entry.prefix})` : ''}`;

  if (!entry || typeof entry.prefix !== 'string' || !entry.prefix.trim()) {
    failures.push(`${where}: prefix must be a non-empty string.`);
    continue;
  }
  const prefix = entry.prefix;

  if (prefix.startsWith('/')) failures.push(`${where}: prefix must not start with '/'.`);
  if (!prefix.endsWith('/')) failures.push(`${where}: prefix must end with '/' so it cannot match a partial path segment.`);
  if (prefix.includes('..')) failures.push(`${where}: prefix must not contain '..'.`);
  if (prefix.includes('*') || prefix.includes('?')) failures.push(`${where}: prefix is a literal path prefix, not a glob.`);

  // A bare top-level prefix would blanket-authorise a whole tree.
  const segments = prefix.split('/').filter(Boolean);
  if (segments.length < 2) failures.push(`${where}: prefix is too broad — needs at least two path segments.`);

  if (seen.has(prefix)) failures.push(`${where}: duplicate prefix.`);
  seen.add(prefix);

  for (const field of ['rationale', 'evidence']) {
    if (typeof entry[field] !== 'string' || entry[field].trim().length < 10) {
      failures.push(`${where}: '${field}' is required and must be a meaningful sentence.`);
    }
  }
}

// A prefix that is a prefix of another is redundant and hides intent.
for (const a of seen) {
  for (const b of seen) {
    if (a !== b && b.startsWith(a)) failures.push(`Redundant prefix: '${b}' is already covered by '${a}'.`);
  }
}

// Guard the gate itself: these must never be publishable.
for (const mustFail of ['.env.local', 'data/database/knowledge.db', 'tasks/absence-integration-ready-2026-06-15/x']) {
  if (isPublishable(mustFail, allowlist)) failures.push(`Allowlist would permit publishing '${mustFail}'.`);
}

if (failures.length) {
  console.error('R2 publication allowlist validation FAILED:');
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}

const unverified = allowlist.prefixes.filter((e) => String(e.rights || '').startsWith('unverified')).length;
console.log(`PASS: R2 publication allowlist valid (${allowlist.prefixes.length} prefixes).`);
if (unverified) console.log(`  NOTE: ${unverified} prefix(es) have rights marked 'unverified' and need review.`);
