// The Wikidata crosswalk of persons (scripts/lib/wikidata-persons.mjs): its validator, the item a
// person record links (official ids first, the crosswalk only where they give none), and the
// committed file itself against the person registry.
//
//   node --test tests/unit/wikidata-persons.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  loadWikidataPersons,
  personWikidata,
  rekeyWikidataPersons,
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
  assert.deepEqual(changes.resolvedLeads, ['Q3']);
  assert.equal(out.mergeLeads.length, 0);
  assert.deepEqual(validateWikidataPersons(out, { personIds: new Set(['100', '200', '300']) }).errors, []);
});

test('re-keying keeps the kept person own link and reports vanished ids', () => {
  const doc = base();
  doc.persons[300] = { qid: 'Q8', name: 'Kept', confidence: 'official', evidence: ['x'] };
  doc.persons[301] = { qid: 'Q9', name: 'Dropped', confidence: 'medium', evidence: ['y'] };
  const { doc: out, changes } = rekeyWikidataPersons(doc, [{ personId: 100 }, { personId: 300, mergedFrom: [301] }]);
  assert.equal(out.persons[300].qid, 'Q8');
  assert.deepEqual(changes.droppedLinks.map((d) => d.qid), ['Q9']);
  assert.deepEqual(changes.missing, ['200']);
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
