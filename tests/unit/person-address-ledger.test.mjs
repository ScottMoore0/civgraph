// The ledger of published person addresses (scripts/lib/person-address-ledger.mjs): it only grows,
// a name key goes back to the person it was published for (through merges), and the check names
// every key or id that stops answering. The committed ledger is compared with main's: no entry may
// leave it or change its person (when git cannot show main's, only the file's shape is checked).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  LEDGER_FILE, applyLedger, emptyLedger, growLedger, isNameKey, ledgerFailures, ledgerText, publishedFromRows, readLedger, resolvePersonId,
} from '../../scripts/lib/person-address-ledger.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const REL = path.relative(ROOT, LEDGER_FILE).split(path.sep).join('/');

test('name keys are names, never bare ids', () => {
  assert.equal(isNameKey('name-hon-c-l-corry'), true);
  assert.equal(isNameKey('hon-c-l-corry'), true);
  assert.equal(isNameKey('140202'), false);
  assert.equal(isNameKey(''), false);
  assert.equal(isNameKey(undefined), false);
});

test('an id resolves to itself, or through merges while the id reached has no page', () => {
  const live = new Set(['10', '20']);
  const keepOf = new Map([['1', '2'], ['2', '10'], ['10', '20'], ['3', '99']]);
  assert.equal(resolvePersonId('10', live, keepOf), '10', 'a live id stays, though a merge row names it');
  assert.equal(resolvePersonId('1', live, keepOf), '10', 'a chain stops at the first live id');
  assert.equal(resolvePersonId('3', live, keepOf), null, 'a merge to nothing');
  assert.equal(resolvePersonId('4', live, keepOf), null);
});

test('the ledger only grows: a key keeps the person it was first published for', () => {
  const first = growLedger(emptyLedger(), [{ id: '7', slug: 'john-smith-7', previousSlugs: ['name-john-smith', 'john-smith'] }]);
  assert.deepEqual(first.ledger.aliases, { 'john-smith': '7', 'name-john-smith': '7' });
  assert.deepEqual(first.ledger.ids, ['7']);
  assert.equal(first.addedAliases, 2);
  // A later build gives the key to another John Smith, and a name: record has no id.
  const second = growLedger(first.ledger, [
    { id: '9', slug: 'john-smith-9', previousSlugs: ['name-john-smith', 'john-smith', 'name-j-smith'] },
    { id: 'name:x', slug: 'x', previousSlugs: ['name-x'] },
    { id: '10', slug: 'a-10' },
  ]);
  assert.deepEqual(second.ledger.aliases, { 'john-smith': '7', 'name-j-smith': '9', 'name-john-smith': '7' }, 'a name: record (no person id) adds no key');
  assert.deepEqual(second.ledger.ids, ['7', '9', '10'], 'ids ascending; a name: record adds none');
  assert.equal(second.addedAliases, 1);
  assert.equal(second.addedIds, 2);
});

test('applying the ledger gives each key back to its person, through merges and ahead of a fresh key', () => {
  const ledger = {
    schemaVersion: 1,
    aliases: { 'name-hon-c-l-corry': '147654', 'name-john-smith': '7', 'name-gone': '55', 'kept-slug-3': '3' },
    ids: ['3', '7', '147654'],
  };
  const items = [
    { id: '153159', slug: 'hon-c-lowry-corry-153159', previousSlugs: ['name-hon-c-lowry-corry'] },
    { id: '7', slug: 'john-smith-7' },
    { id: '9', slug: 'john-smith-9', previousSlugs: ['name-john-smith'] },
    { id: '3', slug: 'kept-slug-3' },
  ];
  const keepOf = new Map([['147654', '153159']]);
  const out = applyLedger(ledger, items, keepOf);
  assert.deepEqual(out.previousSlugs.get('153159'), ['name-hon-c-lowry-corry', 'name-hon-c-l-corry'], 'the merged-away person\'s key follows the merge');
  assert.deepEqual(out.previousSlugs.get('7'), ['name-john-smith'], 'the key goes back to the person it was published for');
  assert.deepEqual(out.previousSlugs.get('9'), [], 'and leaves the record a fresh build gave it to');
  assert.equal(out.previousSlugs.has('3'), false, 'a key that is a live slug is left alone');
  assert.deepEqual(out.unresolved, [['name-gone', '55']]);
  assert.equal(out.restored, 2);
  assert.equal(out.moved, 1);
});

