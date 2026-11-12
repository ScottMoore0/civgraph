// The built election provenance leaves out null optional fields, and is split into an index and one
// part per decade, each well under Cloudflare Pages' 25 MiB per-file limit
// (packages/loader/src/election-provenance.mjs).
//   node --test tests/elections/election-provenance-slim.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import {
  CONTEST_REQUIRED, INDEX_BUDGET_BYTES, PAGES_FILE_LIMIT, PART_BUDGET_BYTES, PUBLISHED_BUDGET_BYTES, SOURCE_REQUIRED,
  TOTAL_BUDGET_BYTES, partFileName, partOf, publishedText, readProvenance, slimProvenance,
} from '../../packages/loader/src/election-provenance.mjs';
import { PROVENANCE_FILE, PROVENANCE_PART_DIR } from '../../packages/loader/src/paths.mjs';

// Written by the records build (npm run records:build; tmp/records), no longer committed.
const FILE = PROVENANCE_FILE;
const PART_DIR = PROVENANCE_PART_DIR;
// As built and as it would deploy (LF): a Windows checkout with autocrlf adds a byte per line on disk.
const lfText = (/** @type {string} */ p) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');

test('null optional fields are left out; required ones stay, null or not', () => {
  const doc = {
    schemaVersion: 1, generatedAt: null, counts: {}, legislation: {},
    contests: [{
      file: 'a/b/c.json', body: 'a', date: 'b', constituency: 'C', status: 'cited', relatedWikipedia: null,
      sources: [{ title: 'Book', publisher: null, url: null, archiveUrl: null, origin: 'bibliography', checked: false, check: 'x', scope: null }],
    }],
  };
  const slim = slimProvenance(doc);
  const [c] = slim.contests;
  assert.equal('relatedWikipedia' in c, false);
  assert.deepEqual(c.sources[0], { title: 'Book', url: null, origin: 'bibliography', checked: false, check: 'x' });
  assert.equal(slim.generatedAt, null, 'top-level fields are untouched');
  // false, 0 and '' are values, not nulls
  const kept = slimProvenance({ contests: [{ ...doc.contests[0], sources: [{ url: 'u', origin: 'import', checked: false, match: 0, title: '' }] }] });
  assert.deepEqual(kept.contests[0].sources[0], { url: 'u', origin: 'import', checked: false, match: 0, title: '' });
});

test('reading a missing field as null gives back the full record', () => {
  const full = { url: null, origin: 'web-check', checked: true, title: 'T', host: null, document: null };
  const slim = slimProvenance({ contests: [{ file: 'f', body: 'b', date: 'd', constituency: 'c', status: 's', sources: [full] }] }).contests[0].sources[0];
  for (const [k, v] of Object.entries(full)) assert.equal(slim[k] ?? null, v, k);
});

test('the built provenance is the slim form, every required field present', () => {
  const doc = readProvenance();
  assert.ok(doc, `${FILE} is not built: npm run records:build`);
  let sources = 0;
  for (const c of doc.contests) {
    for (const k of CONTEST_REQUIRED) assert.ok(k in c, `${c.file} lacks ${k}`);
    for (const [k, v] of Object.entries(c)) assert.ok(v !== null || CONTEST_REQUIRED.includes(k), `${c.file}: null ${k} should be left out`);
    for (const s of c.sources) {
      sources += 1;
      for (const k of SOURCE_REQUIRED) assert.ok(k in s, `${c.file}: a source lacks ${k}`);
      for (const [k, v] of Object.entries(s)) assert.ok(v !== null || SOURCE_REQUIRED.includes(k), `${c.file}: null source ${k} should be left out`);
    }
  }
  assert.ok(sources > 0);
});

test('the built provenance is split: an index, and one part per decade written exactly as publishedText writes it', () => {
  const index = JSON.parse(lfText(FILE));
  assert.equal('contests' in index, false, 'the index holds no contest records');
  assert.ok(index.contestParts?.parts?.length > 0, 'the index lists its parts');
  assert.equal(lfText(FILE), `${JSON.stringify(index, null, 1)}\n`, 'the index is written with one-space indentation');
  const files = readdirSync(PART_DIR).filter((f) => f.endsWith('.json')).sort();
  assert.deepEqual(files, index.contestParts.parts.map((/** @type {{ part: string }} */ p) => partFileName(p.part)).sort(), 'no part file missing or left over');
  for (const { part, contests } of index.contestParts.parts) {
    const text = lfText(path.join(PART_DIR, partFileName(part)));
    const doc = JSON.parse(text);
    assert.equal(doc.part, part);
    assert.equal(doc.contests.length, contests, `${part}: the index's count`);
    assert.equal(text, publishedText(doc), `${part} is written exactly as publishedText writes it`);
    for (const c of doc.contests) assert.equal(partOf(c), part, `${c.file} is in part ${part}`);
  }
});

test('every built provenance file is within its budget, well under the Pages per-file limit', () => {
  assert.ok(PART_BUDGET_BYTES <= PUBLISHED_BUDGET_BYTES && INDEX_BUDGET_BYTES <= PUBLISHED_BUDGET_BYTES);
  assert.ok(PUBLISHED_BUDGET_BYTES <= PAGES_FILE_LIMIT - 1024 * 1024, 'a mebibyte of headroom under the Pages limit');
  const indexBytes = Buffer.byteLength(lfText(FILE));
  assert.ok(statSync(FILE).size <= PAGES_FILE_LIMIT, `${FILE} on disk is over the Pages per-file limit`);
  assert.ok(indexBytes <= INDEX_BUDGET_BYTES, `${FILE} is ${indexBytes} bytes, over the ${INDEX_BUDGET_BYTES}-byte budget`);
  let total = indexBytes;
  for (const f of readdirSync(PART_DIR).filter((name) => name.endsWith('.json'))) {
    const p = path.join(PART_DIR, f);
    const size = Buffer.byteLength(lfText(p));
    total += size;
    assert.ok(statSync(p).size <= PAGES_FILE_LIMIT, `${p} on disk is over the Pages per-file limit`);
    assert.ok(size <= PART_BUDGET_BYTES, `${p} is ${size} bytes, over the ${PART_BUDGET_BYTES}-byte part budget`);
  }
  assert.ok(total <= TOTAL_BUDGET_BYTES, `the provenance files total ${total} bytes, over the ${TOTAL_BUDGET_BYTES}-byte overall budget`);
});
