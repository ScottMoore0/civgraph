// URL compatibility (packages/map/src/app/url-compat.mjs, seam A2 of the frontend plan): renamed layer
// ids and election keys in old share links, moved out of packages/map/app/app.js.
//
//   node --test tests/unit/url-compat.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  LEGACY_LAYER_ID_PREFIXES,
  RENAMED_ELECTION_BODIES,
  RENAMED_ELECTION_DATES,
  renameElectionDatesInParams,
  resolveLegacyLayerId,
  slugifyBody
} from '../../packages/map/src/app/url-compat.mjs';

test('resolveLegacyLayerId rewrites renamed prefixes and leaves the rest', () => {
  assert.equal(resolveLegacyLayerId('roi-local-authorities-1920-vector-test'), 'local-authorities-1920-vector-test');
  assert.equal(resolveLegacyLayerId('ded-1954-04-01-vector-test'), 'ded-1954-08-01-vector-test');
  assert.equal(resolveLegacyLayerId('admin-areas-1938-05-16-vector-test'), 'admin-areas-1938-05-15-vector-test');
  assert.equal(resolveLegacyLayerId('admin-areas-1939-05-23-alias-test'), 'admin-areas-1939-05-23-vector-test');
  assert.equal(resolveLegacyLayerId('county-ed-1957-04-01-vector-test'), 'counties-ireland-1957-vector-test');
  assert.equal(resolveLegacyLayerId('wards-2014-vector-test'), 'wards-2014-vector-test');
  assert.equal(resolveLegacyLayerId(''), '');
  assert.equal(resolveLegacyLayerId(null), '');
  for (const [, to] of LEGACY_LAYER_ID_PREFIXES) {
    assert.equal(resolveLegacyLayerId(`${to}x`), `${to}x`, `${to} is not itself renamed`);
  }
});

test('slugifyBody', () => {
  assert.equal(slugifyBody('Bangor Urban District Council'), 'bangor-urban-district-council');
  assert.equal(slugifyBody(' House of Commons of the United Kingdom '), 'house-of-commons-of-the-united-kingdom');
  assert.equal(slugifyBody(null), '');
});

test('renamed election dates: keys and the electionDate parameter', () => {
  assert.ok(RENAMED_ELECTION_DATES.some(([body, from, to]) => body === 'northern-ireland-assembly' && from === '1983-04-27' && to === '1983-04-20'));
  const params = new URLSearchParams({
    election: 'house-of-commons-of-the-united-kingdom__1968-04-17',
    entity: 'northern-ireland-assembly:1983-04-27',
    electionBody: 'House of Commons of the United Kingdom',
    electionDate: '2011-06-06',
    other: '1968-04-17'
  });
  const returned = renameElectionDatesInParams(params);
  assert.equal(returned, params);
  assert.equal(params.get('election'), 'house-of-commons-of-the-united-kingdom__1969-04-17');
  assert.equal(params.get('entity'), 'northern-ireland-assembly:1983-04-20');
  assert.equal(params.get('electionDate'), '2011-06-09');
  // A bare date is only rewritten as the electionDate of that body.
  assert.equal(params.get('other'), '1968-04-17');
  const otherBody = renameElectionDatesInParams(new URLSearchParams({ electionBody: 'Dáil Éireann', electionDate: '2011-06-06' }));
  assert.equal(otherBody.get('electionDate'), '2011-06-06');
});

test('renamed election bodies: keys, layer ids and the electionBody parameter', () => {
  assert.equal(RENAMED_ELECTION_BODIES.length >= 2, true);
  const params = renameElectionDatesInParams(new URLSearchParams({
    election: 'bangor-urban-district-council__1920-01-15',
    layers: 'election-lisburn-urban-district-council-1920-01-15,wards-2014',
    electionBody: 'Bangor Urban District Council',
    electionDate: '1920-01-15'
  }));
  assert.equal(params.get('election'), 'bangor-borough-council__1920-01-15');
  assert.equal(params.get('layers'), 'election-lisburn-borough-council-1920-01-15,wards-2014');
  assert.equal(params.get('electionBody'), 'Bangor Borough Council');
  // Another date of the same body is left alone.
  const later = renameElectionDatesInParams(new URLSearchParams({ electionBody: 'Bangor Urban District Council', electionDate: '1923-01-15' }));
  assert.equal(later.get('electionBody'), 'Bangor Urban District Council');
});

test('resolveLegacyLayerId tries the other suffix spelling against the loaded index (renames.csv)', () => {
  const index = new Set(['lgd-2012-vector-test', 'eds-1911-raster', 'civil-parishes-alias-test', 'counties-ireland-1957-vector-test']);
  const isKnown = (id) => index.has(id);
  assert.equal(resolveLegacyLayerId('lgd-2012-vector', isKnown), 'lgd-2012-vector-test', 'new spelling before the source ids flip');
  assert.equal(resolveLegacyLayerId('eds-1911-raster-test', isKnown), 'eds-1911-raster', 'old spelling after they flip');
  assert.equal(resolveLegacyLayerId('civil-parishes-alias', isKnown), 'civil-parishes-alias-test');
  assert.equal(resolveLegacyLayerId('lgd-2012-vector-test', isKnown), 'lgd-2012-vector-test', 'a live id is kept');
  assert.equal(resolveLegacyLayerId('county-ed-1957-04-01-vector', isKnown), 'counties-ireland-1957-vector-test', 'renamed prefix, then the suffix');
  assert.equal(resolveLegacyLayerId('unknown-vector', isKnown), 'unknown-vector', 'unknown in both spellings: unchanged');
  assert.equal(resolveLegacyLayerId('lgd-2012-vector'), 'lgd-2012-vector', 'without an index only the prefixes apply');
});
