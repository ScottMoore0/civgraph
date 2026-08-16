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
 * THE QUEUE NEEDS A TERMINAL STATE, AND THIS IS IT
 *
 * Until 2026-08-16 "approved" was the last status a submission could reach. Two
 * consequences, and the second one cost a support round trip:
 *
 *   - This script REFUSES kind "map-submission" on purpose -- turning one into a
 *     layer needs a licence determination, conversion and tiling, none of which
 *     can be done mechanically. So those never advanced past approved even after
 *     the work was finished by hand.
 *   - Even for the kinds it does handle, it stops at a branch. Nothing marked a
 *     submission done once that branch was merged.
 *
 * So --list reported "5 approved and not yet applied" for five layers that had
 * been corrected, uploaded, and byte-verified at the edge nine hours earlier.
 * The queue said the opposite of the truth, and it was going to say it forever.
 *
 * `--mark-applied` closes that. It is deliberately a separate, explicit step
 * rather than something the apply path does for you: at the moment this script
 * finishes, the change is a branch nobody has merged, and calling that "applied"
 * would replace one lie with another. Mark it after the merge, or after doing
 * the work by hand -- which is the only route a map-submission has.
 *
 * Usage:
 *   node scripts/apply-contributions.mjs --list
 *   node scripts/apply-contributions.mjs --apply <submission-id> [<id>...]
 *   node scripts/apply-contributions.mjs --apply-all-approved
 *   node scripts/apply-contributions.mjs --apply <id> --dry-run
 *   node scripts/apply-contributions.mjs --mark-applied <id> --note "what was done"
 *
 * Requires wrangler auth for KV access (the queue is not readable anonymously).
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const CATALOGUE = 'data/database/maps.json';
const KV_BINDING = 'CIVGRAPH_CONTRIBUTION_QUEUE';

/**
 * The only legal status transitions.
 *
 * Exported and pure so the offline schema test can assert them without a queue,
 * a network or wrangler auth. The rule that matters is that `applied` is
 * reachable ONLY from `approved`: marking a pending submission applied would
 * skip review entirely, and marking a rejected one applied would record that
 * something refused had been enacted.
 */
export const TERMINAL_STATUS = 'applied';

export function canMarkApplied(status) {
  if (status === 'approved') return { ok: true };
  if (status === TERMINAL_STATUS) return { ok: false, reason: 'already marked applied' };
  return { ok: false, reason: `status is "${status}"; only an approved submission can be marked applied` };
}

const argv = process.argv.slice(2);
const DRY_RUN = argv.includes('--dry-run');
const LIST = argv.includes('--list');
const APPLY_ALL = argv.includes('--apply-all-approved');
const MARK_APPLIED = argv.includes('--mark-applied');
const markIds = argv.filter((a, i) => argv[i - 1] === '--mark-applied');
const NOTE = argv.includes('--note') ? String(argv[argv.indexOf('--note') + 1] || '') : '';
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

/**
 * Record that an approved submission has actually been enacted.
 *
 * Writes the same audit shape decide.js uses -- appended, never overwritten --
 * so "who said this was done, when, and what they did" survives.
 */
function markApplied(id) {
  const keys = listQueue();
  const matches = keys.filter((k) => k.name.includes(id));
  if (!matches.length) { console.error(`No submission matching "${id}".`); return false; }
  if (matches.length > 1) {
    console.error(`"${id}" matches ${matches.length} submissions; be more specific.`);
    return false;
  }

  const key = matches[0].name;
  const submission = readSubmission(key);
  const verdict = canMarkApplied(submission.status);
  if (!verdict.ok) {
    console.error(`REFUSED ${key}: ${verdict.reason}`);
    return false;
  }

  submission.status = TERMINAL_STATUS;
  submission.decisions = Array.isArray(submission.decisions) ? submission.decisions : [];
  submission.decisions.push({
    decision: TERMINAL_STATUS,
    note: NOTE || 'Marked applied locally.',
    decidedBy: 'local:apply-contributions',
    decidedAt: new Date().toISOString(),
  });

  const metadata = {
    kind: submission.kind,
    entityType: submission.entityType || '',
    entityId: submission.entityId || '',
    submittedBy: submission.submittedBy || '',
    status: submission.status,
  };

  // `kv key put` takes the value as a command-line argument, and a submission is
  // multi-line JSON full of quotes and braces. On Windows every wrangler call
  // goes through a shell (see the note on npx above), which mangles it -- the
  // first attempt died with the JSON half-parsed as shell syntax.
  //
  // `kv bulk put` reads key, value AND metadata from a file, so nothing but a
  // path crosses the command line. That also avoids `--metadata`, which has
  // previously been given a path by mistake and silently wiped the metadata
  // rather than complaining.
  const payload = [{ key, value: JSON.stringify(submission, null, 2), metadata }];
  const tmp = `tmp/kv-mark-applied-${submission.id}.json`;
  mkdirSync('tmp', { recursive: true });
  writeFileSync(tmp, JSON.stringify(payload));
  try {
    wrangler(['kv', 'bulk', 'put', tmp, '--binding', KV_BINDING, '--remote']);
  } finally {
    rmSync(tmp, { force: true });
  }
  console.log(`  ${key} -> ${TERMINAL_STATUS}`);
  return true;
}

function main() {
  if (LIST) {
    const keys = listQueue();
    const rows = keys.map((k) => ({ key: k.name, ...(k.metadata || {}) }));
    const outstanding = rows.filter((r) => r.status === 'approved');
    const done = rows.filter((r) => r.status === TERMINAL_STATUS);
    console.log(`Queue: ${rows.length} submission(s); ${outstanding.length} approved and not yet applied, ${done.length} applied.`);
    for (const r of rows) {
      // map-submission cannot be advanced by this script, so say so on the line
      // rather than letting it sit in the list looking like pending work.
      const hint = r.status === 'approved' && r.kind === 'map-submission' ? '   <- by hand; then --mark-applied' : '';
      console.log(`  [${(r.status || '?').padEnd(14)}] ${r.kind || '?'} ${r.entityType || ''} ${r.entityId || ''}  ${r.key}${hint}`);
    }
    return;
  }

  if (MARK_APPLIED) {
    if (!markIds.length) {
      console.error('--mark-applied needs a submission id.');
      process.exit(1);
    }
    let failures = 0;
    for (const id of markIds) if (!markApplied(id)) failures += 1;
    if (failures) process.exit(1);
    console.log('\nRecorded. These no longer appear as outstanding.');
    return;
  }

  if (!ids.length && !APPLY_ALL) {
    console.error('Nothing to do. Use --list, --apply <id>, --apply-all-approved, or --mark-applied <id>.');
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
      refused.push({ key: key.name, reason: `kind "${submission.kind}" is reviewed by hand, not applied by this script -- once the work is done, close it with --mark-applied ${submission.id}` });
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
  console.log('\nAFTER MERGING, close the queue entries or they stay "approved" forever:');
  for (const a of applied) console.log(`  node scripts/apply-contributions.mjs --mark-applied ${a.id}`);
}

// Guarded so the offline schema test can import canMarkApplied without this
// script trying to reach KV.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
