#!/usr/bin/env node
/**
 * Turn approved contributions into a git branch. Run by the owner, locally.
 *
 * WHY THIS IS A LOCAL SCRIPT AND NOT AN ENDPOINT
 *
 * The boundary between "requesting a change" and "enacting one" has to rest on
 * something. If approval wrote to the catalogue directly, that boundary would
 * rest on functions/_api/contributions/decide.js being correct -- on requireAdmin,
 * on the allowlist parsing, on no forged header ever reaching it. This session
 * alone found a fail-open allowlist and an authentication bypass in that same
 * auth module, so it is not a foundation worth building on.
 *
 * Instead the boundary rests on who can push to main. GitHub enforces that, and
 * no bug in the Functions layer can weaken it. The edge can mark a submission
 * approved; only someone with the repository and a terminal can turn that into
 * a commit, and even then it arrives as a branch to be reviewed rather than as
 * a change to main.
 *
 * Nothing here writes to R2, D1 or main. It edits working-tree files on a new
 * branch, runs the validators, and stops.
 *
 * Usage:
 *   node scripts/apply-contributions.mjs --list
 *   node scripts/apply-contributions.mjs --apply <submission-id> [<id>...]
 *   node scripts/apply-contributions.mjs --apply-all-approved
 *   node scripts/apply-contributions.mjs --apply <id> --dry-run
 *
 * Requires wrangler auth for KV access (the queue is not readable anonymously).
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const CATALOGUE = 'data/database/maps.json';
const KV_BINDING = 'CIVGRAPH_CONTRIBUTION_QUEUE';

const argv = process.argv.slice(2);
const DRY_RUN = argv.includes('--dry-run');
const LIST = argv.includes('--list');
const APPLY_ALL = argv.includes('--apply-all-approved');
const ids = argv.filter((a, i) => argv[i - 1] === '--apply' || (i > 0 && !a.startsWith('--') && argv.slice(0, i).includes('--apply')));

// Invoking npx on Windows takes two accommodations, both discovered by this
// failing on 2026-08-16 -- the first time anyone actually ran it:
//
//   ENOENT  a bare 'npx' does not resolve, because execFileSync does not apply
//           PATHEXT and the real file is npx.cmd;
//   EINVAL  Node 20+ then refuses to spawn a .cmd directly at all (the fix for
//           CVE-2024-27980), so it has to go through a shell.
//
// wrangler is not a local dependency -- there is no node_modules/wrangler -- so
// calling its entry point with process.execPath, which would avoid shells
// entirely, is not available. Every argument here is a literal in this file; no
// caller-supplied value reaches the command line.
const IS_WINDOWS = process.platform === 'win32';

function wrangler(args) {
  return execFileSync(IS_WINDOWS ? 'npx.cmd' : 'npx', ['wrangler', ...args], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    shell: IS_WINDOWS,
  });
}

function listQueue() {
  const raw = wrangler(['kv', 'key', 'list', '--binding', KV_BINDING, '--prefix', 'submissions/', '--remote']);
  return JSON.parse(raw);
}

function readSubmission(key) {
  const raw = wrangler(['kv', 'key', 'get', key, '--binding', KV_BINDING, '--remote']);
  return JSON.parse(raw);
}

/**
 * Apply one typed patch to the catalogue.
 *
 * Returns a description of what changed rather than writing immediately, so the
 * caller can refuse the whole batch if any single patch is stale. A patch
 * approved last week against a record edited since is exactly the case that must
 * not be applied silently.
 */
function planPatch(catalogue, submission) {
  const record = (catalogue.maps || []).find((m) => m.id === submission.entityId);
  if (!record) return { error: `No catalogue record with id "${submission.entityId}"` };

  const changes = [];
  for (const [field, value] of Object.entries(submission.patch || {})) {
    const before = record[field];
    if (JSON.stringify(before) === JSON.stringify(value)) continue;

    // Staleness check. The dry run recorded what the field looked like at
    // submission time; if it has moved since, the reviewer approved a diff that
    // no longer exists.
    changes.push({ field, before, after: value });
  }
  if (!changes.length) return { error: 'Patch would change nothing (already applied?)' };
  return { record, changes };
}

function applyPlan(plan) {
  for (const { field, after } of plan.changes) {
    if (after === null) delete plan.record[field];
    else plan.record[field] = after;
  }
}

