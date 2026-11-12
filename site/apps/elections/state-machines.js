/**
 * The Elections app's state machines (REFACTOR-PLAN.md section 11; ids EL-01..EL-14 of the arch
 * audit, 11 Nov 2026, D:\civgraph-intake\batch4-2026-11-11\arch-review\ELECTIONS-APP-AUDIT.md
 * section 7), as tables over the shared helper (assets/ui/state/machine.js, the browser copy of
 * packages/core/src/state-machine.mjs), in the pattern of Browse, PRONI Search and Words.
 *
 * Full weight (several entry paths or three or more states; the call sites move a run and the
 * table refuses any other move): ROUTE (EL-01), ENGINE (EL-02), BOUND_BODIES (EL-03), PIVOT_RUN
 * (EL-05), MAP_MODE (EL-07, with its guard mapModeShown), MULTIPLES (EL-08), MAP_LIBRARIES (the map
 * libraries' load, the shape of ENGINE; rf9-ui, 12 Nov 2026).
 * Light weight (a small table, a toggle or a typed set of results): EXTRACTS_INDEX (EL-04),
 * MAP_STATUS (EL-09), SWING_EDITS (EL-10), NOTIONAL_METHOD (EL-11), SHEET_KINDS (EL-12),
 * STAGE_KINDS (EL-13), EMBED (EL-14). EL-06 (pivot state <-> URL) is a value, not a machine.
 *
 * Pure tables and guards, no DOM: tests/unit/ui-state-machines.test.mjs walks every table,
 * including every forbidden move; tests/unit/elections-app-lifecycle.test.mjs the guards.
 */
import { defineMachine, defineToggle } from '../../assets/ui/state/machine.js';

/**
 * EL-01. The app's current route (app.js render()). A navigation (first load, a link, popstate,
 * ctx.navigate) starts loading from any state, also while a view is still loading: the newer
 * view supersedes it and the older one is disposed (lib/lifecycle.js), so it settles nothing.
 *   loading -> rendered | not-found | failed    the view's render() resolved, 404'd or threw
 */
export const ROUTE = defineMachine({
  name: 'elections route',
  initial: 'idle',
  transitions: {
    idle: ['loading'],
    loading: ['loading', 'rendered', 'not-found', 'failed'],
    rendered: ['loading'],
    'not-found': ['loading'],
    failed: ['loading'],
  },
});

/**
 * EL-02. DuckDB-WASM (lib/duck.js openDuckDb): started once, on the first view that needs it. A
 * failed start can be tried again (the next query starts it afresh); a ready engine stays ready.
 */
export const ENGINE = defineMachine({
  name: 'elections duckdb engine',
  initial: 'not-started',
  transitions: {
    'not-started': ['starting'],
    starting: ['ready', 'failed'],
    ready: [],
    failed: ['starting'],
  },
});

/**
 * MapLibre GL and PMTiles (lib/maplibre.js loadMapLibre): loaded once, when the first map view opens.
 * A failed load can be tried again (the next map view loads them afresh); loaded stays loaded.
 */
export const MAP_LIBRARIES = defineMachine({
  name: 'elections map libraries',
  initial: 'not-loaded',
  transitions: {
    'not-loaded': ['loading'],
    loading: ['loaded', 'failed'],
    loaded: [],
    failed: ['loading'],
  },
});

/**
 * EL-03. Which bodies the DuckDB view `rows` reads (lib/duck.js). One owner: queryBodies() binds
 * and queries under one lock, so a query always reads the bodies it asked for, whichever view
 * asked last. bound -> binding when a query names other bodies.
 */
export const BOUND_BODIES = defineMachine({
  name: 'elections bound bodies',
  initial: 'unbound',
  transitions: {
    unbound: ['binding'],
    binding: ['bound', 'failed'],
    bound: ['binding'],
    failed: ['binding'],
  },
});

/**
 * EL-04 (light). The extracts index (lib/duck.js extractsIndex): fetched once when available;
 * while unavailable, each call asks again.
 */
export const EXTRACTS_INDEX = defineMachine({
  name: 'elections extracts index',
  initial: 'unknown',
  transitions: {
    unknown: ['loading'],
    loading: ['available', 'unavailable'],
    available: [],
    unavailable: ['loading'],
  },
});

/**
 * EL-05. One pivot table's runs (views/pivot.js). Each form change starts a run with the
 * settings of that moment; a run started while another is out supersedes it (running ->
 * running), and only the latest run may show its table or its error (lib/lifecycle.js latestRun).
 */
export const PIVOT_RUN = defineMachine({
  name: 'elections pivot run',
  initial: 'idle',
  transitions: {
    idle: ['running'],
    running: ['running', 'shown', 'failed'],
    shown: ['running'],
    failed: ['running'],
  },
});

