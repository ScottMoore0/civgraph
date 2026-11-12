// scripts/lib/browse-links.mjs: a Browse record's download links from the catalogue's shapes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileLabel, normalizeFiles, normalizeLinks } from '../../scripts/lib/browse-links.mjs';

test('a { label, file } download is one link, not a link per field (site QA 12 Nov)', () => {
  assert.deepEqual(normalizeLinks([{ label: 'ESRI Shapefile (ZIP)', file: 'https://www.nisra.gov.uk/files/SA2011_Esri_Shapefile_0.zip' }]), [
    { label: 'ESRI Shapefile (ZIP)', url: 'https://www.nisra.gov.uk/files/SA2011_Esri_Shapefile_0.zip' },
  ]);
});

test('a download with a hash, a size and a mirror links the file and its mirror only', () => {
  const links = normalizeLinks([{ label: 'CSV - corbettab_v4.csv', file: 'https://example.org/corbettab_v4.csv', hash: 'abc', bytes: 91098, mirror: 'https://example.org/mirror/corbettab_v4.csv' }]);
  assert.deepEqual(links, [
    { label: 'CSV - corbettab_v4.csv', url: 'https://example.org/corbettab_v4.csv' },
    { label: 'CSV - corbettab_v4.csv (mirror)', url: 'https://example.org/mirror/corbettab_v4.csv' },
  ]);
  assert.ok(links.every((link) => /^https:\/\//.test(link.url)));
});

test('the other shapes read as before', () => {
  assert.deepEqual(normalizeLinks('https://data.civgraph.net/data/maps/x/SA2011.fgb'), [{ label: 'SA2011.fgb', url: 'https://data.civgraph.net/data/maps/x/SA2011.fgb' }]);
  assert.deepEqual(normalizeLinks([{ title: 'Report', href: 'https://example.org/r.pdf', type: 'pdf' }]), [{ label: 'Report', url: 'https://example.org/r.pdf', type: 'pdf' }]);
  assert.deepEqual(normalizeLinks([{ fgb: 'https://archive.org/download/x/T.fgb' }]), [{ label: 'fgb', url: 'https://archive.org/download/x/T.fgb' }]);
  assert.deepEqual(normalizeFiles({ fgb: 'https://data.civgraph.net/a.fgb', csv: ['https://data.civgraph.net/b.csv'] }), [
    { label: 'fgb', url: 'https://data.civgraph.net/a.fgb' },
    { label: 'csv', url: 'https://data.civgraph.net/b.csv' },
  ]);
  assert.deepEqual(normalizeLinks([null, '', [['https://e.org/a.zip']]]), [{ label: 'a.zip', url: 'https://e.org/a.zip' }]);
  assert.equal(fileLabel('https://e.org/dir/file.csv?x=1'), 'file.csv');
  assert.equal(fileLabel(''), 'Source');
});
