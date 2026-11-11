import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { LEDGER, PAGE, RIGHTS, renderSources, stamp } from '../../scripts/build/build-licence-page.mjs';
import { OPEN_RIGHTS } from '../../scripts/check/rules/source-ledger.mjs';

const src = (over = {}) => ({ id: 'x', name: 'Example source', publisher: 'Example body', url: 'https://example.org', rights: 'OGL-3.0', ...over });

test('every rights value the ledger may use has wording on the Licence page', () => {
  assert.deepEqual(OPEN_RIGHTS.filter((r) => !RIGHTS[r]), []);
});

test('the committed Licence page lists the source ledger as it stands', () => {
  const page = readFileSync(PAGE, 'utf8');
  const ledger = JSON.parse(readFileSync(LEDGER, 'utf8'));
  assert.equal(stamp(page, ledger), page);
  for (const s of ledger.sources) assert.ok(page.includes(s.publisher.replace(/&/g, '&amp;')), `${s.id} is not on the page`);
});

test('sources are grouped under their licence, in RIGHTS order, and escaped', () => {
  const html = renderSources({ asOf: '2026-11-09', sources: [
    src({ name: 'B <b>', rights: 'CC0' }), src({ name: 'A & co', rights: 'OGL-3.0' }), src({ name: 'C', rights: 'OGL-3.0', url: '' }),
  ] });
  assert.ok(html.indexOf('Open Government Licence') < html.indexOf('CC0 (no rights reserved)'));
  assert.ok(html.includes('A &amp; co') && html.includes('B &lt;b&gt;'));
  assert.ok(html.includes('<strong>C</strong>'), 'a source with no url is listed without a link');
  assert.ok(html.includes('3 sources'));
  assert.ok(!html.includes('Creative Commons Attribution 4.0'), 'a licence with no sources is left out');
});

test('a rights value with no wording fails rather than appearing unexplained', () => {
  assert.throws(() => renderSources({ sources: [src({ rights: 'facts-only' })] }), /facts-only/);
});

test('stamping replaces only the marked region and needs it', () => {
  const page = 'a\n<!-- licence:sources -->\nold\n<!-- /licence:sources -->\nb\n';
  const out = stamp(page, { sources: [src()] });
  assert.ok(out.startsWith('a\n<!-- licence:sources -->\n') && out.endsWith('<!-- /licence:sources -->\nb\n'));
  assert.ok(!out.includes('\nold\n'));
  assert.throws(() => stamp('no region', { sources: [] }), /no <!-- licence:sources -->/);
});
