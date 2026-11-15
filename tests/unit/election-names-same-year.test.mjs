// Two general elections of one body in one calendar year take the month in their titles
// (scripts/lib/election-names.mjs sameYearGeneralElections and canonicalElectionTitle's
// sameYearGeneral; Phelim Birch's catalogue review #95, #100, 15 Nov 2026), and the recall
// petition is listed with the by-elections under its own title (#99).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalElectionTitle, sameYearGeneralElections } from '../../scripts/lib/election-names.mjs';

const DAIL = { body: 'Dáil Éireann', bodySlug: 'dail-eireann', constituencies: Array.from({ length: 30 }, (_, i) => `C${i}`) };
const WESTMINSTER = { body: 'House of Commons of the United Kingdom', bodySlug: 'house-of-commons-of-the-united-kingdom', constituencies: Array.from({ length: 12 }, (_, i) => `C${i}`) };
/** @param {object} scope @param {string} date */
const titled = (scope, date, sameYearGeneral = true) => canonicalElectionTitle({ ...scope, date, sameYearGeneral });

test('a body with two general elections in a year names each by its month', () => {
  assert.equal(titled(DAIL, '1927-06-09'), 'June 1927 Irish general election');
  assert.equal(titled(DAIL, '1927-09-15'), 'September 1927 Irish general election');
  assert.equal(titled(DAIL, '1982-02-18'), 'February 1982 Irish general election');
  assert.equal(titled(DAIL, '1982-11-24'), 'November 1982 Irish general election');
  assert.equal(titled(WESTMINSTER, '1974-02-28'), 'February 1974 UK general election in Northern Ireland');
  assert.equal(titled(WESTMINSTER, '1974-10-10'), 'October 1974 UK general election in Northern Ireland');
  // 1910 had its own rule until now; the general one gives the same titles.
  assert.equal(titled({ ...WESTMINSTER, constituencies: Array.from({ length: 100 }, (_, i) => `C${i}`) }, '1910-01-15'), 'January 1910 UK general election in Ireland');
  assert.equal(titled({ ...WESTMINSTER, constituencies: Array.from({ length: 100 }, (_, i) => `C${i}`) }, '1910-12-03'), 'December 1910 UK general election in Ireland');
});

test('a year with one general election keeps the plain title', () => {
  assert.equal(titled(DAIL, '1932-02-16', false), '1932 Irish general election');
  assert.equal(titled(WESTMINSTER, '1979-05-03', false), '1979 UK general election in Northern Ireland');
  assert.equal(titled({ ...WESTMINSTER, constituencies: Array.from({ length: 100 }, (_, i) => `C${i}`) }, '1910-01-15', false), '1910 UK general election in Ireland');
});

test('the flag changes no by-election, recall petition, registry day title or council title', () => {
  assert.equal(titled({ ...DAIL, constituencies: ['Dublin West'] }, '1982-05-25'), '1982 Dublin West by-election');
  assert.equal(titled({ ...WESTMINSTER, constituencies: ['North Antrim'], specialType: 'recall-petition' }, '2018-08-29'), '2018 North Antrim recall petition');
  // The Seanad's two 1938 elections are titled by the registry's titlesByDate.
  const seanad = { body: 'Seanad Éireann', bodySlug: 'seanad-eireann', constituencies: Array.from({ length: 6 }, (_, i) => `P${i}`) };
  assert.equal(titled(seanad, '1938-04-27'), 'April 1938 Seanad election');
  assert.equal(titled(seanad, '1938-09-07'), 'August 1938 Seanad election');
  // Councils hold several polls a year, often two in one month: no month.
  assert.equal(titled({ body: 'Belfast County Borough Council', bodySlug: 'belfast-county-borough-council', constituencies: ['Cromac'] }, '1972-01-24'), '1972 Belfast County Borough Council election');
});

test('sameYearGeneralElections finds the bodies with two general elections in one year', () => {
  const entries = [
    { body: 'Dáil Éireann', bodySlug: 'dail-eireann', date: '1927-06-09', general: true },
    { body: 'Dáil Éireann', bodySlug: 'dail-eireann', date: '1927-08-24', general: false },
    { body: 'Dáil Éireann', bodySlug: 'dail-eireann', date: '1927-09-15', general: true },
    { body: 'Dáil Éireann', bodySlug: 'dail-eireann', date: '1932-02-16', general: true },
    { body: 'Dáil Éireann', bodySlug: 'dail-eireann', date: '1932-07-01', general: false },
    { body: 'Seanad Éireann', bodySlug: 'seanad-eireann', date: '1927-12-06', general: true },
    { body: 'North Down', bodySlug: 'local-government', date: '1993-05-19', general: true },
    { body: 'Ards', bodySlug: 'local-government', date: '1993-06-10', general: true },
  ];
  const found = sameYearGeneralElections(entries, (e) => e.general);
  assert.deepEqual([...found].map((e) => e.date), ['1927-06-09', '1927-09-15']);
});
