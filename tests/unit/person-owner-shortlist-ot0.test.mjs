// The 12 Nov 2026 owner-shortlist rows of people the owner approved on 13 Nov 2026 (OT0), as they
// stand in the committed person registry: council careers the name alone had joined across
// councils and decades keep the identity keys data/elections/persons/label-blanked-identity-keys.csv
// gives each piece, the ids split only by an abbreviated name are one person (the lowest id kept,
// the other redirecting through person_id_confirmed_merges.csv), and the names settled for E5 and
// E14 are on file where a rebuild keeps them.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const at = (file) => new URL(`../../data/elections/persons/${file}`, import.meta.url);
const { entities } = JSON.parse(readFileSync(at('person_registry.json'), 'utf8'));
const byId = new Map(entities.map((e) => [e.personId, e]));
/** @param {string} key */
const holders = (key) => entities.filter((e) => (e.sourceIds || []).includes(key)).map((e) => e.personId);
/** @param {string} key */
const holder = (key) => {
  const h = holders(key);
  assert.equal(h.length, 1, `${key} is held by ${h.length} people (${h.join(', ')})`);
  return h[0];
};

test('OT0-01 the name-joined council careers are split by council (C4-C10)', () => {
  // [the person's own key, its id, candidacies left, [the keys of the other pieces, with their candidacies]]
  const splits = [
    ['James Campbell|', 135337, 6, [['clogher-augher-1899', 1], ['lurgan-montiaghs-1911-1939', 5], ['bangor-1912-1937', 2], ['newry-1-drumgath-1967', 1]]],
    ['William Campbell|', 142799, 4, [['clogher-augher-1908', 1], ['antrim-cc-killoquin-1967', 1]]],
    ['William Porter|', 142881, 2, [['clogher-aughentaine-1908', 1], ['lisburn-rural-malone-1939-1949', 2], ['newcastle-1964', 1]]],
    ['Patrick Hughes|', 144657, 2, [['lisnaskea-kulmore-1955', 1], ['dungannon-meenagh-1958', 1]]],
    ['John Porter|', 146350, 1, [['banbridge-loughbrickland-1952', 1]]],
    ['Robert Jones|', 137430, 2, [['lurgan-carrowbrack-1964', 1]]],
    ['John Smith|', 137081, 2, [['clogher-cecil-1908', 1], ['newry-2-forkhill-1911', 1], ['newcastle-1929', 1]]],
  ];
  for (const [key, id, left, pieces] of splits) {
    assert.equal(holder(key), id, key);
    assert.equal(byId.get(id).candidacies, left, `${id} candidacies`);
    const ids = new Set([id]);
    for (const [suffix, n] of pieces) {
      const piece = holder(`${key}${suffix}`);
      ids.add(piece);
      assert.equal(byId.get(piece).candidacies, n, `${key}${suffix} candidacies`);
    }
    assert.equal(ids.size, pieces.length + 1, `${key}: every piece is its own person`);
  }
});

test('OT0-02 the ids split only by an abbreviated name are one person, the lowest id kept (A11, A14-A16)', () => {
  const merged = [
    [139837, ["Herbert B. M'Nally|", "Herbert C. B. M'Nally|"], 139838],
    [136339, ['Alfred Gilpin|', 'A. Gilpin|'], 143964],
    [144746, ['T. C. Stevenson|', 'Thos. C. Stevenson|'], 150340],
    [145916, ['J. C. G. McQuoid|', 'John C. G. McQuoid|'], 150320],
    [144225, ['R. Malcomson|', 'Robt. Malcomson|'], 150329],
    [144152, ['G. McCartney|', 'Geo. E. McCartney|'], 150304],
    [144030, ['C. J. Phillips|', 'Chas. J. Phillips|'], 150295],
    [150318, ['James B. Caughey|', 'James B. Caughey|Independent'], 150319],
    [140172, ["William M'Dowell|", "W. M'Dowell|"], 145192],
  ];
  const lines = readFileSync(at('person_id_confirmed_merges.csv'), 'utf8').split('\n').filter(Boolean);
  const drops = new Map(lines.slice(1).map((l) => l.split(',')).map(([keep, drop]) => [drop, keep]));
  for (const [keep, keys, drop] of merged) {
    for (const key of keys) assert.equal(holder(key), keep, key);
    assert.ok(!byId.has(drop), `${drop} is still a live person`);
    assert.equal(drops.get(String(drop)), String(keep), `${drop} -> ${keep}`);
  }
  // The Gilford Town Commissioners row of 1946 is not the Ardkeen councillor.
  assert.notEqual(holder("William M'Dowell|gilford-1946"), 140172);
});

test('OT0-03 A. McConnell (Cookstown) and F. McConnell (Plumbridge), Tyrone CC 1967, are two people (B8)', () => {
  // persons-13 (MG-D) gave the Cookstown man's rows, this one among them, the declared key
  // "Alex. M'Connell|UUP" (label-blanked-identity-keys.csv), so he is found by that key.
  assert.notEqual(holder("Alex. M'Connell|UUP"), holder('F. McConnell|'));
});

test('OT0-04 Séimi Ó Dubhthaigh is also found as Jimmy Duffy, the results book\'s form (E5)', () => {
  const doc = JSON.parse(readFileSync(at('reference-names.json'), 'utf8'));
  assert.deepEqual((doc.people['128790'] || []).map((e) => [e.name, e.source]), [['Jimmy Duffy', 'ie-local-results-2024']]);
  assert.ok(doc.sources['ie-local-results-2024']);
  assert.equal(byId.get(128790).displayName, 'Séimi Ó Dubhthaigh');
  // The builder writes it too, so a rebuild of reference-names.json keeps it.
  const src = readFileSync(new URL('../../scripts/ingest/gazette-spn/build_reference_names.py', import.meta.url), 'utf8');
  assert.match(src, /\('128790', 'Jimmy Duffy', 'Séimi Ó Dubhthaigh', 'ie-local-results-2024',/);
});

test('OT0-05 the Mayo 2024 Dáil row reads Keira Keogh, on her own person (E14)', () => {
  const fixes = JSON.parse(readFileSync(new URL('../../data/elections/corrections/source-checked-fixes.json', import.meta.url), 'utf8'));
  const ops = fixes.records
    .filter((r) => r.sourceFile === 'data/elections-source/data/elections/dail-eireann/2024-11-29/mayo.json')
    .flatMap((r) => r.operations || []);
  assert.ok(ops.some((op) => op.op === 'candidate' && op.name === 'Kiera Keogh' && op.set?.candidateName === 'Keira Keogh'));
  const keogh = byId.get(109841);
  assert.ok((keogh.sourcePersonIds || []).includes('ei:12167'));
  assert.equal(keogh.displayName, 'Keira Keogh');
});
