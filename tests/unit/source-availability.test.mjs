// scripts/lib/source-availability.mjs: a source gone from its publisher is kept and shows it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { REMOVED_FROM_SOURCE_CHIP, sourceAvailabilityDisplay, sourceAvailabilityLinks } from '../../scripts/lib/source-availability.mjs';
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

test('a record removed from its source links its archived copy and keeps its original address', () => {
  const url = 'https://data.gov.ie/dataset/an';
  const archiveUrl = `https://web.archive.org/web/20250101000000/${url}`;
  assert.deepEqual(sourceAvailabilityLinks(url, { status: 'removed-from-source', seenMissing: '2026-11-13', archiveUrl }), { url: archiveUrl, originalUrl: url });
  // no copy held: the original stays the link
  assert.deepEqual(sourceAvailabilityLinks(url, { status: 'removed-from-source', seenMissing: '2026-11-13' }), { url, originalUrl: null });
  // a record still at its source, or a copy that is no address, changes nothing
  assert.deepEqual(sourceAvailabilityLinks(url, { status: 'available', archiveUrl }), { url, originalUrl: null });
  assert.deepEqual(sourceAvailabilityLinks(url, undefined), { url, originalUrl: null });
  assert.deepEqual(sourceAvailabilityLinks(url, { status: 'removed-from-source', archiveUrl: 'web.archive.org/x' }), { url, originalUrl: null });
  assert.deepEqual(sourceAvailabilityLinks(null, undefined), { url: null, originalUrl: null });
});

test('the gate marks exactly the 10 NISRA publications, 15 Open Data NI and 93 data.gov.ie datasets missing on 13 Nov 2026, links an archived copy where one is held and keeps the original address', () => {
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
  let archived = 0;
  for (const source of marked) {
    const { archiveUrl, ...rest } = /** @type {{ archiveUrl?: string }} */ (source.availability);
    assert.deepEqual(rest, { status: 'removed-from-source', seenMissing: '2026-11-13' });
    const portal = portals.find(([, idRe]) => idRe.test(String(source.id)));
    assert.ok(portal, String(source.id));
    // the original address stays recorded in url
    assert.match(String(source.url), portal[2]);
    const links = sourceAvailabilityLinks(source.url, source.availability);
    if (archiveUrl) {
      // the copy is Civgraph's own mirror or an Internet Archive capture of that address
      assert.match(archiveUrl, /^https:\/\/(web\.archive\.org\/web\/\d+\/|data\.civgraph\.net\/)/, String(source.id));
      assert.deepEqual(links, { url: archiveUrl, originalUrl: source.url });
      archived += 1;
    } else {
      assert.deepEqual(links, { url: source.url, originalUrl: null });
    }
    byPortal[portal[0]] = (byPortal[portal[0]] || 0) + 1;
  }
  assert.deepEqual(byPortal, { nisra: 10, 'opendata-ni': 15, 'opendata-ie': 93 });
  // 82 have an archived copy (link review of 25 Nov 2026 and Wayback lookups of 27 Nov 2026); 36 have none
  assert.equal(archived, 82);
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
  assert.match(build, /sourceAvailabilityLinks\(entry\.url, entry\.availability\)/);
  assert.match(build, /originalUrl: links\.originalUrl/);
});
