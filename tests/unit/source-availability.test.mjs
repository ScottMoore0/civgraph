// scripts/lib/source-availability.mjs: a source gone from its publisher is kept and shows it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { REMOVED_FROM_SOURCE_CHIP, sourceAvailabilityDisplay } from '../../scripts/lib/source-availability.mjs';
import { readApprovedPublicationGate } from '../../scripts/lib/approved-publication-index.mjs';

test('a record removed from its source gets a status chip and a dated Status line', () => {
  assert.deepEqual(sourceAvailabilityDisplay({ status: 'removed-from-source', seenMissing: '2026-11-13' }), {
    chip: "No longer on the publisher's website",
    status: "No longer on the publisher's website (found missing on 2026-11-13)",
  });
});

test('without a usable date the Status line is the chip alone', () => {
  assert.deepEqual(sourceAvailabilityDisplay({ status: 'removed-from-source' }), { chip: REMOVED_FROM_SOURCE_CHIP, status: REMOVED_FROM_SOURCE_CHIP });
  assert.deepEqual(sourceAvailabilityDisplay({ status: 'removed-from-source', seenMissing: '13 Nov' }), { chip: REMOVED_FROM_SOURCE_CHIP, status: REMOVED_FROM_SOURCE_CHIP });
});

test('no availability, or one it does not know, shows nothing', () => {
  for (const value of [undefined, null, '', 'removed-from-source', {}, { status: 'available' }]) {
    assert.equal(sourceAvailabilityDisplay(value), null);
  }
});

test('the gate marks exactly the 10 NISRA publications missing on 13 Nov 2026, and keeps their links', () => {
  const { sources } = readApprovedPublicationGate();
  const marked = sources.filter((source) => sourceAvailabilityDisplay(source.availability));
  assert.equal(marked.length, 10);
  for (const source of marked) {
    assert.match(String(source.id), /^approved-publication:nisra-pub-/);
    assert.deepEqual(source.availability, { status: 'removed-from-source', seenMissing: '2026-11-13' });
    assert.match(String(source.url), /^https:\/\/www\.nisra\.gov\.uk\/publications\//);
  }
});

test('the Browse build shows availability through the existing status chips', () => {
  const build = readFileSync(new URL('../../scripts/build/build-browse-indexes.mjs', import.meta.url), 'utf8');
  assert.match(build, /sourceAvailabilityDisplay\(entry\.availability\)/);
  assert.match(build, /status: entry\.status \|\| availability\?\.status \|\| statusChips\[0\] \|\| null/);
});
