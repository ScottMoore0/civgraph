// npm run rebuild (scripts/build/rebuild-changed.mjs): the person-id step always withholds
// unmappable elections, the plan follows what changed, and each step comes after what it reads.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  classifyChanges, manifestArgsWithWithhold, planRebuild, votesDirFromWrapper, WITHHOLD,
} from '../../scripts/build/rebuild-changed.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const files = (/** @type {string[]} */ ...paths) => paths.map((p) => ({ path: p, tracked: true }));
/** @param {string[]} paths @param {{ full?: boolean, manifestArgs?: string }} [o] */
const planFor = (paths, { full = false, manifestArgs } = {}) => {
  const c = classifyChanges(files(...paths), { full });
  return { ...c, plan: planRebuild({ ...c, noBrowser: true, votesDir: 'C:\\votes', manifestArgs }) };
};

const PERSON_FIXTURES = [
  ['data/elections-source/dail/2024/dublin-bay-north.json'],
  ['data/elections/persons/person_id_merges.csv'],
  ['data/elections/persons/person_registry.json', 'site/index.html'],
  ['scripts/ingest/persons/apply_person_ids_v2.py'],
];

test('every plan that re-stamps person ids passes --withhold-unmappable', () => {
  let seen = 0;
  for (const paths of PERSON_FIXTURES) {
    for (const manifestArgs of [undefined, '', '--allow-missing-feature-indexes', `${WITHHOLD}`, `  ${WITHHOLD}  --x `]) {
      for (const full of [false, true]) {
        const { plan } = planFor(paths, { full, manifestArgs });
        const steps = plan.filter((s) => s.args.some((a) => /rebuild-person-ids|persons:rebuild/.test(a)));
        assert.equal(steps.length, 1, paths.join());
        seen += 1;
        const args = String(steps[0].env?.MANIFEST_ARGS || '').split(/\s+/);
        assert.ok(args.includes(WITHHOLD), `${paths.join()} with MANIFEST_ARGS=${manifestArgs}: ${steps[0].env?.MANIFEST_ARGS}`);
        assert.equal(args.filter((a) => a === WITHHOLD).length, 1);
        assert.equal(plan[0], steps[0], 'the re-stamp runs first');
      }
    }
  }
  assert.equal(seen, PERSON_FIXTURES.length * 10);
  assert.equal(manifestArgsWithWithhold(undefined), WITHHOLD);
  assert.equal(manifestArgsWithWithhold('--a'), `--a ${WITHHOLD}`);
});

test('the script never runs the person-id step any other way', () => {
  const src = readFileSync(path.join(ROOT, 'scripts', 'build', 'rebuild-changed.mjs'), 'utf8');
  assert.equal(src.match(/rebuild-person-ids\.sh'/g)?.length, 1, 'one call site, the planned step');
  assert.doesNotMatch(src, /persons:rebuild'/);
});

test('a ledger or other build output never re-stamps person ids (the 13 Nov 2026 re-mint)', () => {
  for (const out of ['data/elections/persons/published-person-addresses.json', 'data/elections/published-graph-ids.json']) {
    const { mode, persons, plan } = planFor([out]);
    assert.equal(persons, false, out);
    assert.equal(mode, 'none', out);
    assert.equal(plan.length, 0);
  }
  const { persons, mode } = planFor(['data/elections/published-graph-ids.json', 'data/database/maps.json']);
  assert.equal(mode, 'data');
  assert.equal(persons, false);
});

test('the plan follows the class of what changed', () => {
  assert.equal(planFor(['packages/map/app/app.js']).mode, 'app');
  assert.equal(planFor(['site/pages/contact.html']).mode, 'code');
  assert.equal(planFor(['functions/_api/records/index.js', 'packages/map/app/app.js']).mode, 'code');
  assert.equal(planFor(['data/database/maps.json']).mode, 'data');
  assert.equal(planFor(['packages/loader/src/ingest-maps.mjs', 'site/index.html']).mode, 'data');
  assert.equal(planFor([]).mode, 'none');
  for (const p of [['packages/map/app/app.js'], ['site/pages/contact.html']]) {
    assert.ok(!planFor(p).plan.some((s) => s.args.includes('records:build')), `${p}: no records build for code`);
  }
  const untracked = classifyChanges([{ path: 'assets/images/x.docx', tracked: false }, { path: 'review-for-phelim/a.txt', tracked: false }]);
  assert.equal(untracked.mode, 'none');
});

test('the data chain runs each step after what it reads', () => {
  const { plan } = planFor(['data/elections-source/dail/2024/x.json']);
  const ids = plan.map((s) => s.id);
  const at = (/** @type {string} */ id) => { const i = ids.indexOf(id); assert.ok(i >= 0, id); return i; };
  assert.deepEqual(ids, [
    'persons', 'timeline-changes', 'ni-local', 'records', 'graph-ids', 'person-addresses', 'catalogue', 'catalogue-check',
    'build', 'records-again', 'local-artefacts', 'stats-home', 'stats-about', 'elections-app', 'records-check', 'check-fast', 'catalogue-tests',
  ]);
  for (const reader of ['graph-ids', 'person-addresses', 'catalogue', 'local-artefacts', 'elections-app']) assert.ok(at('records') < at(reader), reader);
  // The ledgers, the catalogue and the maps index (npm run build) feed the records: the second build follows them all.
  for (const feeder of ['graph-ids', 'person-addresses', 'catalogue', 'build']) assert.ok(at(feeder) < at('records-again'), feeder);
  for (const reader of ['local-artefacts', 'elections-app', 'records-check']) assert.ok(at('records-again') < at(reader), reader);
  assert.ok(at('stats-home') > at('local-artefacts') && at('check-fast') > at('stats-about'));
  // Both records builds skip themselves when tmp/records is already of these inputs, and read the votes.
  for (const s of plan.filter((x) => x.args.includes('records:build'))) {
    assert.equal(s.gate, 'records-stale');
    assert.equal(s.env?.CIVGRAPH_VOTES_DIR, 'C:\\votes');
  }
  assert.equal(plan[0].gate, 'persons-stale');
});

test('the votes directory is read from the publish wrapper', () => {
  assert.equal(votesDirFromWrapper("set -e\nexport CIVGRAPH_VOTES_DIR='C:\\civgraph-data\\votes'\nexec bash x"), 'C:\\civgraph-data\\votes');
  assert.equal(votesDirFromWrapper('export CIVGRAPH_VOTES_DIR="/c/v"'), '/c/v');
  assert.equal(votesDirFromWrapper('# export CIVGRAPH_VOTES_DIR=x'), '');
  assert.equal(votesDirFromWrapper('nothing here'), '');
});
