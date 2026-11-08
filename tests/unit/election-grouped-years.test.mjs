// The grouped years in the map's election catalogue (packages/map/src/election/grouped-years.mjs) and the
// methods that open one (packages/map/src/election/grouped-year-methods.js), moved out of
// packages/map/app/election-manager.js.
//
//   node --test tests/unit/election-grouped-years.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  addGroupedYears,
  findGroupedYear,
  groupedYearForLayerId,
  groupedYearOptionsFromParams,
  inTimelineSeries,
  keptGroupedYearView,
  listedElections
} from '../../packages/map/src/election/grouped-years.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const espree = createRequire(import.meta.url)('espree');

function catalogue() {
  return {
    elections: [
      { key: 'westminster__1945-07-05', body: 'House of Commons', bodySlug: 'westminster', date: '1945-07-05' },
      { key: 'belfast-county-borough-council__1946-01-15', body: 'Belfast County Borough Council', bodySlug: 'belfast-county-borough-council', date: '1946-01-15' },
      { key: 'belfast-county-borough-council-aldermen__1946-01-15', body: 'Belfast County Borough Council (aldermen)', bodySlug: 'belfast-county-borough-council-aldermen', date: '1946-01-15' },
      { key: 'larne-borough-council__1946-01-16', body: 'Larne Borough Council', bodySlug: 'larne-borough-council', date: '1946-01-16' },
      { key: 'dublin-county-borough-council__1911-01-15', body: 'Dublin County Borough Council', bodySlug: 'dublin-county-borough-council', date: '1911-01-15' },
      { key: 'belfast-city-council__1973-05-30', body: 'Belfast City Council', bodySlug: 'belfast-city-council', bodyGroup: 'local-government', date: '1973-05-30' }
    ]
  };
}

test('a year entry is added for each year of council rounds, once', () => {
  const cat = catalogue();
  addGroupedYears(cat);
  const years = cat.elections.filter((entry) => entry.niLocalGroup);
  assert.deepEqual(years.map((entry) => [entry.key, entry.body, entry.date]), [
    ['ireland-local__1911', 'Irish local elections', '1911'],
    ['ni-local__1946', 'Northern Ireland local elections', '1946']
  ]);
  const ni = years[1];
  assert.deepEqual(ni.roundKeys, ['belfast-county-borough-council__1946-01-15', 'belfast-county-borough-council-aldermen__1946-01-15', 'larne-borough-council__1946-01-16']);
  assert.equal(ni.councilCount, 2);
  assert.equal(ni.hasAldermen, true);
  assert.deepEqual([ni.loadable, ni.resultsOnly, ni.placeholder, ni.sourceMapId, ni.stylingModes], [true, false, false, null, []]);
  addGroupedYears(cat);
  assert.equal(cat.elections.filter((entry) => entry.niLocalGroup).length, 2);
  assert.doesNotThrow(() => addGroupedYears(null));
  assert.doesNotThrow(() => addGroupedYears({ elections: 'none' }));
});

test('the lists show the years instead of their rounds', () => {
  const cat = catalogue();
  addGroupedYears(cat);
  assert.deepEqual(listedElections(cat.elections).map((entry) => entry.key), [
    'westminster__1945-07-05', 'belfast-city-council__1973-05-30', 'ireland-local__1911', 'ni-local__1946'
  ]);
});

test('a year by an older name or layer id', () => {
  const cat = catalogue();
  addGroupedYears(cat);
  assert.equal(findGroupedYear(cat.elections, 'Northern Ireland local elections', '1911')?.key, 'ireland-local__1911');
  assert.equal(findGroupedYear(cat.elections, 'Irish local elections', '1946')?.key, 'ni-local__1946');
  assert.equal(findGroupedYear(cat.elections, 'House of Commons', '1946'), null);
  assert.equal(findGroupedYear(cat.elections, 'Northern Ireland local elections', '1946-01-15'), null);
  assert.equal(findGroupedYear(cat.elections, 'Northern Ireland local elections', '1950'), null);
  assert.deepEqual(groupedYearForLayerId('election-northern-ireland-local-elections-1911'), { body: 'Northern Ireland local elections', date: '1911' });
  assert.equal(groupedYearForLayerId('election-irish-local-elections-1911'), null);
  assert.equal(groupedYearForLayerId(undefined), null);
});

test('the council years run as one timeline; other elections by body', () => {
  const year = { niLocalGroup: true, body: 'Irish local elections' };
  assert.equal(inTimelineSeries({ niLocalGroup: true, body: 'Northern Ireland local elections' }, year), true);
  assert.equal(inTimelineSeries({ body: 'Irish local elections' }, year), false);
  assert.equal(inTimelineSeries({ body: 'House of Commons' }, { body: 'House of Commons' }), true);
  assert.equal(inTimelineSeries({ body: 'Dáil Éireann' }, { body: 'House of Commons' }), false);
});

test('a year view keeps its settings from year to year, and reads them from an address', () => {
  assert.deepEqual(keptGroupedYearView({ active: true, level: 'ded', show: 'seats', members: 'all', area: 'x' }), { level: 'ded', show: 'seats', members: 'all' });
  assert.deepEqual(keptGroupedYearView({ active: false, level: 'ded' }), {});
  assert.deepEqual(keptGroupedYearView(undefined), {});
  const params = new URLSearchParams('electionLevel=counties&electionShow=votes&electionArea=Antrim');
  assert.deepEqual(groupedYearOptionsFromParams(params), { level: 'counties', show: 'votes', members: null, area: 'Antrim' });
});

test('the election manager installs the grouped-year methods and defines none of them itself', () => {
  const parse = (file) => espree.parse(readFileSync(path.join(ROOT, file), 'utf8'), { ecmaVersion: 'latest', sourceType: 'module' });
  const methodsOf = (program, name) => program.body
    .map((node) => (node.type === 'ExportNamedDeclaration' ? node.declaration : node))
    .find((node) => node?.type === 'ClassDeclaration' && node.id.name === name)
    .body.body.filter((member) => member.type === 'MethodDefinition').map((member) => member.key.name);
  const manager = parse('packages/map/app/election-manager.js');
  const own = new Set(methodsOf(manager, 'Test2ElectionManager'));
  const grouped = methodsOf(parse('packages/map/src/election/grouped-year-methods.js'), 'GroupedYearMethods');
  assert.deepEqual(grouped, ['loadNiLocalGroup', 'closeGroupedYearLayers']);
  for (const name of grouped) assert.equal(own.has(name), false, `${name} is defined in both`);
  const source = readFileSync(path.join(ROOT, 'packages/map/app/election-manager.js'), 'utf8');
  assert.match(source, /installMethods\(Test2ElectionManager, \[GroupedYearMethods\]\)/);
});
