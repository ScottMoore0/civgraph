// The ingest scripts' item statuses and run modes (packages/intake/src/item-status.mjs, catalogue
// IN-L): every value a script writes or compares for a named field comes from its vocabulary's
// name map, never a quoted literal, and every name it reads is in that vocabulary.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import * as itemStatus from '@civgraph/intake/item-status.mjs';

const { isItemStatus, literalsOf, namesOf, named, MIRROR_ITEM, NAME_MAPS, SCRIPT_VOCABULARIES } = itemStatus;
const IMPORT = /import \{ ([^}]+) \} from '@civgraph\/intake\/item-status\.mjs';/;

test('every item status in the ingest scripts comes from its vocabulary', () => {
  const problems = [];
  let seen = 0;
  for (const [file, fields] of Object.entries(SCRIPT_VOCABULARIES)) {
    const source = readFileSync(path.join('scripts', 'ingest', file), 'utf8');
    const imported = (source.match(IMPORT)?.[1] || '').split(',').map((n) => n.trim()).filter(Boolean);
    if (!imported.length) { problems.push(`${file}: does not import item-status.mjs`); continue; }
    for (const name of imported) if (!(name in itemStatus)) problems.push(`${file}: imports ${name}, which item-status.mjs does not export`);
    for (const [field, vocabulary] of Object.entries(fields)) {
      // A bracketed name (RESULT['Not Elected']) is quoted, but it is a name, not a literal.
      const unnamed = source.replace(/\b[A-Z_]+\[\s*(["'])[^"']+\1\s*\]/g, 'NAME');
      for (const v of literalsOf(unnamed, field)) problems.push(`${file} ${field}: quoted "${v}" instead of a name`);
      const maps = imported.filter((n) => NAME_MAPS[n] === vocabulary);
      const used = maps.reduce((k, n) => k + namesOf(source, n).size, 0);
      if (!used) problems.push(`${file}: no ${field} name read from its vocabulary; the entry is stale`);
    }
    for (const name of imported.filter((n) => n in NAME_MAPS)) {
      for (const v of namesOf(source, name)) { seen += 1; if (!NAME_MAPS[name].includes(v)) problems.push(`${file}: ${name}.${v} is not in its vocabulary`); }
    }
  }
  assert.deepEqual(problems, []);
  assert.ok(seen > 40, `only ${seen} names read`);
});

test('each name map holds its vocabulary, every value under its own name', () => {
  for (const [name, vocabulary] of Object.entries(NAME_MAPS)) {
    const map = itemStatus[name];
    assert.ok(Object.isFrozen(map), name);
    assert.deepEqual(Object.keys(map), [...vocabulary], name);
    for (const v of vocabulary) assert.equal(map[v], v, `${name}.${v}`);
  }
  assert.deepEqual(named(['a', 'b-c']), { a: 'a', 'b-c': 'b-c' });
});

test('namesOf reads dotted and bracketed names', () => {
  const src = "x = MIRROR.uploaded; y = MIRROR['skipped-dynamic']; z = OTHER.failed; if (s === MIRROR[\"already\"]) {}";
  assert.deepEqual([...namesOf(src, 'MIRROR')].sort(), ['already', 'skipped-dynamic', 'uploaded']);
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
