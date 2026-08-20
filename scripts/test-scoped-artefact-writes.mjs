#!/usr/bin/env node
/**
 * A scoped run must describe what it touched, not redefine the artefact.
 *
 * WHY THIS EXISTS
 *
 * Twice now, a `--ids` run has quietly destroyed records it was never asked to consider.
 *
 *   2026-07-31  promote-test-converted-layers --ids <19 layers> rewrote maps-test.json
 *               from its own report and deleted 15 unrelated working layers.
 *   2026-08-19  verify-test-pmtiles-cdn --ids <5 layers> replaced all 819 rows of
 *               cdn-range-report.json with 5. write-test-cdn-upload-manifest then read
 *               that truncated report and cleared remoteVerified for 330 layers whose
 *               archives were fine. Measured, not estimated: 331 -> 1.
 *
 * Both tools reported success. "Rewrite the file from what I processed" and "delete
 * everything I did not process" are the same instruction unless something compares.
 *
 * The July incident produced writeArtefactJson, which refuses to shrink a collection.
 * That is the right rule for a generator that always produces the whole thing and the
 * wrong one for a deliberately partial run -- which is why the three tools in the
 * August incident had never adopted it. mergeArtefactRecords is the missing half.
 *
 * Run: node scripts/test-scoped-artefact-writes.mjs
 */
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { mergeArtefactRecords, writeArtefactJson } from './lib/safe-artefact-write.mjs';

let failures = 0;
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures += 1;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : ` — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`}`);
}

const dir = mkdtempSync(join(tmpdir(), 'civgraph-scoped-'));
const artefact = join(dir, 'report.json');
const seed = { results: [{ layerId: 'a', ok: true }, { layerId: 'b', ok: true }, { layerId: 'c', ok: false }] };
writeFileSync(artefact, JSON.stringify(seed, null, 2));

console.log('mergeArtefactRecords:');

// THE AUGUST INCIDENT. A run that saw only 'b' must leave 'a' and 'c' exactly as found.
{
  const m = mergeArtefactRecords(artefact, [{ layerId: 'b', ok: false }], { collection: 'results', idKey: 'layerId' });
  check('scoped run keeps untouched rows', m.records.map((r) => r.layerId), ['a', 'b', 'c']);
  check('  the touched row is replaced', m.records.find((r) => r.layerId === 'b').ok, false);
  check('  counts report what happened', [m.updated, m.added, m.kept], [1, 0, 2]);
}

// Order is preserved and new rows append, so a scoped run makes a readable diff rather
// than reshuffling 800 lines.
{
  const m = mergeArtefactRecords(artefact, [{ layerId: 'd', ok: true }, { layerId: 'a', ok: false }], { collection: 'results', idKey: 'layerId' });
  check('new rows append, existing order held', m.records.map((r) => r.layerId), ['a', 'b', 'c', 'd']);
  check('  counts report what happened', [m.updated, m.added, m.kept], [1, 1, 2]);
}

// A first write has nothing to lose and must not invent anything.
{
  const m = mergeArtefactRecords(join(dir, 'absent.json'), [{ layerId: 'x' }], { collection: 'results', idKey: 'layerId' });
  check('absent artefact -> fresh rows only', m.records.map((r) => r.layerId), ['x']);
}

// An unreadable artefact must not silently discard rows either -- but it also cannot
// merge with what it cannot parse. Treating it as a first write is the honest option;
// what matters is that it does not throw and lose the run.
{
  const broken = join(dir, 'broken.json');
  writeFileSync(broken, '{ not json');
  const m = mergeArtefactRecords(broken, [{ layerId: 'x' }], { collection: 'results', idKey: 'layerId' });
  check('unparseable artefact -> fresh rows only', m.records.map((r) => r.layerId), ['x']);
}

// The collection name is not guessable and a wrong guess would silently merge into
// nothing, which reads exactly like the bug this prevents.
{
  let threw = false;
  try { mergeArtefactRecords(artefact, [], {}); } catch { threw = true; }
  check('missing collection name throws', threw, true);
}

console.log('writeArtefactJson (the July half, still enforced):');
{
  let threw = false;
  try {
    writeArtefactJson(artefact, { results: [{ layerId: 'a', ok: true }] }, { collection: 'results', idKey: 'layerId' });
  } catch { threw = true; }
  check('refuses to shrink a collection', threw, true);
  const ok = writeArtefactJson(artefact, { results: [{ layerId: 'a', ok: true }] }, { collection: 'results', idKey: 'layerId', allowDeletions: true });
  check('  unless deletions are explicit', ok.removed, 2);
}

// A flag a script does not implement must abort it. The August over-run happened
// because switch-test-pmtiles-to-cdn.mjs accepted --ids and discarded it.
console.log('assertKnownFlags:');
{
  const probe = join(dir, 'probe.mjs');
  const lib = new URL('./lib/safe-artefact-write.mjs', import.meta.url).href;
  writeFileSync(probe, `import { assertKnownFlags } from ${JSON.stringify(lib)};\nassertKnownFlags(['--ids']);\nconsole.log('RAN');\n`);
  const run = (...args) => spawnSync(process.execPath, [probe, ...args], { encoding: 'utf8' });
  check('unknown flag aborts', run('--nope').status, 2);
  check('  and does not run the body', /RAN/.test(run('--nope').stdout), false);
  check('known flag runs', run('--ids', 'a,b').status, 0);
  check('no flags runs', run().status, 0);
  check("a value is not mistaken for a flag", run('--ids', 'a,b').stdout.trim(), 'RAN');
}

rmSync(dir, { recursive: true, force: true });

console.log('');
if (failures) {
  console.error(`FAIL: ${failures} check(s) failed.`);
  process.exit(1);
}
console.log('PASS: scoped runs merge, whole-collection runs refuse to shrink, unknown flags abort.');
