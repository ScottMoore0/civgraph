// The one reference format for map layers (scripts/check/rules/map-references.mjs): {label, url?, note?}.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalLabel, normaliseReferences, normaliseRecord, referenceProblems } from '../../scripts/check/rules/map-references.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

test('a label puts its own host first, once, however it was written', () => {
  const url = 'https://data.gov.ie/dataset/planning-register';
  assert.equal(canonicalLabel('Planning Register (data.gov.ie)', url), 'data.gov.ie — Planning Register');
  assert.equal(canonicalLabel('Planning Register — data.gov.ie', url), 'data.gov.ie — Planning Register');
  assert.equal(canonicalLabel('Counties - 2019 - data.gov.ie (data.gov.ie)', url), 'data.gov.ie — Counties - 2019');
  assert.equal(canonicalLabel('data.gov.ie — Planning Register', url), 'data.gov.ie — Planning Register');
  assert.equal(canonicalLabel('Peacelines (NIO) (www.nisra.gov.uk)', 'https://www.nisra.gov.uk/x'), 'nisra.gov.uk — Peacelines (NIO)');
  // a bracket that is not the address stays
  assert.equal(canonicalLabel('Peacelines (NIO)', 'https://www.nisra.gov.uk/x'), 'Peacelines (NIO)');
  assert.equal(canonicalLabel('Local Authorities 2024 - GeoJSON download', 'https://example.org/a.geojson'), 'Local Authorities 2024 — GeoJSON download');
  assert.equal(canonicalLabel('Peacelines - ESRI Shapefile (ZIP) download', 'https://example.org/a.zip'), 'Peacelines — ESRI Shapefile (ZIP) download');
});

test('normalising trims, drops empty notes, encodes spaces and merges exact duplicates', () => {
  const out = normaliseReferences([
    { label: '  Census  report ', url: 'https://data.civgraph.net/a b.txt ', note: '' },
    { label: 'Census report', url: 'https://data.civgraph.net/a%20b.txt', note: 'Table 6' },
    { label: 'Order (no address)', url: '' },
    'https://example.org/page',
  ]);
  assert.deepEqual(out, [
    { label: 'Census report', url: 'https://data.civgraph.net/a%20b.txt', note: 'Table 6' },
    { label: 'Order (no address)' },
    { label: 'example.org', url: 'https://example.org/page' },
  ]);
  assert.deepEqual(referenceProblems(out), []);
});

test('the retired sourceNotes field becomes a reference: an address as its url, prose as its note', () => {
  const a = { id: 'a', sourceNotes: 'https://data.civgraph.net/data/maps/x/Wards 1912.txt' };
  normaliseRecord(a);
  assert.deepEqual(a, { id: 'a', references: [{ label: 'Source notes', url: 'https://data.civgraph.net/data/maps/x/Wards%201912.txt' }] });
  const b = { id: 'b', references: [{ label: 'Gazette', url: 'https://example.org/g' }], sourceNotes: 'Fermanagh: Dublin Gazette 10 May 1912. Portstewart: later.' };
  normaliseRecord(b);
  assert.deepEqual(b.references[1], { label: 'Source notes', note: 'Fermanagh: Dublin Gazette 10 May 1912. Portstewart: later.' });
  // an address already cited is not cited twice
  const c = { id: 'c', references: [{ label: 'Notes', url: 'https://example.org/n%20o.txt' }], sourceNotes: 'https://example.org/n o.txt' };
  normaliseRecord(c);
  assert.equal(c.references.length, 1);
  assert.equal('sourceNotes' in c, false);
});

test('the check names what is out of format', () => {
  const p = referenceProblems([
    { label: 'A', url: 'not an address', extra: 1 },
    { label: '', note: '   ' },
    { label: 'B (example.org)', url: 'https://example.org/b' },
    { label: 'A', url: 'not an address' },
  ]).join('\n');
  assert.match(p, /key "extra"/);
  assert.match(p, /url is not an http\(s\) address/);
  assert.match(p, /reference 2 has no label/);
  assert.match(p, /note is empty/);
  assert.match(p, /should read "example\.org — B"/);
  assert.match(p, /repeats an earlier reference/);
  assert.deepEqual(referenceProblems('x'), ['references is not a list']);
});

test('the maps database, the renderer layers and the census statistics are in the format', () => {
  for (const [rel, key] of [['data/database/maps.json', 'maps'], ['render/metadata/maps-test.json', 'layers'], ['data/database/data-entries.json', 'dataEntries']]) {
    const doc = JSON.parse(readFileSync(path.join(ROOT, rel), 'utf8'));
    const bad = [];
    for (const rec of doc[key]) {
      for (const problem of referenceProblems(rec.references)) bad.push(`${rec.id}: ${problem}`);
      if ('sourceNotes' in rec) bad.push(`${rec.id}: sourceNotes`);
    }
    assert.deepEqual(bad.slice(0, 5), [], `${rel}: run node scripts/check/rules/map-references.mjs --write`);
  }
});
