// The Wikidata crosswalk of persons (scripts/lib/wikidata-persons.mjs): its validator, the item a
// person record links (official ids first, the crosswalk only where they give none), and the
// committed file itself against the person registry; the re-key after person merges (links move,
// settled merge leads become links, conflicts are listed, nothing leaves unlisted), and the
// lost-item comparison check:wikidata-persons runs against the previous committed crosswalk.
//
//   node --test tests/unit/wikidata-persons.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  addRemovals,
  linkFromLead,
  loadRemovals,
  loadWikidataPersons,
  lostQids,
  personRedirects,
  personWikidata,
  rekeyWikidataPersons,
  restoreLostLinks,
  validateRemovals,
  validateWikidataPersons,
  wikidataOf,
  wikidataUrl
} from '../../scripts/lib/wikidata-persons.mjs';

const base = () => ({
  schemaVersion: 1,
  source: { url: 'https://query.wikidata.org/sparql', licence: 'CC0 1.0' },
  persons: {
    100: { qid: 'Q1', name: 'Ann Example', confidence: 'official', evidence: ['oireachtas:Ann-Example.D.2016-10-03 (Wikidata P4690)'] },
    200: { qid: 'Q2', name: 'Bob Example', confidence: 'medium', evidence: ['P39 Teachta Dála 1997-2002, Dublin North'] }
  },
  mergeLeads: [{ wikidata: 'Q3', persons: [{ personId: '300' }, { personId: '301' }], verdict: 'same', reason: 'one P39 span covers both' }]
});
const registry = { personIds: new Set(['100', '200', '300', '301']), registryQids: new Map([['100', 'Q1']]) };

test('a well-formed crosswalk passes', () => {
  assert.deepEqual(validateWikidataPersons(base(), registry).errors, []);
});

test('a person id missing from the registry fails, in links and in merge leads', () => {
  const doc = base();
  doc.persons[999] = { qid: 'Q9', name: 'Gone', confidence: 'high', evidence: ['x'] };
  doc.mergeLeads[0].persons.push({ personId: '302' });
  const { errors } = validateWikidataPersons(doc, registry);
  assert.ok(errors.some((e) => e.includes('persons[999]') && e.includes('not in person_registry.json')));
  assert.ok(errors.some((e) => e.includes('mergeLeads[0]') && e.includes('302')));
});

test('bad qid, confidence and evidence fail', () => {
  const doc = base();
  doc.persons[200] = { qid: 'X2', name: 'Bob Example', confidence: 'low', evidence: [] };
  const { errors } = validateWikidataPersons(doc, registry);
  assert.equal(errors.filter((e) => e.startsWith('persons[200]')).length, 3);
});

test('one item linked to two persons fails', () => {
  const doc = base();
  doc.persons[200].qid = 'Q1';
  assert.ok(validateWikidataPersons(doc, registry).errors.some((e) => e.includes('also linked to person 100')));
});

test('a link that disagrees with the registry wikidata id fails', () => {
  const doc = base();
  doc.persons[100].qid = 'Q7';
  assert.ok(validateWikidataPersons(doc, registry).errors.some((e) => e.includes("registry's wikidata:Q1")));
});

test('official ids win; the crosswalk fills only an empty set', () => {
  const doc = base();
  assert.deepEqual(personWikidata(new Set(['Q5']), doc, '200'), { qid: 'Q5', fromCrosswalk: false });
  assert.deepEqual(personWikidata(new Set(['Q5', 'Q6']), doc, '200'), { qid: null, fromCrosswalk: false });
  assert.deepEqual(personWikidata(new Set(), doc, '200'), { qid: 'Q2', fromCrosswalk: true });
  assert.deepEqual(personWikidata(new Set(), doc, 'name:someone'), { qid: null, fromCrosswalk: false });
  assert.equal(wikidataOf({ persons: { 1: { qid: 'Q1', confidence: 'low' } } }, 1), null);
});

test('wikidataUrl only accepts item ids', () => {
  assert.equal(wikidataUrl('Q42'), 'https://www.wikidata.org/wiki/Q42');
  assert.equal(wikidataUrl('javascript:alert(1)'), null);
  assert.equal(wikidataUrl(undefined), null);
});

