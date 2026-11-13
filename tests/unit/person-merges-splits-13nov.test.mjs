// The person merges and splits the owner approved on 13 Nov 2026 (research-K1, K2 and J; stream
// persons-13), as they stand in the committed person registry: the keys in
// data/elections/persons/label-blanked-identity-keys.csv and person_id_confirmed_merges.csv hold
// them, so a rebuild cannot undo them, and every retired id still redirects.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const at = (file) => new URL(`../../data/elections/persons/${file}`, import.meta.url);
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
const crosswalk = readFileSync(at('ie-ei-crosswalk.csv'), 'utf8');

test('PMS-01 Daniel Kennedy is three men: ei:1338 and ie:2117 no longer join them', () => {
  assert.equal(holder('ei:1338'), 111063);
  const leix = holder('Daniel Kennedy|leix-offaly-farmers-1923-1932');
  const nenagh = holder('Daniel Kennedy|nenagh-rearcross-1950-1979');
  assert.equal(new Set([111063, leix, nenagh]).size, 3);
  assert.equal(byId.get(111063).candidacies, 3);
  assert.equal(byId.get(leix).candidacies, 2);
  assert.equal(byId.get(nenagh).candidacies, 5);
  assert.ok(!holders('ie:2117').length, 'ie:2117 is set aside on the declared rows');
  assert.doesNotMatch(crosswalk, /^ie:2117,ei:1338,/m);
  assert.equal(redirect.get(130990), nenagh);
});

test('PMS-02 James Stewart: the UUP councillor is not the Communist candidate, and his 1,681 votes are back', () => {
  assert.equal(holder('T2715824823'), 73878);
  const uup = holder('T2715824823-uup');
  assert.notEqual(uup, 73878);
  assert.equal(byId.get(uup).candidacies, 4);
  assert.deepEqual(byId.get(uup).parties, ['UUP']);
  assert.ok(!byId.get(73878).parties.includes('UUP'));
});

test('PMS-03 Roy Beggs Jr keeps the rows that carry his father\'s candidacy id', () => {
  assert.equal(holder('21374'), 21374);
  assert.ok(byId.get(21374).officialPersonIds.includes('niassembly:8'));
  assert.ok(byId.get(68301).officialPersonIds.includes('ukparliament:646'));
  assert.ok(!byId.get(68301).officialPersonIds.includes('niassembly:8'));
});

test('PMS-04 Martin Connolly of Galway is not the Sligo councillor', () => {
  assert.equal(holder('Martin Connolly|galway-no-3-1985'), 122099);
  assert.notEqual(holder('Martin Connolly|sligo:ballymote-tobercurry'), 122099);
  assert.ok(!confirmed.some((r) => r.includes('name:martin connolly')));
});

test('PMS-05 the Castlebar rows are the Mayo TD Micheal O Morain (ei:1927), not the Galway councillor (ie:1845)', () => {
  assert.equal(holder('ei:1927'), 100065);
  assert.equal(byId.get(100065).firstYear, 1937);
  assert.ok(byId.get(100065).bodies.includes('ireland-local'));
  const galway = holder('ie:1845');
  assert.notEqual(galway, 100065);
  assert.ok(!byId.get(galway).bodies.includes('dail-eireann') || byId.get(galway).firstYear >= 1974);
  assert.match(crosswalk, /^ie:1845,ei:3172,/m);
});

test('PMS-06 John Beirne of Roscommon is one man, over the Snr/Jnr and two-Oireachtas-id vetoes', () => {
  const e = byId.get(100298);
  assert.ok(e.sourcePersonIds.includes('ei:4933') && e.sourcePersonIds.includes('ei:2114'));
  assert.equal(e.firstYear, 1943);
  assert.equal(e.candidacies, 7);
  assert.ok(!byId.has(111146));
  assert.equal(redirect.get(111146), 100298);
  const row = confirmed.find(([keep, drop]) => keep === '100298' && drop === '111146');
  assert.ok(row && row.at(-1).includes('official-ids') && row.at(-1).includes('ei-relatives'));
  // No other pair carries an override.
  assert.equal(confirmed.filter((r) => /ei-relatives|official-ids/.test(r.at(-1) || '')).length, 1);
});

test('PMS-07 James Watt of Dunseark holds Bernagh 1927-33, Coalisland 1936 and Aghnahoe 1939; Webb was a misprint', () => {
  assert.equal(holder('James Watt|dunseark'), 144557);
  assert.equal(byId.get(144557).candidacies, 5);
  assert.ok(!byId.get(144557).aliases.includes('James Webb'));
  for (const id of [154577, 146208]) {
    assert.ok(!byId.has(id), `${id} is still live`);
    assert.equal(redirect.get(id), 144557);
  }
});

test('PMS-08 every retired id of the 13 Nov merges redirects to a live person', () => {
  const retired = [108294, 100118, 79664, 91035, 20391, 62514, 76765, 65471, 67392, 134404, 104437, 103977, 111863, 111146,
    100271, 116740, 102866, 133506, 117578, 105923, 135087, 104212, 106294, 103978, 104199, 115460, 116540, 105633,
    145199, 151184, 149175, 143110, 142813, 144354, 142673, 147722, 146513, 145001, 148198, 148995, 153193, 140637,
    147291, 148455, 149193, 147942, 148864, 148865, 148863, 148374, 144281, 147306, 147779, 141809, 141807, 108168,
    139232, 139730, 143978, 145279, 154549, 141839, 140326, 141841, 141855, 154577, 146208, 145930, 145543, 145542,
    140889, 143294, 147697, 148420, 148901, 130990];
  for (const id of retired) {
    assert.ok(!byId.has(id), `${id} is still live`);
    assert.ok(redirect.has(id) || readFileSync(at('person_id_merges.csv'), 'utf8').includes(`,${id},`), `${id} has no redirect`);
    const to = redirect.get(id);
    if (to) assert.ok(byId.has(to), `${id} redirects to ${to}, which is not live`);
  }
});
