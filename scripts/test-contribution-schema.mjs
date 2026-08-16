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
import { readFileSync } from 'node:fs';
import { dryRunPatch, EDITABLE_FIELDS, VALID_KINDS, describeSchema } from '../functions/_api/contributions/_schema.js';
import { canMarkApplied, TERMINAL_STATUS } from './apply-contributions.mjs';

let passed = 0;
const failures = [];

function check(name, condition, detail) {
  if (condition) { passed += 1; return; }
  failures.push(detail ? `${name} — ${detail}` : name);
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

// --- object arrays: references and sourceDownloads --------------------------
//
// These are edited as structured groups in the UI, so the validator has to give
// errors a human can act on: which entry, which attribute. "references is
// invalid" would be useless in a form with six of them.
{
  const ok = dryRunPatch('map', {
    references: [{ label: 'PRONI catalogue', url: 'https://www.nidirect.gov.uk/proni', note: '' }],
  }, currentMap);
  check('accepts a well-formed reference', ok.ok === true, JSON.stringify(ok.errors));
}
{
  const r = dryRunPatch('map', { references: [{ label: 'A', url: 'not-a-url' }] }, currentMap);
  check('rejects a reference url that is not http(s)', r.ok === false);
  check('the error names the entry and attribute', r.errors.some((e) => /references\[1\]\.url/.test(e)), JSON.stringify(r.errors));
}
{
  const r = dryRunPatch('map', { references: [{ url: 'https://example.com' }] }, currentMap);
  check('rejects a reference with no label', r.ok === false);
  check('it says which entry needs a label', r.errors.some((e) => /references\[1\] needs a label/.test(e)), JSON.stringify(r.errors));
}
{
  const r = dryRunPatch('map', { references: [{ label: 'A', wat: 'x' }] }, currentMap);
  check('rejects an unrecognised reference attribute', r.ok === false);
  check('it lists the attributes that are allowed', r.errors.some((e) => /expected label, url, note/.test(e)), JSON.stringify(r.errors));
}
{
  const r = dryRunPatch('map', { references: ['just a string'] }, currentMap);
  check('rejects a bare string where a reference object belongs', r.ok === false);
}
{
  const r = dryRunPatch('map', { references: [{ label: 'A\nB' }] }, currentMap);
  check('rejects a line break inside a reference label', r.ok === false);
}
{
  const r = dryRunPatch('map', {
    sourceDownloads: [{ label: 'Shapefile', file: 'x.zip', bytes: 1024 }],
  }, currentMap);
  check('accepts a sourceDownload with a numeric bytes', r.ok === true, JSON.stringify(r.errors));
}
{
  const r = dryRunPatch('map', { sourceDownloads: [{ label: 'x', file: 'y.zip', bytes: 'lots' }] }, currentMap);
  check('rejects a non-numeric bytes', r.ok === false);
  check('it names the attribute', r.errors.some((e) => /bytes must be a number/.test(e)), JSON.stringify(r.errors));
}
{
  const r = dryRunPatch('map', { references: [] }, { ...currentMap, references: [{ label: 'old' }] });
  check('accepts clearing every reference', r.ok === true, JSON.stringify(r.errors));
}
{
  const described = describeSchema().map.find((f) => f.name === 'references');
  check('the schema advertises reference attributes for the UI', Array.isArray(described?.attributes) && described.attributes.length === 3, JSON.stringify(described));
  check('references is typed as objectArray', described?.type === 'objectArray', described?.type);
  const keywords = describeSchema().map.find((f) => f.name === 'keywords');
  check('a plain string array is still typed as array', keywords?.type === 'array', keywords?.type);
}

// --- the allowlists themselves ---------------------------------------------
check('retire is a valid kind', VALID_KINDS.has('retire'));
check('map fields exclude id, slug, files and style',
  !EDITABLE_FIELDS.map.has('id') && !EDITABLE_FIELDS.map.has('slug')
  && !EDITABLE_FIELDS.map.has('files') && !EDITABLE_FIELDS.map.has('style'));

// --- the queue's terminal state --------------------------------------------
//
// "approved" used to be the last status a submission could reach, so --list
// reported five already-published layers as outstanding work, indefinitely.
// These assert the transition rule rather than the plumbing: the plumbing needs
// KV, the rule is what can silently go wrong.
check('an approved submission can be marked applied', canMarkApplied('approved').ok);
check('a pending submission cannot be marked applied', !canMarkApplied('pending-review').ok);
check('a rejected submission cannot be marked applied', !canMarkApplied('rejected').ok);
check('marking an applied submission again is refused', !canMarkApplied(TERMINAL_STATUS).ok);
check('the refusal says why', /only an approved submission/.test(canMarkApplied('pending-review').reason || ''));
check('applied is not a decision the web endpoint can set',
  !/applied/.test(readFileSync(new URL('../functions/_api/contributions/decide.js', import.meta.url), 'utf8')
    .match(/const VALID_DECISIONS[^;]+;/)?.[0] || 'applied'));

if (failures.length) {
  console.error(`FAIL: ${failures.length} of ${passed + failures.length} contribution schema checks failed:`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`PASS: ${passed} contribution schema checks.`);
