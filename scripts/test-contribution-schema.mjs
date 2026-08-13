#!/usr/bin/env node
/**
 * Tests for the contribution patch validator.
 *
 * This validator is the only thing standing between a contributor's input and a
 * reviewer's attention, so it has to fail as reliably as it passes. Every case
 * below that expects a rejection is the point: a validator nobody has watched
 * reject something is not known to work. This project has twice shipped checks
 * that passed for accidental reasons -- a parity check that could not fail, and
 * a budget check measuring the wrong set.
 */
import { dryRunPatch, EDITABLE_FIELDS, VALID_KINDS } from '../functions/_api/contributions/_schema.js';

let passed = 0;
const failures = [];

function check(name, condition) {
  if (condition) { passed += 1; return; }
  failures.push(name);
}

const currentMap = {
  id: 'deds-ni-1926',
  name: 'District Electoral Divisions 1926',
  date: '1926-01-01',
  keywords: ['deds', '1926'],
  provider: 'PRONI',
  hidden: false,
};

// --- accepts a well-formed patch -------------------------------------------
const good = dryRunPatch('map', { provider: 'PRONI / Paddy Matthews' }, currentMap);
check('accepts a valid single-field patch', good.ok === true);
check('reports which fields would actually change', good.effective.join() === 'provider');
check('records that it saw the current record', good.checkedAgainstCurrentRecord === true);

// --- rejects fields that are not editable ----------------------------------
const notEditable = dryRunPatch('map', { id: 'something-else' }, currentMap);
check('rejects a patch to id', notEditable.ok === false);
check('names the offending field', notEditable.errors.some((e) => e.includes('id')));
const filesPatch = dryRunPatch('map', { files: { xyz: 'https://example.com/x' } }, currentMap);
check('rejects a patch to files (would repoint the layer)', filesPatch.ok === false);

// --- shape checking --------------------------------------------------------
check('rejects a string where an array belongs', dryRunPatch('map', { keywords: 'deds' }, currentMap).ok === false);
check('rejects a number where a string belongs', dryRunPatch('map', { name: 1926 }, currentMap).ok === false);
check('rejects a string where a boolean belongs', dryRunPatch('map', { hidden: 'yes' }, currentMap).ok === false);
check('accepts a real boolean', dryRunPatch('map', { hidden: true }, currentMap).ok === true);
check('accepts an explicit null (clearing a field)', dryRunPatch('map', { description: null }, currentMap).ok === true);

// --- the newline rule, which exists because of a real outage ---------------
const newline = dryRunPatch('map', { labelProperty: 'MAX_CON_NA\n' }, currentMap);
check('rejects a line break in a label', newline.ok === false);
check('explains why a line break is rejected', newline.errors.some((e) => /line break/.test(e)));
check('rejects a line break inside an array item', dryRunPatch('map', { keywords: ['a\nb'] }, currentMap).ok === false);

// --- bounds ----------------------------------------------------------------
check('accepts valid bounds', dryRunPatch('map', { bounds: [-8.2, 54.0, -5.4, 55.3] }, currentMap).ok === true);
check('rejects bounds with the wrong arity', dryRunPatch('map', { bounds: [-8.2, 54.0, -5.4] }, currentMap).ok === false);
check('rejects inverted bounds', dryRunPatch('map', { bounds: [-5.4, 54.0, -8.2, 55.3] }, currentMap).ok === false);
check('rejects out-of-range bounds', dryRunPatch('map', { bounds: [-200, 54.0, -5.4, 55.3] }, currentMap).ok === false);

// --- no-op patches ---------------------------------------------------------
const noop = dryRunPatch('map', { provider: 'PRONI' }, currentMap);
check('refuses a patch that changes nothing', noop.ok === false);
check('warns that the value is already set', noop.warnings.some((w) => /already has this value/.test(w)));
check('refuses an empty patch', dryRunPatch('map', {}, currentMap).ok === false);

// --- the year-disagreement warning -----------------------------------------
const wrongYear = dryRunPatch('map', { date: '1937-01-01' }, currentMap);
check('warns when the name year and date year disagree', wrongYear.warnings.some((w) => /1926.*1937|1937.*1926/.test(w)));
check('a disagreement warns but does not block', wrongYear.ok === true);

// --- unknown entity types --------------------------------------------------
check('rejects an unknown entity type', dryRunPatch('spaceship', { name: 'x' }, null).ok === false);

// --- behaviour without the current record ----------------------------------
const blind = dryRunPatch('map', { provider: 'Somebody' }, null);
check('still validates shape with no current record', blind.ok === true);
check('admits it could not compare against the record', blind.checkedAgainstCurrentRecord === false);

// --- the allowlists themselves ---------------------------------------------
check('retire is a valid kind', VALID_KINDS.has('retire'));
check('map fields exclude id, slug, files and style',
  !EDITABLE_FIELDS.map.has('id') && !EDITABLE_FIELDS.map.has('slug')
  && !EDITABLE_FIELDS.map.has('files') && !EDITABLE_FIELDS.map.has('style'));

if (failures.length) {
  console.error(`FAIL: ${failures.length} of ${passed + failures.length} contribution schema checks failed:`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`PASS: ${passed} contribution schema checks.`);
