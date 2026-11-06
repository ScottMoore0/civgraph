// The published election-provenance.json leaves out null optional fields so it stays under
// Cloudflare Pages' 25 MiB per-file limit (scripts/lib/election-provenance-slim.mjs).
//   node --test tests/elections/election-provenance-slim.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import {
  CONTEST_REQUIRED, PUBLISHED_BUDGET_BYTES, SOURCE_REQUIRED, publishedText, slimProvenance,
} from '../../scripts/lib/election-provenance-slim.mjs';

const FILE = 'data/database/election-provenance.json';
const PAGES_LIMIT = 25 * 1024 * 1024;

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

test('the committed file is the slim form, every required field present', () => {
  const doc = JSON.parse(readFileSync(FILE, 'utf8'));
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
  assert.equal(readFileSync(FILE, 'utf8').replace(/\r\n/g, '\n'), publishedText(doc), 'the file is written exactly as publishedText writes it');
});

test('the committed file is within its budget, well under the Pages per-file limit', () => {
  // As committed and deployed (LF): a Windows checkout with autocrlf adds a byte per line on disk.
  const size = Buffer.byteLength(readFileSync(FILE, 'utf8').replace(/\r\n/g, '\n'));
  assert.ok(statSync(FILE).size <= PAGES_LIMIT, `${FILE} on disk is over the Pages per-file limit`);
  assert.ok(PUBLISHED_BUDGET_BYTES < PAGES_LIMIT);
  assert.ok(size <= PUBLISHED_BUDGET_BYTES, `${FILE} is ${size} bytes, over the ${PUBLISHED_BUDGET_BYTES}-byte budget`);
});
