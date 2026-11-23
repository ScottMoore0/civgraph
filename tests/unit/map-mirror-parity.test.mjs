// The local map mirror against R2 (scripts/publish/map-mirror-parity.mjs): the comparison, with
// no network and no files.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  PART_SIZES, candidatePartSizes, collectReferences, compareFile, compareMirror, createDigester, digestNeeded,
  exitCodeFor, foldersOf, formatReport, mirrorKey, parseEtag, summarise,
} from '../../scripts/publish/map-mirror-parity.mjs';

const ORIGIN = 'https://data.example.test';
const MIB = 1024 * 1024;
const md5 = (/** @type {Uint8Array} */ b) => createHash('md5').update(b).digest('hex');
/** The S3 multipart ETag of `bytes` cut into `partSize` parts, computed the plain way. */
function multipart(bytes, partSize) {
  const parts = [];
  for (let i = 0; i < bytes.length; i += partSize) parts.push(createHash('md5').update(bytes.subarray(i, i + partSize)).digest());
  return `${createHash('md5').update(Buffer.concat(parts)).digest('hex')}-${parts.length}`;
}

test('mirrorKey takes data-origin URLs and repository paths under data/maps/, nothing else', () => {
  assert.equal(mirrorKey(`${ORIGIN}/data/maps/parliamentary/2011_Dail.fgb`, ORIGIN), 'data/maps/parliamentary/2011_Dail.fgb');
  assert.equal(mirrorKey(`${ORIGIN}/data/maps/a/b%20c.fgb?v=3#x`, ORIGIN), 'data/maps/a/b c.fgb');
  assert.equal(mirrorKey('/data/maps/a/x.geojson', ORIGIN), 'data/maps/a/x.geojson');
  assert.equal(mirrorKey('data/maps/Electoral Divisions 1986-2019/x.fgb', ORIGIN), 'data/maps/Electoral Divisions 1986-2019/x.fgb');
  assert.equal(mirrorKey('https://elsewhere.test/data/maps/a.fgb', ORIGIN), null);
  assert.equal(mirrorKey(`${ORIGIN}/data/tiles/a.pmtiles`, ORIGIN), null);
  assert.equal(mirrorKey(`${ORIGIN}/data/maps/a/{z}/{x}/{y}.png`, ORIGIN), null);
  assert.equal(mirrorKey(`${ORIGIN}/data/maps/a/`, ORIGIN), null);
  assert.equal(mirrorKey('render/source-cache/x.fgb', ORIGIN), null);
  assert.equal(mirrorKey(42, ORIGIN), null);
});

test('collectReferences marks catalogue and layer geometry as build inputs, the rest as referenced', () => {
  const refs = collectReferences({
    maps: [
      { id: 'a', files: { fgb: `${ORIGIN}/data/maps/p/a.fgb`, image: `${ORIGIN}/data/maps/p/a.png` }, sourceNotes: 'see data/maps/p/a.fgb for the source' },
      { id: 'b', variants: [{ id: 'b1', files: { fgb: 'data/maps/p/b1.fgb' } }], downloads: [{ url: `${ORIGIN}/data/maps/p/a.png` }] },
    ],
    layers: [{ id: 'a', sourceFile: 'data/maps/p/a.fgb', tileUrl: `${ORIGIN}/data/tiles/a.pmtiles` }],
    chunkIndexes: [{ path: 'data/maps/p/a-chunks.json', doc: { chunks: [{ file: 'data/maps/p/chunks/a_0.fgb', zoomFiles: { z7: 'data/maps/p/chunks/a_0_z7.fgb' } }] } }],
  }, { dataOrigin: ORIGIN });
  assert.deepEqual([...refs.keys()].sort(), ['data/maps/p/a.fgb', 'data/maps/p/a.png', 'data/maps/p/b1.fgb', 'data/maps/p/chunks/a_0.fgb', 'data/maps/p/chunks/a_0_z7.fgb']);
  assert.equal(refs.get('data/maps/p/a.fgb')?.build, true);
  assert.deepEqual([...(refs.get('data/maps/p/a.fgb')?.from || [])].sort(), ['maps-test.json sourceFile', 'maps.json files.fgb']);
  assert.equal(refs.get('data/maps/p/b1.fgb')?.build, true);
  assert.equal(refs.get('data/maps/p/a.png')?.build, false);
  assert.equal(refs.get('data/maps/p/chunks/a_0.fgb')?.build, false, 'chunk parts are read by the app, not the builds');
});

