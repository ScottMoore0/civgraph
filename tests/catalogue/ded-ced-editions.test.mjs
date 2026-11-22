// The NI district and county electoral division editions of 1921-1969: every drawn edition points at a
// file and draws a /test layer that joins its tile pieces on civ_fid; the pre-1930 DED editions say they
// are the 1930 map unchanged; and the editions after 1 Apr 1930 are partial (16 Nov 2026): Paddy
// Matthews's 1930 DEDs, and the 1923 county electoral divisions joined from them, with every division a
// later change altered left out of the file, served under new _partial names. The 1924 editions before the
// changes the 1930 map draws (Bangor 20 Jun 1924, Whitehead 24 Jun 1925) are partial the same way; the 1922
// DED editions are the 3 May 1921 map unchanged (the 1922 ward orders moved no DED line). Newry North and
// South Urban, which the 1930 map draws as before the transfer of 22 Aug 1929, are left out of every DED
// edition from that date, 1 Apr 1930 included (22 Nov 2026); the 1925-29 editions keep the full 1930 map.
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
  assert.ok(drawn.length >= 90, `drawn editions: ${drawn.length}`);
  for (const m of drawn) {
    assert.match(m.files?.fgb || '', /^https:\/\/data\.civgraph\.net\/data\/maps\/electoral-divisions\/.+\.fgb(\?v=[0-9a-f-]+)?$/, m.id);
    assert.ok(m.labelProperty, `${m.id} labelProperty`);
    const layer = layerBySource.get(m.id);
    assert.ok(layer, `${m.id} has a /test layer`);
    // This batch's files (dated NI_DEDs_ / NI_County_Electoral_Divisions_ files) carry civ_fid.
    if (/^NI_(DEDs|County_Electoral_Divisions)_\d{4}-\d\d-\d\d(_v2|_partial|_v2_partial)?\.fgb$/.test(fileOf(m)) && !fileOf(m).includes('1924-06-20')) {
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

test('the 1925-29 DED editions say they are the 1930 map unchanged, and keep its full file', () => {
  const pre30 = drawn.filter((m) => m.id.startsWith('ded-') && m.date < '1930-04-01' && m.date > '1925-04-01');
  assert.equal(pre30.length, 6);
  for (const m of pre30) {
    assert.equal(fileOf(m), 'NI_DEDs_1930.fgb', m.id);
    assert.equal(m.incomplete, undefined, `${m.id} incomplete`);
    if (m.id !== 'ded-1925-06-24') assert.equal(m.cloneOf, 'ded-1925-06-24', m.id);
    assert.match(m.changeNote, /Not drawn for this date: this edition shows the 1 Apr 1930 DED map/, m.id);
    assert.doesNotMatch(m.changeNote, /same file as ded-1930-04-01/, m.id);
  }
  // ded-1925-06-24 draws the full map on the archive the 1930 layer served before; the others alias it
  const own = layerBySource.get('ded-1925-06-24');
  assert.equal(own.aliasOf, undefined);
  assert.equal(own.status, 'converted');
  for (const m of pre30.filter((x) => x.cloneOf)) assert.equal(layerBySource.get(m.id).aliasTargetLayerId, own.id, m.id);
});

test('Newry North and South Urban are left out of every DED edition from 22 Aug 1929, and Newry county division stays', () => {
  const NEWRY = "Newry (from 22 Aug 1929): Newry North Urban and Newry South Urban";
  const from1930 = drawn.filter((m) => m.id.startsWith('ded-') && m.date >= '1930-04-01');
  assert.ok(from1930.length >= 41, `DED editions from 1 Apr 1930: ${from1930.length}`);
  for (const m of from1930) {
    assert.ok(m.changeNote.includes(`Not in this edition's file: ${NEWRY}`), m.id);
    assert.match(fileOf(m), m.id === 'ded-1930-04-01' ? /^NI_DEDs_1930-04-01_partial\.fgb$/ : /_v2_partial\.fgb$/, m.id);
  }
  const d1930 = byId.get('ded-1930-04-01');
  assert.equal(d1930.incomplete, true);
  assert.deepEqual(d1930.provider, ['Paddy Matthews']);
  assert.doesNotMatch(d1930.changeNote, /Civgraph geometry/);
  // ded-1925-04-01: district names as at 1 Apr 1925, Newry kept
  const d1925 = byId.get('ded-1925-04-01');
  assert.equal(fileOf(d1925), 'NI_DEDs_1925-04-01_v2_partial.fgb');
  assert.doesNotMatch(d1925.changeNote, /Newry \(from/);
  const layer1925 = layerBySource.get('ded-1925-04-01');
  for (const name of ['Bangor Municipal Borough', 'Coleraine Municipal Borough']) {
    assert.ok(!(layer1925.categoricalValues?.AdministrativeArea || []).includes(name), name);
  }
  // the transfer lies inside Newry county electoral division: no county edition leaves it out
  for (const m of drawn.filter((x) => x.id.startsWith('county-ed-') && x.date > '1930-04-01')) {
    assert.match(m.changeNote, /Newry is drawn, as Newry North Urban and Newry South Urban/, m.id);
    assert.doesNotMatch(m.changeNote.split("Not in this edition's file:")[1] || '', /Down: [^;.]*\bNewry\b/, m.id);
  }
});

test('the editions after 1 Apr 1930 and the 1924 editions before the Bangor and Whitehead changes are partial, under new names, credited to Paddy Matthews', () => {
  const early = ['ded-1924-04-01', 'ded-1924-06-01', 'ded-1924-06-20', 'ded-1925-04-01', 'county-ed-1924-04-01', 'county-ed-1924-06-01'];
  const partial = drawn.filter((m) => m.date > '1930-04-01' || early.includes(m.id));
  assert.ok(partial.length >= 85, `partial editions: ${partial.length}`);
  for (const id of early) assert.ok(partial.some((m) => m.id === id), `${id} drawn`);
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

test('the 1922 DED editions are the 3 May 1921 map unchanged, credited as it is', () => {
  const ded1922 = drawn.filter((m) => m.id.startsWith('ded-1922-'));
  assert.equal(ded1922.length, 5);
  for (const m of ded1922) {
    assert.equal(m.cloneOf, 'ded-1921-05-03', m.id);
    assert.deepEqual(m.provider, byId.get('ded-1921-05-03').provider, `${m.id} provider`);
    assert.equal(m.incomplete, undefined, `${m.id} incomplete`);
    assert.match(m.changeNote, /No DED changed/, m.id);
  }
});

test('the county electoral divisions from 1 Apr 1924 are drawn and have a /test layer', () => {
  const ced = editions.filter((m) => m.id.startsWith('county-ed-') && m.date >= '1924-04-01');
  assert.ok(ced.length >= 51, `county editions from 1924: ${ced.length}`);
  for (const m of ced) {
    assert.notEqual(m.placeholder, true, `${m.id} placeholder`);
    assert.ok(layerBySource.has(m.id), `${m.id} has a /test layer`);
  }
});
