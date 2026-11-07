// The Elliott & Flackes people items settled on 7 Nov 2026 (people-delta.json): the offices,
// tenures, affiliations and honours read as researched, the two recorded merges name the
// records they join, the 1967 Douglas row is split from the 1973 Derry Gormley, and the items
// held for want of a second source stay out.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { loadFactsModel } from '../../scripts/lib/facts-model.mjs';

const read = (rel) => JSON.parse(readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8'));
const model = loadFactsModel();
const tenure = (id) => model.tenures.find((t) => t.id === id);
const byPerson = (list, personId) => list.filter((x) => x.personId === personId);
const newspapers = (fact) => fact.citations.filter((c) => c.kind === 'newspaper');

test('Hay was Mayor of Derry from the annual meeting of 1 June 1992', () => {
  const hay = tenure('mayor-derry:57442:1992-06-01');
  assert.ok(hay);
  assert.equal(hay.start, '1992-06-01');
  assert.equal(hay.startPrecision, 'day');
  assert.equal(hay.began, 'elected');
  assert.equal(tenure('mayor-derry:57442:1992'), undefined);
});

test('Derry 1998: Joe Millar mayor and Lynn Fleming deputy from 1 June; no one else is guessed', () => {
  assert.equal(tenure('mayor-derry:100394:1998-06-01').start, '1998-06-01');
  assert.equal(tenure('deputy-mayor-derry:26684:1998-06-01').start, '1998-06-01');
  // Mildred Garfield (101545) never held the deputy mayoralty.
  assert.deepEqual(byPerson(model.tenures, '101545'), []);
});

test('Gorman chaired the Forum from its first sitting, interim then permanent', () => {
  const interim = tenure('ni-forum-chair:73790:1996-06-14');
  const permanent = tenure('ni-forum-chair:73790:1997-06');
  assert.ok(interim && permanent);
  assert.equal(interim.began, 'appointed');
  assert.equal(interim.end.slice(0, 7), permanent.start);
  assert.ok(newspapers(interim).length >= 2);
});

test('Merlyn Rees held Finance at the NIO from April to September 1976', () => {
  const rees = tenure('nio-minister-finance:900014:1976-04');
  assert.equal(rees.start, '1976-04');
  assert.equal(rees.end, '1976-09');
});

test('Lennon sat in the Senate until 1972, as the press of 1971-72 shows', () => {
  const lennon = model.honours.find((h) => h.id === '104202:senate-of-northern-ireland:1944');
  assert.equal(lennon.end, '1972');
  assert.match(lennon.note, /Settled from the contemporary press/);
  assert.ok(newspapers(lennon).length >= 3);
  assert.ok(lennon.citations.some((c) => c.page === '314'));
});

test("Ó Conaill was Republican Sinn Féin's chairman, then its vice-president", () => {
  const chair = tenure('republican-sinn-fein-chair:108934:1986-11');
  const vp = tenure('republican-sinn-fein-vice-president:108934:1988-10');
  assert.ok(chair && vp);
  assert.equal(chair.end, vp.start, 'the chair ends where the vice-presidency begins');
  assert.equal(vp.end, '1991-01-01');
  assert.equal(vp.ended, 'died');
  assert.ok(model.offices.some((o) => o.id === 'republican-sinn-fein-chair' && o.partyId === 'republican-sinn-fein'));
});

test("Glass was Alliance's first chairman, then its president", () => {
  const chair = tenure('alliance-chair:78876:1970-10-24');
  const president = tenure('alliance-president:78876:1972-03-25');
  assert.ok(chair && president);
  assert.ok(chair.end < president.start);
  assert.equal(president.end, '1974-03');
});

test("Lynch's Workers' Party posts are dated from the press, in post by 1978 and 1979", () => {
  const vp = tenure('workers-party-vice-president:59944:by-1978-09-12');
  const chair = tenure('workers-party-northern-chair:59944:by-1979-02-26');
  assert.ok(vp && chair);
  for (const t of [vp, chair]) {
    assert.equal(t.start, null);
    assert.equal(t.end, '1992');
    assert.match(t.note, /Settled from the contemporary press/);
  }
});

test("Green's parties run in order with no overlap, and the UUUM/UUUP spell is not shown", () => {
  const green = byPerson(model.affiliations, '87101').filter((a) => a.kind === 'party');
  assert.deepEqual(green.map((a) => a.id), [
    '87101:vanguard:to-1978-06:party',
    '87101:uup:1978-06:party',
    '87101:ulster-popular-unionist-party:1981:party',
    '87101:uup:1982:party',
    '87101:conservative:1989-01-17:party',
  ]);
  for (let i = 1; i < green.length; i += 1) {
    assert.ok(String(green[i - 1].end) <= String(green[i].start), `${green[i - 1].id} ends by ${green[i].id}`);
  }
  assert.ok(!green.some((a) => a.partyId === 'uuup'));
});

test('the Gormley and McConnell moves to Alliance cite the book pages', () => {
  const pages = (id) => model.affiliations.find((a) => a.id === id).citations.map((c) => c.page).filter(Boolean);
  assert.ok(pages('65292:alliance:1972-02-18:party').includes('267'));
  assert.ok(pages('50631:alliance:1972-02-18:party').includes('326'));
});

test('the Cunninghams are registered as people who never stood', () => {
  const registered = new Map(model.nonCandidates.map((p) => [p.personId, p.displayName]));
  assert.equal(registered.get('900074'), 'James Glencairn Cunningham');
  assert.equal(registered.get('900075'), 'Josias Cunningham');
});

test('the R. V. Campbell and Jack Preston merges name the records they join', () => {
  const rows = readFileSync(new URL('../../data/elections/persons/person_id_confirmed_merges.csv', import.meta.url), 'utf8').split('\n');
  const registry = new Map(read('data/elections/persons/person_registry.json').entities.map((e) => [e.personId, e]));
  for (const [keep, drop, keepKey, dropKey] of [[47167, 142098, '47167', 'R. V. Campbell|'], [102721, 107895, 'T2961067081', 'T3662557448']]) {
    assert.ok(rows.some((r) => r.startsWith(`${keep},${drop},`)), `${keep} <- ${drop}`);
    // The stable keys resolve to the two records as they stand before the re-stamp.
    if (registry.has(drop)) {
      assert.ok(registry.get(keep).sourceIds.includes(keepKey));
      assert.ok(registry.get(drop).sourceIds.includes(dropKey));
    }
  }
});

test('the 1967 Douglas member is filed under Thomas Columba Gormley', () => {
  const file = 'data/elections-source/data/elections/tyrone-county-council/1967-06-01/douglas.json';
  const fix = read('data/elections/corrections/source-checked-fixes.json').records.find((r) => r.sourceFile === file);
  assert.ok(fix, 'a source-checked fix');
  assert.deepEqual(fix.operations, [{ op: 'candidate', name: 'Gormley', set: { candidateName: 'Thomas Columba Gormley', Firstname: 'Thomas Columba' } }]);
  assert.ok(read(file).Constituency.countGroup.some((row) => row.candidateName === 'Gormley'), 'the row the fix renames');
  const in1964 = read('data/elections-source/data/elections/tyrone-county-council/1964-06-04/douglas.json').Constituency.countGroup[0];
  assert.equal(in1964.candidateName, fix.operations[0].set.candidateName, 'the name of the 1964 member');
});

test('items held for want of a second source stay out', () => {
  assert.deepEqual(byPerson(model.tenures, '99076').filter((t) => /vice-chair/.test(t.officeId)), []);
  assert.ok(!byPerson(model.affiliations, '87101').some((a) => /1992/.test(`${a.start}${a.end}`)));
});
