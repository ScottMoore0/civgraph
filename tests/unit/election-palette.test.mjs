// Election map palette (src/map/election/palette.mjs, seam E2 of the frontend plan): the party
// colour tables and colour helpers moved out of app/src/election-manager.js.
//
//   node --test tests/unit/election-palette.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  colourForMode,
  knownPartyColour,
  mainPanePartyColour,
  MODE_LABELS,
  numericColour,
  PARTY_COLOURS,
  partyColour,
  partyColourForResult,
  ROI_MAIN_PARTY_COLOURS,
  safeCssColour,
  usesMainRoiPartyPalette
} from '../../src/map/election/palette.mjs';
import { partyColour as registryPartyColour } from '../../src/election-domain.mjs';
import { numericColour as rendererNumericColour } from '../../src/election-renderer.mjs';

test('tables and labels', () => {
  assert.equal(MODE_LABELS.leadingParty, 'Leading party');
  assert.equal(PARTY_COLOURS.get('sdlp'), '#2aa82c');
  assert.equal(ROI_MAIN_PARTY_COLOURS.get('fianna fail'), '#66BB66');
});

test('partyColour reads the local palette by normalised name, grey otherwise', () => {
  assert.equal(partyColour('Sinn Féin'), '#326760');
  assert.equal(partyColour('Solidarity–PBP'), '#6b7280');
  assert.equal(partyColour('Solidarity-PBP'), '#8e2420');
  assert.equal(partyColour('Nobody in particular'), '#6b7280');
});

test('safeCssColour keeps hex and rgb(a), falls back on anything else', () => {
  assert.equal(safeCssColour(' #abc '), '#abc');
  assert.equal(safeCssColour('rgba(1, 2, 3, 0.5)'), 'rgba(1, 2, 3, 0.5)');
  assert.equal(safeCssColour('red'), '#6b7280');
  assert.equal(safeCssColour('#fff;background:url(x)', '#000'), '#000');
});

test('numericColour is the same ramp as the shared renderer', () => {
  assert.equal(numericColour('n/a', 0, 1), '#9ca3af');
  assert.equal(numericColour(35, 35, 80), '#fef3c7');
  assert.equal(numericColour(80, 35, 80), '#92400e');
  for (const value of [-5, 0, 10, 22, 31, 47, 58, 69, 100, 1e6]) {
    assert.equal(numericColour(value, 0, 70), rendererNumericColour(value, 0, 70));
  }
});

test('usesMainRoiPartyPalette is judged from the bundle and entry', () => {
  assert.equal(usesMainRoiPartyPalette({ body: 'Dáil Éireann' }, null), true);
  assert.equal(usesMainRoiPartyPalette(null, { key: 'irish-local-2024' }), true);
  assert.equal(usesMainRoiPartyPalette({ body: 'European Parliament' }, { region: 'Republic of Ireland' }), true);
  assert.equal(usesMainRoiPartyPalette({ body: 'European Parliament' }, { region: 'Northern Ireland' }), false);
  assert.equal(usesMainRoiPartyPalette({ body: 'Northern Ireland Assembly' }, { id: 'nia-2022' }), false);
  assert.equal(usesMainRoiPartyPalette(), false);
});

test('mainPanePartyColour: explicit colour, placeholder grey, route palette', () => {
  assert.equal(mainPanePartyColour('Fianna Fáil', '', true), '#66BB66');
  assert.equal(mainPanePartyColour('Fianna Fáil', '', false), '#66bb66');
  assert.equal(mainPanePartyColour('Fianna Fáil', '#123456', true), '#123456');
  // A placeholder grey never hides a colour the party has.
  assert.equal(mainPanePartyColour('SDLP', '#6b7280'), '#2aa82c');
  // ...but stays for a party with no colour.
  assert.equal(mainPanePartyColour('Nobody in particular', '#6b7280'), '#6b7280');
  assert.equal(mainPanePartyColour('', ''), '#6b7280');
  assert.equal(mainPanePartyColour('', '#abcdef'), '#abcdef');
  // Registry parties always take the registry colour.
  assert.equal(mainPanePartyColour('No label', '#ff0000'), registryPartyColour('No label'));
});

test('knownPartyColour', () => {
  assert.equal(knownPartyColour('Independent', true), '#DCDCDC');
  assert.equal(knownPartyColour('', true), '');
  assert.equal(knownPartyColour('Nobody in particular'), '');
});

test('partyColourForResult prefers an elected candidate of the party when asked', () => {
  const result = {
    leadingName: 'B',
    winnerName: 'B',
    candidates: [
      { name: 'A', party: 'Fianna Fáil', colour: '#111111', elected: true },
      { name: 'B', party: 'Fianna Fáil', colour: '#222222', elected: false },
      { name: 'C', party: 'Fine Gael', colour: '#333333' }
    ]
  };
  assert.equal(partyColourForResult(result, 'Fianna Fáil', '', { preferElected: true }), '#111111');
  assert.equal(partyColourForResult(result, 'Fianna Fáil'), '#222222');
  assert.equal(partyColourForResult(result, 'Labour', '', { roi: true }), '#CC0000');
  assert.equal(partyColourForResult({}, 'Labour', '#444444'), '#444444');
});

test('colourForMode by mode', () => {
  const result = {
    winnerParty: 'Fine Gael',
    leadingParty: 'Fine Gael',
    candidates: [{ name: 'X', party: 'Fine Gael', elected: true }],
    turnoutPct: 80,
    leadingPct: 10,
    majorityPct: 'x',
    seatsWon: 6,
    quota: 1_000
  };
  assert.equal(colourForMode('winner', result, true), '#6699FF');
  assert.equal(colourForMode('leadingParty', result, false), '#6699ff');
  assert.equal(colourForMode('turnout', result), '#92400e');
  assert.equal(colourForMode('voteShare', result), '#fef3c7');
  assert.equal(colourForMode('majority', result), '#9ca3af');
  assert.equal(colourForMode('seats', result), '#92400e');
  assert.equal(colourForMode('quota', result), '#fef3c7');
  assert.equal(colourForMode('unknown', result), '#6b7280');
});
