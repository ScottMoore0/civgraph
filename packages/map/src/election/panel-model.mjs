/**
 * The election pane's model: which view of an election the pane shows, which constituency and
 * which party or candidate page is open, the map's colouring mode, and how that state is written
 * to the address and read back from it. The pane's drawing (renderPanel and the tables) stays in
 * packages/map/app/election-manager.js and reads this state from the manager's fields.
 *
 * Moved out of packages/map/app/election-manager.js (frontend plan section 5.1, part of seam E6) without
 * changing behaviour. Pure: no DOM, no network; each function takes the facts it needs.
 */
import { normalizeName } from '../../../core/src/election-domain.mjs';
import { defineMachine } from '../../../core/src/state-machine.mjs';
import { defineChoice } from '../state-helpers.mjs';

/** The map's colouring modes, in the order an election offers them. */
export const DEFAULT_MODE_ORDER = Object.freeze(['winner', 'leadingParty', 'voteShare', 'turnout', 'majority', 'seats', 'quota']);

/** The views of a whole election, and of a council (or a local election in district mode). */
export const ELECTION_VIEWS = Object.freeze(['party', 'candidate', 'local-party', 'constituency', 'trends']);
export const COUNCIL_VIEWS = Object.freeze(['party', 'candidate', 'local-party', 'trends']);

/**
 * The pane's two small toggles (refactor plan section 11, light weight): the overlay drawn on the
 * map, seat circles or vote bars, and the level a local election is shown at, its district
 * electoral areas or the whole council (a non-local election is at constituency level). The
 * manager's fields stay plain strings; every assignment goes through `check`.
 */
export const OVERLAY_MODE = defineChoice('election overlay', ['circles', 'bars']);
export const LOCAL_MODE = defineChoice('election local level', ['dea', 'district', 'constituency']);

/**
 * The views the pane draws (MA-04). `results` is the one-seat first-past-the-post result's own
 * view; `counts` and `animation` need a constituency. Kept as a list, not a checked choice: a
 * view named in the address for a selected multi-seat result is kept as it is (normalizePanelView)
 * and drawn as the candidate table, so checking it would turn an odd address into an error.
 */
export const PANEL_VIEWS = Object.freeze(['party', 'candidate', 'local-party', 'constituency', 'council', 'counts', 'animation', 'trends', 'results']);

/** @typedef {'closed' | 'open'} EntityPageState */

/**
 * The pane's party or candidate page (MA-04, full weight with the views above): `open` with a
 * kind, a key and the view Back returns to, or `closed`. Every write of the manager's
 * activeEntityKind/Key/ReturnView goes through `entityPageFields`, which moves this machine.
 *
 *   closed -> open    an entity link, or an address that names one
 *   open -> open      a link from one entity page to another
 *   open -> closed    Back, any other view drawn, a new or closed election
 *   closed -> closed  the same (nothing was open)
 */
export const ENTITY_PAGE = defineMachine({
  name: 'election entity page',
  initial: /** @type {EntityPageState} */ ('closed'),
  transitions: { closed: ['closed', 'open'], open: ['open', 'closed'] }
});

/**
 * The fields for the entity page's next state, after checking the move from the current one.
 * `returnView` is kept as given (an address restore can leave it null, as before).
 * @param {{ state: () => EntityPageState, to: (next: EntityPageState) => EntityPageState }} page
 * @param {{ kind: string, key: string } | null} entity  null closes the page
 * @param {string | null} [returnView]  the view Back returns to; left unchanged when undefined
 */
export function entityPageFields(page, entity, returnView) {
  page.to(entity ? 'open' : 'closed');
  /** @type {{ activeEntityKind: string | null, activeEntityKey: string | null, activeEntityReturnView?: string | null }} */
  const fields = { activeEntityKind: entity ? entity.kind : null, activeEntityKey: entity ? entity.key : null };
  if (returnView !== undefined) fields.activeEntityReturnView = returnView;
  return fields;
}

/** The colouring mode an election opens in: the current one if it offers it, else its first usual mode, else winner. */
export function stylingModeFor(entry, currentMode) {
  return entry?.stylingModes?.includes(currentMode)
    ? currentMode
    : (entry?.stylingModes?.find((mode) => DEFAULT_MODE_ORDER.includes(mode)) || 'winner');
}

/** The pane as an election opens: the party view, nothing selected, the election's own level. */
export function freshPanelState(entry) {
  return {
    activePanelView: 'party',
    activeSelectedResultKey: null,
    activeEntityKind: null,
    activeEntityKey: null,
    activeEntityReturnView: 'party',
    activeLocalMode: LOCAL_MODE.check(entry?.bodyGroup === 'local-government' ? 'dea' : 'constituency')
  };
}

/** Nothing selected and no party or candidate page open (an election closing). */
export function clearedSelection() {
  return {
    activeSelectedResultKey: null,
    activeEntityKind: null,
    activeEntityKey: null,
    activeEntityReturnView: 'party'
  };
}

/** The key a selected result is remembered by (and written to the address as). */
export function selectedResultKey(result) {
  return result ? normalizeName(result.matchName || result.constituency || '') : null;
}

/**
 * The view the pane can show. `facts` says what is selected: `selected` (a constituency or
 * council is open), `singleSeatFptp` (it is a one-seat first-past-the-post result),
 * `councilAggregate` (it is a council's aggregate) and `districtMode` (a local election shown by
 * council). A view the selection cannot show falls back to the party view.
 */
export function normalizePanelView(view, { selected = false, singleSeatFptp = false, councilAggregate = false, districtMode = false } = {}) {
  const value = view || 'party';
  if (selected && singleSeatFptp) {
    return value === 'trends' ? 'trends' : 'results';
  }
  if (councilAggregate) {
    return COUNCIL_VIEWS.includes(value) ? value : 'party';
  }
  if (!selected && districtMode) {
    return COUNCIL_VIEWS.includes(value) ? value : 'party';
  }
  if (!selected) {
    return ELECTION_VIEWS.includes(value) ? value : 'party';
  }
  return value;
}

/**
 * The view an address opens. With a constituency selected, the view it names (or party). Without
 * one, a view that needs a constituency (counts, animation) is not inherited: the overall party
 * pane opens instead.
 */
export function restoredPanelView(validSelected, requestedView) {
  const view = validSelected
    ? (requestedView || 'party')
    : (requestedView && requestedView !== 'counts' && requestedView !== 'animation' ? requestedView : 'party');
  return view;
}

/** What the address records about an open election (packages/map/src/app/url-state.js writes it). */
export function electionURLState(state, layerId) {
  return {
    layerId,
    body: state.activeEntry.body,
    date: state.activeEntry.date,
    mode: state.activeMode,
    overlay: state.overlayMode,
    view: state.activePanelView,
    localMode: state.activeLocalMode,
    geographyMode: state.activeGeographyModeId,
    selected: state.activeSelectedResultKey,
    countDetail: state.countDetailedView,
    entityKind: state.activeEntityKind,
    entityKey: state.activeEntityKey,
    entityReturnView: state.activeEntityReturnView
  };
}
