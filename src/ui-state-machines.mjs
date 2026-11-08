// @ts-check
/**
 * The catalogue pane's explicit state machines (refactor plan section 11; state-machine catalogue
 * MA-07 to MA-10). src/ui-controller.js and packages/map/src/app/entity-bridge.js keep their fields and
 * read them as before; every write now goes through a machine or choice here, so a value outside
 * the set, or a move the table does not list, throws instead of leaving the pane in a state no
 * code expects.
 *
 * Pure: no DOM, no storage. The shared helper is packages/core/src/state-machine.mjs (bundled).
 */
import { defineMachine } from '../packages/core/src/state-machine.mjs';
import { defineChoice } from '../packages/map/src/state-helpers.mjs';

/**
 * MA-07 the split between the catalogue and the map (uiController.currentStateId, mirrored to
 * the shell's data-split-state). Five layouts; the buttons, the drag handle, a double-click, the
 * phone toggle and a saved preference may each move from any one to any other, so the table is
 * the whole set (a choice). Which layouts a device offers is SPLIT_ALLOWED: setSplitState and
 * updateSplitState hold the layout to it; the drag handle writes the layout its position gives,
 * as before (the catalogue's medium risk, kept).
 */
export const SPLIT_LAYOUT = defineChoice('split layout', ['balanced', 'info-full', 'info-75', 'map-75', 'map-full']);

/** The layouts a device class offers, the default first. */
export const SPLIT_ALLOWED = Object.freeze({
  desktop: Object.freeze(['info-full', 'info-75', 'balanced', 'map-75', 'map-full']),
  // map-full first, so it is the default on a phone.
  mobile: Object.freeze(['map-full', 'info-full'])
});

/**
 * MA-08 the catalogue pane's view (uiController.catalogueView): the list (with or without the
 * book viewer over it, _catalogueBookView) or a map's detail page. Either may follow either.
 */
export const CATALOGUE_VIEW = defineChoice('catalogue view', ['list', 'detail']);

/**
 * MA-08 the kinds of step on the catalogue pane's back stack (catalogueHistory): each entry's
 * `type`, checked as it is pushed. The Back and Forward buttons and the history list move the
 * index along the stack; restoring an entry dispatches on its type.
 */
export const CATALOGUE_HISTORY_ENTRY = defineChoice('catalogue history entry', ['list', 'tab', 'detail', 'book-viewer', 'feature-detail', 'election-entity-detail']);

/** @typedef {'eager' | 'deferred' | 'released'} MobileCatalogueState */

/**
 * MA-09 the phone's deferred catalogue (uiController.mobileCatalogue). On a phone that opens on
 * the map, the long catalogue list is not drawn at start-up: an empty shell is (deferred), and
 * the list is drawn when the reader first opens the catalogue pane (released). The flat list's
 * render request (_flatRenderScheduled) and the expanded mobile list (_mobileCatalogueExpanded,
 * set once) are flags beside it.
 *
 *   eager -> deferred      start-up on a phone with the map showing
 *   deferred -> released   the catalogue pane opened (ensureMobileCatalogueReady)
 *   deferred -> deferred   the shell drawn again (a re-render while still on the map)
 *   released -> released   the pane opened again before the list was drawn
 *   released -> deferred   the shell drawn again after a release (a later map-only render)
 *   eager -> released      the pane opened with no shell drawn (the old flag was set false)
 */
export const MOBILE_CATALOGUE = defineMachine({
  name: 'mobile catalogue',
  initial: /** @type {MobileCatalogueState} */ ('eager'),
  transitions: {
    eager: ['deferred', 'released'],
    deferred: ['deferred', 'released'],
    released: ['released', 'deferred']
  }
});

/** @typedef {'loading' | 'loaded' | 'choice' | 'error' | 'missing'} EntityPageLoadState */

/**
 * MA-10 one opening of a party, person or constituency page in the catalogue pane
 * (openElectionEntityDetailInCatalogue): it shows the loading shell, then ends in one of four
 * states. Retry, or another page, is a new opening (a new run, from loading); entityPageToken
 * still tells a superseded one, which ends without a move. The placeholder states are the
 * non-loaded ones, which uiController.showElectionEntityPlaceholder draws.
 */
export const ENTITY_PAGE_LOAD = defineMachine({
  name: 'catalogue entity page',
  initial: /** @type {EntityPageLoadState} */ ('loading'),
  transitions: { loading: ['loaded', 'choice', 'error', 'missing'], loaded: [], choice: [], error: [], missing: [] }
});

/** The states the placeholder draws (all but loaded). */
export const ENTITY_PLACEHOLDER = defineChoice('catalogue entity placeholder', ['loading', 'choice', 'error', 'missing']);
