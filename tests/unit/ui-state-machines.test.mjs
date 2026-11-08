/**
 * The state machines of Browse and the PRONI Search app (browse/state-machines.js,
 * apps/proni-search/state-machines.js; REFACTOR-PLAN.md section 11, catalogue stream 7):
 * every table allows exactly the moves it lists, the moves the pages make are walks the tables
 * allow, and the moves they must never make are refused. The pages themselves are driven by
 * tests/browser/ui-state-machines.spec.cjs.
 *
 * Also holds the served helper (assets/ui/state/machine.js) byte-identical to the shared one
 * (packages/core/src/state-machine.mjs) once that is in the tree.
 *
 *   node --test tests/unit/ui-state-machines.test.mjs
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import * as browse from '../../site/browse/state-machines.js';
import * as proni from '../../site/apps/proni-search/state-machines.js';
import * as words from '../../site/apps/words/state-machines.js';
import { THEME_PREFERENCE } from '../../packages/ui/assets/state/theme.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const MACHINES = {
  'browse ROUTER': browse.ROUTER,
  'browse CONTRIBUTOR_FORM': browse.CONTRIBUTOR_FORM,
  'browse CONTRIBUTOR_SUBMISSION': browse.CONTRIBUTOR_SUBMISSION,
  'browse BALLOT_LABELS': browse.BALLOT_LABELS,
  'browse PRINTED_LABELS': browse.PRINTED_LABELS,
  'browse CONTRIBUTOR_EDITOR': browse.CONTRIBUTOR_EDITOR,
  'proni RESULTS': proni.RESULTS,
  'proni VIEW': proni.VIEW,
  'proni AZ_SCOPE': proni.AZ_SCOPE,
  'proni CARD_CHILDREN': proni.CARD_CHILDREN,
  'proni CARD_DESCRIPTION': proni.CARD_DESCRIPTION,
  'proni MODAL': proni.MODAL,
  'proni COPY_FLASH': proni.COPY_FLASH,
  'words TOOLTIP': words.TOOLTIP,
  'site THEME_PREFERENCE': THEME_PREFERENCE,
};

test('every move not in a table is refused, and every move in it is allowed', () => {
  for (const [label, machine] of Object.entries(MACHINES)) {
    for (const from of machine.states) {
      for (const to of machine.states) {
        const listed = machine.transitions[from].includes(to);
        assert.equal(machine.can(from, to), listed, `${label}: ${from} -> ${to}`);
        const run = machine.start(from);
        if (listed) assert.equal(run.to(to), to);
        else assert.throws(() => run.to(to), /is not a transition/, `${label}: ${from} -> ${to} should throw`);
      }
    }
  }
});

test('Browse router (UI-01): a navigation renders or fails; nothing settles an idle router', () => {
  const m = browse.ROUTER;
  m.assertPath(['routing', 'rendered', 'routing', 'routing', 'failed', 'routing', 'rendered']);
  for (const bad of [['idle', 'rendered'], ['idle', 'failed'], ['rendered', 'rendered'], ['rendered', 'failed'], ['failed', 'rendered']]) {
    assert.equal(m.can(bad[0], bad[1]), false, bad.join(' -> '));
  }
});

test('Browse contributor form (UI-02): the paths the page takes', () => {
  const m = browse.CONTRIBUTOR_FORM;
  // Submit map; Cancel.
  m.assertPath(['map-submission', 'closed']);
  // Propose edit: openEditSubmissionForm, then showInlineEditor closes the dialog and shows the
  // editor; then Submit map closes the editor and opens the dialog.
  m.assertPath(['metadata-edit', 'closed', 'metadata-edit', 'closed', 'map-submission']);
  assert.throws(() => m.start().to(/** @type {any} */ ('editing')), /is not a transition/);
});

