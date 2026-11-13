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

test('the gate marks exactly the 10 NISRA publications, 15 Open Data NI and 93 data.gov.ie datasets missing on 13 Nov 2026, and keeps their links', () => {
  const { sources } = readApprovedPublicationGate();
  const marked = sources.filter((source) => sourceAvailabilityDisplay(source.availability));
  assert.equal(marked.length, 118);
  /** @type {Record<string, number>} */
  const byPortal = {};
  const portals = [
    ['nisra', /^approved-publication:nisra-pub-/, /^https:\/\/www\.nisra\.gov\.uk\/publications\//],
    ['opendata-ni', /^approved-publication:opendata-ni-/, /^https:\/\/www\.opendatani\.gov\.uk\/dataset\//],
    ['opendata-ie', /^approved-publication:opendata-ie-/, /^https:\/\/data\.gov\.ie\/dataset\//],
  ];
  for (const source of marked) {
    assert.deepEqual(source.availability, { status: 'removed-from-source', seenMissing: '2026-11-13' });
    const portal = portals.find(([, idRe]) => idRe.test(String(source.id)));
    assert.ok(portal, String(source.id));
    assert.match(String(source.url), portal[2]);
    byPortal[portal[0]] = (byPortal[portal[0]] || 0) + 1;
  }
  assert.deepEqual(byPortal, { nisra: 10, 'opendata-ni': 15, 'opendata-ie': 93 });
  // The two data.gov.ie datasets still listed, now under the CSO, are not marked.
  for (const id of ['approved-publication:opendata-ie-eiieea30-municipal-waste-generated-per-capita', 'approved-publication:opendata-ie-sca39-children-relationship-with-parents']) {
    const source = sources.find((s) => s.id === id);
    assert.ok(source && !source.availability, id);
  }
});

test('the Browse build shows availability through the existing status chips', () => {
  const build = readFileSync(new URL('../../scripts/build/build-browse-indexes.mjs', import.meta.url), 'utf8');
  assert.match(build, /sourceAvailabilityDisplay\(entry\.availability\)/);
  assert.match(build, /status: entry\.status \|\| availability\?\.status \|\| statusChips\[0\] \|\| null/);
});
