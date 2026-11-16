// The NI district and county electoral division editions of 1921-1969: every drawn edition points at a
// file and draws a /test layer that joins its tile pieces on civ_fid; the pre-1930 DED editions say they
// are the 1930 map unchanged; and the editions after 1 Apr 1930 are partial (16 Nov 2026): Paddy
// Matthews's 1930 DEDs, and the 1923 county electoral divisions joined from them, with every division a
// later change altered left out of the file, served under new _partial names.
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
    if (/^NI_(DEDs|County_Electoral_Divisions)_\d{4}-\d\d-\d\d(_v2|_partial)?\.fgb$/.test(fileOf(m)) && !fileOf(m).includes('1924-06-20')) {
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

test('the editions after 1 Apr 1930 are partial, under new names, credited to Paddy Matthews', () => {
  const partial = drawn.filter((m) => m.date > '1930-04-01' || m.id === 'ded-1925-04-01');
  assert.ok(partial.length >= 75, `partial editions: ${partial.length}`);
  for (const m of partial) {
    assert.match(fileOf(m), /_partial\.fgb$/, m.id);
    assert.equal(m.incomplete, true, `${m.id} incomplete`);
    assert.deepEqual(m.provider, ['Paddy Matthews'], `${m.id} provider`);
    assert.equal(m.approximateSegments, undefined, `${m.id} approximateSegments`);
    assert.match(m.changeNote, /Not in this edition's file: /, m.id);
  }
  // The 1921-22 county electoral divisions are the 1898 divisions, drawn from a source map.
  assert.equal(byId.get('county-ed-1921-05-03').approximateSegments, undefined);
});
