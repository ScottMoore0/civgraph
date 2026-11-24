import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { combinedDerivedFromLines, creditLine, derivedFromLines, mergedDerivedFromLines } from '@civgraph/core/credits.mjs';

// A layer built for Civgraph from other people's maps credits its builder as provider and says what it
// was derived from in sourceCredits; every place that shows the credit shows both (owner, 17 Nov 2026).

const PLU = 'Derived from the 1911 census District Electoral Division maps of Phelim Birch and Paddy Matthews';

test('the derived-from lines are picked out of the source credits, trimmed, each once', () => {
  assert.deepEqual(derivedFromLines(['Scott Moore', `  ${PLU} `, PLU, 'derived from  a map']), [PLU, 'derived from a map']);
  assert.deepEqual(derivedFromLines(['Hill Bagging', 'Copernicus DEM']), []);
  assert.deepEqual(derivedFromLines(undefined), []);
  assert.deepEqual(derivedFromLines('Derived from a string, not a list'), []);
  assert.deepEqual(derivedFromLines(['Derived fromage']), []);
  const EP = 'Assembled from Counties of Ireland by Tailte Éireann and OSNI';
  assert.deepEqual(derivedFromLines(['Tailte Éireann', 'OSNI', EP, 'Assembled']), [EP]);
  assert.deepEqual(mergedDerivedFromLines(['Scott Moore', PLU], undefined, [PLU]), [PLU]);
});

test('the credit line is the providers, then what the layer was derived from', () => {
  assert.equal(creditLine(['Scott Moore'], [PLU]),
    'Scott Moore; derived from the 1911 census District Electoral Division maps of Phelim Birch and Paddy Matthews');
  assert.equal(creditLine(['Scott Moore', 'Scott Moore', '', null], []), 'Scott Moore');
  assert.equal(creditLine(['OSNI', 'Tailte Éireann'], []), 'OSNI, Tailte Éireann');
  assert.equal(creditLine([], [PLU]), PLU);
  assert.equal(creditLine([], [PLU, 'Derived from OSNI townlands']), `${PLU}; derived from OSNI townlands`);
  assert.equal(creditLine(['Moore'], ['Derived from X'], { separator: ' / ' }), 'Moore; derived from X');
  assert.equal(creditLine([], []), '');
  assert.equal(creditLine(['Tailte Éireann'], ['Assembled from Counties of Ireland by Tailte Éireann']),
    'Tailte Éireann; assembled from Counties of Ireland by Tailte Éireann');
});

test('a row says the derived-from lines of its maps once', () => {
  const of = (/** @type {string} */ x) => `Derived from the ${x} District Electoral Division maps of Phelim Birch and Paddy Matthews`;
  assert.deepEqual(combinedDerivedFromLines([of('1 Apr 1921'), of('1911 census'), of('1907-12'), of('1907-12')]),
    ['Derived from the 1 Apr 1921, 1911 census and 1907-12 District Electoral Division maps of Phelim Birch and Paddy Matthews']);
  assert.deepEqual(combinedDerivedFromLines([of('1911 census'), of('1907-12')]),
    ['Derived from the 1911 census and 1907-12 District Electoral Division maps of Phelim Birch and Paddy Matthews']);
  const pm = "Derived from Paddy Matthews's 1926 District Electoral Division map";
  const both = `${pm} and the 3 May 1921 District Electoral Division map of Paddy Matthews and Phelim Birch`;
  assert.deepEqual(combinedDerivedFromLines([pm, both, pm]), [both]);
  assert.deepEqual(combinedDerivedFromLines(['Derived from OSNI townlands', pm]), ['Derived from OSNI townlands', pm]);
  assert.deepEqual(combinedDerivedFromLines([of('1911 census')]), [of('1911 census')]);
  const townlands = 'Derived from the townland boundaries of Tailte Éireann (CC BY 4.0) and OSNI (OGL)';
  assert.deepEqual(combinedDerivedFromLines([of('1 Apr 1921'), of('1911 census'), of('1907-12'), townlands, of('1907-12')]),
    ['Derived from the 1 Apr 1921, 1911 census and 1907-12 District Electoral Division maps of Phelim Birch and Paddy Matthews', townlands]);
  assert.deepEqual(combinedDerivedFromLines([townlands, of('1911 census'), of('1907-12')]),
    [townlands, 'Derived from the 1911 census and 1907-12 District Electoral Division maps of Phelim Birch and Paddy Matthews']);
  assert.deepEqual(combinedDerivedFromLines([]), []);
});

test('every map that credits its builder only and names its sources says what it was derived from', () => {
  const maps = JSON.parse(readFileSync('data/database/maps.json', 'utf8')).maps;
  const catalogue = JSON.parse(readFileSync('data/catalogue/catalogue.json', 'utf8'));
  const agent = JSON.parse(readFileSync('site/agent/maps-index.json', 'utf8'));
  const agentById = new Map(agent.maps.map((/** @type {{ id: string }} */ m) => [m.id, m]));
  const derived = maps.filter((/** @type {{ sourceCredits?: unknown }} */ m) => derivedFromLines(m.sourceCredits).length);
  assert.ok(derived.length >= 36, `maps with a derived-from credit: ${derived.length}`);
  for (const m of derived) {
    const lines = derivedFromLines(m.sourceCredits);
    // the catalogue document carries it for every map it lists
    if (catalogue.maps[m.id]) assert.deepEqual(catalogue.maps[m.id].derivedFrom, lines, `${m.id} catalogue derivedFrom`);
    assert.deepEqual(agentById.get(m.id)?.derivedFrom, lines, `${m.id} agent index derivedFrom`);
  }
  assert.match(catalogue.maps['plu-roi-1921-04-01'].derivedFrom[0], /^Derived from .*Phelim Birch and Paddy Matthews$/);
  assert.deepEqual(catalogue.maps['mep-2024'].derivedFrom, ['Assembled from Counties of Ireland by Tailte Éireann']);
});
