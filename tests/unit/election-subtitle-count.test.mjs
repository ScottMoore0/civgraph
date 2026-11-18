// Election subtitles count in the singular for one: "1 constituency", never "1 constituencies"
// (by-elections, Seanad panels and every other one-area contest). countNoun
// (packages/core/src/format.js) forms them in the manifest builder, the map app's catalogue and
// the area-results subtitle; the interface translates each form by its "{n} ..." pattern.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { countNoun } from '@civgraph/core/format.js';
import { areaResultsSubtitle } from '@civgraph/core/area-results.mjs';
import { loadRegistry } from '@civgraph/registries/index.mjs';
import { electionBody } from '@civgraph/registries/election-bodies.mjs';

test('countNoun takes the singular for one only', () => {
  assert.equal(countNoun(1, 'constituency', 'constituencies'), '1 constituency');
  assert.equal(countNoun(2, 'constituency', 'constituencies'), '2 constituencies');
  assert.equal(countNoun(0, 'constituency', 'constituencies'), '0 constituencies');
  assert.equal(countNoun(1, 'LEA'), '1 LEA');
  assert.equal(countNoun(180, 'LEA'), '180 LEAs');
  assert.equal(countNoun(1, 'DEA'), '1 DEA');
  assert.equal(countNoun(7, 'ward'), '7 wards');
});

test('the area-results subtitle uses the registry singular for one area', () => {
  const { units = {}, unit = {} } = electionBody(loadRegistry('election-bodies'), 'ireland-president')?.areaResults || {};
  assert.ok(Object.keys(units).length > 0);
  for (const basis of Object.keys(units)) {
    assert.ok(unit[basis], `no singular noun for ${basis}`);
    const one = { dataKind: 'area-results', countingBasis: basis, totalConstituencies: 1 };
    assert.equal(areaResultsSubtitle([one], units, unit), `1 ${unit[basis]}`);
    assert.equal(areaResultsSubtitle([{ ...one, totalConstituencies: 3 }], units, unit), `3 ${units[basis]}`);
  }
});

test('no election subtitle is written as "N constituencies" without the singular', () => {
  for (const file of ['scripts/build/build-test2-election-manifest.mjs', 'packages/map/app/election-manager.js', 'packages/map/src/ui-controller.js']) {
    const source = readFileSync(file, 'utf8');
    // "results for 63 of 166 LEAs" counts the total, which is never one.
    assert.doesNotMatch(source, /(?<!of )\$\{[^}]*\}\s(constituencies|LEAs|DEAs)`/, `${file} forms a plural count without countNoun`);
  }
});

test('every singular subtitle form has its translation pattern', () => {
  const strings = readFileSync('data/i18n/strings/catalogue.txt', 'utf8');
  for (const english of ['{n} constituency', '{n} constituency; {u} unmatched', '{n} ward', '{n} DEA', '{n} LEA', '{n} county or county borough', '{n} counties and county boroughs']) {
    assert.match(strings, new RegExp(`^${english.replace(/[{}]/g, '\\$&')} ¦ \\S`, 'm'), `no Irish pattern for "${english}"`);
  }
});
