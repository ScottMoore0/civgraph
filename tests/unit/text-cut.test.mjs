import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cutNote } from '@civgraph/core/text-cut.mjs';

// The catalogue pane's map notes stopped mid-word at 300 characters (Phelim Birch's review, #5).

test('a note that fits is kept whole (trimmed)', () => {
  assert.equal(cutNote('  Since 1911: no change.  ', 100), 'Since 1911: no change.');
  assert.equal(cutNote('', 10), '');
  assert.equal(cutNote(undefined, 10), '');
});

test('a longer note ends at the last sentence that fits, with no ellipsis', () => {
  const note = 'Union A was dissolved in 1885. Its divisions went to Westport. Corrected 1 Nov 2026: the gaps are filled.';
  assert.equal(cutNote(note, 70), 'Union A was dissolved in 1885. Its divisions went to Westport.');
  assert.equal(cutNote(note, 62), 'Union A was dissolved in 1885. Its divisions went to Westport.');
});

test('abbreviations and initials do not end a sentence', () => {
  const note = 'Portrush was extended into Co. Londonderry in 1915. St. Mary\'s DED and No. 3 Ward and J. Smith\'s farm were unchanged in that order.';
  assert.equal(cutNote(note, 80), 'Portrush was extended into Co. Londonderry in 1915.');
  const eg = 'Some urban DEDs, e.g. Buncrana, were split. The rest stayed as in 1911 throughout the decade.';
  assert.equal(cutNote(eg, 60), 'Some urban DEDs, e.g. Buncrana, were split.');
});

test('a stop before a lower-case word or a digit is not a sentence end', () => {
  const note = 'The area (c. 1850 acres) and the lough (approx. half of it) were added. Later changes are listed in the next edition.';
  assert.equal(cutNote(note, 90), 'The area (c. 1850 acres) and the lough (approx. half of it) were added.');
});

test('a closing quote or bracket stays with its sentence', () => {
  const note = 'The order says the area "consists of reclaimed lands." (Gazette, 1961.) More text follows here.';
  assert.equal(cutNote(note, 80), 'The order says the area "consists of reclaimed lands." (Gazette, 1961.)');
});

test('with no sentence end late enough, it ends after a clause, else a word, with an ellipsis', () => {
  const list = 'Changes since 1930: Holywood UD extended; Carrickfergus UD extended; Larne RD DEDs re-constituted; Armagh UD divided into five wards';
  const cut = cutNote(list, 100);
  assert.equal(cut, 'Changes since 1930: Holywood UD extended; Carrickfergus UD extended; Larne RD DEDs re-constituted…');
  assert.ok(cut.length <= 100);
  const words = 'one two three four five six seven eight nine ten eleven twelve thirteen fourteen';
  const w = cutNote(words, 40);
  assert.equal(w, 'one two three four five six seven eight…');
  assert.ok(w.length <= 40);
});

test('an early sentence end is passed over for a later clause or word', () => {
  const note = 'In short. Then a long list of changes with no stop: Holywood UD extended; Larne RD DEDs re-constituted; Armagh UD divided';
  assert.equal(cutNote(note, 110), 'In short. Then a long list of changes with no stop: Holywood UD extended; Larne RD DEDs re-constituted…');
});

test('one unbroken word is cut at the limit', () => {
  const cut = cutNote('x'.repeat(50), 20);
  assert.equal(cut, `${'x'.repeat(19)}…`);
  assert.equal(cut.length, 20);
});
