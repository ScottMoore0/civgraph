import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  LEDGER, LEDGER_MD, coveringEntry, forbiddenIn, privateIdMatch, renderMarkdown, tallyProvenance, validateLedger,
} from '../../scripts/check/rules/source-ledger.mjs';

const entry = (over = {}) => ({
  id: 'example-open-source', name: 'Example', category: 'elections', publisher: 'Example body',
  url: 'https://example.org', rights: 'OGL-3.0', access: 'open',
  mirrored: { status: 'partial', where: ['r2'], approxSize: '1 GB', asOf: '2026-11-09' },
  extracted: { status: 'partial', what: 'x', counts: { records: 3 }, targets: ['data/x.json'] },
  remaining: 'r', nextStep: 'n', lastChecked: '2026-11-09', match: { hosts: ['example.org'] },
  ...over,
});
const ledgerOf = (...sources) => ({ schemaVersion: 1, asOf: '2026-11-09', policy: 'p', sources });

test('the committed ledger validates and its docs table is current', () => {
  const ledger = JSON.parse(readFileSync(LEDGER, 'utf8'));
  assert.deepEqual(validateLedger(ledger), []);
  const md = readFileSync(LEDGER_MD, 'utf8').replace(/\r\n/g, '\n').trimEnd();
  assert.equal(md, renderMarkdown(ledger).trimEnd());
});

test('a well-formed open entry passes', () => {
  assert.deepEqual(validateLedger(ledgerOf(entry())), []);
});

test('bad enums and non-open rights fail', () => {
  const errors = validateLedger(ledgerOf(entry({ category: 'misc', rights: 'facts-only', access: 'anything',
    mirrored: { status: 'maybe', where: ['usb'], approxSize: null, asOf: null } })));
  for (const want of ['category', 'rights', 'access', 'mirrored.status', 'mirrored.where']) {
    assert.ok(errors.some((e) => e.includes(want)), `expected an error about ${want}: ${errors.join('; ')}`);
  }
});

test('privately tracked source ids fail', () => {
  assert.equal(privateIdMatch('irish-newspaper-archives'), 'irish-newspaper');
  assert.equal(privateIdMatch('ark-elections'), 'ark');
  assert.equal(privateIdMatch('nisra-files'), null);
  assert.equal(privateIdMatch('market-data'), null);
  const errors = validateLedger(ledgerOf(entry({ id: 'how-ireland-voted-1989' })));
  assert.ok(errors.some((e) => e.includes('privately tracked')));
});

test('local paths and private-material words fail', () => {
  assert.ok(forbiddenIn('held at D:\\data\\x').length);
  assert.ok(forbiddenIn('C:/Users/someone/file').length);
  assert.ok(forbiddenIn('the Pointer address file').length);
  assert.deepEqual(forbiddenIn('see https://data.civgraph.net/data/downloads/'), []);
  const errors = validateLedger(ledgerOf(entry({ remaining: 'copy in E:\\Archive' })));
  assert.ok(errors.some((e) => e.includes('drive-letter')));
});

test('provenance tally counts covered citations and ignores private hosts and printed works', () => {
  const ledger = ledgerOf(entry());
  const provenance = { contests: [{ sources: [
    { url: 'https://www.example.org/a', host: 'www.example.org' },
    { url: 'https://electionsireland.org/x', host: 'electionsireland.org' },
    { url: null, title: 'A printed book', publisher: 'Someone' },
    { url: 'https://uncovered.example.net/x', host: 'uncovered.example.net' },
  ] }] };
  assert.equal(coveringEntry(ledger, provenance.contests[0].sources[0]), 'example-open-source');
  const { perEntry, uncovered } = tallyProvenance(ledger, provenance);
  assert.equal(perEntry.get('example-open-source'), 1);
  assert.deepEqual([...uncovered], [['uncovered.example.net', 1]]);
});
