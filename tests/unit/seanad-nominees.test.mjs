// The senators nominated by the Taoiseach and, in 1922, by the President of the Executive Council
// (stream seanad-3b): tenures of data/offices/tenures/seanad.json, written by
// scripts/ingest/seanad/build_seanad_nominees.py. Each nominee is joined by Oireachtas member code,
// else by a checked row of seanad-nominee-checks.csv, else registered as a non-candidate; never by
// name alone.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const at = (/** @type {string} */ file) => new URL(`../../${file}`, import.meta.url);
const json = (/** @type {string} */ file) => JSON.parse(readFileSync(at(file), 'utf8'));
const { tenures } = json('data/offices/tenures/seanad.json');
const { offices } = json('data/offices/offices.json');
const { entities } = json('data/elections/persons/person_registry.json');
const { persons: registered } = json('data/elections/persons/non-candidate-persons.json');
const byId = new Map(entities.map((/** @type {{ personId: number | string }} */ e) => [String(e.personId), e]));
const checks = readFileSync(at('data/elections/persons/seanad-nominee-checks.csv'), 'utf8').split('\n').slice(1).filter(Boolean)
  .map((line) => line.split(','));

test('SN-01 every tenure names an office of Seanad Éireann and a person of the registry', () => {
  const ids = new Set(offices.filter((/** @type {{ institution: string }} */ o) => o.institution === 'seanad-eireann').map((/** @type {{ id: string }} */ o) => o.id));
  assert.deepEqual([...ids].sort(), ['seanad-free-state-nominee', 'seanad-taoiseach-nominee']);
  for (const t of tenures) {
    assert.ok(ids.has(t.officeId), t.id);
    assert.ok(byId.has(String(t.personId)), `${t.id}: person ${t.personId} is not in the registry`);
    assert.equal(t.began, 'appointed');
    assert.ok(!t.end || t.end >= t.start, t.id);
  }
});

test('SN-02 the Taoiseach nominees span 1938 to the present; the 1922 nominees are thirty, for six or twelve years', () => {
  const taoiseach = tenures.filter((/** @type {{ officeId: string }} */ t) => t.officeId === 'seanad-taoiseach-nominee');
  const president = tenures.filter((/** @type {{ officeId: string }} */ t) => t.officeId === 'seanad-free-state-nominee');
  assert.ok(taoiseach.length >= 320, `${taoiseach.length} Taoiseach nominee tenures`);
  assert.equal(taoiseach.reduce((a, /** @type {{ start: string }} */ t) => (a < t.start ? a : t.start), '9999'), '1938-04-27');
  assert.equal(president.length, 30);
  for (const t of president) {
    assert.equal(t.start, '1922-12-06');
    assert.ok(t.end <= '1934-12-05', t.id);
  }
});

test('SN-03 a held-back nominee has no tenure, and a joined one is the person the check names or the member code holds', () => {
  const holders = new Map();
  for (const t of tenures) holders.set(t.citations[0].url, String(t.personId));
  for (const [code, , verdict, personId] of checks) {
    const url = [...holders.keys()].find((u) => decodeURIComponent(u).includes(`/member/${code}/`));
    const byCode = entities.find((/** @type {{ officialPersonIds?: string[], keyedBy?: string }} */ e) => e.keyedBy !== 'registered' && (e.officialPersonIds || []).includes(`oireachtas:${code}`));
    // a held-back nominee whose member code a candidate record now holds is joined by that code
    if (verdict === 'hold') assert.ok(url === undefined || (byCode && holders.get(url) === String(byCode.personId)), `${code} is held back but has a tenure`);
    if (verdict === 'join' && url) {
      const held = holders.get(url);
      assert.ok(held === personId || (byCode && String(byCode.personId) === held), `${code}: tenure holder ${held}, check ${personId}`);
    }
  }
});

test('SN-04 a registered nominee is in the non-candidate block and holds the member code no candidate holds', () => {
  const candidateCodes = new Set(entities.filter((/** @type {{ keyedBy?: string }} */ e) => e.keyedBy !== 'registered')
    .flatMap((/** @type {{ officialPersonIds?: string[] }} */ e) => e.officialPersonIds || []).filter((/** @type {string} */ o) => o.startsWith('oireachtas:')));
  const nominees = registered.filter((/** @type {{ basis: string[] }} */ p) => p.basis.some((b) => b.startsWith('seanad-')));
  assert.ok(nominees.length > 0);
  for (const p of nominees) {
    assert.ok(Number(p.personId) >= 900001, p.personId);
    const codes = p.officialPersonIds.filter((/** @type {string} */ o) => o.startsWith('oireachtas:'));
    assert.equal(codes.length, 1, p.personId);
    assert.ok(!candidateCodes.has(codes[0]), `${p.personId} shares ${codes[0]} with a candidate`);
    assert.ok(tenures.some((/** @type {{ personId: string }} */ t) => String(t.personId) === p.personId), `${p.personId} holds no tenure`);
  }
});
