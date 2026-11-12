// The election provenance is written as an index and one part per decade, and read back whole
// through one module (packages/loader/src/election-provenance.mjs): the split and the join are
// exact inverses, keep the contests' order, and read a single file from before the split alike.
//   node --test tests/unit/election-provenance-parts.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  PART_BUDGET_BYTES, UNDATED_PART, budgetProblems, joinProvenance, partFileName, partOf, provenanceFiles,
  provenanceText, publishedText, readProvenance, slimProvenance, splitProvenance, writeProvenance,
} from '../../packages/loader/src/election-provenance.mjs';
import { REPO_ROOT } from '../../packages/loader/src/paths.mjs';

/** A contest record as the build writes it (body/date/file.json). */
const contest = (/** @type {string} */ body, /** @type {string} */ date, /** @type {string} */ name, extra = {}) => ({
  file: `${body}/${date}/${name}.json`, body, date, constituency: name, status: 'cited', relatedWikipedia: null,
  sources: [{ title: `${name} source`, publisher: null, url: null, origin: 'bibliography', checked: false }], ...extra,
});

// In the build's order (by file), the decades interleave: each body runs through its own dates.
const DOC = {
  schemaVersion: 1,
  generatedAt: '2026-11-12T00:00:00.000Z',
  licence: 'Citations only.',
  counts: { contests: 7 },
  legislation: { 'nia/1962/14': { label: 'Electoral Law Act (NI) 1962' } },
  contests: [
    contest('a-council', '1920-01-15', 'Ward A'),
    contest('a-council', '1924-06-01', 'Ward B'),
    contest('a-council', '1933-05-20', 'Ward C'),
    contest('b-house', '1832-12-10', 'Antrim', { legislation: ['nia/1962/14'] }),
    contest('b-house', '1929-05-22', 'Down'),
    contest('c-odd', 'unknown', 'Somewhere'),
    contest('d-house', '1921-05-24', 'Belfast'),
  ],
};

test('partOf: the decade of the contest date, or the undated part', () => {
  assert.equal(partOf({ date: '1921-05-24' }), '1920s');
  assert.equal(partOf({ date: '2024-11-29' }), '2020s');
  assert.equal(partOf({ date: '1801' }), '1800s');
  assert.equal(partOf({ date: 'unknown' }), UNDATED_PART);
  assert.equal(partOf({}), UNDATED_PART);
});

test('split: an index with the head fields in order, and one part per decade in name order', () => {
  const { index, parts } = splitProvenance(DOC);
  assert.deepEqual(Object.keys(index), ['schemaVersion', 'generatedAt', 'licence', 'counts', 'legislation', 'contestParts']);
  assert.equal('contests' in index, false);
  assert.deepEqual(index.contestParts.parts, [
    { part: '1830s', contests: 1 }, { part: '1920s', contests: 4 }, { part: '1930s', contests: 1 }, { part: UNDATED_PART, contests: 1 },
  ]);
  assert.deepEqual(index.contestParts.order, [['1920s', 2], ['1930s', 1], ['1830s', 1], ['1920s', 1], [UNDATED_PART, 1], ['1920s', 1]]);
  assert.deepEqual(parts.map((p) => p.part), ['1830s', '1920s', '1930s', UNDATED_PART]);
  assert.deepEqual(parts[1].contests.map((c) => c.constituency), ['Ward A', 'Ward B', 'Down', 'Belfast']);
  assert.equal('relatedWikipedia' in parts[1].contests[0], false, 'the parts are the slim form');
});

test('join gives back the slim document exactly: the same head, records and order', () => {
  const { index, parts } = splitProvenance(DOC);
  const byName = new Map(parts.map((p) => [p.part, p]));
  const joined = joinProvenance(index, (part) => /** @type {any} */ (byName.get(part)));
  assert.deepEqual(joined, slimProvenance(DOC));
  assert.equal(JSON.stringify(joined), JSON.stringify(slimProvenance(DOC)), 'key order too');
  assert.equal(publishedText(joined), publishedText(DOC), 'the single-file text, byte for byte');
});

