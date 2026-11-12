// The merge leads of c10-merge-leads that the owner approved on 12 Nov 2026 (stream w8-merges), as
// they stand in the committed person registry: the name-keyed 1924-67 council rows the papers show
// to be other men keep the identity keys data/elections/persons/label-blanked-identity-keys.csv
// gives them, so no re-stamp joins them again, and every id the leads retired still redirects.
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

test('MLC-01 the two William Houstons of Ballymena Rural District stay two people', () => {
  assert.equal(holder('William Houston|'), 143963);
  assert.notEqual(holder('William Houston|ballymena-glenravel-1958-1967'), 143963);
  assert.equal(byId.get(143963).candidacies, 15);
});

test('MLC-02 the John Boyds of Seacon, Killagan, Ballynure and Clonelly, and the J. Boyds, are who the papers say', () => {
  assert.equal(holder('John Boyd|'), 143959);
  assert.equal(byId.get(143959).candidacies, 5);
  const killagan = holder('John Boyd|ballymoney-killagan-1933');
  const ballynure = holder('John Boyd|larne-ballynure-1924-1939');
  assert.equal(new Set([143959, killagan, ballynure, 104090, 144062]).size, 5);
  assert.equal(byId.get(ballynure).candidacies, 6);
  assert.equal(holder('John Boyd|UUP'), 144062);
  assert.equal(byId.get(144062).candidacies, 6);
  assert.equal(holder('James Boyd|Independent'), 143372);
  assert.equal(holder('12554802'), 104090);
  assert.deepEqual(byId.get(104090).sourceIds, ['12554802']);
  assert.equal(holder('J. Boyd|UUP'), 145911);
});

test('MLC-03 Patrick McKenna the TD is not the Monaghan councillor of 1979-91', () => {
  assert.deepEqual(byId.get(100325).sourcePersonIds, ['ei:1363']);
  assert.notEqual(holder('ie:22125'), 100325);
  assert.ok(!(byId.get(123420).sourcePersonIds || []).includes('wikipedia:Patrick McKenna (Irish politician)'));
});

test('MLC-04 every id the leads retired redirects to its person', () => {
  const lines = readFileSync(at('person_id_confirmed_merges.csv'), 'utf8').split('\n').filter(Boolean);
  const drops = new Map(lines.slice(1).map((l) => l.split(',')).map(([keep, drop]) => [drop, keep]));
  const retired = {
    145049: 144327, 147765: 144327, 150929: 144327, 145195: 144327,
    147264: 143963, 151283: 143963, 148449: 143963,
    152629: 100739, 152623: 103129, 152627: 109015, 152624: 108800,
    124345: 100026, 104286: 103852, 104257: 104247, 106296: 104247, 122885: 122809, 104439: 104244,
    104261: 104129, 104074: 103851, 104526: 104115, 104354: 102198, 105921: 104016,
  };
  for (const [drop, keep] of Object.entries(retired)) {
    assert.equal(drops.get(drop), String(keep), `${drop} -> ${keep}`);
    assert.ok(!byId.has(Number(drop)), `${drop} is still a live person`);
    assert.ok(byId.has(keep), `${keep} is not a live person`);
  }
});

test('MLC-05 a declared identity key may hold several printed forms of a name', () => {
  const src = readFileSync(new URL('../../scripts/ingest/persons/build_person_registry_v2.py', import.meta.url), 'utf8');
  assert.match(src, /bad_ids = \{i for i, n in names_by_id\.items\(\) if len\(n\) > 1 and i not in declared\}/);
  assert.match(src, /names = \{matchkey\(r\['name'\]\) for r in v\} if k\[1\] in declared else \{matchkey\(v\[0\]\['name'\]\)\}/);
});
