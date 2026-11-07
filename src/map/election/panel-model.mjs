/**
 * The election pane's model: which view of an election the pane shows, which constituency and
 * which party or candidate page is open, the map's colouring mode, and how that state is written
 * to the address and read back from it. The pane's drawing (renderPanel and the tables) stays in
 * app/src/election-manager.js and reads this state from the manager's fields.
 *
 * Moved out of app/src/election-manager.js (frontend plan section 5.1, part of seam E6) without
 * changing behaviour. Pure: no DOM, no network; each function takes the facts it needs.
 */
import { normalizeName } from '../../election-domain.mjs';
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

/** What the address records about an open election (src/map/app/url-state.js writes it). */
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
