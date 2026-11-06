// The Elliott & Flackes importer's rules (scripts/facts/import_elliott_flackes_facts.py and
// ef_offices.py): dates keep their precision, names match only with dates and a party or body,
// and office strings resolve to the catalogue or are reported as not modelled.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

function py(code) {
  const r = spawnSync('python', ['-c', `import sys, json\nsys.path.insert(0, 'scripts/facts')\n${code}`], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout.trim().split('\n').pop());
}

test('dates are parsed with their precision; qualified dates are not dates', () => {
  const out = py(`from import_elliott_flackes_facts import parse_date
print(json.dumps([parse_date(x) for x in ['1974', '1974-05', '1974-05-28', 'by 1974', '1975-76', '1999-13', None]]))`);
  assert.deepEqual(out, [
    ['1974', 'year', null], ['1974-05', 'month', null], ['1974-05-28', 'day', null],
    [null, null, 'by 1974'], [null, null, '1975-76'], [null, null, '1999-13'], [null, null, null],
  ]);
});

test('given names: nicknames and middle names match, a middle initial does not', () => {
  const out = py(`from import_elliott_flackes_facts import given_compatible, name_tokens
cases = [('James', 'Jim'), ('Robert Lloyd', 'Lloyd'), ('Ray', 'Ulick R'), ('R.', 'Robert'), ('Albert', 'Bertie'), ('John', 'Peter')]
print(json.dumps([given_compatible(name_tokens(a + ' X'), name_tokens(b + ' X')[:-1]) if False else given_compatible(name_tokens(a + ' X')[:-1], name_tokens(b + ' X')[:-1]) for a, b in cases]))`);
  assert.deepEqual(out, [true, true, false, true, true, false]);
});

test('Irish surnames written as two words are one token', () => {
  const out = py(`from import_elliott_flackes_facts import name_tokens
print(json.dumps([name_tokens('Tomas Mac Giolla'), name_tokens('Ruairi O Bradaigh'), name_tokens('Sir John Gorman')]))`);
  assert.deepEqual(out, [['tomas', 'macgiolla'], ['ruairi', 'obradaigh'], ['john', 'gorman']]);
});

test('office strings resolve to the catalogue, or are reported as not modelled', () => {
  const out = py(`import ef_offices as o
cases = [('Secretary of State for Northern Ireland', None, 1990), ('NIO minister responsible for Finance (Finance and Personnel from 1982) (direct rule)', None, 1985),
 ('Lord Mayor of Belfast', None, 1993), ('Mayor of Londonderry', None, 1975), ('Speaker, NI Assembly', None, 1983), ('Speaker, NI Assembly', None, None),
 ('Life peer (House of Lords)', None, 1996), ('Senator, Seanad Eireann', None, 1980), ('Minister of Home Affairs (NI Government)', None, 1969),
 ('Head, Department of Agriculture (NI Executive)', None, 1974)]
res = [list(o.match(a, b, c)) for a, b, c in cases]
res.append(list(o.match_party_office('Deputy leader, Alliance Party', 'alliance')))
res.append(list(o.match_party_office('President of the Ulster Unionist Council', 'uup')))
print(json.dumps(res))`);
  assert.deepEqual(out.map((r) => r[0]), [
    'secretary-of-state-ni', 'nio-minister-finance', 'lord-mayor-belfast', 'mayor-derry', 'ni-assembly-1982-speaker', null,
    null, null, 'ni-minister-of-home-affairs', 'ni-executive-agriculture', 'alliance-deputy-leader', 'uuc-president',
  ]);
  assert.match(out[5][1], /no date/);
  assert.match(out[6][1], /honour or peerage/);
  assert.match(out[7][1], /membership of a body/);
});

test('a person is matched only with dates and a party or body, never on the name alone', () => {
  const out = py(`from import_elliott_flackes_facts import Parties, Persons
pp = Persons(Parties())
print(json.dumps([
  pp.match('David Trimble', 1995, {'uup'}, ()),
  pp.match('David Trimble', 1995, set(), ()),
  pp.match('David Trimble', 1890, {'uup'}, ()),
  pp.match('Brian Faulkner', 1971, set(), ['parliament-of-northern-ireland']),
]))`);
  assert.equal(out[0][0], 84615);
  assert.equal(out[1][0], null);
  assert.match(out[1][1], /name-only/);
  assert.equal(out[2][0], null);
  assert.equal(out[3][0], 54656);
});
