/**
 * The state machines of Browse, the PRONI Search app, Words and the Elections app
 * (browse/state-machines.js, apps/proni-search/state-machines.js, apps/words/state-machines.js,
 * apps/elections/state-machines.js; REFACTOR-PLAN.md section 11, catalogue stream 7):
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
import * as elections from '../../site/apps/elections/state-machines.js';
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
  'elections ROUTE': elections.ROUTE,
  'elections ENGINE': elections.ENGINE,
  'elections BOUND_BODIES': elections.BOUND_BODIES,
  'elections EXTRACTS_INDEX': elections.EXTRACTS_INDEX,
  'elections PIVOT_RUN': elections.PIVOT_RUN,
  'elections MAP_MODE': elections.MAP_MODE,
  'elections MULTIPLES': elections.MULTIPLES,
  'elections MAP_STATUS': elections.MAP_STATUS,
  'elections SWING_EDITS': elections.SWING_EDITS,
  'elections NOTIONAL_METHOD': elections.NOTIONAL_METHOD,
  'elections EMBED': elections.EMBED,
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

test('Elections route (EL-01): a navigation from anywhere loads; only a loading route settles', () => {
  const m = elections.ROUTE;
  m.assertPath(['loading', 'rendered', 'loading', 'loading', 'not-found', 'loading', 'failed', 'loading', 'rendered']);
  for (const settled of ['rendered', 'not-found', 'failed']) {
    assert.equal(m.can('idle', settled), false, `idle -> ${settled}`);
    for (const other of ['rendered', 'not-found', 'failed']) assert.equal(m.can(settled, other), false, `${settled} -> ${other}`);
  }
});

test('Elections DuckDB engine (EL-02): starts once; a failed start may be retried; ready stays ready', () => {
  const m = elections.ENGINE;
  m.assertPath(['starting', 'failed', 'starting', 'ready']);
  assert.equal(m.start('ready').done(), true);
  for (const bad of [['not-started', 'ready'], ['starting', 'starting'], ['failed', 'ready'], ['ready', 'starting']]) {
    assert.equal(m.can(bad[0], bad[1]), false, bad.join(' -> '));
  }
});

test('Elections bound bodies (EL-03): rows is rebound only through binding, never left half-bound', () => {
  const m = elections.BOUND_BODIES;
  m.assertPath(['binding', 'bound', 'binding', 'failed', 'binding', 'bound']);
  for (const bad of [['unbound', 'bound'], ['bound', 'bound'], ['failed', 'bound'], ['binding', 'binding']]) {
    assert.equal(m.can(bad[0], bad[1]), false, bad.join(' -> '));
  }
});

test('Elections pivot run (EL-05): a newer run supersedes a running one; a settled run needs a new run', () => {
  const m = elections.PIVOT_RUN;
  m.assertPath(['running', 'running', 'shown', 'running', 'failed', 'running', 'shown']);
  for (const bad of [['idle', 'shown'], ['shown', 'failed'], ['failed', 'shown'], ['shown', 'shown']]) {
    assert.equal(m.can(bad[0], bad[1]), false, bad.join(' -> '));
  }
});

test('Elections map mode (EL-07): every mode reaches every other; the guard draws what the data allows', () => {
  const m = elections.MAP_MODE;
  assert.deepEqual([...m.states].sort(), elections.MAP_MODES.map((x) => x.mode).sort());
  m.assertPath(['swing', 'share', 'turnout', 'winner', 'share']);
  for (const s of m.states) assert.equal(m.can(s, s), false, `${s} -> ${s}`);
  assert.deepEqual(elections.mapModeShown('swing', { party: true, vs: false }), { mode: 'share', reason: 'no-vs' });
  assert.deepEqual(elections.mapModeShown('swing', { party: false, vs: true }), { mode: 'winner', reason: 'no-party' });
  assert.deepEqual(elections.mapModeShown('share', { party: false, vs: false }), { mode: 'winner', reason: 'no-party' });
  assert.deepEqual(elections.mapModeShown('swing', { party: true, vs: true }), { mode: 'swing', reason: null });
  assert.deepEqual(elections.mapModeShown('turnout', { party: false, vs: false }), { mode: 'turnout', reason: null });
  assert.equal(elections.mapModeOf('nonsense'), 'winner');
  assert.equal(elections.mapModeOf('swing'), 'swing');
});

test('Elections small multiples (EL-08): no second drawing while one runs; leaving aborts for good', () => {
  const m = elections.MULTIPLES;
  m.assertPath(['drawing', 'done', 'drawing', 'failed', 'drawing', 'aborted']);
  assert.equal(m.can('drawing', 'drawing'), false, 'a second click while drawing');
  assert.equal(m.start('aborted').done(), true);
  assert.equal(m.can('idle', 'done'), false);
});

test('Elections light machines (EL-04, 09, 10, 11, 14) and result sets (EL-12, 13)', () => {
  elections.EXTRACTS_INDEX.assertPath(['loading', 'unavailable', 'loading', 'available']);
  assert.equal(elections.EXTRACTS_INDEX.can('available', 'loading'), false, 'an available index is not fetched again');
  elections.MAP_STATUS.assertPath(['drawn']);
  assert.equal(elections.MAP_STATUS.can('drawn', 'failed'), false);
  elections.SWING_EDITS.assertPath(['edited', 'edited', 'base', 'edited']);
  assert.equal(elections.SWING_EDITS.can('base', 'base'), false);
  assert.deepEqual(elections.NOTIONAL_METHOD.states, ['population', 'areal']);
  elections.EMBED.assertPath(['failed']);
  assert.equal(elections.EMBED.can('shown', 'loading'), false);
  assert.deepEqual([...elections.SHEET_KINDS].sort(), ['none', 'order', 'single', 'stages', 'unopposed']);
  assert.deepEqual([...elections.STAGE_KINDS].sort(), ['exclusion', 'surplus']);
  const run = elections.NOTIONAL_METHOD.start();
  assert.equal(elections.settle(run, 'population'), 'population');
  assert.equal(elections.settle(run, 'areal'), 'areal');
  assert.deepEqual(run.history(), ['population', 'areal']);
});

test('the served helper is the shared one: one source, no copy', async () => {
  // /assets/ui/state/machine.js is served from packages/core/src/state-machine.mjs itself
  // (packages/served.json), and the package path is a re-export of it for Node, tsc and bundles.
  const { sourceOf } = await import('../../scripts/build/site.mjs');
  assert.equal(sourceOf('assets/ui/state/machine.js'), 'packages/core/src/state-machine.mjs');
  assert.equal(sourceOf('assets/ui/state/theme.js'), 'packages/ui/assets/state/theme.js', 'the rest of the folder is still the package');
  const shim = readFileSync(path.join(ROOT, 'packages/ui/assets/state/machine.js'), 'utf8');
  assert.deepEqual(shim.split(/\r?\n/).filter((l) => l && !l.startsWith('//')), ["export * from '../../../core/src/state-machine.mjs';"],
    'packages/ui/assets/state/machine.js only re-exports the core helper: edit packages/core/src/state-machine.mjs');
  const core = await import('../../packages/core/src/state-machine.mjs');
  const viaShim = await import('../../site/assets/ui/state/machine.js');
  assert.deepEqual(Object.keys(viaShim).sort(), Object.keys(core).sort());
  for (const k of Object.keys(core)) assert.equal(viaShim[k], core[k], `${k} is the core export itself`);
});
