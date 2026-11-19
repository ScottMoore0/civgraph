// The person merges, splits and data fixes the owner approved on 14 Nov 2026 (the clear findings of
// research-ina-a and research-ina-b; stream persons-14), as they stand in the committed person registry:
// the keys in data/elections/persons/label-blanked-identity-keys.csv, person_id_confirmed_merges.csv and
// ie-ei-crosswalk.csv hold them, so a rebuild cannot undo them, and every retired id still redirects.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const at = (file) => new URL(`../../data/elections/persons/${file}`, import.meta.url);
const json = (file) => JSON.parse(readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8'));
const { entities } = JSON.parse(readFileSync(at('person_registry.json'), 'utf8'));
const byId = new Map(entities.map((e) => [e.personId, e]));
/** @param {string} key */
const holders = (key) => entities.filter((e) => (e.sourceIds || []).includes(key) || (e.sourcePersonIds || []).includes(key)).map((e) => e.personId);
/** @param {string} key */
const holder = (key) => {
  const h = holders(key);
  assert.equal(h.length, 1, `${key} is held by ${h.length} people (${h.join(', ')})`);
  return h[0];
};
const confirmed = readFileSync(at('person_id_confirmed_merges.csv'), 'utf8').split('\n').filter(Boolean).slice(1)
  .map((l) => l.split(','));
const redirect = new Map(confirmed.map(([keep, drop]) => [Number(drop), Number(keep)]));
const mergeLog = readFileSync(at('person_id_merges.csv'), 'utf8');
const crosswalk = readFileSync(at('ie-ei-crosswalk.csv'), 'utf8');
/** @param {number} id */
const candidacies = (id) => byId.get(id)?.candidacies;

test('PMS14-01 Warrenpoint East Ward 1964: Samuel Tate, the outgoing member, stood and lost, and joins his 1955-61 rows', () => {
  const doc = json('data/elections-source/data/elections/warrenpoint-urban-district-council/1964-05-20/east-ward.json');
  const tate = doc.Constituency.countGroup.find((c) => c.Surname === 'Tate');
  assert.equal(tate.Candidate_First_Pref_Votes, '292.00');
  assert.equal(tate.Status, 'Not Elected');
  assert.equal(tate.Name_As_Printed, 'S. Tate (U.)');
  assert.equal(doc.Constituency.countGroup.length, 6);
  assert.equal(holder('S. Tate|UUP'), 139078);
  assert.equal(candidacies(139078), 4);
});

test('PMS14-02 James Reynolds of Esker is one man 1942-79; the Trean man of 1945 stays apart, Clann na Talmhan', () => {
  assert.equal(holder('ie:12319'), 131674);
  assert.equal(candidacies(131674), 6);
  assert.ok(!byId.has(138445));
  assert.equal(redirect.get(138445), 131674);
  assert.ok(byId.has(156570), 'the Trean James Reynolds keeps his own id');
  assert.equal(candidacies(156570), 1);
  const doc = json('data/elections-source/data/elections/ireland-local/1945-06-14/carrick-on-shannon.json');
  assert.equal(doc.candidates.find((c) => c.first_pref === 520).party, 'Clann na Talmhan');
});

test('PMS14-03 Edmond Carey stays one person and died on 26 August 1943, cited to the GRO and the Irish Examiner', () => {
  const cw = json('data/elections/persons/official-person-crosswalk.json').people.Q5338846;
  assert.equal(cw.died, '1943-08-26');
  assert.ok(!('diedRejected' in cw));
  assert.match(cw.diedSource, /2314530/);
  assert.match(cw.diedSource, /Irish Examiner, 27 Aug 1943, p\. 3/);
  assert.doesNotMatch(JSON.stringify(cw), /Street|St\.|Road/, 'the place is Midleton only, never a street');
  assert.equal(candidacies(112779), 5);
  assert.equal(holder('ei:1501'), 112779);
});

test('PMS14-04 Louise Marsden, McFaul, Melaugh and Gardiner are each one person, the lower id kept', () => {
  assert.equal(holder('T311544083'), 102978);
  assert.equal(holder('T484356285'), 102978);
  assert.equal(holder('713888849-mid-and-east-antrim'), 63720);
  assert.equal(holder('T2633674761'), 84239);
  assert.equal(holder('Samuel Gardiner|lurgan-1964-1967'), 76185);
  for (const [drop, keep] of [[153585, 102978], [105941, 63720], [100930, 84239], [143656, 76185]]) {
    assert.ok(!byId.has(drop), `${drop} is still live`);
    assert.equal(redirect.get(drop), keep);
  }
});

test('PMS14-05 the two Austin Kellys are each joined, and kept apart from each other', () => {
  const wp = holder('100008');
  const sdlp = holder('Austin Kelly|mid-ulster-sdlp-2011');
  assert.equal(wp, 63215);
  assert.equal(sdlp, 117337);
  assert.equal(holder('T2595954672'), 63215);
  assert.equal(holder('T2595954672-magherafelt-mid-ulster'), 117337);
  assert.notEqual(wp, sdlp);
  assert.equal(candidacies(63215), 6);
  assert.equal(candidacies(117337), 3);
});

test('PMS14-06 the ten Warrenpoint Labour men each hold their run under one declared key, the lowest id kept', () => {
  const runs = [
    ['Charles McGreevy|warrenpoint-1949-1967', 139751, 7],
    ['Michael James Barry|warrenpoint-1952-1964', 141381, 4],
    ['James McMullan|warrenpoint-1946-1952', 139928, 3],
    ["Henry C. O'Hagan|warrenpoint-1936-1949", 139150, 4],
    ["Patrick O'Neill|warrenpoint-1958-1964", 140037, 3],
    ['Gregory McKevitt|warrenpoint-1958-1967', 139813, 4],
    ['William Gray|warrenpoint-1955-1958', 142634, 2],
    ['James McCart|warrenpoint-1964-1967', 139868, 2],
    ['Edward McNeill|warrenpoint-1961-1967', 139799, 2],
    ['Gerard Boyle|warrenpoint-1964-1967', 140858, 2],
  ];
  for (const [key, keep, n] of runs) {
    assert.equal(holder(key), keep, key);
    assert.equal(candidacies(keep), n, `${key}: ${candidacies(keep)} candidacies`);
  }
  // McMullan keeps 139928: 139891 also holds the Larne Rural District J. M'Mullan of 1936 and stays live,
  // joined on 19 Nov 2026 (w19-merges, initials joins) to John M'Mullan's Glenarm South rows of 1924-33.
  assert.ok(byId.has(139891));
  assert.equal(candidacies(139891), 5);
});

test('PMS14-07 Patrick Collins of Menlough: the Ballinasloe councillor (ie:3410) is the 1948 Galway North candidate (ei:2289)', () => {
  assert.match(crosswalk, /^ie:3410,ei:2289,Patrick Collins,/m);
  assert.equal(holder('ei:2289'), 110326);
  assert.equal(holder('ie:3410'), 110326);
  assert.equal(candidacies(110326), 6);
  assert.ok(!byId.has(132498));
  assert.match(mergeLog, /^IE-EI-CROSSWALK,110326,132498,/m);
});

test('PMS14-08 Thomas Bothwell, jun., holds every Coolyermor row of 1924-61; the Old Barr man of 1952-55 is apart', () => {
  const jun = holder('Thomas Bothwell, jun.|');
  assert.equal(jun, 147109);
  assert.equal(candidacies(147109), 12);
  assert.equal(holder('Thomas Bothwell, Senr.|old-barr-1952-1955'), 144088);
  assert.equal(candidacies(144088), 2);
  assert.ok(!byId.get(144088).parties.includes('UUP'));
});

test('PMS14-09 George Elliott, jun., holds the Fermanagh County Council rows of 1924-39; Enniskillen Borough 1949-61 stays on 139343', () => {
  assert.equal(holder('George Elliott, Jun.|UUP'), 140887);
  assert.equal(candidacies(140887), 9);
  assert.equal(candidacies(139343), 3);
  assert.equal(byId.get(139343).firstYear, 1949);
});

test('PMS14-10 the 1955 Ballymoney J. Donaghy is James, with his 1952 row; the 1946 row stays unsettled on 139389', () => {
  assert.equal(holder('James Donaghy|ballymoney-urban-1952-1955'), 135469);
  assert.equal(candidacies(135469), 2);
  assert.equal(candidacies(139389), 1);
  // Unclear, left as they are: Joseph Donaghy of 1936/39 and of 1958/61.
  assert.equal(holder('Joseph Donaghy|ballymoney-urban-1958-1961'), 152676);
  assert.ok(byId.has(137100));
});

test('PMS14-11 Craig: the Ballyclare councillor of 1958-67 is the Newtownabbey man, and the 1967 Antrim RD J. W. Craig is James Wright Craig', () => {
  assert.equal(holder('James Craig|ballyclare-newtownabbey-1958-1973'), 133717);
  assert.equal(candidacies(133717), 5);
  assert.equal(holder('James Wright Craig|antrim-1966-1977'), 101709);
  assert.equal(candidacies(101709), 3);
  assert.notEqual(holder('T3941250872'), holder('T3941250872-newtownabbey'));
  // 139436 keeps its Belfast and Gilford rows; 141339 keeps the 1952 Antrim Town Commissioners row.
  assert.equal(candidacies(139436), 4);
  assert.equal(candidacies(141339), 1);
  assert.ok(!byId.has(139383));
});

test('PMS14-12 Smyth was born about 1823 (Boylan 1826 recorded as the book\'s reading)', () => {
  const r = json('data/elections/persons/reference-dates.json').people['123957'];
  assert.equal(r.born, '1823');
  assert.equal(r.bookGives.born, '1826');
  assert.ok(r.checkedAgainst.born.length >= 2);
});

test('PMS14-13 the figures: Cork Mid 1969 (Desmond) and Portrush 1952 (Fleck 786; Robinson unchanged, noted)', () => {
  const mid = json('data/elections/dail-wikipedia-counts/1969-06-18/cork-mid.json');
  assert.deepEqual(mid.candidates.find((c) => c.name === 'Eileen Desmond').counts, [4936, 4977, 5129, 6762, 7000, 7038]);
  assert.equal(mid.candidates.find((c) => c.name === 'Batt Donegan').counts[2], 3878);
  const portrush = json('data/elections-source/data/elections/portrush-urban-district-council/1952-05-21/portrush.json');
  const row = (surname) => portrush.Constituency.countGroup.find((c) => c.Surname === surname);
  assert.equal(row('Fleck').Candidate_First_Pref_Votes, '786.00');
  assert.equal(row('Robinson').Candidate_First_Pref_Votes, '678.00');
  assert.match(portrush.correctionNote, /Robinson's figure is left at 678/);
});

test('PMS14-14 every id retired on 14 Nov redirects to a live person', () => {
  const retired = [138445, 153585, 105941, 100930, 101567, 133562, 143656, 139763, 140480, 139752, 140436, 140493, 140481,
    141814, 153282, 153286, 141456, 139820, 139832, 153197, 140854, 140936, 142635, 141455, 153235, 140924, 132498, 144253,
    147198, 139383];
  for (const id of retired) {
    assert.ok(!byId.has(id), `${id} is still live`);
    assert.ok(redirect.has(id) || mergeLog.includes(`,${id},`), `${id} has no redirect`);
    const to = redirect.get(id);
    if (to) assert.ok(byId.has(to), `${id} redirects to ${to}, which is not live`);
  }
  // 141753 led to 153282, which is now retired: it leads on to Michael J. Barry.
  assert.equal(redirect.get(141753), 141381);
});
