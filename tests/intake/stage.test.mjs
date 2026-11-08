// intake stage: dry run by default, --write applies, a second run changes nothing.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { loadBatch } from '../../packages/intake/src/batch.mjs';
import { stageBatch } from '../../packages/intake/src/stage.mjs';
import { main } from '../../scripts/intake/intake.mjs';
import { makeBatch, makeRepo, writeFile } from './helpers.mjs';

const read = (repo, rel) => readFileSync(path.join(repo, rel), 'utf8');

test('a dry run reports every change and writes nothing', () => {
  const repo = makeRepo();
  const { dir } = makeBatch();
  const before = read(repo, 'data/database/maps.json');
  const res = stageBatch(loadBatch(dir, { repo }));
  assert.equal(res.written, false);
  assert.deepEqual(res.errors, []);
  assert.deepEqual(res.conflicts, []);
  const summary = res.changes.map((c) => (c.action === 'edit' ? c.detail : `${c.action} ${c.path}`));
  assert.deepEqual(summary, [
    'add data/maps/health/New_Layer.fgb',
    'add data/maps/health/Lookup.csv',
    'insert maps entry dd-1921 after plu-ni-1921-04-01',
    'insert maps entry dd-1924 after dd-1921',
    'insert class ni-dd after ni-poor-law-unions',
    'edit plu-ni-1924-04-01.description',
    'add reference to plu-ni-1924-04-01: S.R. & O. 1948 No. 281',
    'replace record e1 / A / seats',
    'add record e2 / B / seats',
    'add data/elections-source/data/elections/council/1923-01-15/ward-a.json',
  ]);
  assert.equal(read(repo, 'data/database/maps.json'), before);
  assert.equal(existsSync(path.join(repo, 'data/maps/health/New_Layer.fgb')), false);
});

test('--write applies the batch, and running it again changes nothing', () => {
  const repo = makeRepo();
  const { dir } = makeBatch();
  const batch = loadBatch(dir, { repo });
  const first = stageBatch(batch, { write: true });
  assert.equal(first.written, true);
  assert.equal(first.changes.length, 10);

  const maps = JSON.parse(read(repo, 'data/database/maps.json'));
  assert.deepEqual(maps.maps.map((m) => m.id), ['plu-ni-1921-04-01', 'dd-1921', 'dd-1924', 'plu-ni-1924-04-01']);
  assert.deepEqual(maps.classes.map((c) => c.id), ['ni-poor-law-unions', 'ni-dd']);
  assert.equal('_insert_after' in maps.classes[1], false);
  assert.match(maps.maps[3].description, /boards abolished 30 Sep 1948/);
  assert.equal(maps.maps[3].references.length, 1);
  assert.equal(read(repo, 'data/maps/health/New_Layer.fgb'), 'new layer bytes');
  const corr = JSON.parse(read(repo, 'data/elections/corrections/seat-corrections.json'));
  assert.deepEqual(corr.records.map((r) => r.proposedValue), [2, 3]);

  const snapshot = read(repo, 'data/database/maps.json');
  const second = stageBatch(batch, { write: true });
  assert.deepEqual(second.changes, []);
  assert.equal(second.written, false);
  assert.equal(second.unchanged, 5); // 2 copies + 2 records + 1 election file
  assert.equal(read(repo, 'data/database/maps.json'), snapshot);
});

test('maps.json keeps its CRLF line endings', () => {
  const repo = makeRepo({ eol: '\r\n' });
  const { dir } = makeBatch();
  stageBatch(loadBatch(dir, { repo }), { write: true });
  const text = read(repo, 'data/database/maps.json');
  assert.ok(text.includes('\r\n'));
  assert.equal(/[^\r]\n/.test(text), false);
});

test('a differing election source file is a conflict, and a conflict blocks every write', () => {
  const repo = makeRepo();
  const { dir } = makeBatch();
  writeFile(repo, 'data/elections-source/data/elections/council/1923-01-15/ward-a.json', { area: 'Ward A', changed: true });
  const before = read(repo, 'data/database/maps.json');
  const res = stageBatch(loadBatch(dir, { repo }), { write: true });
  assert.equal(res.conflicts.length, 1);
  assert.equal(res.written, false);
  assert.equal(read(repo, 'data/database/maps.json'), before);
});

test('rounds held back by excludeRounds are not copied, and invalid JSON is an error', () => {
  const repo = makeRepo();
  const { dir, manifest } = makeBatch();
  writeFile(dir, 'exclude.json', { rounds: [{ slug: 'council', folder: '1923-01-15' }] });
  writeFile(dir, 'elections/council/1926-01-15/bad.json', '{ not json');
  manifest.operations.find((o) => o.id === 'results').excludeRounds = 'exclude.json';
  writeFile(dir, 'batch.json', manifest);
  const res = stageBatch(loadBatch(dir, { repo }));
  assert.ok(res.notes.some((n) => /1 file\(s\) held back/.test(n)));
  assert.ok(res.errors.some((e) => /council\/1926-01-15\/bad\.json is not valid JSON/.test(e)));
});

test('the CLI stages only with --write', () => {
  const repo = makeRepo();
  const { dir } = makeBatch();
  const lines = [];
  assert.equal(main(['stage', dir, '--repo', repo], { log: (l) => lines.push(l) }), 0);
  assert.match(lines.at(-1), /^DRY RUN: 10 change\(s\)/);
  assert.equal(existsSync(path.join(repo, 'data/maps/health/Lookup.csv')), false);
  assert.equal(main(['stage', dir, '--repo', repo, '--write'], { log: (l) => lines.push(l) }), 0);
  assert.match(lines.at(-1), /^WRITTEN: 10 change\(s\)/);
  assert.equal(main(['stage', dir, '--repo', repo], { log: (l) => lines.push(l) }), 0);
  assert.match(lines.at(-1), /^DRY RUN: 0 change\(s\), 5 already in place -- nothing to do/);
});
