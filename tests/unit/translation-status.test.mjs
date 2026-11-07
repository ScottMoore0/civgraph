// The built translation files' _status (scripts/i18n/translation-status.mjs, catalogue PL-05).
import test from 'node:test';
import assert from 'node:assert/strict';
import { languageFileStatus, translationStatus } from '../../scripts/i18n/translation-status.mjs';

test('a language file is draft until a reviewer is named, then reviewed', () => {
  assert.equal(languageFileStatus({ reviewedBy: null }), 'draft');
  assert.equal(languageFileStatus({}), 'draft');
  assert.equal(languageFileStatus({ reviewedBy: '  ' }), 'draft');
  assert.equal(languageFileStatus({ reviewedBy: 'A. Reviewer' }), 'reviewed');
});

test('source and generated files never change status; draft and reviewed move only to each other', () => {
  for (const to of ['draft', 'reviewed', 'generated']) assert.equal(translationStatus.check('source', to).ok, false, `source -> ${to}`);
  for (const to of ['draft', 'reviewed', 'source']) assert.equal(translationStatus.check('generated', to).ok, false, `generated -> ${to}`);
  assert.equal(translationStatus.check('draft', 'source').ok, false);
  assert.equal(translationStatus.check('draft', 'reviewed', { reviewedBy: null }).ok, false);
  assert.equal(translationStatus.check('reviewed', 'draft').ok, true);
});
