// Batch 4b: party-label readings that depend on where a contest was held, and the Lurgan and
// Portadown result files of 1947-67.
//
// A bare "Labour" means the Irish Labour Party in the Dail (normalizeParty turns the string into
// "Irish Labour"), but in a Northern Ireland council it is the NILP from 1924, a town Labour list
// with no party named before that, and Irish Labour only where the paper or the context says so.
// The rules that read it are confined to the "ni" region of data/elections/party-label-interpretations.json,
// so no Dail or Republic contest's reading changes; the tests below prove it on every source file.
//
//   node --test tests/elections/party-label-regions.test.mjs
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { normalizeParty, partyColour } from '../../src/election-domain.mjs';
import { createPartyLabelInterpreter } from '../../scripts/lib/party-label-interpretations.mjs';
import { seatTypeResultFile } from '../../scripts/lib/election-result-files.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const config = JSON.parse(readFileSync(path.join(root, 'data/elections/party-label-interpretations.json'), 'utf8'));
const interpreter = createPartyLabelInterpreter(config);
const ELECTIONS = path.join(root, 'data/elections-source/data/elections');
const registry = JSON.parse(readFileSync(path.join(root, 'data/elections/parties/party_registry.json'), 'utf8'));

function contest(rows) {
  return {
    Constituency: {
      countInfo: { Constituency_Name: 'Test Ward', Number_Of_Seats: '1' },
      countGroup: rows.map((row, index) => ({
        Candidate_Id: '',
        Count_Number: '1',
        Firstname: row.first || 'A.',
        Surname: row.surname,
        candidateName: `${row.first || 'A.'} ${row.surname}`,
        Party_Name: row.party || '',
        Party_As_Printed: row.printed ?? '',
        Total_Votes: String(100 - index),
        Status: 'Not Elected',
        id: index
      }))
    }
  };
}

/** The reading one candidate gets in a body on a date. */
function readAs(body, date, row) {
  const raw = contest([{ surname: 'Test', ...row }]);
  interpreter.apply({ body, date }, raw);
  return raw.Constituency.countGroup[0].Party_Name;
}

function walk(dir, files = []) {
  for (const name of readdirSync(dir)) {
    const file = path.join(dir, name);
    if (statSync(file).isDirectory()) walk(file, files);
    else if (name.endsWith('.json') && !name.startsWith('_')) files.push(file);
  }
  return files;
}

test('every election body is placed inside or outside Northern Ireland, once', () => {
  const ni = new Set(config.regions.ni.bodies);
  const notNi = new Set(config.regions.notNi.bodies);
  for (const body of readdirSync(ELECTIONS)) {
    if (!statSync(path.join(ELECTIONS, body)).isDirectory()) continue;
    assert.ok(ni.has(body) !== notNi.has(body), `${body} must be in exactly one of regions.ni and regions.notNi`);
  }
  for (const body of ['dail-eireann', 'ireland-local', 'ireland-european', 'ireland-president', 'house-of-commons-of-the-united-kingdom']) {
    assert.ok(!ni.has(body), `${body} is not a Northern Ireland body`);
  }
});

test('no Dail, Republic or House of Commons contest changes its reading: a bare Labour there stays Irish Labour', () => {
  const outside = config.regions.notNi.bodies;
  let rows = 0;
  let labour = 0;
  for (const body of outside) {
    const dir = path.join(ELECTIONS, body);
    let exists = true;
    try { statSync(dir); } catch { exists = false; }
    if (!exists) continue;
    for (const file of walk(dir)) {
      let raw;
      try { raw = JSON.parse(readFileSync(file, 'utf8')); } catch { continue; }
      const date = path.relative(dir, file).split(path.sep)[0];
      const before = JSON.stringify(raw);
      for (const row of [...(raw?.Constituency?.countGroup || []), ...(Array.isArray(raw?.candidates) ? raw.candidates : [])]) {
        rows += 1;
        if (/^labour$/i.test(String(row?.Party_Name ?? row?.party ?? '').trim())) labour += 1;
      }
      interpreter.apply({ body, date }, raw);
      assert.equal(JSON.stringify(raw), before, `the party-label rules changed ${path.relative(ELECTIONS, file)}`);
    }
  }
  assert.ok(rows > 10000, `read the Republic's contests (${rows} rows)`);
  assert.ok(labour > 400, `including their bare Labour rows (${labour})`);
  assert.equal(normalizeParty('Labour'), 'Irish Labour', 'the Dail convention is unchanged');
  assert.equal(readAs('dail-eireann', '1927-06-09', { party: 'Labour' }), 'Labour');
  assert.equal(readAs('ireland-local', '1999-06-11', { party: 'Labour' }), 'Labour');
  assert.equal(readAs('house-of-commons-of-the-united-kingdom', '1915-06-11', { party: 'Labour' }), 'Labour');
});

