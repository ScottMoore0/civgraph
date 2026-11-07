// The ingest scripts' item statuses and run modes (scripts/intake/lib/item-status.mjs, catalogue
// IN-L): every literal a script writes or compares for a named field is in its vocabulary.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { isItemStatus, literalsOf, MIRROR_ITEM, SCRIPT_VOCABULARIES } from '../../scripts/intake/lib/item-status.mjs';

test('every status literal in the ingest scripts is in its vocabulary', () => {
  const stray = [];
  let seen = 0;
  for (const [file, fields] of Object.entries(SCRIPT_VOCABULARIES)) {
    const source = readFileSync(path.join('scripts', 'ingest', file), 'utf8');
    for (const [field, vocabulary] of Object.entries(fields)) {
      const found = literalsOf(source, field);
      // A field that names an HTTP response (response.status) is not an item status.
      for (const v of found) { seen += 1; if (!vocabulary.includes(v)) stray.push(`${file} ${field}: "${v}"`); }
      assert.ok(found.size > 0, `${file}: no ${field} literal found; the vocabulary entry is stale`);
    }
  }
  assert.deepEqual(stray, []);
  assert.ok(seen > 40);
});

test('the vocabularies are closed', () => {
  assert.ok(Object.isFrozen(MIRROR_ITEM));
  assert.ok(isItemStatus(MIRROR_ITEM, 'uploaded'));
  assert.equal(isItemStatus(MIRROR_ITEM, 'done'), false);
  assert.throws(() => { MIRROR_ITEM.push('done'); });
});

test('literalsOf reads assignments, comparisons and ternaries', () => {
  const src = "x = { status: 'a' }; if (row.status === \"b\") y.status = 'c'; z = { status: ok ? 'd' : 'e' };";
  assert.deepEqual([...literalsOf(src, 'status')].sort(), ['a', 'b', 'c', 'd', 'e']);
});
