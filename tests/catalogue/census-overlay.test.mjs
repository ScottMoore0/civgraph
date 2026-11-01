// node --test tests/catalogue/census-overlay.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  classIndexFor, fillColorExpression, joinRows, LICENCES, licenceFor, NO_DATA_FILL,
  overlayClasses, parseCsv, statisticFor
} from '../../src/census-overlay.mjs';

const entries = JSON.parse(readFileSync(new URL('../../data/database/data-entries.json', import.meta.url), 'utf8')).dataEntries;
const byId = (id) => entries.find((e) => e.id === id);

test('parseCsv reads quoted cells, doubled quotes and CRLF', () => {
  const { header, rows } = parseCsv('Geography,GeographyCode,Total\r\n"Abbey (Antrim, LGD)",N08000101,3354\r\n"Say ""hi""",N2,1\r\n');
  assert.deepEqual(header, ['Geography', 'GeographyCode', 'Total']);
  assert.equal(rows[0].Geography, 'Abbey (Antrim, LGD)');
  assert.equal(rows[1].Geography, 'Say "hi"');
  assert.equal(rows.length, 2);
});

test('every statistic has classes that cover its domain, each a distinct colour', () => {
  assert.equal(entries.length, 87);
  for (const e of entries) {
    const classes = overlayClasses(e);
    assert.ok(classes.length >= 2, e.id);
    assert.equal(new Set(classes.map((c) => c.colour)).size, classes.length, `${e.id}: repeated colour`);
    assert.equal(classIndexFor(classes, e.domain[0] - 1e9), 0, e.id);
    assert.equal(classIndexFor(classes, e.domain[1] + 1e9), classes.length - 1, e.id);
  }
});

test('a decile is one class a value, labelled 1 to 10', () => {
  const classes = overlayClasses(byId('nimdm-2017-mdm-decile-sa'));
  assert.deepEqual(classes.map((c) => c.label), ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10']);
  assert.equal(classIndexFor(classes, 7), 6);
});

test('a percentage of 0 to 100 is ten classes of ten points', () => {
  const classes = overlayClasses(byId('data-2021-religion-catholic-ward'));
  assert.equal(classes.length, 10);
  assert.equal(classes[0].label, 'Under 10%');
  assert.equal(classes[9].label, '90% and over');
  assert.equal(classIndexFor(classes, 27.07), 2);
});

test('the fill expression matches tile codes to class colours, and leaves the rest unfilled', () => {
  const entry = byId('data-2021-religion-catholic-ward');
  const { rows } = parseCsv('Geography,GeographyCode,Total,Catholic,Catholic_pct\nAbbey,N08000101,3354,908,27.07\nB,N08000102,10,9,95\n');
  const joined = joinRows(entry, rows);
  assert.equal(joined.tileKey, 'WardCode');
  const expr = fillColorExpression(entry, joined);
  assert.deepEqual(expr.slice(0, 2), ['match', ['to-string', ['get', 'WardCode']]]);
  assert.equal(expr.at(-1), NO_DATA_FILL);
  assert.deepEqual(expr[2], ['N08000101']);
  assert.deepEqual(expr[4], ['N08000102']);
});

test('a crosswalk joins a CSV key the tiles do not carry', () => {
  const entry = byId('data-population-change-1971-1981-ward1972');
  const { rows } = parseCsv('W72_ID,Geography,pop_1971_persons,pop_1981_persons,pop_change_pct\nfermanagh--garrison,GARRISON,1000,1100,10\nnowhere--x,X,1,1,0\n');
  const joined = joinRows(entry, rows, { tileKey: 'civ_fid', map: { 'fermanagh--garrison': 477 } });
  assert.equal(joined.tileKey, 'civ_fid');
  assert.ok(joined.byTileValue.has('477'));
  assert.deepEqual(joined.unmatched, ['nowhere--x']);
});

test('the details give the value, the count and the total it is a share of', () => {
  const s = statisticFor(byId('data-2021-religion-catholic-ward'), { Geography: 'Abbey', GeographyCode: 'N08000101', Total: '3354', Catholic: '908', Catholic_pct: '27.07' });
  assert.equal(s.valueText, '27.07%');
  assert.equal(s.summary, '908 of 3,354 usual residents');
  assert.equal(s.areaName, 'Abbey');
  const households = statisticFor(byId('data-2021-no-car-lgd'), { Geography: 'X', GeographyCode: 'N1', Total: '59460', NoCar: '9966', NoCar_pct: '16.76' });
  assert.equal(households.summary, '9,966 of 59,460 households');
});

test('licences: NISRA is OGL v3, Pobal and the CSO are CC BY 4.0', () => {
  for (const e of entries) assert.equal(licenceFor(e).short, e.id.startsWith('pobal-') ? 'CC BY 4.0' : 'OGL v3.0', e.id);
  assert.equal(licenceFor({ source: { title: 'CSO Census 2022, table F1001' } }), LICENCES.ccby);
  assert.equal(licenceFor({ source: { title: 'NISRA Census 2021' } }), LICENCES.ogl);
});

test('a categorical scale (Pobal) is one named class a value', () => {
  const classes = overlayClasses(byId('pobal-hp-2016-ed'));
  assert.equal(classes.length, 8);
  assert.equal(classes[0].label, '1 Extremely disadvantaged (below -30)');
  assert.equal(classIndexFor(classes, 4), 3);
  const s = statisticFor(byId('pobal-hp-2016-ed'), { CSOED: '14119', ED_NAME: "St. Helen's", HP_cat: '4', HP_rel: '-6.23' });
  assert.equal(s.areaName, "St. Helen's");
});