/** EL-07. What the results map shows; any mode may follow any other (the form's select). */
export const MAP_MODE = defineMachine({
  name: 'elections map mode',
  initial: 'winner',
  transitions: {
    winner: ['turnout', 'share', 'swing'],
    turnout: ['winner', 'share', 'swing'],
    share: ['winner', 'turnout', 'swing'],
    swing: ['winner', 'turnout', 'share'],
  },
});

/** @typedef {'winner' | 'turnout' | 'share' | 'swing'} MapMode */

/** The map modes, with their labels, in the order the form lists them. */
export const MAP_MODES = /** @type {ReadonlyArray<{ mode: MapMode, label: string }>} */ (Object.freeze([
  { mode: 'winner', label: 'Winner' },
  { mode: 'turnout', label: 'Turnout' },
  { mode: 'share', label: 'Party share' },
  { mode: 'swing', label: 'Change in party share' },
]));

/** The map mode a URL asks for, or winner. @param {string | null | undefined} value @returns {MapMode} */
export function mapModeOf(value) {
  return /** @type {MapMode} */ (MAP_MODES.some((m) => m.mode === value) ? value : 'winner');
}

/**
 * EL-07's guard: the mode the map can draw for the mode asked for. Share and swing need a party
 * with votes; swing also needs an earlier election on the same boundaries (`vs`). Without one,
 * swing is drawn as the party's share and the page says why (`reason`); without a party, share
 * and swing fall back to the winner.
 * @param {MapMode} mode
 * @param {{ party: boolean, vs: boolean }} has
 * @returns {{ mode: MapMode, reason: 'no-vs' | 'no-party' | null }}
 */
export function mapModeShown(mode, has) {
  if ((mode === 'share' || mode === 'swing') && !has.party) return { mode: 'winner', reason: 'no-party' };
  if (mode === 'swing' && !has.vs) return { mode: 'share', reason: 'no-vs' };
  return { mode, reason: null };
}

/**
 * EL-08. The small multiples (views/map.js): one drawing at a time. A click while drawing is
 * refused (the button is disabled too); leaving the view aborts the drawing, for good.
 */
export const MULTIPLES = defineMachine({
  name: 'elections small multiples',
  initial: 'idle',
  transitions: {
    idle: ['drawing'],
    drawing: ['done', 'failed', 'aborted'],
    done: ['drawing'],
    failed: ['drawing'],
    aborted: [],
  },
});

/** EL-09 (light). The map's status line: loading, then drawn (with counts) or failed. */
export const MAP_STATUS = defineMachine({
  name: 'elections map status',
  initial: 'loading',
  transitions: { loading: ['drawn', 'failed'], drawn: [], failed: [] },
});

/**
 * EL-10 (light). The swingometer's edits: the base election, or changed by the sliders (each
 * slider move stays edited); Reset goes back to the base.
 */
export const SWING_EDITS = defineMachine({
  name: 'elections swing edits',
  initial: 'base',
  transitions: { base: ['edited'], edited: ['edited', 'base'] },
});

/** The most a swingometer slider or a d.<party> URL value moves a party's share, in points. */
export const SWING_LIMIT = 15;

/** A swing value in points, clamped to the slider's range; null when it is not a number. */
export function clampSwing(/** @type {unknown} */ value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(-SWING_LIMIT, Math.min(SWING_LIMIT, n)) : null;
}

/** EL-11 (light). How the notional results share out old areas: by residents or by land area. */
export const NOTIONAL_METHOD = defineToggle('elections notional method', ['population', 'areal']);

/**
 * EL-12 (light). What a contest's count sheet can show (lib/count.js countSheet):
 *   stages     real stage-by-stage totals: the full sheet, transfers and the flow diagram;
 *   order      the count at which each candidate was elected or excluded, totals not given;
 *   single     one round of votes (first past the post, or a one-count STV result);
 *   unopposed  no poll: every member returned unopposed (packages/core/src/unopposed.mjs);
 *   none       no votes recorded and not known to be unopposed ("votes not recorded").
 * @typedef {'stages' | 'order' | 'single' | 'unopposed' | 'none'} SheetKind
 */
export const SHEET_KINDS = /** @type {readonly SheetKind[]} */ (Object.freeze(['stages', 'order', 'single', 'unopposed', 'none']));

/**
 * EL-13 (light). What a transfer stage distributes (lib/count.js transferStages).
 * @typedef {'surplus' | 'exclusion'} StageKind
 */
export const STAGE_KINDS = /** @type {readonly StageKind[]} */ (Object.freeze(['surplus', 'exclusion']));

/** EL-14 (light). The embeddable widget (embed/embed.js): loading, then shown or failed. */
export const EMBED = defineMachine({
  name: 'elections embed',
  initial: 'loading',
  transitions: { loading: ['shown', 'failed'], shown: [], failed: [] },
});

/**
 * Move a run to `next` unless it is there already (a toggle or a self-less table driven by a
 * value that may repeat). Returns the state.
 * @template {string} S
 * @param {import('../../assets/ui/state/machine.js').Run<S>} run
 * @param {S} next
 */
export function settle(run, next) {
  return run.state() === next ? next : run.to(next);
}