test('the check names each key or id that no longer answers as published', () => {
  const ledger = {
    schemaVersion: 1,
    aliases: { 'name-a': '1', 'name-b': '2', 'name-c': '3', 'name-d': '4', 'name-e': '5' },
    ids: ['1', '2', '5', '6', '8'],
  };
  const cards = [{ id: '1', slug: 'a-1' }, { id: '2', slug: 'b-2' }, { id: '3', slug: 'c-3' }, { id: '6', slug: 'f-6' }];
  const rows = [
    { alias: 'name-a', slug: 'a-1' }, // answers as published
    { alias: 'name-b', slug: 'c-3' }, // answers with another person
    // name-c: dropped
    { alias: 'name-e', slug: 'f-6' }, // 5 merged into 6: answers with the person kept
    { alias: '5', slug: 'f-6' },
  ];
  const published = publishedFromRows(cards, rows);
  const failures = ledgerFailures(ledger, { ...published, keepOf: new Map([['5', '6'], ['8', '6']]) });
  assert.deepEqual(failures, [
    'name-b: answers with c-3, not b-2 (person 2)',
    'name-c: no longer answers (was person 3, now c-3)',
    'name-d: person 4 no longer has a page or a merge to one',
    'person 8: merged into 6 but the alias table has no row for it',
  ]);
  assert.deepEqual(published.items.find((item) => item.id === '6')?.previousSlugs, ['name-e'], 'bare-id aliases are not name keys');
});

test('the file text is the ledger, one entry per line', () => {
  const ledger = growLedger({ ...emptyLedger(), description: 'd' }, [{ id: '2', slug: 'b-2', previousSlugs: ['name-b'] }, { id: '1', slug: 'a-1' }]).ledger;
  const text = ledgerText(ledger);
  assert.deepEqual(JSON.parse(text), { schemaVersion: 1, description: 'd', aliases: { 'name-b': '2' }, ids: ['1', '2'] });
  assert.match(text, /\n {4}"name-b": "2"\n/);
});

/** @returns {import('../../scripts/lib/person-address-ledger.mjs').AddressLedger | null} */
function ledgerOnMain() {
  for (const ref of [process.env.ARCH_BASELINE_REF, 'main', 'origin/main'].filter(Boolean)) {
    try {
      return JSON.parse(execFileSync('git', ['show', `${ref}:${REL}`], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 1 << 28 }));
    } catch { /* next ref */ }
  }
  return null;
}

test('the committed ledger: well formed, and nothing of main\'s ledger left or changed', (t) => {
  const ledger = readLedger();
  assert.equal(ledger.schemaVersion, 1);
  for (const [alias, id] of Object.entries(ledger.aliases)) {
    assert.ok(isNameKey(alias), `${alias} is a name key`);
    assert.match(id, /^[1-9]\d*$/, `${alias} names a person id`);
  }
  assert.deepEqual(ledger.ids, [...new Set(ledger.ids)].sort((a, b) => Number(a) - Number(b)), 'ids unique and ascending');
  for (const id of ledger.ids) assert.match(id, /^[1-9]\d*$/);
  assert.deepEqual(Object.keys(ledger.aliases), Object.keys(ledger.aliases).sort(), 'keys sorted');
  const main = ledgerOnMain();
  if (!main) { t.diagnostic(`no committed ${REL} on main: nothing to compare with yet`); return; }
  for (const [alias, id] of Object.entries(main.aliases || {})) assert.equal(ledger.aliases[alias], id, `${alias} keeps person ${id}`);
  const ids = new Set(ledger.ids);
  for (const id of main.ids || []) assert.ok(ids.has(String(id)), `person ${id} stays in the ledger`);
});
