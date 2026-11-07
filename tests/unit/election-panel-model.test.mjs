// The election pane's model (src/map/election/panel-model.mjs): the view, the selection, the
// colouring mode and the address state, moved out of app/src/election-manager.js.
//
//   node --test tests/unit/election-panel-model.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  clearedSelection,
  COUNCIL_VIEWS,
  DEFAULT_MODE_ORDER,
  ELECTION_VIEWS,
  electionURLState,
  freshPanelState,
  normalizePanelView,
  restoredPanelView,
  selectedResultKey,
  stylingModeFor
} from '../../src/map/election/panel-model.mjs';

test('the colouring mode an election opens in', () => {
  assert.equal(DEFAULT_MODE_ORDER[0], 'winner');
  assert.equal(stylingModeFor({ stylingModes: ['winner', 'turnout'] }, 'turnout'), 'turnout');
  assert.equal(stylingModeFor({ stylingModes: ['custom', 'turnout', 'winner'] }, 'quota'), 'turnout');
  assert.equal(stylingModeFor({ stylingModes: ['custom'] }, 'quota'), 'winner');
  assert.equal(stylingModeFor({}, 'turnout'), 'winner');
  assert.equal(stylingModeFor(null, 'turnout'), 'winner');
});

test('a fresh pane, and a cleared selection', () => {
  assert.deepEqual(freshPanelState({ bodyGroup: 'local-government' }), {
    activePanelView: 'party',
    activeSelectedResultKey: null,
    activeEntityKind: null,
    activeEntityKey: null,
    activeEntityReturnView: 'party',
    activeLocalMode: 'dea'
  });
  assert.equal(freshPanelState({ bodyGroup: 'parliament' }).activeLocalMode, 'constituency');
  assert.deepEqual(clearedSelection(), { activeSelectedResultKey: null, activeEntityKind: null, activeEntityKey: null, activeEntityReturnView: 'party' });
});

test('a selected result is keyed by its normalised match name, else its constituency', () => {
  assert.equal(selectedResultKey(null), null);
  assert.equal(selectedResultKey({ matchName: 'Fermanagh & South Tyrone', constituency: 'x' }), 'fermanagh and south tyrone');
  assert.equal(selectedResultKey({ constituency: 'Belfast North (1922)' }), 'belfast north');
  assert.equal(selectedResultKey({}), '');
});

test('the view a selection can show', () => {
  // A whole election: its five views, anything else falls back to party.
  for (const view of ELECTION_VIEWS) assert.equal(normalizePanelView(view), view);
  assert.equal(normalizePanelView('counts'), 'party');
  assert.equal(normalizePanelView(null), 'party');
  // A local election shown by council has no constituency view.
  for (const view of COUNCIL_VIEWS) assert.equal(normalizePanelView(view, { districtMode: true }), view);
  assert.equal(normalizePanelView('constituency', { districtMode: true }), 'party');
  // A council's aggregate, selected or not.
  assert.equal(normalizePanelView('local-party', { selected: true, councilAggregate: true }), 'local-party');
  assert.equal(normalizePanelView('counts', { selected: true, councilAggregate: true }), 'party');
  // A one-seat first-past-the-post result: results or trends.
  assert.equal(normalizePanelView('party', { selected: true, singleSeatFptp: true }), 'results');
  assert.equal(normalizePanelView('trends', { selected: true, singleSeatFptp: true }), 'trends');
  // singleSeatFptp only counts with a selection.
  assert.equal(normalizePanelView('candidate', { singleSeatFptp: true }), 'candidate');
  // Any other selected constituency shows the view it is asked for.
  assert.equal(normalizePanelView('counts', { selected: true }), 'counts');
  assert.equal(normalizePanelView('animation', { selected: true, districtMode: true }), 'animation');
  assert.equal(normalizePanelView('', { selected: true }), 'party');
});

test('the view an address opens', () => {
  assert.equal(restoredPanelView(true, 'counts'), 'counts');
  assert.equal(restoredPanelView(true, null), 'party');
  assert.equal(restoredPanelView(false, 'counts'), 'party');
  assert.equal(restoredPanelView(false, 'animation'), 'party');
  assert.equal(restoredPanelView(false, 'candidate'), 'candidate');
  assert.equal(restoredPanelView(false, ''), 'party');
});

test('the address state of an open election', () => {
  const state = {
    activeEntry: { body: 'Dáil Éireann', date: '2020-02-08' },
    activeMode: 'voteShare',
    overlayMode: 'bars',
    activePanelView: 'candidate',
    activeLocalMode: 'constituency',
    activeGeographyModeId: null,
    activeSelectedResultKey: 'galway east',
    countDetailedView: true,
    activeEntityKind: 'party',
    activeEntityKey: 'labour',
    activeEntityReturnView: 'counts'
  };
  const url = electionURLState(state, 'election-dail-eireann-2020-02-08');
  assert.deepEqual(Object.keys(url), ['layerId', 'body', 'date', 'mode', 'overlay', 'view', 'localMode', 'geographyMode', 'selected', 'countDetail', 'entityKind', 'entityKey', 'entityReturnView']);
  assert.deepEqual(url, {
    layerId: 'election-dail-eireann-2020-02-08',
    body: 'Dáil Éireann',
    date: '2020-02-08',
    mode: 'voteShare',
    overlay: 'bars',
    view: 'candidate',
    localMode: 'constituency',
    geographyMode: null,
    selected: 'galway east',
    countDetail: true,
    entityKind: 'party',
    entityKey: 'labour',
    entityReturnView: 'counts'
  });
});
