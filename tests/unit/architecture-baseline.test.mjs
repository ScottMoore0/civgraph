// The architecture baseline (config/architecture-baseline.json, docs/ARCHITECTURE-RULES.md R14) only
// shrinks. It holds today's findings of check:architecture as a count per check per file; a count
// may fall (fix the findings, then `node scripts/check/architecture.mjs --write-baseline`) but never
// rise, and no file or check may join it. Compared with the baseline on main (or ARCH_BASELINE_REF):
// a branch that adds to it fails here. When main has no baseline yet (the landing that adds it) or
// git cannot show it (a shallow clone), only the file's own shape is checked.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { BASELINE_PATH, baselineGrowth, CHECKS } from '../../scripts/check/architecture.mjs';

const ROOT = new URL('../../', import.meta.url);
const baseline = JSON.parse(readFileSync(new URL(BASELINE_PATH, ROOT), 'utf8'));
const config = JSON.parse(readFileSync(new URL('config/architecture.json', ROOT), 'utf8'));

/** The baseline as committed on the first ref that has it, or null. */
function committedBaseline() {
  for (const ref of [process.env.ARCH_BASELINE_REF, 'main', 'origin/main'].filter(Boolean)) {
    try {
      return { ref, json: JSON.parse(execFileSync('git', ['show', `${ref}:${BASELINE_PATH}`], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 1 << 26 })) };
    } catch { /* no such ref, or no baseline on it yet */ }
  }
  return null;
}

test('the baseline names only checks that take one, with positive whole counts', () => {
  const ids = new Set(CHECKS.map((c) => c.id));
  for (const [id, files] of Object.entries(baseline)) {
    if (id === '//') continue;
    assert.ok(ids.has(id), `${id} is not a check of check:architecture`);
    assert.ok(!config.noBaseline.includes(id), `${id} must be clean: it takes no baseline`);
    for (const [file, n] of Object.entries(files)) assert.ok(Number.isInteger(n) && n > 0, `${id} ${file}: ${n}`);
  }
});

test('the baseline only shrinks: no count above, and no entry beyond, the committed one', (t) => {
  const committed = committedBaseline();
  if (!committed) {
    t.diagnostic(`no committed ${BASELINE_PATH} on main or origin/main: nothing to compare with yet`);
    return;
  }
  assert.deepEqual(baselineGrowth(committed.json, baseline), [], `${BASELINE_PATH} grew against ${committed.ref}: fix the new findings or mark them arch-ok R<n>: reason; the baseline is today's debt, not a place for new code`);
});