test('re-keying after a merge moves the link and resolves the lead', () => {
  const doc = base();
  doc.persons[301] = { qid: 'Q3', name: 'Dropped Half', confidence: 'high', evidence: ['x'] };
  const entities = [{ personId: 100 }, { personId: 200 }, { personId: 300, mergedFrom: [301] }];
  const { doc: out, changes } = rekeyWikidataPersons(doc, entities);
  assert.equal(out.persons[300].qid, 'Q3');
  assert.equal(out.persons[301], undefined);
  assert.deepEqual(changes.moved, [{ from: '301', to: '300', qid: 'Q3' }]);
  assert.deepEqual(changes.resolvedLeads, ['Q3']);
  assert.equal(out.mergeLeads.length, 0);
  assert.deepEqual(changes.conflicts, []);
  assert.deepEqual(validateWikidataPersons(out, { personIds: new Set(['100', '200', '300']) }).errors, []);
});

test('re-keying keeps the kept person own link, lists the other as a conflict, and lists vanished ids', () => {
  const doc = base();
  doc.persons[300] = { qid: 'Q8', name: 'Kept', confidence: 'official', evidence: ['x'] };
  doc.persons[301] = { qid: 'Q9', name: 'Dropped', confidence: 'medium', evidence: ['y'] };
  const { doc: out, changes } = rekeyWikidataPersons(doc, [{ personId: 100 }, { personId: 300, mergedFrom: [301] }], { date: '2026-11-12' });
  assert.equal(out.persons[300].qid, 'Q8');
  assert.deepEqual(changes.conflicts.map((c) => [c.qid, c.personId, c.kind, c.keptPersonId, c.keptQid, c.date]), [
    ['Q9', '301', 'conflict', '300', 'Q8', '2026-11-12'],
    ['Q3', '301', 'conflict', '300', 'Q8', '2026-11-12'] // the lead of 300 and 301, settled onto a person holding Q8
  ]);
  assert.deepEqual(changes.missing, ['200']);
  assert.deepEqual(changes.removals.map((r) => [r.qid, r.personId, r.kind]), [['Q2', '200', 'vanished']]);
  // nothing leaves unlisted: every earlier item is still linked, a lead, or listed
  const listed = [...changes.conflicts, ...changes.removals].map((r) => r.qid);
  assert.deepEqual(lostQids(doc, out, listed), []);
});

// The wave-6 failure: owner-approved merges are redirect rows in person_id_confirmed_merges.csv,
// not the registry's mergedFrom; the old re-key saw the dropped half as gone and resolved the lead
// with no link at all.
test('a merge lead settled by a confirmed-merge redirect becomes the kept person link', () => {
  const doc = base();
  doc.mergeLeads[0].label = 'Carol Example';
  doc.mergeLeads[0].persons = [
    { personId: '300', name: 'Carol Example', grade: 'undated', officeEvidence: ['council 2009 North (Lab) [district]'] },
    { personId: '301', name: 'Carol Example', grade: 'high', officeEvidence: ['council 2014 North (Lab) [district]'] }
  ];
  const entities = [{ personId: 100 }, { personId: 200 }, { personId: 300 }];
  const old = rekeyWikidataPersons(doc, entities);
  assert.equal(old.doc.persons[300], undefined, 'without the redirect rows the lead cannot be settled');
  assert.deepEqual(old.changes.removals.map((r) => [r.qid, r.kind, r.keptPersonId]), [['Q3', 'vanished', '300']], '...but it is listed, not dropped silently');
  const { doc: out, changes } = rekeyWikidataPersons(doc, entities, { redirects: [{ keep: '300', drop: '301' }], note: 'linked at the landing' });
  assert.deepEqual(changes.linkedFromLeads, [{ qid: 'Q3', to: '300', from: ['300', '301'], verdict: 'same' }]);
  assert.equal(out.persons[300].qid, 'Q3');
  assert.equal(out.persons[300].name, 'Carol Example');
  assert.equal(out.persons[300].label, 'Carol Example');
  assert.equal(out.persons[300].confidence, 'high', 'the best crosswalk grade of its records');
  assert.deepEqual(out.persons[300].evidence.slice(0, 2), ['council 2009 North (Lab) [district]', 'council 2014 North (Lab) [district]']);
  assert.match(out.persons[300].evidence[2], /merge lead "same" \(one P39 span covers both\): persons 300, 301 merged into 300/);
  assert.equal(out.persons[300].evidence[3], 'linked at the landing');
  assert.deepEqual(changes.conflicts, []);
  assert.deepEqual(changes.removals, []);
  assert.deepEqual(validateWikidataPersons(out, { personIds: new Set(['100', '200', '300']) }).errors, []);
});

