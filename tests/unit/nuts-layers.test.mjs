import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// NUTS 2 and NUTS 3 of Ireland and Northern Ireland, 2003-2013 and 2016-2021, built from Civgraph's
// own council maps (owner, batch 4, 11 Nov 2026). Eurostat's codes are facts; GISCO's geometry is
// non-commercial and must not be what these maps load.

const read = (p) => JSON.parse(readFileSync(p, 'utf8'));
const maps = new Map(read('data/database/maps.json').maps.map((m) => [m.id, m]));
const layers = new Map(read('render/metadata/maps-test.json').layers.map((l) => [l.id, l]));
const series = read('data/catalogue/catalogue.source.json').series.find((s) => s.id === 'census-nuts-2-regions');

const range = (prefix, from, to) => Array.from({ length: to - from + 1 }, (_, i) => `${prefix}${from + i}`);
const NI_2021 = ['UKN06', 'UKN07', 'UKN08', 'UKN09', 'UKN0A', 'UKN0B', 'UKN0C', 'UKN0D', 'UKN0E', 'UKN0F', 'UKN0G'];
const NI_2016 = ['UKN06', 'UKN07', 'UKN08', 'UKN09', ...range('UKN', 10, 16)];
const IE_2016 = ['IE041', 'IE042', 'IE051', 'IE052', 'IE053', 'IE061', 'IE062', 'IE063'];
const EXPECTED = {
  'nuts-2-2003-2013': { NUTS_ID: ['IE01', 'IE02', 'UKN0'] },
  'nuts-3-2003-2013': { NUTS_ID: ['IE011', 'IE012', 'IE013', 'IE021', 'IE022', 'IE023', 'IE024', 'IE025', ...range('UKN0', 1, 5)] },
  'nuts-2-2016-2021': { NUTS_ID: ['IE04', 'IE05', 'IE06', 'UKN0'] },
  'nuts-3-2016-2021': { NUTS_ID: [...IE_2016, ...NI_2021], NUTS_ID_2016: [...IE_2016, ...NI_2016] },
};

test('the four NUTS maps are in maps.json, built from council maps and citing the regulations', () => {
  for (const id of Object.keys(EXPECTED)) {
    const m = maps.get(id);
    assert.ok(m, id);
    assert.match(m.files.fgb, /^https:\/\/data\.civgraph\.net\/data\/maps\/census-areas\/NUTS[23]_Ireland_(2003-2013|2016-2021)\.fgb$/, id);
    assert.doesNotMatch(JSON.stringify(m.files), /gisco|ec\.europa\.eu/i, id);
    assert.equal(m.labelProperty, 'NAME', id);
    assert.equal(m.licence, 'CC-BY-4.0', id);
    assert.match(m.licenceNote, /Built for Civgraph by joining its council maps/, id);
    const urls = m.references.map((r) => r.url);
    assert.ok(urls.some((u) => /eur-lex\.europa\.eu\/eli\/reg/.test(u)), `${id} cites a NUTS regulation`);
    assert.ok(urls.some((u) => /eurostat\/web\/nuts\/history/.test(u)), `${id} cites Eurostat's code lists`);
    assert.ok(urls.some((u) => /layers=(local-authorities-20(08|14))/.test(u)) && urls.some((u) => /layers=lgd-(1993|2012)/.test(u)), `${id} cites its council maps`);
  }
  assert.match(maps.get('nuts-3-2016-2021').description, /UKN10-UKN16 became UKN0A-UKN0G/);
});

test('their live layers carry Eurostat\'s codes: UKN0A-0G for 2021 and UKN10-16 for 2016', () => {
  for (const [id, codes] of Object.entries(EXPECTED)) {
    const layer = layers.get(`${id}-vector`);
    assert.ok(layer, id);
    assert.equal(layer.sourceMapId, id);
    assert.equal(layer.labelProperty, 'NAME');
    assert.equal(layer.promoteId, 'id');
    for (const [field, want] of Object.entries(codes)) assert.deepEqual([...layer.categoricalValues[field]].sort(), [...want].sort(), `${id} ${field}`);
  }
});

test('the catalogue row lists them first, labelled by version, signed off', () => {
  assert.deepEqual(series.members.slice(0, 4), ['nuts-2-2016-2021', 'nuts-2-2003-2013', 'nuts-3-2016-2021', 'nuts-3-2003-2013']);
  assert.equal(series.labels['nuts-3-2016-2021'], 'NUTS 3 (2016–2021)');
  assert.equal(series.labels['nuts-2-2003-2013'], 'NUTS 2 (2003–2013)');
  const signed = new Set(read('data/catalogue/catalogue.source.json').signedOff.map((s) => s.id));
  for (const id of Object.keys(EXPECTED)) assert.ok(signed.has(id), id);
});

test('the Tailte NUTS maps label each area by its own name, not "Ireland"', () => {
  assert.equal(maps.get('tailte-nuts2-boundaries-ungeneralised').labelProperty, 'NUTS2NAME');
  assert.equal(maps.get('tailte-nuts3-boundaries-generalised-20m').labelProperty, 'NUTS3NAME');
  assert.equal(layers.get('tailte-nuts2-boundaries-ungeneralised-vector').labelProperty, 'NUTS2NAME');
  assert.equal(layers.get('tailte-nuts3-boundaries-generalised-20m-vector').labelProperty, 'NUTS3NAME');
  for (const id of ['tailte-nuts2-boundaries-ungeneralised-vector', 'tailte-nuts3-boundaries-generalised-20m-vector']) {
    const names = read(`render/metadata/feature-indexes/${id}.json`).items.map((i) => i.name);
    assert.ok(names.length > 1 && !names.includes('Ireland'), id);
  }
});
