// The phrase that shows the interface-language control (src/catalogue/lang-reveal.js): only the
// whole phrase counts, in any case, with surrounding spaces and punctuation ignored.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LANGUAGE_PHRASE, isLanguagePhrase, languageOptionsShown, revealLanguageOptions } from '../../src/catalogue/lang-reveal.js';

test('the phrase, however it is typed, is the phrase', () => {
  for (const q of [LANGUAGE_PHRASE, 'Language Toggle', 'LANGUAGE TOGGLE', '  language toggle  ', 'language toggle.', '"language toggle"', '¿language toggle?', 'language   toggle', '\tlanguage toggle\n', '…language toggle!!']) {
    assert.equal(isLanguagePhrase(q), true, q);
  }
});

test('nothing else is', () => {
  for (const q of ['', null, undefined, 'language', 'toggle', 'irish', 'gaeilge', 'languages', 'language toggles', 'toggle language', 'language-toggle', 'languagetoggle', 'the language toggle', 'language toggle maps', 'language toggle 2', 'lang toggle']) {
    assert.equal(isLanguagePhrase(q), false, String(q));
  }
});

test('outside a browser it does nothing and says the options are not shown', () => {
  assert.equal(languageOptionsShown(), false);
  assert.equal(revealLanguageOptions(), false);
});
