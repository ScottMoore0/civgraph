// @ts-check
/**
 * An approved site contribution as an intake batch (refactor plan IP-4; intake spec section 7):
 * `intake from-contribution <id> <batch-dir>` reads the submission, and the contribution plugin
 * (scripts/ingest/contribution/plugin.mjs) turns it into maps-json-patch edits that the normal
 * commands (validate, plan, stage --write) apply. The edits are the ones
 * scripts/intake/contributions.mjs --apply makes (planPatch, planRetire, applyPlan there): a
 * metadata edit sets each patched field that differs (null deletes it); a retire hides the
 * record. The same refusals hold: a submission that is not approved, a record that is not in the
 * catalogue, a patch that changes nothing, a record already hidden, and a map submission, which
 * is work by hand (licence, conversion and tiling, from the attachments
 * contribution-attachments.mjs --fetch puts in quarantine).
 *
 * Nothing here reads KV, R2 or D1: the submission comes in as a file. The command line reads the
 * queue through wrangler only when it is not given one (readQueuedSubmission).
 */
import { execFileSync } from 'node:child_process';
import { CONTRIBUTION_STATUS } from './statuses.mjs';

/** The status a submission reaches once its batch is applied; only one that may reach it is turned into a batch. */
const APPLIED = 'applied';
export const CONTRIBUTION_KV_BINDING = 'CIVGRAPH_CONTRIBUTION_QUEUE';

/**
 * The fields of a queued submission this reads (packages/api/src/handlers/contributions/submit.js).
 * @typedef {object} Submission
 * @property {string} id
 * @property {string} kind                 metadata-edit | retire | map-submission
 * @property {string | null} [entityType]
 * @property {string | null} [entityId]
 * @property {string} [title]
 * @property {string} [summary]
 * @property {Record<string, unknown> | null} [patch]
 * @property {{ reason: string } | null} [retire]
 * @property {unknown} [mapRequest]
 * @property {string[]} [sourceUrls]
 * @property {string[]} [quarantineKeys]
 * @property {string} [submittedAt]
 * @property {string | null} [submittedBy]
 * @property {string} status
 */

/**
 * One maps-json-patch edit (packages/intake/src/stage.mjs).
 * @typedef {{ id: string, op: 'set-field', field: string, value: unknown } | { id: string, op: 'unset-field', field: string }} ContributionEdit
 */

/**
 * @typedef {object} ContributionPlan
 * @property {ContributionEdit[]} edits
 * @property {{ field: string, before: unknown, after: unknown }[]} changes
 */

/** @param {unknown} a @param {unknown} b */
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Why a submission cannot become a batch, or null.
 * @param {Submission} submission
 * @returns {string | null}
 */
export function contributionRefusal(submission) {
  if (!submission || typeof submission !== 'object' || typeof submission.id !== 'string') return 'not a submission (no id)';
  if (submission.status === APPLIED) return 'already marked applied';
  const known = /** @type {readonly string[]} */ (CONTRIBUTION_STATUS.states);
  if (!known.includes(submission.status)) return `status "${submission.status}" is not a contribution status`;
  if (!CONTRIBUTION_STATUS.can(/** @type {import('./statuses.mjs').ContributionStatus} */ (submission.status), APPLIED)) return `status is "${submission.status}"; only an approved submission becomes a batch`;
  return null;
}

/**
 * The catalogue edits a submission makes, checked against the catalogue as it is now.
 * @param {Submission} submission
 * @param {{ maps?: Array<Record<string, unknown>> }} catalogue   data/database/maps.json
 * @returns {ContributionPlan | { error: string }}
 */
export function planContribution(submission, catalogue) {
  const refusal = contributionRefusal(submission);
  if (refusal) return { error: refusal };
  if (submission.kind !== 'retire' && submission.kind !== 'metadata-edit') return { error: `kind "${submission.kind}" is reviewed by hand, not turned into a batch -- once the work is done, close it with contributions.mjs --mark-applied ${submission.id}` };
  const record = (catalogue.maps || []).find((m) => m.id === submission.entityId);
  if (!record) return { error: `No catalogue record with id "${submission.entityId}"` };
  const id = /** @type {string} */ (submission.entityId);
  if (submission.kind === 'retire') {
    if (record.hidden === true) return { error: 'Record is already hidden' };
    return { edits: [{ id, op: 'set-field', field: 'hidden', value: true }], changes: [{ field: 'hidden', before: record.hidden, after: true }] };
  }
  /** @type {ContributionEdit[]} */
  const edits = [];
  const changes = [];
  for (const [field, value] of Object.entries(submission.patch || {})) {
    if (same(record[field], value)) continue;
    changes.push({ field, before: record[field], after: value });
    edits.push(value === null ? { id, op: 'unset-field', field } : { id, op: 'set-field', field, value });
  }
  if (!edits.length) return { error: 'Patch would change nothing (already applied?)' };
  return { edits, changes };
}

/**
 * What of a submission a batch keeps: everything the review needs, without the contributor's
 * identity (submittedBy) or browser (userAgent).
 * @param {Submission & Record<string, unknown>} submission
 */
export function submissionRecord(submission) {
  const { submittedBy: _who, userAgent: _ua, ...kept } = submission;
  return kept;
}

/**
 * Read one submission from the live queue (KV, through wrangler): the owner's terminal only.
 * Matches `id` against the queue's keys as contributions.mjs does.
 * @param {string} id
 * @param {{ wrangler?: (args: string[]) => string }} [io]
 * @returns {Submission}
 */
export function readQueuedSubmission(id, { wrangler = runWrangler } = {}) {
  /** @type {Array<{ name: string }>} */
  const keys = JSON.parse(wrangler(['kv', 'key', 'list', '--binding', CONTRIBUTION_KV_BINDING, '--prefix', 'submissions/', '--remote']));
  const matches = keys.filter((k) => k.name.includes(id));
  if (!matches.length) throw new Error(`no submission matching "${id}"`);
  if (matches.length > 1) throw new Error(`"${id}" matches ${matches.length} submissions; be more specific`);
  return JSON.parse(wrangler(['kv', 'key', 'get', /** @type {{ name: string }} */ (matches[0]).name, '--binding', CONTRIBUTION_KV_BINDING, '--remote']));
}

/** @param {string[]} args */
function runWrangler(args) {
  const windows = process.platform === 'win32';
  return execFileSync(windows ? 'npx.cmd' : 'npx', ['wrangler', ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, shell: windows });
}
