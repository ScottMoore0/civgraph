// The facts model (docs/facts-model.md): schemas, the rules a schema cannot state, the loader
// and its lookups.   node --test tests/facts/
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  browsePartySlugResolver, checkFactsModel, formatFactDate, formatSpan, indexFactsModel, loadFactsModel, notAfter, precisionOf, schemaErrors,
} from '../../scripts/lib/facts-model.mjs';

const cite = { kind: 'book', title: 'Elliott and Flackes (1999), Dictionary, p. 469', publisher: 'Blackstaff Press', url: null, page: '469', citation: 'Elliott & Flackes (1999), p. 469' };

function tinyModel(overrides = {}) {
  const institutions = [{ id: 'party-uup', name: 'Ulster Unionist Party', kind: 'party', jurisdiction: 'northern-ireland', partyId: 'uup' }];
  const offices = [{ id: 'uup-leader', name: 'Leader, Ulster Unionist Party', institution: 'party-uup', jurisdiction: 'northern-ireland', kind: 'party-leader', partyId: 'uup', start: null, startPrecision: null, end: null, endPrecision: null, nameHistory: [], citations: [] }];
  const tenures = [{ id: 'uup-leader:84615:1995-09-08', personId: '84615', officeId: 'uup-leader', start: '1995-09-08', startPrecision: 'day', end: null, endPrecision: null, began: 'elected', ended: null, contest: 'uup-leadership__1995-09-08', citations: [cite] }];
  const events = [{ id: 'uup:founded:1905-03-03', partyId: 'uup', date: '1905-03-03', precision: 'day', type: 'founded', citations: [cite] }];
  const affiliations = [{ id: '84615:vanguard:to-1978:party', personId: '84615', partyId: 'vanguard', kind: 'party', start: null, startPrecision: null, startEvent: null, end: '1978', endPrecision: 'year', endEvent: 'defected-to', citations: [cite] }];
  const nonCandidates = [{ personId: '900001', key: 'peter brooke', displayName: 'Peter Brooke', aliases: ['Peter Brooke'], officialPersonIds: ['wikidata:Q334257'], basis: ['secretary-of-state-ni'], citations: [cite] }];
  const model = { institutions, offices, tenures, events, affiliations, nonCandidates, ...overrides };
  model.officesDoc = { schemaVersion: 1, description: 'x', institutions: model.institutions, offices: model.offices };
  model.tenureDocs = { 'parties.json': { schemaVersion: 1, description: 'x', tenures: model.tenures } };
  model.eventsDoc = { schemaVersion: 1, description: 'x', events: model.events };
  model.affiliationsDoc = { schemaVersion: 1, description: 'x', affiliations: model.affiliations };
  model.nonCandidatesDoc = { schemaVersion: 1, description: 'x', idBlock: { from: 900001, to: 999999 }, persons: model.nonCandidates };
  return model;
}
const refs = {
  personIds: new Set(['84615']),
  partyIds: new Set(['uup', 'vanguard']),
  electionKeys: new Set(['uup-leadership__1995-09-08']),
  candidateOfficialIds: new Map([['ukparliament:657', '80677']]),
};

test('the committed facts files pass their schemas and rules', async () => {
  const model = loadFactsModel();
  assert.ok(model.tenures.length > 300, 'tenures load');
  assert.deepEqual(await schemaErrors(model), []);
  assert.deepEqual(checkFactsModel(model), []);
});

test('a well-formed small model passes', async () => {
  const model = tinyModel();
  assert.deepEqual(await schemaErrors(model), []);
  assert.deepEqual(checkFactsModel(model, refs), []);
});

test('schemas reject a book citation without a page, an unknown begin, a malformed date', async () => {
  const noPage = { ...cite };
  delete noPage.page;
  const errors = await schemaErrors(tinyModel({
    tenures: [{ ...tinyModel().tenures[0], began: 'crowned', start: '1995-13', citations: [noPage] }],
  }));
  assert.ok(errors.some((e) => /began/.test(e)), errors.join('\n'));
  assert.ok(errors.some((e) => /start/.test(e)), errors.join('\n'));
  assert.ok(errors.some((e) => /page/.test(e)), errors.join('\n'));
});

test('rules catch references, precision, order and the registered block', () => {
  const base = tinyModel();
  const errors = checkFactsModel(tinyModel({
    tenures: [
      { ...base.tenures[0], officeId: 'no-such-office' },
      { ...base.tenures[0], id: 'uup-leader:84615:1995-09-08:2', start: '1995-09', startPrecision: 'day', end: '1990', endPrecision: 'year' },
      { ...base.tenures[0], id: 'uup-leader:84615:1995-09-08:3', personId: '1', contest: 'uup-leadership__2001-01-01' },
    ],
    nonCandidates: [{ ...base.nonCandidates[0], personId: '142000', officialPersonIds: ['ukparliament:657'] }],
  }), refs);
  const has = (re) => assert.ok(errors.some((e) => re.test(e)), `${re} in:\n${errors.join('\n')}`);
  has(/unknown office no-such-office/);
  has(/month-precise, recorded as day/);
  has(/ends \(1990\) before it starts/);
  has(/unknown person 1/);
  has(/unknown contest/);
  has(/outside the registered block/);
  has(/shares ukparliament:657 with candidate 80677/);
});

test('a duplicate id and an affiliation with neither party nor label are errors', () => {
  const base = tinyModel();
  const errors = checkFactsModel(tinyModel({
    events: [base.events[0], base.events[0]],
    affiliations: [{ ...base.affiliations[0], partyId: null }],
  }), refs);
  assert.ok(errors.some((e) => /duplicate id uup:founded/.test(e)));
  assert.ok(errors.some((e) => /neither a party nor a label/.test(e)));
});

test('dates keep the precision they were given', () => {
  assert.equal(precisionOf('1974'), 'year');
  assert.equal(precisionOf('1974-05'), 'month');
  assert.equal(precisionOf('1974-05-28'), 'day');
  assert.equal(formatFactDate('1974-05-28'), '28 May 1974');
  assert.equal(formatFactDate('1974-05'), 'May 1974');
  assert.equal(formatSpan('1972-03', '1974-01'), 'March 1972 – January 1974');
  assert.equal(formatSpan(null, '1987-09'), 'until September 1987');
  assert.equal(formatSpan('1998', null), 'from 1998');
  assert.ok(notAfter('1974', '1974-05'));
  assert.ok(!notAfter('1975', '1974-05'));
});

test('the index groups tenures by person and office, and offices by party', () => {
  const index = indexFactsModel(tinyModel());
  assert.equal(index.tenuresByPerson.get('84615').length, 1);
  assert.equal(index.tenuresByOffice.get('uup-leader')[0].personId, '84615');
  assert.deepEqual(index.officesByParty.get('uup').map((o) => o.id), ['uup-leader']);
  assert.equal(index.eventsByParty.get('uup')[0].type, 'founded');
});

test('registry ids resolve to Browse party slugs through their labels', () => {
  const resolve = browsePartySlugResolver(
    [{ id: 'uup', name: 'Ulster Unionist Party', aliases: ['UUP'] }, { id: 'vanguard', name: 'Vanguard Unionist Progressive Party', aliases: [] }, { id: 'ghost', name: 'Nobody', aliases: [] }],
    { 'vanguard unionist progressive party': 'vanguard-unionist-progressive-party' },
    new Set(['uup', 'vanguard-unionist-progressive-party']),
  );
  assert.equal(resolve('uup'), 'uup');
  assert.equal(resolve('vanguard'), 'vanguard-unionist-progressive-party');
  assert.equal(resolve('ghost'), null);
});
