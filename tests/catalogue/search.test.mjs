// Unit tests for the rebuilt catalogue's search (src/catalogue/search.js), run against the built
// catalogue. node --test tests/catalogue/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CatalogueSearch, PeopleSearch, coveringPoint, normalise, parseQuery, withinOneEdit, wordMatch } from '../../src/catalogue/search.js';

const catalogue = JSON.parse(readFileSync('data/catalogue/catalogue.json', 'utf8'));
const places = JSON.parse(readFileSync('data/catalogue/places.json', 'utf8'));
const books = JSON.parse(readFileSync('data/database/books.json', 'utf8')).books || [];
const search = new CatalogueSearch(catalogue, { books });
search.setPlaces(places);
const seriesName = (id) => catalogue.series.find((s) => s.id === id)?.name;

test('normalise folds case, accents, apostrophes and ampersands', () => {
  assert.equal(normalise('Dáil Éireann'), 'dail eireann');
  assert.equal(normalise("O'Neill & Sons"), 'oneill and sons');
  assert.equal(normalise('  Wards—1993 '), 'wards 1993');
});

test('parseQuery takes years, decades and ranges out as a period', () => {
  assert.deepEqual(parseQuery('census 1911'), { words: ['census'], period: { from: 1911, to: 1911 } });
  assert.deepEqual(parseQuery('wards 1900s'), { words: ['wards'], period: { from: 1900, to: 1909 } });
  assert.deepEqual(parseQuery('1841-1851').period, { from: 1841, to: 1851 });
  assert.deepEqual(parseQuery('map of the wards').words, ['wards']);
  assert.deepEqual(parseQuery('the').words, ['the'], 'a query of stop words alone is still searched');
});

test('wordMatch: exact, prefix, one typo for longer words only', () => {
  assert.equal(wordMatch('wards', 'wards'), 1);
  assert.equal(wordMatch('town', 'townlands'), 0.8);
  assert.equal(wordMatch('townlnds', 'townlands'), 0.5);
  assert.equal(wordMatch('wrds', 'wards'), 0, 'four letters is too short for a typo');
  assert.ok(withinOneEdit('parish', 'parsh'));
  assert.ok(!withinOneEdit('parish', 'perch'));
});

test('a misspelt series name still finds it', () => {
  const r = search.query('townlnds');
  assert.ok(r.series.length, 'some result');
  assert.match(seriesName(r.series[0].id), /townland/i);
});

test('every word must match', () => {
  const r = search.query('wards zzzzqq');
  assert.equal(r.series.length, 0);
});

test('a year narrows a series to its editions of that year', () => {
  // (Was "census 1911", which found only the DED map now dated 1910, as Phelim Birch corrected.)
  const r = search.query('wards 1993');
  assert.ok(r.series.length, 'wards 1993 finds a series');
  for (const hit of r.series) {
    for (const id of hit.members) {
      const year = Number(/(\d{4})/.exec(catalogue.maps[id].date || '')?.[1]);
      assert.equal(year, 1993, `${id} is a 1993 edition`);
    }
  }
});

test('constituencies and places are found by name', () => {
  const r = search.query('dungannon');
  assert.ok(r.contests.some((c) => normalise(c.name) === 'dungannon'), 'Dungannon as a contest');
  assert.ok(r.places.some((p) => p.exact), 'Dungannon as a named place');
});

test('filters by jurisdiction and kind apply to series', () => {
  const ni = search.query('wards', { scope: 'Northern Ireland' });
  assert.ok(ni.series.length);
  for (const h of ni.series) assert.equal(catalogue.series.find((s) => s.id === h.id).scope, 'Northern Ireland');
});

test('maps still to be added are left out unless asked for', () => {
  const todo = catalogue.series.find((s) => s.status && !s.status.ready && !s.status.incomplete);
  if (!todo) return;
  const q = todo.name;
  assert.ok(!search.query(q).series.some((h) => h.id === todo.id));
  assert.ok(search.query(q, { includeToAdd: true }).series.some((h) => h.id === todo.id));
});

test('coveringPoint finds series by extent, and the places at a point', () => {
  const belfast = coveringPoint(catalogue, search.places, -5.93, 54.597);
  assert.ok(belfast.series.length > 20, 'many maps cover Belfast');
  assert.ok(belfast.named.length > 0, 'named places at Belfast');
  const sea = coveringPoint(catalogue, search.places, -20, 40);
  assert.equal(sea.series.length, 0);
});

test('the built catalogue is internally consistent', () => {
  const ids = new Set(catalogue.series.map((s) => s.id));
  assert.equal(ids.size, catalogue.series.length, 'series ids are unique');
  for (const sub of catalogue.subjects) for (const id of sub.series) assert.ok(ids.has(id), `${sub.id} names ${id}`);
  for (const s of catalogue.series) {
    for (const m of s.members) assert.ok(catalogue.maps[m.id], `${s.id} member ${m.id} has a record`);
    for (const m of s.members.filter((x) => x.of)) assert.ok(s.members.some((x) => x.id === m.of && !x.of), `${m.id} hangs under an edition`);
  }
  for (const target of Object.values(catalogue.redirects)) assert.ok(ids.has(target), `redirect to ${target}`);
});

const peopleDoc = JSON.parse(readFileSync('data/catalogue/people.json', 'utf8'));
const people = new PeopleSearch(peopleDoc);

test('people are found by name, despite a typo, best known first', () => {
  assert.equal(people.query('paisley')[0].row[1], 'Ian Paisley');
  assert.equal(people.query('paisly')[0].row[1], 'Ian Paisley');
  assert.equal(people.query('sammy wilson')[0].row[1], 'Sammy Wilson');
  assert.deepEqual(people.query('zzzzqqq'), []);
});

test('a year keeps the people active then', () => {
  const r = people.query('robinson 1998');
  assert.ok(r.length);
  for (const { row } of r) assert.ok(row[4] <= 1998 && row[5] >= 1998, `${row[1]} ${row[4]}-${row[5]}`);
});

test('every person links to a Browse page, and every contest to a catalogue election', () => {
  assert.equal(PeopleSearch.url(people.query('sammy wilson')[0].row), '/browse/#/persons/sammy-wilson-96356');
  for (const row of peopleDoc.people) for (const c of row[8]) assert.ok(catalogue.elections[c[0]], `${row[1]}: contest ${c[0]}`);
});