test('a bare Labour in a Northern Ireland contest is read by place and date', () => {
  // Before the NILP (March 1924): Labour with no party named.
  assert.equal(readAs('lurgan-borough-council', '1900-01-15', { party: 'Labour' }), 'Local Labour');
  assert.equal(readAs('strabane-urban-district-council', '1923-01-05', { party: 'Labour', printed: 'Lab' }), 'Local Labour');
  // Belfast, January 1923: the Labour Party nominated no one officially (News-Letter, 6 Jan 1923).
  assert.equal(readAs('belfast-county-borough-council', '1923-01-15', { party: 'Labour', printed: 'Lab.' }), 'Local Labour');
  assert.equal(readAs('belfast-county-borough-council', '1923-01-15', { printed: 'Engineers' }), 'Local Labour');
  // Belfast 1920: the NAUL's nominees, printed apart from the Belfast Labour Party.
  assert.equal(readAs('belfast-county-borough-council', '1920-01-15', { party: 'Labour', printed: 'N.A.U.L.' }), 'National Amalgamated Union of Labour');
  // From 1924: the NILP, unless the paper printed Irish Labour or the context shows it.
  assert.equal(readAs('strabane-urban-district-council', '1946', { party: 'Labour', printed: 'Lab' }), 'NI Labour');
  assert.equal(readAs('portadown-borough-council', '1967-05-17', { party: 'Labour', printed: 'L' }), 'NI Labour');
  assert.equal(readAs('armagh-urban-district-council', '1946-09-18', { party: 'Labour', printed: 'do.' }), 'NI Labour');
  assert.equal(readAs('armagh-county-council', '1949-06-02', { party: 'Labour', printed: 'Irish Labour' }), 'Irish Labour');
  assert.equal(readAs('warrenpoint-urban-district-council', '1955-05-18', { party: 'Labour', printed: 'E.L.' }), 'Irish Labour');
  assert.equal(readAs('newry-no-2-rural-district-council', '1952-06-05', { first: 'Patrick', surname: 'McEnteggart', party: 'Labour' }), 'Irish Labour');
  assert.equal(readAs('lurgan-borough-council', '1949-06-15', { party: 'Labour', printed: 'L' }), 'Local Labour');
  assert.equal(readAs('armagh-urban-district-council', '1961-05-17', { party: 'Labour', printed: 'Independent Trade Unionist' }), 'Independent Labour');
  // A reading already given (Newry 1946's NI Labour) is left alone.
  assert.equal(readAs('newry-urban-district-council', '1946-09-18', { party: 'NI Labour', printed: 'Labour' }), 'NI Labour');
});

test('no Northern Ireland source row is left reading a bare Labour', () => {
  const leftovers = [];
  for (const body of config.regions.ni.bodies) {
    const dir = path.join(ELECTIONS, body);
    try { statSync(dir); } catch { continue; }
    for (const file of walk(dir)) {
      let raw;
      try { raw = JSON.parse(readFileSync(file, 'utf8')); } catch { continue; }
      interpreter.apply({ body, date: path.relative(dir, file).split(path.sep)[0] }, raw);
      for (const row of [...(raw?.Constituency?.countGroup || []), ...(Array.isArray(raw?.candidates) ? raw.candidates : [])]) {
        if (/^labour$/i.test(String(row?.Party_Name ?? row?.party ?? '').trim())) leftovers.push(path.relative(ELECTIONS, file));
      }
    }
  }
  assert.deepEqual([...new Set(leftovers)], [], 'every bare Labour in Northern Ireland has a reading');
});

