// The interface text with no key only shrinks (architecture rule R10: interface text is keyed or
// patterned in site/assets/i18n/en.json). data/i18n/review/untranslated-ui.txt lists every string
// the interface source holds that en.json lacks, each with its class from
// data/i18n/review/untranslated-ui-triage.tsv; "interface" (unclassified) and "later" lines are
// still to key. The count of them, as the source stands now, may not exceed the committed list's,
// and the committed list's may not exceed main's (or I18N_BASELINE_REF's). New interface text is
// keyed in data/i18n/strings/<surface>.txt (then npm run i18n:build), or, if it is not interface
// text, given its class in the triage file; then node scripts/i18n/extract-ui-strings.mjs
// --missing --review rewrites the list.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  buildReview, isCode, looksLikeUi, parseTriage, placeholderShape, REVIEW_FILE, reviewText, TODO_CLASSES, todoCount, unkeyed, withoutGenerated
} from '../../scripts/i18n/extract-ui-strings.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const committed = readFileSync(new URL(REVIEW_FILE, new URL('../../', import.meta.url)), 'utf8');

/**
 * The number of lines still to key in a committed list. A list from before the triage (no class
 * column) counts every line.
 * @param {string} text
 * @returns {number}
 */
function committedTodo(text) {
  if (text.includes('# class\t')) return todoCount(text);
  return text.split('\n').filter((line) => line && !line.startsWith('#')).length;
}

/** The review list as committed on the first ref that has it, or null. */
function baseList() {
  for (const ref of [process.env.I18N_BASELINE_REF, 'main', 'origin/main'].filter(Boolean)) {
    try {
      return { ref, text: execFileSync('git', ['show', `${ref}:${REVIEW_FILE}`], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 1 << 26 }) };
    } catch { /* no such ref, or no list on it */ }
  }
  return null;
}

test('the scan drops code, CSS and selectors but keeps text and templates of text', () => {
  for (const code of [', b.id ||', ', classIds: [', ': \'\', cell.rowspan ?', ').localeCompare(b.name ||', 'btn btn--sm btn--outline', 'a, button', 'thead th[data-leaf-col-idx]',
    '(max-width: 768px)', ':scope > [data-cn-more]', 'background-color: #888', '320px 0px', 'Inter, Arial, sans-serif', ', leafStart + 1,', 'clamp(340px, 28%, 460px)', 'Escape']) {
    assert.equal(looksLikeUi(code), false, code);
  }
  for (const text of ['Show labels as printed', 'all contests', '(teller)', ', found by', 'Catalogue note:', 'Loaded division {x}.', 'Search {x} PRONI records - title, reference, or dates…']) {
    assert.equal(looksLikeUi(text), true, text);
  }
  assert.equal(looksLikeUi('{x}px'), false);
  assert.equal(isCode('No votes match.'), false);
});

test('a pattern counts as a key for the template of its shape; names are not interface text', () => {
  assert.equal(placeholderShape('Load more ({n} of {total})'), 'Load more ({x} of {x})');
  const list = [
    { text: 'Load more ({x} of {x})', surfaces: ['browse'], files: ['site/browse/browse.js'], count: 1 },
    { text: 'Counties (Ireland)', surfaces: ['app'], files: ['a.js'], count: 1 },
    { text: 'Holders', surfaces: ['browse'], files: ['site/browse/browse.js'], count: 1 }
  ];
  assert.deepEqual(unkeyed(list, ['Load more ({n} of {total})'], new Set(['Counties (Ireland)'])).map((e) => e.text), ['Holders']);
});

test('a generated page body is not read; the rest of the page is', () => {
  const html = '<h1>Status</h1><!-- status:body --><p>Antrim: 8 of 8 rounds</p><!-- /status:body --><p>Footer</p>';
  assert.equal(withoutGenerated('site/pages/status.html', html), '<h1>Status</h1><!-- /status:body --><p>Footer</p>');
  assert.equal(withoutGenerated('site/pages/about.html', html), html);
});

test('the triage file is well formed, and its classes reach the list', () => {
  const { classes, problems } = parseTriage('# comment\ndata\tPhelim Birch\nlater\tAuthors\nnope\tX\ndata\tPhelim Birch\n');
  assert.deepEqual(problems.map((p) => p.replace(/^.*?:\d+: /, '')), ['unknown class "nope"', '"Phelim Birch" is listed twice']);
  const text = reviewText([
    { text: 'Authors', surfaces: ['app'], files: ['x.js'], count: 1 },
    { text: 'Phelim Birch', surfaces: ['app'], files: ['x.js'], count: 1 },
    { text: 'New words', surfaces: ['app'], files: ['x.js'], count: 1 }
  ], classes);
  assert.match(text, /^later\tapp\tx\.js\tAuthors$/m);
  assert.match(text, /^interface\tapp\tx\.js\tNew words$/m);
  assert.equal(todoCount(text), 2);
  assert.deepEqual(TODO_CLASSES, ['interface', 'later']);
});

test('the triage file of the repository parses, and no line of it is stale', (t) => {
  const review = buildReview(ROOT);
  assert.deepEqual(review.problems, []);
  const listed = new Set(review.missing.map((e) => e.text));
  const stale = [...review.classes.keys()].filter((s) => !listed.has(s));
  // A stale line is harmless (a string now keyed, removed, or become a map name); report it so
  // the next --review run can drop it.
  if (stale.length) t.diagnostic(`${stale.length} triage line(s) no longer in the list, e.g. "${stale[0]}"`);
});

test('interface text with no key only shrinks: the source against the committed list, and that against main', (t) => {
  const now = todoCount(buildReview(ROOT).text);
  const mine = committedTodo(committed);
  assert.ok(now <= mine, `the source has ${now} unkeyed interface strings, the committed ${REVIEW_FILE} ${mine}: key the new text in data/i18n/strings/ (npm run i18n:build) or class it in the triage file, then node scripts/i18n/extract-ui-strings.mjs --missing --review`);
  const base = baseList();
  if (!base) {
    t.diagnostic(`no ${REVIEW_FILE} on main or origin/main to compare with`);
    return;
  }
  const theirs = committedTodo(base.text);
  assert.ok(mine <= theirs, `${REVIEW_FILE} has ${mine} lines still to key, ${base.ref} ${theirs}: the list only shrinks`);
});
