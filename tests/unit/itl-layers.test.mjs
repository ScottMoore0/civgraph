import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// ITL 1, 2 and 3 of Northern Ireland (Phelim Birch review #10), built from Civgraph's lgd-2012 map
// as the NUTS 2016-2021 maps were. ONS's codes and names are facts (OGL v3.0); ONS's own
// boundaries are not what these maps load. ITL 2025 changed no Northern Ireland unit.

const read = (p) => JSON.parse(readFileSync(p, 'utf8'));
const maps = new Map(read('data/database/maps.json').maps.map((m) => [m.id, m]));
const layers = new Map(read('render/metadata/maps-test.json').layers.map((l) => [l.id, l]));
const source = read('data/catalogue/catalogue.source.json');
const series = source.series.find((s) => s.id === 'census-itl-regions');

const ITL3 = ['TLN06', 'TLN07', 'TLN08', 'TLN09', 'TLN0A', 'TLN0B', 'TLN0C', 'TLN0D', 'TLN0E', 'TLN0F', 'TLN0G'];
const EXPECTED = {
  'itl-1-2021-2025': { ITL_ID: ['TLN'], NUTS_ID: ['UKN'] },
  'itl-2-2021-2025': { ITL_ID: ['TLN0'], NUTS_ID: ['UKN0'] },
  'itl-3-2021-2025': { ITL_ID: ITL3, NUTS_ID: ITL3.map((c) => `UK${c.slice(2)}`), ITL2_ID: ['TLN0'], ITL1_ID: ['TLN'] },
};

test('the three ITL maps are in maps.json, built from lgd-2012 and citing ONS', () => {
  for (const [id, i] of Object.keys(EXPECTED).map((k, n) => [k, n + 1])) {
    const m = maps.get(id);
    assert.ok(m, id);
    assert.equal(m.files.fgb, `https://data.civgraph.net/data/maps/census-areas/ITL${i}_NI_2021-2025.fgb`);
    assert.equal(m.labelProperty, 'NAME');
    assert.equal(m.licence, 'OGL v3.0');
    assert.match(m.licenceNote, /Local Government Districts 2012/);
    const urls = m.references.map((r) => r.url);
    assert.ok(urls.some((u) => u.startsWith('https://geoportal.statistics.gov.uk/datasets/')), `${id} cites ONS Open Geography`);
    assert.ok(urls.includes('https://civgraph.net/maps/#layers=lgd-2012'), `${id} cites its district map`);
    // No map description: the drafted one was AI prose (owner, 19 Nov 2026).
    assert.equal(m.description, undefined, id);
  }
});

test('their render layers carry ONS codes and the NUTS 2021 equivalents', () => {
  for (const [id, codes] of Object.entries(EXPECTED)) {
    const layer = layers.get(`${id}-vector`);
    assert.ok(layer, id);
    assert.equal(layer.sourceMapId, id);
    assert.equal(layer.promoteId, 'id');
    assert.equal(layer.minzoom, 0);
    for (const [field, want] of Object.entries(codes)) assert.deepEqual([...layer.categoricalValues[field]].sort(), [...want].sort(), `${id} ${field}`);
  }
});

test('the ITL Regions row sits beside NUTS Regions, labelled by level, signed off', () => {
  assert.ok(series);
  assert.equal(series.scope, 'Northern Ireland');
  assert.deepEqual(series.members, Object.keys(EXPECTED));
  assert.equal(series.labels['itl-3-2021-2025'], 'ITL 3 (2021–2025)');
  const census = source.subjects.find((s) => s.id === 'census').series;
  assert.equal(census.indexOf('census-itl-regions'), census.indexOf('census-nuts-2-regions') + 1);
  const signed = new Set(source.signedOff.map((s) => s.id));
  for (const id of Object.keys(EXPECTED)) assert.ok(signed.has(id), id);
});
