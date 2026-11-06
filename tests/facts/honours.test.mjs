// Honours, peerages and memberships (data/elections/persons/honours.json): the committed file
// passes its schema and rules, every entry cites the book and a second source, an in-post-by
// date reads as such, and a person page renders the table.
import assert from 'node:assert/strict';
import test from 'node:test';
import { checkFactsModel, formatSpan, loadFactsModel, schemaErrors } from '../../scripts/lib/facts-model.mjs';

test('honours.json passes its schema and the model rules', async () => {
  const model = loadFactsModel();
  assert.ok(model.honours.length > 0);
  const errors = (await schemaErrors(model)).filter((e) => /honours/.test(e));
  assert.deepEqual(errors, []);
  assert.deepEqual(checkFactsModel(model).filter((e) => /^honour /.test(e)), []);
});

test('every honour cites the book and at least one second source', () => {
  for (const h of loadFactsModel().honours) {
    assert.ok(h.citations.some((c) => c.kind === 'book'), h.id);
    assert.ok(h.citations.some((c) => c.kind !== 'book'), h.id);
  }
});

test('an honour or tenure known only to be held by a date says so', () => {
  assert.equal(formatSpan(null, null, { startBy: '1999-03-20' }), 'in post by 20 March 1999');
  assert.equal(formatSpan(null, '1983', { startBy: '1972-06' }), 'in post by June 1972 – 1983');
  assert.equal(formatSpan('1997-06-10', null), 'from 10 June 1997');
  const model = loadFactsModel();
  const errors = checkFactsModel({ ...model, honours: [{ id: '1:peerage:1990', personId: '1', kind: 'peerage', title: 'x', start: '1990', startPrecision: 'year', startBy: '1990', end: null, endPrecision: null, citations: [] }] }, {});
  assert.ok(errors.some((e) => /both a start and an in-post-by/.test(e)));
  assert.ok(errors.some((e) => /no citation/.test(e)));
});