test('parseEtag tells single-part from multipart ETags', () => {
  assert.deepEqual(parseEtag('"0123456789ABCDEF0123456789abcdef"'), { md5: '0123456789abcdef0123456789abcdef', parts: null });
  assert.deepEqual(parseEtag('"0123456789abcdef0123456789abcdef-12"'), { md5: '0123456789abcdef0123456789abcdef', parts: 12 });
  assert.equal(parseEtag('not-an-etag'), null);
  assert.equal(parseEtag(null), null);
});

test('candidatePartSizes keeps only part sizes giving that many parts, 8 MiB first', () => {
  assert.equal(PART_SIZES[0], 8 * MIB);
  assert.deepEqual(candidatePartSizes(20 * MIB, 3, [8 * MIB, 5 * MIB, 10 * MIB]), [8 * MIB]);
  assert.deepEqual(candidatePartSizes(20 * MIB, 4, [8 * MIB, 5 * MIB, 10 * MIB]), [5 * MIB]);
  assert.deepEqual(candidatePartSizes(20 * MIB, 7, [8 * MIB, 5 * MIB]), []);
});

test('createDigester gives the MD5 and the multipart ETags, whatever the chunk sizes', () => {
  const bytes = Buffer.alloc(2500, 0);
  for (let i = 0; i < bytes.length; i += 1) bytes[i] = (i * 31) % 251;
  const digester = createDigester({ md5: true, partSizes: [1000, 600] });
  for (let i = 0; i < bytes.length; i += 333) digester.update(bytes.subarray(i, i + 333));
  const got = digester.result();
  assert.equal(got.md5, md5(bytes));
  assert.deepEqual(got.multipart, { 1000: multipart(bytes, 1000), 600: multipart(bytes, 600) });
  assert.equal(got.multipart?.['1000']?.endsWith('-3'), true);
  const exact = createDigester({ md5: false, partSizes: [1250] });
  exact.update(bytes);
  assert.deepEqual(exact.result(), { multipart: { 1250: multipart(bytes, 1250) } }, 'a file of whole parts has no empty last part');
});