test('a settled lead whose kept person holds another item keeps that item and lists the conflict', () => {
  const doc = base();
  doc.persons[300] = { qid: 'Q8', name: 'Kept', confidence: 'official', evidence: ['x'] };
  const { doc: out, changes } = rekeyWikidataPersons(doc, [{ personId: 100 }, { personId: 200 }, { personId: 300 }], { redirects: [{ keep: '300', drop: '301' }] });
  assert.equal(out.persons[300].qid, 'Q8');
  assert.deepEqual(changes.conflicts.map((c) => [c.qid, c.kind, c.keptPersonId, c.keptQid]), [['Q3', 'conflict', '300', 'Q8']]);
  assert.deepEqual(changes.linkedFromLeads, []);
  assert.deepEqual(lostQids(doc, out, changes.conflicts.map((c) => c.qid)), []);
});

test('the registry wikidata: id of the kept person counts: the same item links, another is a conflict', () => {
  const entities = [{ personId: 100 }, { personId: 200 }, { personId: 300 }];
  const redirects = [{ keep: '300', drop: '301' }];
  const same = rekeyWikidataPersons(base(), entities, { redirects, registryQids: new Map([['300', 'Q3']]) });
  assert.equal(same.doc.persons[300].qid, 'Q3');
  const other = rekeyWikidataPersons(base(), entities, { redirects, registryQids: new Map([['300', 'Q7']]) });
  assert.equal(other.doc.persons[300], undefined);
  assert.deepEqual(other.changes.conflicts.map((c) => [c.qid, c.keptQid]), [['Q3', 'Q7']]);
  // a live person's own link is the validator's business, not the re-key's
  const own = rekeyWikidataPersons(base(), entities, { registryQids: new Map([['200', 'Q9']]) });
  assert.equal(own.doc.persons[200].qid, 'Q2');
});

test('a lead the review called different is not linked when its records are merged, but listed', () => {
  const doc = base();
  doc.mergeLeads[0].verdict = 'different';
  const { doc: out, changes } = rekeyWikidataPersons(doc, [{ personId: 100 }, { personId: 200 }, { personId: 300, mergedFrom: [301] }]);
  assert.equal(out.persons[300], undefined);
  assert.deepEqual(changes.conflicts.map((c) => [c.qid, c.kind, c.keptPersonId]), [['Q3', 'merged-different', '300']]);
});

test('an item already linked to another person is not linked twice', () => {
  const doc = base();
  doc.persons[200].qid = 'Q3';
  const { doc: out, changes } = rekeyWikidataPersons(doc, [{ personId: 100 }, { personId: 200 }, { personId: 300, mergedFrom: [301] }]);
  assert.equal(out.persons[200].qid, 'Q3');
  assert.equal(out.persons[300], undefined);
  assert.deepEqual(changes.conflicts.map((c) => [c.qid, c.keptPersonId]), [['Q3', '200']]);
});

test('a lead that stays two persons is re-keyed and kept', () => {
  const doc = base();
  doc.mergeLeads[0].persons.push({ personId: '302' });
  const { doc: out, changes } = rekeyWikidataPersons(doc, [{ personId: 100 }, { personId: 200 }, { personId: 300 }, { personId: 303 }], { redirects: [{ keep: '300', drop: '301' }, { keep: '303', drop: '302' }] });
  assert.deepEqual(out.mergeLeads[0].persons.map((p) => p.personId), ['300', '303']);
  assert.deepEqual(changes.resolvedLeads, []);
});

test('a lead whose records are all gone is listed as vanished', () => {
  const { changes } = rekeyWikidataPersons(base(), [{ personId: 100 }, { personId: 200 }]);
  assert.deepEqual(changes.resolvedLeads, ['Q3']);
  assert.deepEqual(changes.removals.map((r) => [r.qid, r.personId, r.kind]), [['Q3', '300 301', 'vanished']]);
});

test('redirects follow chains, prefer mergedFrom, and never redirect a live id', () => {
  const entities = [{ personId: 1 }, { personId: 2, mergedFrom: [5] }, { personId: 3 }];
  const to = personRedirects(entities, [{ keep: '4', drop: '6' }, { keep: '2', drop: '4' }, { keep: '3', drop: '5' }, { keep: '1', drop: '3' }, { keep: 'x', drop: '7' }]);
  assert.equal(to('6'), '2', '6 -> 4 -> 2');
  assert.equal(to(5), '2', 'mergedFrom wins over a later row');
  assert.equal(to('3'), '3', 'a live id answers as itself');
  assert.equal(to('7'), null);
  assert.equal(to('9'), null);
  const loop = personRedirects([{ personId: 1 }], [{ keep: '8', drop: '9' }, { keep: '9', drop: '8' }]);
  assert.equal(loop('8'), null, 'a redirect loop ends, unresolved');
});