test('the Belfast Socialists of 1925-31 are the NILP, and the Socialist page keeps only the Republic label', () => {
  for (const printed of ['Soc.', 'Soc', 'Socialist']) {
    assert.equal(readAs('belfast-county-borough-council', '1927-01-15', { printed }), 'NI Labour');
  }
  assert.equal(readAs('belfast-county-borough-council-aldermen', '1926-01-15', { printed: 'Socialist' }), 'NI Labour');
  const socialist = registry.entities.find((entity) => entity.id === 'socialist');
  assert.ok(socialist, 'the Socialist entity is kept');
  assert.deepEqual(Object.keys(socialist.observed?.bodies || {}).sort(), ['dail-eireann', 'ireland-european']);
});

test('ex-servicemen have a label of their own; only a printed Legion is British Legion', () => {
  assert.equal(readAs('limavady-urban-district-council', '1946-09-18', { printed: 'Ex-Servicemen' }), 'Ex-servicemen');
  assert.equal(readAs('portadown-borough-council', '1952-05-21', { printed: 'Ex-Ser.' }), 'Ex-servicemen');
  assert.equal(readAs('kilkeel-urban-district-council', '1946-09-18', { printed: 'Brit. Lgn.' }), 'British Legion');
  assert.equal(readAs('coleraine-borough-council', '1929-01-15', { printed: 'British Legion' }), 'British Legion');
});

test('Newry I.C.A. is the Irish Citizen Association; Lurgan I.C.A. stays the Independent Citizens\' Association', () => {
  assert.equal(readAs('newry-urban-district-council', '1955-05-18', { printed: 'I.C.A.' }), 'Irish Citizen Association');
  assert.equal(readAs('newry-urban-district-council', '1946-09-18', { printed: 'I.C.A.' }), 'Irish Citizen Association');
  assert.equal(readAs('lurgan-borough-council', '1964-05-20', { printed: 'I.C.A.', party: "Independent Citizens' Association" }), "Independent Citizens' Association");
  assert.equal(readAs('belfast-county-borough-council', '1923-01-15', { printed: 'Orange' }), 'Independent Unionist');
  assert.equal(readAs('belfast-county-borough-council-aldermen', '1946-09-18', { printed: 'Workers' }), '', 'unresolved: No label');
});

test('each new reading has a registry entry, a colour of its own and survives normalizeParty', () => {
  const names = new Set(registry.entities.map((entity) => entity.name));
  for (const party of ['Local Labour', 'National Amalgamated Union of Labour', 'Ex-servicemen', 'Irish Citizen Association', "Independent Citizens' Association"]) {
    assert.ok(names.has(party), `${party} is in the party registry`);
    assert.equal(normalizeParty(party), party, `${party} is not folded into another party`);
    assert.notEqual(partyColour(party, 'none'), 'none', `${party} has a colour`);
  }
  assert.notEqual(partyColour('Local Labour'), partyColour('Irish Labour'));
});

test('a seat-type bracket names the result file: Portadown (councillors) is councillors.json', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'seat-type-'));
  try {
    writeFileSync(path.join(dir, 'councillors.json'), '{}');
    writeFileSync(path.join(dir, 'portadown.json'), '{}');
    assert.equal(seatTypeResultFile(dir, 'Portadown (councillors)'), path.join(dir, 'councillors.json'));
    assert.equal(seatTypeResultFile(dir, 'Portadown (aldermen)'), null, 'no aldermen.json, no match');
    assert.equal(seatTypeResultFile(dir, 'Athlone (Roscommon)'), null, 'only a seat type counts');
    assert.equal(seatTypeResultFile(dir, 'Portadown'), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('every Lurgan and Portadown result of 1947-67 in the election index finds a file with candidates', () => {
  const index = JSON.parse(readFileSync(path.join(root, 'data/elections-source/data/elections_index.json'), 'utf8'));
  let checked = 0;
  for (const body of index.bodies) {
    for (const entry of body.dates || []) {
      for (const constituency of entry.constituencies || []) {
        // Bangor's "Ballyholme Ward (Councillors)" and the like are filed under their ward names.
        if (!/^(Lurgan|Portadown) \((aldermen|councillors)\)$/.test(constituency)) continue;
        const file = seatTypeResultFile(path.join(ELECTIONS, body.slug, entry.date), constituency);
        assert.ok(file, `${body.slug} ${entry.date} ${constituency} has a result file`);
        const raw = JSON.parse(readFileSync(file, 'utf8'));
        assert.ok((raw.Constituency?.countGroup || raw.candidates || []).length > 0, `${file} has candidates`);
        checked += 1;
      }
    }
  }
  assert.equal(checked, 23, 'the 23 split-list results (Lurgan 11, Portadown 12)');
});
