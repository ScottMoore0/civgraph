// The NI district and county electoral division editions of 1921-1969 (tracing batch of 7 Nov 2026):
// every drawn edition points at a file and draws a /test layer that joins its tile pieces on civ_fid;
// the pre-1930 DED editions say they are the 1930 map unchanged; the replaced 1939 file is served
// under a new name; and the editions that carry Bangor's corrected borough line mark its approximate
// stretches with their OSNI six-inch citation.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const maps = JSON.parse(readFileSync('data/database/maps.json', 'utf8')).maps;
const layers = JSON.parse(readFileSync('render/metadata/maps-test.json', 'utf8')).layers;
const byId = new Map(maps.map((m) => [m.id, m]));
const layerBySource = new Map();
for (const l of layers) if (!layerBySource.has(l.sourceMapId)) layerBySource.set(l.sourceMapId, l);
const editions = maps.filter((m) => /^(ded|county-ed)-19[2-6]\d-\d\d-\d\d$/.test(m.id));
const drawn = editions.filter((m) => !m.placeholder);
const fileOf = (m) => String(m.files?.fgb || '').split('?')[0].split('/').pop();

test('every drawn edition has a file, a label property and a /test layer', () => {
  assert.ok(drawn.length >= 80, `drawn editions: ${drawn.length}`);
  for (const m of drawn) {
    assert.match(m.files?.fgb || '', /^https:\/\/data\.civgraph\.net\/data\/maps\/electoral-divisions\/.+\.fgb$/, m.id);
    assert.ok(m.labelProperty, `${m.id} labelProperty`);
    const layer = layerBySource.get(m.id);
    assert.ok(layer, `${m.id} has a /test layer`);
    // This batch's files (dated NI_DEDs_ / NI_County_Electoral_Divisions_ files) carry civ_fid.
    if (/^NI_(DEDs|County_Electoral_Divisions)_\d{4}-\d\d-\d\d(_v2)?\.fgb$/.test(fileOf(m)) && !fileOf(m).includes('1924-06-20')) {
      assert.equal(layer.promoteId, 'civ_fid', `${m.id} promoteId`);
    }
  }
});

test('an edition that shares another edition\'s file says which', () => {
  const owner = new Map();
  for (const m of drawn) {
    const f = fileOf(m);
    if (!m.cloneOf) {
      assert.ok(!owner.has(f) || f === 'NI_County_Electoral_Divisions_1924-06-20.fgb', `${f} drawn by ${owner.get(f)} and ${m.id}`);
      owner.set(f, m.id);
    }
  }
  for (const m of drawn.filter((x) => x.cloneOf)) {
    assert.ok(byId.has(m.cloneOf), `${m.id} cloneOf ${m.cloneOf}`);
    assert.equal(fileOf(m), fileOf(byId.get(m.cloneOf)), `${m.id} shares ${m.cloneOf}'s file`);
  }
});

test('the 1925-29 DED editions say they are the 1930 map unchanged', () => {
  const pre30 = drawn.filter((m) => m.id.startsWith('ded-') && m.date < '1930-04-01' && m.date > '1925-04-01');
  assert.equal(pre30.length, 6);
  for (const m of pre30) {
    assert.equal(m.cloneOf, 'ded-1930-04-01', m.id);
    assert.match(m.changeNote, /Not drawn for this date: this edition shows the 1 Apr 1930 DED map/, m.id);
  }
});

test('the replaced 1 Apr 1939 DED file is served under its own new name', () => {
  assert.equal(fileOf(byId.get('ded-1939-04-01')), 'NI_DEDs_1939-04-01_v2.fgb');
  assert.equal(byId.get('ded-1939-04-01').approximateSegments?.url,
    'https://data.civgraph.net/data/maps/approximate/NI_DEDs_1939-04-01_v2-approximate.geojson');
});

test("Bangor's corrected line is marked approximate on the DED editions that draw it", () => {
  for (const id of ['ded-1950-04-01', 'ded-1956-04-01', 'ded-1962-04-01', 'ded-1963-09-13', 'ded-1967-04-01', 'ded-1969-04-02']) {
    const a = byId.get(id).approximateSegments;
    assert.ok(a, `${id} approximateSegments`);
    assert.match(a.note, /Bangor borough boundary .+ OSNI six-inch Edition 5/, id);
  }
  // The 1921-22 county electoral divisions are the 1898 divisions, drawn from a source map.
  assert.equal(byId.get('county-ed-1921-05-03').approximateSegments, undefined);
});
