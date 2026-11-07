// The person-id rebuild loop (scripts/ingest/persons/rebuild-person-ids.mjs) with fake commands:
// the same order as the shell script it replaced, and the states it could not express.
import assert from 'node:assert/strict';
import test from 'node:test';
import { MAX_PASSES, rebuild, REBUILD } from '../../scripts/ingest/persons/rebuild-person-ids.mjs';

const ORDER_HEAD = [
  'node scripts/build/build-test2-election-manifest.mjs --x',
  'node scripts/build/build-test2-election-summaries.mjs',
  'python scripts/ingest/persons/build_person_registry_v2.py --force',
  'python scripts/ingest/persons/apply_person_ids_v2.py',
];
const MERGE = 'python scripts/ingest/persons/merge_person_ids.py';
const APPLY = 'python scripts/ingest/persons/apply_person_ids_v2.py';
const TAIL = ['python scripts/ingest/persons/build_name_registry.py', 'python scripts/ingest/persons/audit_person_ids.py'];

/** answers: command line -> list of { status, output } handed out in turn (last one repeats) */
function harness(answers = {}) {
  const calls = [];
  const said = [];
  const logged = [];
  const states = [];
  const used = {};
  const io = {
    exec: (argv) => {
      const cmd = argv.join(' ');
      calls.push(cmd);
      const list = answers[cmd] || [{ status: 0, output: 'ok\n' }];
      const i = Math.min(used[cmd] = (used[cmd] ?? -1) + 1, list.length - 1);
      return list[i];
    },
    log: (t) => logged.push(t),
    say: (t) => said.push(t),
    sleep: () => {},
    record: (s) => states.push(s),
  };
  return { io, calls, said, logged, states };
}

test('the table: a clean run, and no way back once audited, failed or stopped for relatives', () => {
  REBUILD.assertPath(['manifest', 'summaries', 'registry', 'applied', 'merging', 'reapplied', 'merging', 'converged', 'name-registry', 'audited']);
  for (const s of ['audited', 'failed', 'needs-relatives']) assert.ok(REBUILD.start(s).done(), s);
  assert.equal(REBUILD.can('manifest', 'applied'), false, 'the registry cannot be skipped');
  assert.equal(REBUILD.can('merging', 'name-registry'), false, 'the loop ends converged or not-converged, never silently');
});

test('converges on the second pass: the same commands as the shell script, then PERSON IDS OK', () => {
  const h = harness({ [MERGE]: [{ status: 0, output: 'merged 3\n' }, { status: 0, output: 'Nothing to merge\n' }] });
  assert.equal(rebuild({ manifestArgs: ['--x'] }, h.io), 0);
  assert.deepEqual(h.calls, [...ORDER_HEAD, MERGE, APPLY, MERGE, ...TAIL]);
  assert.deepEqual(h.said, ['PERSON IDS OK']);
  assert.ok(h.logged.includes('merge loop done after 2 pass(es)\n'));
  assert.deepEqual(h.states.slice(-3), ['converged', 'name-registry', 'audited']);
});

test('never converging: six passes, then a NOT CONVERGED warning before carrying on as before', () => {
  const h = harness({ [MERGE]: [{ status: 0, output: 'merged 1\n' }] });
  assert.equal(rebuild({}, h.io), 0);
  assert.equal(h.calls.filter((c) => c === MERGE).length, MAX_PASSES);
  assert.match(h.said[0], /^NOT CONVERGED/);
  assert.equal(h.said[1], 'PERSON IDS OK');
  assert.ok(h.states.includes('not-converged'));
});

test('a merge pass that needs the relatives harvest stops with exit 2 and lists them', () => {
  const out = 'a\n3 people without their pages on file:\n  12\n  34\n  56\nend\n';
  const h = harness({ [MERGE]: [{ status: 0, output: out }] });
  assert.equal(rebuild({}, h.io), 2);
  assert.deepEqual(h.said, ['NEEDS RELATIVES HARVEST', '3 people without their pages on file:\n  12\n  34\n  56']);
  assert.equal(h.states.at(-1), 'needs-relatives');
});

test('a lock error retries that command; a plain failure stops the run; the earlier lock error no longer counts', () => {
  let h = harness({ [ORDER_HEAD[1]]: [{ status: 1, output: 'EBUSY: resource busy\n' }, { status: 0, output: 'ok\n' }] });
  assert.equal(rebuild({ manifestArgs: ['--x'] }, h.io), 0);
  assert.equal(h.calls.filter((c) => c === ORDER_HEAD[1]).length, 2);
  assert.ok(h.logged.some((l) => l.startsWith('retry 1: node scripts/build/build-test2-election-summaries.mjs')));
  h = harness({
    [ORDER_HEAD[0]]: [{ status: 1, output: 'EPERM\n' }, { status: 0, output: 'ok\n' }],
    [ORDER_HEAD[2]]: [{ status: 1, output: 'Traceback: KeyError\n' }],
  });
  assert.equal(rebuild({ manifestArgs: ['--x'] }, h.io), 1);
  assert.equal(h.calls.filter((c) => c === ORDER_HEAD[2]).length, 1, 'not retried because of the manifest\'s earlier EPERM');
  assert.deepEqual(h.said, [`FAILED: ${ORDER_HEAD[2]}`]);
  assert.equal(h.states.at(-1), 'failed');
  h = harness({ [ORDER_HEAD[1]]: [{ status: 1, output: 'Errno 22\n' }] });
  assert.equal(rebuild({ manifestArgs: ['--x'] }, h.io), 1);
  assert.equal(h.calls.filter((c) => c === ORDER_HEAD[1]).length, 4);
  assert.deepEqual(h.said, [`FAILED after retries: ${ORDER_HEAD[1]}`]);
});