test('join refuses parts that do not match the index', () => {
  const { index, parts } = splitProvenance(DOC);
  const byName = new Map(parts.map((p) => [p.part, p]));
  const short = (/** @type {string} */ part) => (part === '1920s' ? { ...byName.get(part), contests: [] } : byName.get(part));
  assert.throws(() => joinProvenance(index, /** @type {any} */ (short)), /1920s: 0 contests, the index says 4/);
  const misnamed = (/** @type {string} */ part) => ({ ...byName.get(part), part: 'x' });
  assert.throws(() => joinProvenance(index, /** @type {any} */ (misnamed)), /says it is part x/);
  const order = { ...index, contestParts: { ...index.contestParts, order: index.contestParts.order.slice(1) } };
  assert.throws(() => joinProvenance(order, (part) => /** @type {any} */ (byName.get(part))), /leaves 2 contests of part 1920s unread/);
  assert.throws(() => joinProvenance(/** @type {any} */ ({ schemaVersion: 1 }), () => { throw new Error('unread'); }), /no contestParts/);
});

test('budgets: a part over its budget is named', () => {
  const files = provenanceFiles(DOC);
  assert.deepEqual(budgetProblems(files), []);
  const big = { ...files, parts: [...files.parts, { part: '2010s', file: '2010s.json', text: 'x'.repeat(PART_BUDGET_BYTES + 1), contests: 1 }] };
  const problems = budgetProblems(big);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /part 2010s is \d+ bytes, over its \d+-byte budget: split that decade/);
});

test('write, then read: the split form on disk reads back whole; stale parts go; a single file still reads', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'provenance-parts-'));
  try {
    const where = { file: path.join(dir, 'election-provenance.json'), partDir: path.join(dir, 'election-provenance-parts') };
    // A single file from before the split.
    writeFileSync(where.file, publishedText(DOC));
    assert.deepEqual(readProvenance(where), slimProvenance(DOC));
    assert.equal(provenanceText(where), publishedText(DOC));
    // A part left over from an earlier build is removed.
    const out = writeProvenance(DOC, where);
    assert.deepEqual(out.written.sort(), ['1830s.json', '1920s.json', '1930s.json', `${UNDATED_PART}.json`]);
    writeFileSync(path.join(where.partDir, '1990s.json'), '{}');
    const again = writeProvenance(DOC, where);
    assert.deepEqual(again.written, [], 'unchanged parts are not rewritten');
    assert.deepEqual(again.removed, ['1990s.json']);
    assert.deepEqual(readdirSync(where.partDir).sort(), ['1830s.json', '1920s.json', '1930s.json', `${UNDATED_PART}.json`]);
    assert.deepEqual(readProvenance(where), slimProvenance(DOC));
    assert.equal(provenanceText(where), publishedText(DOC), 'the single-file text, byte for byte');
    assert.equal(readFileSync(path.join(where.partDir, partFileName('1830s')), 'utf8'), publishedText({ schemaVersion: 1, part: '1830s', contests: [DOC.contests[3]] }));
    rmSync(where.file);
    assert.equal(readProvenance(where), null, 'not built: null');
    assert.equal(provenanceText(where), '');
    assert.equal(existsSync(where.partDir), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('one door: code that names the provenance file reads it through election-provenance.mjs', () => {
  const listed = spawnSync('git', ['grep', '-l', 'PROVENANCE_FILE', '--', '*.mjs', '*.js', '*.py'], { cwd: REPO_ROOT, encoding: 'utf8' });
  assert.equal(listed.status, 0, listed.stderr);
  // These only define, resolve or pass the path along (to readProvenance, through ingest-provenance).
  const definers = new Set([
    'packages/config/src/node.mjs', 'packages/loader/src/paths.mjs', 'scripts/records/paths.py',
    'packages/loader/src/election-provenance.mjs', 'packages/loader/src/build-records-db.mjs',
    'tests/records/paths.test.mjs', 'tests/unit/election-provenance-parts.test.mjs',
  ]);
  const offenders = listed.stdout.split('\n').filter(Boolean)
    .filter((f) => !definers.has(f))
    .filter((f) => !/election-provenance\.mjs['"]/.test(readFileSync(path.join(REPO_ROOT, f), 'utf8')));
  assert.deepEqual(offenders, [], 'read the provenance with readProvenance (packages/loader/src/election-provenance.mjs), not the file');
});