test('compareFile: size first, then MD5 or the multipart ETag; a size difference needs no hash', () => {
  const bytes = Buffer.from('the live file');
  const live = { size: bytes.length, etag: `"${md5(bytes)}"`, uploaded: '2026-08-16T10:00:00.000Z' };
  const file = { size: bytes.length, mtimeMs: 0 };
  assert.deepEqual(compareFile({ local: file, remote: live, digest: { md5: md5(bytes) } }), { verdict: 'match', why: 'md5' });
  assert.deepEqual(compareFile({ local: file, remote: live, digest: { md5: md5(Buffer.from('the old file!')) } }), { verdict: 'stale', why: 'md5' });
  assert.deepEqual(compareFile({ local: { size: 3, mtimeMs: 0 }, remote: live }), { verdict: 'stale', why: 'size' });
  assert.deepEqual(digestNeeded({ size: 3, mtimeMs: 0 }, live), { md5: false, partSizes: [] });
  assert.deepEqual(digestNeeded(file, live), { md5: true, partSizes: [] });
  assert.equal(compareFile({ local: file, remote: live }).verdict, 'unverified', 'equal size and no hash proves nothing');
  assert.equal(compareFile({ local: null, remote: live }).verdict, 'missing-local');
  assert.equal(compareFile({ local: file, remote: null }).verdict, 'missing-remote');

  const big = { size: 20 * MIB, mtimeMs: 0 };
  const etag = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-3';
  const remote = { size: 20 * MIB, etag: `"${etag}"`, uploaded: null };
  assert.deepEqual(digestNeeded(big, remote).partSizes[0], 8 * MIB);
  assert.deepEqual(compareFile({ local: big, remote, digest: { multipart: { [8 * MIB]: etag } } }), { verdict: 'match', why: 'multipart 8 MiB parts' });
  assert.equal(compareFile({ local: big, remote, digest: { multipart: { [8 * MIB]: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb-3' } } }).verdict, 'unverified',
    'a multipart ETag that matches no tried part size is unverified until every candidate is tried');
  // 20 MiB in 3 parts: 7, 8 or 9 MiB parts. 8 MiB (the uploader's) first, then the other two.
  assert.deepEqual(candidatePartSizes(20 * MIB, 3), [8 * MIB, 7 * MIB, 9 * MIB]);
  assert.deepEqual(digestNeeded(big, remote, { multipart: { [8 * MIB]: 'b'.repeat(32) + '-3' } }).partSizes, [7 * MIB, 9 * MIB]);
  assert.deepEqual(digestNeeded(big, remote, { multipart: { [8 * MIB]: etag } }), { md5: false, partSizes: [] }, 'a match needs no second pass');
  const allTried = { [7 * MIB]: 'c'.repeat(32) + '-3', [8 * MIB]: 'b'.repeat(32) + '-3', [9 * MIB]: 'd'.repeat(32) + '-3' };
  assert.equal(compareFile({ local: big, remote, digest: { multipart: allTried } }).verdict, 'stale', 'same size, and no part size reproduces the ETag');
  assert.deepEqual(digestNeeded(big, remote, { multipart: allTried }), { md5: false, partSizes: [] });
});

test('a same-size changed file is stale under a multipart ETag, a same-size copy matches', () => {
  const live = Buffer.alloc(3 * 1000 + 17, 7);
  const old = Buffer.from(live);
  old[1500] = 8;
  // Part sizes are whole MiB in production; scale the arithmetic down with a custom list.
  const sizes = [1000, 1200];
  const etag = multipart(live, 1000);
  const remote = { size: live.length, etag: `"${etag}"`, uploaded: null };
  const file = { size: live.length, mtimeMs: 0 };
  assert.deepEqual(candidatePartSizes(live.length, 4, sizes), [1000]);
  const same = createDigester({ md5: false, partSizes: [1000] });
  same.update(live);
  assert.equal(same.result().multipart?.['1000'], etag);
  const changed = createDigester({ md5: false, partSizes: [1000] });
  changed.update(old);
  assert.notEqual(changed.result().multipart?.['1000'], etag);
  assert.equal(compareFile({ local: file, remote: { ...remote, size: live.length + 1 } }).verdict, 'stale');
});

test('compareMirror scopes rows; only a stale build input fails; the report lists it with sizes and dates', () => {
  const old = Buffer.from('LAOIGHIS');
  const now = Buffer.from('LEIX....');
  const refs = collectReferences({ maps: [{ files: { fgb: `${ORIGIN}/data/maps/c/counties.fgb`, image: `${ORIGIN}/data/maps/c/thumb.png` } }] }, { dataOrigin: ORIGIN });
  const local = new Map([
    ['data/maps/c/counties.fgb', { size: old.length, mtimeMs: Date.UTC(2026, 5, 20) }],
    ['data/maps/c/thumb.png', { size: 10, mtimeMs: 0 }],
    ['data/maps/c/spare.fgb', { size: 5, mtimeMs: 0 }],
    ['data/maps/_archive/x.fgb', { size: 1, mtimeMs: 0 }],
  ]);
  const remote = new Map([
    ['data/maps/c/counties.fgb', { size: now.length, etag: `"${md5(now)}"`, uploaded: '2026-08-16T09:30:00.000Z' }],
    ['data/maps/c/thumb.png', { size: 11, etag: null, uploaded: null }],
    ['data/maps/c/spare.fgb', { size: 5, etag: `"${md5(Buffer.from('spare'))}"`, uploaded: null }],
  ]);
  const digests = new Map([['data/maps/c/counties.fgb', { md5: md5(old) }]]);
  const rows = compareMirror({ refs, local, remote, digests });
  assert.deepEqual(rows.map((r) => [r.key, r.scope, r.verdict]), [
    ['data/maps/c/counties.fgb', 'build', 'stale'],
    ['data/maps/c/spare.fgb', 'unreferenced', 'unverified'],
    ['data/maps/c/thumb.png', 'referenced', 'stale'],
  ], 'the local archive folder is left out');
  assert.equal(exitCodeFor(rows), 1);
  assert.equal(summarise(rows).build?.stale, 1);
  const report = formatReport(rows).join('\n');
  assert.match(report, /STALE, read by the builds: 1\n {4}data\/maps\/c\/counties\.fgb\n {6}local {2}8 B, modified 2026-06-20 00:00\n {6}R2 {5}8 B, uploaded 2026-08-16 09:30 {2}\(differs by md5\)/);
  assert.equal(exitCodeFor(rows.filter((r) => r.scope !== 'build')), 0, 'stale images or unreferenced files are reported, not failed');
});

test('foldersOf lists each folder once, for delimited listings', () => {
  assert.deepEqual(foldersOf(['data/maps/a/x.fgb', 'data/maps/a/y.fgb', 'data/maps/a/chunks/z.fgb']), ['data/maps/a/', 'data/maps/a/chunks/']);
});