test('linkFromLead falls back to the first record and medium confidence', () => {
  const link = linkFromLead({ wikidata: 'Q5', persons: [{ personId: '7', name: 'Dan', grade: 'undated' }], verdict: 'review' }, '9', ['7', '8']);
  assert.deepEqual(link, { qid: 'Q5', name: 'Dan', confidence: 'medium', evidence: ['merge lead "review": persons 7, 8 merged into 9'] });
});

test('lostQids finds items gone from links and leads, and spares listed ones', () => {
  const before = base();
  const after = base();
  delete after.persons[200];
  after.mergeLeads = [];
  assert.deepEqual(lostQids(before, after), [{ qid: 'Q2', personIds: ['200'] }, { qid: 'Q3', personIds: ['300', '301'] }]);
  assert.deepEqual(lostQids(before, after, ['Q2', 'Q3']), []);
  // a lead that became a link, or a link that moved, is not lost
  const settled = base();
  settled.mergeLeads = [];
  settled.persons[300] = { qid: 'Q3', name: 'x', confidence: 'high', evidence: ['x'] };
  settled.persons[201] = settled.persons[200];
  delete settled.persons[200];
  assert.deepEqual(lostQids(before, settled), []);
});

test('restoreLostLinks brings back what an earlier crosswalk lost, re-keyed, and lists conflicts', () => {
  const earlier = base();
  earlier.persons[400] = { qid: 'Q4', name: 'Fourth', confidence: 'official', evidence: ['e'] };
  earlier.persons[500] = { qid: 'Q5', name: 'Fifth', confidence: 'official', evidence: ['e'] };
  // what the old re-key left: the lead resolved with no link, and both links dropped
  const current = base();
  current.mergeLeads = [];
  current.persons[402] = { qid: 'Q6', name: 'Has one', confidence: 'official', evidence: ['e'] };
  const entities = [{ personId: 100 }, { personId: 200 }, { personId: 300 }, { personId: 402 }, { personId: 600 }];
  const redirects = [{ keep: '300', drop: '301' }, { keep: '402', drop: '400' }, { keep: '600', drop: '500' }];
  const out = restoreLostLinks(current, earlier, entities, { redirects, note: 'restored', removed: new Set(['Q5']) });
  assert.deepEqual(out.restored.map((r) => [r.qid, r.to]), [['Q3', '300']]);
  assert.equal(out.doc.persons[300].qid, 'Q3');
  assert.equal(out.doc.persons[300].evidence.at(-1), 'restored');
  assert.equal(out.doc.persons[402].qid, 'Q6', 'the kept person keeps its own item');
  assert.deepEqual(out.conflicts.map((c) => [c.qid, c.keptQid]), [['Q4', 'Q6']]);
  assert.equal(out.doc.persons[600], undefined, 'an item already on the removal list is left alone');
  assert.deepEqual(lostQids(earlier, out.doc, ['Q4', 'Q5']), []);
});

test('the removal list: validated, and added to once per item', () => {
  const doc = { schemaVersion: 1, conflicts: [], removals: [] };
  const conflict = { qid: 'Q9', personId: '301', kind: 'conflict', reason: 'merged into 300, which already links Q8' };
  const once = addRemovals(doc, [conflict], [{ qid: 'Q2', personId: '200', kind: 'vanished', reason: 'person 200 is gone without a redirect' }]);
  const twice = addRemovals(once, [conflict], []);
  assert.equal(twice.conflicts.length, 1);
  assert.equal(twice.removals.length, 1);
  assert.deepEqual(validateRemovals(twice), []);
  const bad = validateRemovals({ schemaVersion: 1, conflicts: [{ qid: 'X', personId: 'a', kind: 'gone', reason: '' }], removals: 'no' });
  assert.equal(bad.length, 5);
  assert.deepEqual(validateRemovals(loadRemovals()), [], 'the committed removal list is valid');
});

test('the committed crosswalk is valid against the committed registry', () => {
  const reg = JSON.parse(readFileSync(new URL('../../data/elections/persons/person_registry.json', import.meta.url), 'utf8'));
  const personIds = new Set(reg.entities.map((e) => String(e.personId)));
  const registryQids = new Map();
  for (const e of reg.entities) {
    const held = (e.officialPersonIds || []).filter((o) => o.startsWith('wikidata:'));
    if (held.length === 1) registryQids.set(String(e.personId), held[0].slice(9));
  }
  const doc = loadWikidataPersons();
  const { errors } = validateWikidataPersons(doc, { personIds, registryQids });
  assert.deepEqual(errors.slice(0, 5), []);
  assert.ok(Object.keys(doc.persons).length > 1000, 'the crosswalk holds the linked persons');
});