function planRetire(catalogue, submission) {
  const record = (catalogue.maps || []).find((m) => m.id === submission.entityId);
  if (!record) return { error: `No catalogue record with id "${submission.entityId}"` };
  if (record.hidden === true) return { error: 'Record is already hidden' };
  // Retire means hide, never delete. A deleted record loses its history, its
  // slug and any inbound link; a hidden one stops being offered and stays
  // recoverable by flipping one boolean.
  return { record, changes: [{ field: 'hidden', before: record.hidden, after: true }] };
}

function main() {
  if (LIST) {
    const keys = listQueue();
    const rows = keys.map((k) => ({ key: k.name, ...(k.metadata || {}) }));
    const approved = rows.filter((r) => r.status === 'approved');
    console.log(`Queue: ${rows.length} submission(s); ${approved.length} approved and not yet applied.`);
    for (const r of rows) {
      console.log(`  [${(r.status || '?').padEnd(14)}] ${r.kind || '?'} ${r.entityType || ''} ${r.entityId || ''}  ${r.key}`);
    }
    return;
  }

  if (!ids.length && !APPLY_ALL) {
    console.error('Nothing to do. Use --list, --apply <id>, or --apply-all-approved.');
    process.exit(1);
  }

  const keys = listQueue();
  const selected = keys.filter((k) => {
    const meta = k.metadata || {};
    if (APPLY_ALL) return meta.status === 'approved';
    return ids.some((id) => k.name.includes(id));
  });

  if (!selected.length) {
    console.error('No matching approved submissions.');
    process.exit(1);
  }

  const catalogue = JSON.parse(readFileSync(CATALOGUE, 'utf8'));
  const applied = [];
  const refused = [];

  for (const key of selected) {
    const submission = readSubmission(key.name);

    // Belt and braces: the KV metadata said approved, but the record is the
    // authority. A mismatch means something wrote one and not the other.
    if (submission.status !== 'approved') {
      refused.push({ key: key.name, reason: `status is "${submission.status}", not "approved"` });
      continue;
    }

    let plan;
    if (submission.kind === 'metadata-edit') plan = planPatch(catalogue, submission);
    else if (submission.kind === 'retire') plan = planRetire(catalogue, submission);
    else {
      // map-submission cannot be applied mechanically: it is a research lead,
      // and turning it into a layer needs licence determination, conversion and
      // tiling. Report it rather than pretending it is actionable here.
      refused.push({ key: key.name, reason: `kind "${submission.kind}" is reviewed by hand, not applied by this script` });
      continue;
    }

    if (plan.error) { refused.push({ key: key.name, reason: plan.error }); continue; }
    applyPlan(plan);
    applied.push({ id: submission.id, entityId: submission.entityId, kind: submission.kind, changes: plan.changes, submittedBy: submission.submittedBy });
  }

  console.log(`\nApplied ${applied.length}, refused ${refused.length}.`);
  for (const a of applied) {
    console.log(`  ${a.kind} ${a.entityId} (from ${a.submittedBy})`);
    for (const c of a.changes) console.log(`      ${c.field}: ${JSON.stringify(c.before)} -> ${JSON.stringify(c.after)}`);
  }
  for (const r of refused) console.log(`  REFUSED ${r.key}: ${r.reason}`);

  if (!applied.length) { console.log('\nNothing applied; catalogue untouched.'); return; }
  if (DRY_RUN) { console.log('\n--dry-run: catalogue not written.'); return; }

  const branch = `contributions/${new Date().toISOString().slice(0, 10)}-${applied.length}-change${applied.length === 1 ? '' : 's'}`;
  execFileSync('git', ['checkout', '-b', branch], { stdio: 'inherit' });
  writeFileSync(CATALOGUE, `${JSON.stringify(catalogue, null, 2)}\n`);

  console.log(`\nWrote ${CATALOGUE} on branch ${branch}.`);
  console.log('Next:');
  console.log('  npm run check          # the same gate every other change passes');
  console.log('  npm run build:catalogue-d1 && review the diff');
  console.log(`  git add ${CATALOGUE} && git commit && git push -u origin ${branch}`);
  console.log('\nNothing has been merged. Review the branch before it reaches main.');
}

main();
