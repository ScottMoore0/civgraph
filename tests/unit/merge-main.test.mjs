// tools/merge-main.mjs: the rules that resolve main's mechanical conflicts on the restructure branch.
import test from 'node:test';
import assert from 'node:assert/strict';
import { conflictHunks, mergeChain, merge3, onlyTokens, takeOurs } from '../../tools/merge-main.mjs';

const conflicted = [
  'a\n',
  '<<<<<<< HEAD\n',
  '  <script type="module" src="/app/build/app.bundle.js?v=76ce9e12014a"></script>\n',
  '=======\n',
  '  <script type="module" src="/app/build/app.bundle.js?v=37bcf47555ab"></script>\n',
  '>>>>>>> main\n',
  'b\n',
].join('');

test('a hunk that differs only in cache tokens is recognised, and ours is kept', () => {
  const hunks = conflictHunks(conflicted);
  assert.equal(hunks.length, 1);
  assert.ok(onlyTokens(hunks[0]));
  assert.equal(takeOurs(conflicted), 'a\n  <script type="module" src="/app/build/app.bundle.js?v=76ce9e12014a"></script>\nb\n');
  assert.ok(onlyTokens({ ours: "const VERSION = 'root-maplibre-sw-76ce9e12014a';\n", theirs: "const VERSION = 'root-maplibre-sw-37bcf47555ab';\n" }));
});

test('a hunk with any other difference is not a token hunk', () => {
  assert.ok(!onlyTokens({ ours: 'parties: { singular: "Party" },\n', theirs: 'parties: { singular: "Party", detailDir: "parties" },\n' }));
});

test('a command chain keeps both sides: main\'s additions at main\'s place, ours removals kept', () => {
  const base = 'a && b && c';
  const ours = 'a && c && x';           // ours removed b, added x
  const theirs = 'a && b && c && d';    // main added d
  assert.equal(mergeChain(base, ours, theirs).value, 'a && c && d && x');
  // main removed c: removed here too
  assert.equal(mergeChain(base, ours, 'a && b').value, 'a && x');
});

test('a records builder main adds to the Pages build is not added back here', () => {
  const ctx = { notes: [], conflicts: [] };
  const merged = merge3(
    { scripts: { build: 'node scripts/a.mjs && node scripts/build-party-profiles.mjs && node scripts/z.mjs' } },
    { scripts: { build: 'node scripts/a.mjs && node scripts/z.mjs' } },
    { scripts: { build: 'node scripts/a.mjs && node scripts/build-party-profiles.mjs && node scripts/build-office-pages.mjs && node scripts/z.mjs' } },
    [], ctx,
  );
  assert.equal(merged.scripts.build, 'node scripts/a.mjs && node scripts/z.mjs');
  assert.equal(ctx.conflicts.length, 0);
  assert.match(ctx.notes.join('\n'), /build-office-pages\.mjs.*records:build/);
});

test('package keys: one-sided changes win, new keys from main are kept, a real clash is reported', () => {
  const ctx = { notes: [], conflicts: [] };
  const merged = merge3(
    { scripts: { x: '1', y: '1' } },
    { scripts: { x: '2', y: '1' } },
    { scripts: { x: '1', y: '3', z: 'new' } },
    [], ctx,
  );
  assert.deepEqual(merged, { scripts: { x: '2', y: '3', z: 'new' } });
  const clash = { notes: [], conflicts: [] };
  merge3({ v: '1' }, { v: '2' }, { v: '3' }, [], clash);
  assert.equal(clash.conflicts.length, 1);
});
