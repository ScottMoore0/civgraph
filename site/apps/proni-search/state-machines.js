/**
 * The PRONI Search app's state machines (REFACTOR-PLAN.md section 11; catalogue ids UI-03,
 * UI-04, UI-L), as tables over the shared helper (assets/ui/state/machine.js, the browser
 * copy of packages/core/src/state-machine.mjs).
 *
 * app.js runs them; tests/unit/ui-state-machines.test.mjs walks the tables, including every
 * forbidden move, and tests/browser/ui-state-machines.spec.js drives the page.
 */
import { defineMachine, defineToggle } from '../../assets/ui/state/machine.js';

/**
 * UI-03. The current query's results, page by page (search() and renderAllRoots()).
 *   idle -> loading       a page is requested (the first, or the next on scroll)
 *   loading -> idle       a full page came, so more may follow; or the request failed and the
 *                         next scroll tries again
 *   loading -> done       the last page; idle -> done: no input
 *   loading -> failed     the API answered with an error
 *   any -> idle           a new query (reset), even while a page is loading: that request is
 *                         then stale (state.reqId moved on) and moves nothing
 */
export const RESULTS = defineMachine({
  name: 'proni results',
  initial: 'idle',
  transitions: {
    idle: ['idle', 'loading', 'done'],
    loading: ['idle', 'done', 'failed'],
    done: ['idle'],
    failed: ['idle'],
  },
});

/** UI-04. Which of the three views is shown. route() can reach any view from any other. */
export const VIEW = defineMachine({
  name: 'proni view',
  initial: 'search',
  transitions: {
    search: ['search', 'record', 'ecat'],
    record: ['search', 'record', 'ecat'],
    ecat: ['search', 'record', 'ecat'],
  },
});

/**
 * The A-Z bar's scope: no reference letter, one letter, or 'All' (every top-level record,
 * grouped by letter). Another letter replaces a letter; the same letter clears it; 'All'
 * turns itself off.
 */
export const AZ_SCOPE = defineMachine({
  name: 'proni a-z scope',
  initial: 'none',
  transitions: {
    none: ['letter', 'all'],
    letter: ['letter', 'none', 'all'],
    all: ['letter', 'none'],
  },
});

/**
 * UI-L. A card's sub-records. Expanding fetches them (the button is disabled meanwhile); a
 * failed fetch leaves the card collapsed.
 */
export const CARD_CHILDREN = defineMachine({
  name: 'proni card children',
  initial: 'collapsed',
  transitions: {
    collapsed: ['loading'],
    loading: ['expanded', 'collapsed'],
    expanded: ['collapsed'],
  },
});

/**
 * A card's description and its "Show more" button: the preview, then the full text fetched
 * once (or shown at once when it was fetched before), then the button opens the record. A
 * failed fetch keeps the preview and opens the record instead.
 */
export const CARD_DESCRIPTION = defineMachine({
  name: 'proni card description',
  initial: 'preview',
  transitions: {
    preview: ['loading', 'expanded'],
    loading: ['expanded', 'preview'],
    expanded: ['expanded'],
  },
});

/** UI-L. The record dialog. */
/**
 * Every top-level record (app.js loadRoots, for 'All' and letter browsing): fetched once, when first
 * asked for. A failed fetch can be tried again (the next ask fetches afresh); ready stays ready.
 */
export const ROOTS = defineMachine({
  name: 'proni roots',
  initial: 'idle',
  transitions: {
    idle: ['loading'],
    loading: ['ready', 'failed'],
    ready: [],
    failed: ['loading'],
  },
});

export const MODAL = defineToggle('proni record dialog', ['closed', 'open']);

/**
 * UI-L. The "Copied" confirmation of a copy button or a guide reference line: idle, or copied
 * until its timer ends. A copy while one shows restarts the timer and leaves the state alone.
 */
export const COPY_FLASH = defineToggle('proni copy confirmation', ['idle', 'copied']);
