// `intake from-contribution` (refactor plan IP-4): an approved contribution becomes an intake
// batch through the contribution plugin (scripts/ingest/contribution/plugin.mjs), and staging
// that batch makes exactly the catalogue change scripts/intake/contributions.mjs --apply makes.
// Fixtures only: the submissions are files in fixtures/contributions/ beside this test (made up),
// the repository a throwaway git repository; nothing reads KV, R2 or D1.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadBatch, validateBatch } from '../../packages/intake/src/batch.mjs';
import { contributionRefusal, planContribution, readQueuedSubmission, submissionRecord } from '../../packages/intake/src/contribution.mjs';
import { pluginMain } from '../../packages/intake/src/plugin-cli.mjs';
import { stageBatch } from '../../packages/intake/src/stage.mjs';
import { applyPlan, planPatch, planRetire } from '../../scripts/intake/contributions.mjs';
import { tempDir, writeFile } from './helpers.mjs';

const FIXTURES = fileURLToPath(new URL('./fixtures/contributions', import.meta.url));
const fixture = (name) => JSON.parse(readFileSync(path.join(FIXTURES, name), 'utf8'));
const INTAKE_SRC = pathToFileURL(path.resolve('packages/intake/src')).href;

const git = (repo, ...args) => {
  const r = spawnSync('git', args, { cwd: repo, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim();
};

/** A git repository holding the fixture catalogue and the real contribution plugin. */
function contributionRepo() {
  const repo = tempDir('contribution');
  git(repo, 'init', '-q');
  git(repo, 'config', 'user.email', 'test@example.invalid');
  git(repo, 'config', 'user.name', 'test');
  git(repo, 'config', 'core.autocrlf', 'false');
  writeFile(repo, 'data/database/maps.json', readFileSync(path.join(FIXTURES, 'maps.json'), 'utf8'));
  writeFile(repo, 'data/database/r2-publication-allowlist.json', { schemaVersion: 1, prefixes: [{ prefix: 'data/maps/' }] });
  const plugin = readFileSync(path.resolve('scripts/ingest/contribution/plugin.mjs'), 'utf8').replaceAll("'../../../packages/intake/src", `'${INTAKE_SRC}`);
  writeFile(repo, 'scripts/ingest/contribution/plugin.mjs', plugin);
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'base');
  return repo;
}

function quiet() {
  /** @type {string[]} */
  const lines = [];
  return { lines, io: { log: (/** @type {string} */ s) => lines.push(s), err: (/** @type {string} */ s) => lines.push(s), stdio: /** @type {'pipe'} */ ('pipe') } };
}

/** The catalogue contributions.mjs --apply writes for one submission. */
function appliedByContributionsScript(submission) {
  const catalogue = fixture('maps.json');
  const plan = submission.kind === 'retire' ? planRetire(catalogue, submission) : planPatch(catalogue, submission);
  assert.equal(plan.error, undefined);
  applyPlan(plan);
  return `${JSON.stringify(catalogue, null, 2)}\n`;
}

for (const name of ['metadata-edit.json', 'retire.json']) {
  test(`from-contribution ${name}: a valid batch whose staging equals contributions.mjs --apply`, async () => {
    const repo = contributionRepo();
    const submission = fixture(name);
    const batchDir = path.join(tempDir('from-contribution'), `contribution-${submission.kind}`);
    const { lines, io } = quiet();
    const code = await pluginMain(['from-contribution', submission.id, batchDir, '--repo', repo, '--submission', path.join(FIXTURES, name)], io);
    assert.equal(code, 0, lines.join('\n'));
    assert.equal(git(repo, 'status', '--porcelain'), '', 'nothing in the repository changed yet');
    const batch = loadBatch(batchDir, { repo });
    assert.deepEqual(validateBatch(batch).errors, []);
    assert.equal(batch.manifest.status, 'draft');
    assert.deepEqual(batch.manifest.kinds, ['contribution']);
    assert.deepEqual(batch.manifest.operations.map((o) => o.type), ['maps-json-patch']);
    assert.match(batch.manifest.title, new RegExp(submission.id));
    assert.ok(batch.manifest.notes.some((n) => n.includes(`--mark-applied ${submission.id}`)));
    // The contributor's identity stays out of the batch.
    const kept = readFileSync(path.join(batchDir, 'contribution/submission.json'), 'utf8');
    assert.equal(JSON.parse(kept).id, submission.id);
    assert.doesNotMatch(kept, /contributor@example\.invalid|submittedBy|userAgent/);
    assert.doesNotMatch(readFileSync(path.join(batchDir, 'batch.json'), 'utf8'), /contributor@example\.invalid/);
    const res = stageBatch(batch, { write: true });
    assert.deepEqual(res.errors, []);
    assert.equal(readFileSync(path.join(repo, 'data/database/maps.json'), 'utf8'), appliedByContributionsScript(submission));
    // A second staging changes nothing.
    assert.equal(stageBatch(loadBatch(batchDir, { repo }), { write: true }).changes.length, 0);
    // The folder is taken now.
    assert.equal(await pluginMain(['from-contribution', submission.id, batchDir, '--repo', repo, '--submission', path.join(FIXTURES, name)], quiet().io), 1);
  });
}

test('from-contribution refuses what contributions.mjs --apply refuses, and writes no batch', async () => {
  const repo = contributionRepo();
  const edit = fixture('metadata-edit.json');
  const cases = [
    [{ ...edit, status: 'pending-review' }, /only an approved submission/],
    [{ ...edit, status: 'rejected' }, /only an approved submission/],
    [{ ...edit, status: 'applied' }, /already marked applied/],
    [{ ...edit, entityId: 'no-such-map' }, /No catalogue record/],
    [{ ...edit, patch: { name: fixture('maps.json').maps[0].name } }, /change nothing/],
    [{ ...fixture('retire.json'), entityId: 'plu-ni-1911-hidden' }, /already hidden/],
    [fixture('map-submission.json'), /reviewed by hand/],
  ];
  for (const [submission, why] of cases) {
    const file = writeFile(tempDir('sub'), 'submission.json', submission);
    const batchDir = path.join(tempDir('refused'), 'contribution-refused');
    const { lines, io } = quiet();
    assert.equal(await pluginMain(['from-contribution', submission.id, batchDir, '--repo', repo, '--submission', file], io), 1, `${why}`);
    assert.ok(lines.some((l) => why.test(l)), `${why}: ${lines.join(' | ')}`);
    assert.equal(existsSync(path.join(batchDir, 'batch.json')), false);
  }
  // The id given must be the submission's.
  const { lines, io } = quiet();
  assert.equal(await pluginMain(['from-contribution', 'sub_other', path.join(tempDir('x'), 'b'), '--repo', repo, '--submission', path.join(FIXTURES, 'metadata-edit.json')], io), 1);
  assert.ok(lines.some((l) => /is not submission sub_other/.test(l)), lines.join(' | '));
});

test('the plan matches contributions.mjs field by field; null deletes the field', () => {
  const catalogue = fixture('maps.json');
  const edit = fixture('metadata-edit.json');
  const plan = planContribution(edit, catalogue);
  assert.ok(!('error' in plan));
  const theirs = planPatch(fixture('maps.json'), edit);
  assert.deepEqual(plan.changes, theirs.changes);
  assert.ok(plan.edits.some((e) => e.op === 'unset-field'), 'the fixture deletes a field');
  assert.equal(contributionRefusal(/** @type {never} */ ({})), 'not a submission (no id)');
  assert.deepEqual(Object.keys(submissionRecord({ ...edit, userAgent: 'x' })).filter((k) => /submittedBy|userAgent/.test(k)), []);
});

test('the live queue is read only through the wrangler the caller gives (never in a test)', () => {
  /** @type {string[][]} */
  const calls = [];
  const sub = fixture('metadata-edit.json');
  const wrangler = (/** @type {string[]} */ args) => {
    calls.push(args);
    return args[2] === 'list' ? JSON.stringify([{ name: `submissions/${sub.id}` }, { name: 'submissions/sub_zzz' }]) : JSON.stringify(sub);
  };
  assert.equal(readQueuedSubmission(sub.id, { wrangler }).id, sub.id);
  assert.deepEqual(calls.map((c) => c.slice(0, 3)), [['kv', 'key', 'list'], ['kv', 'key', 'get']]);
  assert.ok(calls.every((c) => c.includes('CIVGRAPH_CONTRIBUTION_QUEUE')));
  assert.throws(() => readQueuedSubmission('sub_', { wrangler }), /matches 2 submissions/);
  assert.throws(() => readQueuedSubmission('nothing', { wrangler }), /no submission matching/);
});
