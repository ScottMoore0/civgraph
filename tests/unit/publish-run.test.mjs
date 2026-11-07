// The publish stages (scripts/publish/publish-run.mjs, catalogue PL-01) and publish.sh's use of them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkPublishTransition, main, previousRunWarning, publishRun } from '../../scripts/publish/publish-run.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Walk `path` from start with the guards; return the first refusal or null. */
function walk(stages, dry) {
  let at = 'start';
  for (const next of stages) {
    const verdict = checkPublishTransition(at, next, { dry });
    if (!verdict.ok) return verdict.reason;
    at = next;
  }
  return null;
}

test('every path publish.sh takes is allowed', () => {
  assert.equal(walk(['built', 'loaded', 'pushed', 'logged'], false), null);
  assert.equal(walk(['built', 'loaded', 'downloads', 'pushed', 'logged'], false), null);
  assert.equal(walk(['built', 'would-load', 'logged'], true), null);
  assert.equal(walk(['built', 'would-load', 'downloads', 'logged'], true), null);
  assert.equal(walk(['refused'], false), null);
  assert.equal(walk(['aborted-before-load'], true), null);
  assert.equal(walk(['built', 'load-failed'], false), null);
  assert.equal(walk(['built', 'loaded', 'aborted-after-load'], false), null);
  assert.equal(walk(['built', 'loaded', 'downloads', 'aborted-after-load'], false), null);
});

test('out-of-order and wrong-mode moves are refused', () => {
  assert.match(walk(['loaded'], false), /start -> loaded is not allowed/);
  assert.match(walk(['built', 'pushed'], false), /built -> pushed is not allowed/);
  assert.match(walk(['built', 'loaded', 'logged'], false), /loaded -> logged/);
  assert.match(walk(['built', 'loaded'], true), /a dry run loads and pushes nothing/);
  assert.match(walk(['built', 'would-load'], false), /only a dry run/);
  assert.match(walk(['built', 'would-load', 'downloads', 'pushed'], true), /a dry run/);
  assert.match(walk(['refused'], true), /a dry run/);
  for (const end of ['logged', 'refused', 'aborted-before-load', 'load-failed', 'aborted-after-load']) {
    assert.ok(publishRun.start(end).done(), `${end} is final`);
  }
});

test('publish.sh names only stages the machine has', () => {
  const sh = readFileSync(path.join(ROOT, 'scripts/publish/publish.sh'), 'utf8');
  const named = [...sh.matchAll(/\b(?:stage to|aborted) ([a-z-]+)/g)].map((m) => m[1]);
  assert.ok(named.length >= 9, named.join(','));
  for (const name of named) assert.ok(publishRun.states.includes(name), name);
});

test('the run is recorded, and the next run warns about an unsettled one', () => {
  const work = mkdtempSync(path.join(tmpdir(), 'publish-run-'));
  const log = console.log;
  const lines = [];
  console.log = (line) => lines.push(String(line));
  const errors = console.error;
  console.error = () => {};
  try {
    assert.equal(main([work, 'start']), 0);
    assert.equal(main([work, 'to', 'built']), 0);
    assert.equal(main([work, 'to', 'loaded']), 0);
    assert.equal(main([work, 'to', 'logged']), 1, 'refused: loaded -> logged');
    assert.equal(main([work, 'to', 'aborted-after-load']), 0);
    const saved = JSON.parse(readFileSync(path.join(work, 'publish-run.json'), 'utf8'));
    assert.deepEqual(saved.run.history, ['start', 'built', 'loaded', 'aborted-after-load']);
    assert.equal(main([work, 'start', '--dry']), 0);
    assert.match(lines.join('\n'), /loaded D1 but did not push/);
  } finally {
    console.log = log;
    console.error = errors;
    rmSync(work, { recursive: true, force: true });
  }
  assert.equal(previousRunWarning({ stage: 'logged' }), null);
  assert.equal(previousRunWarning(null), null);
  assert.match(previousRunWarning({ stage: 'load-failed' }), /D1 may hold part/);
  assert.match(previousRunWarning({ stage: 'loaded' }), /without finishing/);
});
