// Timeline dates and change wording (src/map/app/timeline/dates.mjs, frontend-plan.md 5.2 A3).
//
//   node --test tests/unit/timeline-dates.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { formatHectares, parseTimelineDate, timelineChangeName, yearOnlyMapDate } from '../../src/map/app/timeline/dates.mjs';

const iso = (date) => date?.toISOString().slice(0, 10) ?? null;

test('parseTimelineDate reads years, ISO dates and timestamps as UTC', () => {
  assert.equal(iso(parseTimelineDate(1950)), '1950-01-01');
  assert.equal(iso(parseTimelineDate('1950')), '1950-01-01');
  assert.equal(iso(parseTimelineDate('1950-06')), '1950-06-01');
  assert.equal(iso(parseTimelineDate('1950-06-02')), '1950-06-02');
  assert.equal(iso(parseTimelineDate(Date.UTC(2024, 10, 29))), '2024-11-29');
  assert.equal(parseTimelineDate(null), null);
  assert.equal(parseTimelineDate(''), null);
  assert.equal(parseTimelineDate('not a date'), null);
});

test('parseTimelineDate takes a negative timestamp (before 1970) as a timestamp, not a year', () => {
  assert.equal(iso(parseTimelineDate(-31536000000)), '1969-01-01');
});

test('yearOnlyMapDate keeps the day only when it is meant', () => {
  assert.equal(yearOnlyMapDate({ date: '2023' }), '2023');
  assert.equal(yearOnlyMapDate({ id: 'deds-1977', date: '1977-01-01' }), '1977');
  assert.equal(yearOnlyMapDate({ id: 'x', name: 'Counties 1 Jan 1919', date: '1919-01-01' }), null);
  assert.equal(yearOnlyMapDate({ id: 'x', date: '1919-01-01', dateEffective: '1919-01-01' }), null);
  assert.equal(yearOnlyMapDate({ date: '1950-06-02' }), null);
  assert.equal(yearOnlyMapDate(null), null);
});

test('timelineChangeName title-cases names written in capitals', () => {
  assert.equal(timelineChangeName('CROSSGAR and KILLYLEAGH'), 'Crossgar and Killyleagh');
  // Only a joining word between spaces is lowered.
  assert.equal(timelineChangeName('BALLYNAHINCH (PART OF)'), 'Ballynahinch (Part Of)');
  assert.equal(timelineChangeName('ROSS OF MULL'), 'Ross of Mull');
  assert.equal(timelineChangeName('Mixed Case Name'), 'Mixed Case Name');
  assert.equal(timelineChangeName(''), 'an unnamed area');
});

test('formatHectares', () => {
  assert.equal(formatHectares(0), '0.0 ha');
  assert.equal(formatHectares(3.14), '3.1 ha');
  assert.equal(formatHectares(42.6), '43 ha');
  assert.equal(formatHectares(12345.4), '12,345 ha');
  assert.equal(formatHectares('x'), '0.0 ha');
});