test('Browse contributor submission: one answer per submission, no second submit while one is out', () => {
  const m = browse.CONTRIBUTOR_SUBMISSION;
  m.assertPath(['submitting', 'sent']);
  m.assertPath(['submitting', 'failed']);
  assert.equal(m.can('submitting', 'submitting'), false);
  assert.equal(m.can('idle', 'sent'), false);
  assert.equal(m.can('sent', 'failed'), false);
  assert.equal(m.start('sent').done(), true);
  for (const s of m.states) assert.ok(browse.SUBMISSION_STATUS_CLASS[s], `no status class for ${s}`);
});

test('Browse toggles: settle() moves only when the value changes', () => {
  const run = browse.BALLOT_LABELS.start();
  assert.equal(browse.settle(run, 'hidden'), 'hidden');
  assert.equal(browse.settle(run, 'shown'), 'shown');
  assert.equal(browse.settle(run, 'shown'), 'shown');
  assert.deepEqual(run.history(), ['hidden', 'shown']);
  assert.throws(() => run.to('shown'), /is not a transition/);
});

test('PRONI results (UI-03): pages until done; only a new query leaves done or failed', () => {
  const m = proni.RESULTS;
  m.assertPath(['loading', 'idle', 'loading', 'idle', 'loading', 'done', 'idle', 'loading', 'failed', 'idle', 'done']);
  // A new query while a page is loading.
  m.assertPath(['loading', 'idle', 'loading']);
  for (const bad of [['done', 'loading'], ['failed', 'loading'], ['loading', 'loading'], ['idle', 'failed'], ['done', 'failed']]) {
    assert.equal(m.can(bad[0], bad[1]), false, bad.join(' -> '));
  }
});

test('PRONI view (UI-04): any view from any view, nothing else', () => {
  const m = proni.VIEW;
  assert.deepEqual([...m.states].sort(), ['ecat', 'record', 'search']);
  m.assertPath(['record', 'search', 'ecat', 'record', 'record', 'search']);
});

test('PRONI A-Z scope: a letter, the same letter again, All on and off', () => {
  const m = proni.AZ_SCOPE;
  m.assertPath(['letter', 'letter', 'none', 'all', 'none', 'all', 'letter', 'all']);
  assert.equal(m.can('all', 'all'), false);
  assert.equal(m.can('none', 'none'), false);
});

test('PRONI card children and description: no reload while loading, no load once expanded', () => {
  const c = proni.CARD_CHILDREN;
  c.assertPath(['loading', 'expanded', 'collapsed', 'loading', 'collapsed']);
  assert.equal(c.can('loading', 'loading'), false);
  assert.equal(c.can('expanded', 'loading'), false);
  assert.equal(c.can('collapsed', 'expanded'), false);
  const d = proni.CARD_DESCRIPTION;
  d.assertPath(['loading', 'preview', 'loading', 'expanded', 'expanded']);
  d.assertPath(['expanded']);
  assert.equal(d.can('expanded', 'preview'), false);
  assert.equal(d.can('expanded', 'loading'), false);
});

test('Words chart tooltip: hidden and shown, no move to where it already is', () => {
  assert.deepEqual(words.TOOLTIP.states, ['hidden', 'shown']);
  words.TOOLTIP.assertPath(['shown', 'hidden', 'shown']);
  assert.throws(() => words.TOOLTIP.assertTransition('shown', 'shown'), /is not a transition/);
});

test('the served helper is the shared one, byte for byte', () => {
  const shared = path.join(ROOT, 'packages/core/src/state-machine.mjs');
  if (!existsSync(shared)) return; // until rf-records lands packages/core/src/state-machine.mjs
  assert.equal(readFileSync(path.join(ROOT, 'packages/ui/assets/state/machine.js'), 'utf8'), readFileSync(shared, 'utf8'),
    'packages/ui/assets/state/machine.js (served as /assets/ui/state/machine.js) must be a copy of packages/core/src/state-machine.mjs (then re-stamp the import maps)');
});
