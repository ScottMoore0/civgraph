/**
 * The second tranche of the citations review (owner-approved 24 Nov 2026):
 *   S26  an exported map image carries the licence of the maps shown, not CC BY-SA 4.0 whatever
 *        they are (packages/core/src/licence-rights.mjs imageLicence);
 *   S08  a contest's Sources list its own citations, not those a Wikipedia article gave for the
 *        whole election (packages/api/src/queries OWN_CITATION), run over a small database;
 *   P07  catalogue and election descriptions carry their author, credited under them.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { imageLicence, licenceRights } from '@civgraph/core/licence-rights.mjs';
import { aboutHtml } from '@civgraph/map/catalogue/view-maps.js';

test('S26: the image licence follows the maps shown', () => {
  assert.equal(imageLicence(['CC BY 4.0', 'OGL v3.0'])?.name, 'CC BY 4.0');
  assert.equal(imageLicence(['Open Government Licence v3.0'])?.url, 'https://creativecommons.org/licenses/by/4.0/');
  assert.equal(imageLicence(['CC-BY-4.0', 'CC-BY-SA-4.0'])?.name, 'CC BY-SA 4.0', 'ShareAlike wins');
  assert.equal(imageLicence(['CC BY-SA 4.0', ''])?.name, 'CC BY-SA 4.0', 'ShareAlike wins even beside an unrecorded licence');
  assert.equal(imageLicence(['CC BY 4.0', '']), null, 'a map with no recorded licence: no licence claimed');
  assert.equal(imageLicence(['OGL and CC BY 4.0']), null, 'two licences in one text: none claimed');
  assert.equal(imageLicence([]), null);
  assert.equal(licenceRights('ODbL 1.0'), 'ODbL');
});

test('S08: a contest lists its own citations, not the whole-article ones', async () => {
  const { DatabaseSync } = await import('node:sqlite');
  const { ELECTIONS_API } = await import('@civgraph/api/queries/elections.js');
  const { ELECTION_PAGES } = await import('@civgraph/api/queries/pages.js');
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(`CREATE TABLE contests (election_key TEXT, seq INTEGER, name TEXT, source_file TEXT);
      CREATE TABLE candidacies (election_key TEXT, contest_seq INTEGER, person_id TEXT, ord INTEGER);
      CREATE TABLE citations (subject_type TEXT, subject_key TEXT, ord INTEGER, title TEXT, publisher TEXT, url TEXT,
        archive_url TEXT, host TEXT, kind TEXT, basis TEXT, checked INTEGER, scope TEXT, match TEXT, citation TEXT);
      INSERT INTO contests VALUES ('e1', 1, 'North Antrim', 'data/elections-source/data/elections/hoc/1992/north-antrim.json');
      INSERT INTO candidacies VALUES ('e1', 1, 'p1', 1);`);
    const add = db.prepare("INSERT INTO citations VALUES ('contest', 'hoc/1992/north-antrim.json', ?, ?, NULL, ?, NULL, NULL, NULL, NULL, ?, ?, NULL, '{}')");
    add.run(1, 'Westminster by-elections, 23 January 1986', 'https://example.org/fw86', 1, 'article');
    add.run(2, 'Westminster election, 9 April 1992', 'https://example.org/fw92', 1, 'this contest');
    add.run(3, 'Results by section', 'https://example.org/section', 0, 'same section');
    add.run(4, 'Imported from', 'https://example.org/import', 0, null);
    const titles = (/** @type {Record<string, unknown>[]} */ rows) => rows.map((r) => r['title']);
    const own = ['Westminster election, 9 April 1992', 'Results by section', 'Imported from'];
    assert.deepEqual(titles(db.prepare(ELECTIONS_API.contestCitations).all('e1', 1)), own);
    assert.deepEqual(titles(db.prepare(ELECTIONS_API.personCitations).all('p1')), own);
    assert.deepEqual(titles(db.prepare(ELECTION_PAGES.citations).all('hoc/1992/north-antrim.json')), own);
  } finally {
    db.close();
  }
});

test('P07: descriptions name their author, and the catalogue credits it under each', () => {
  const descriptions = JSON.parse(readFileSync(new URL('../../data/catalogue/descriptions.json', import.meta.url), 'utf8'));
  assert.equal(descriptions.author, 'Phelim Birch');
  assert.equal(descriptions.rows['census-itl-regions'], undefined, 'the ITL Regions text is removed');
  const html = aboutHtml({ text: ['A paragraph.'], by: 'Phelim Birch' });
  assert.match(html, /<p class="cn-about__by">Description: Phelim Birch<\/p><\/div>$/);
  assert.doesNotMatch(aboutHtml({ text: ['A paragraph.'] }), /Description:/);
});

test('S15: each downloadable map file gets a licence note beside it, and the downloads carry their terms', async () => {
  const { licenceNotes } = await import('../../scripts/build/build-map-licence-notes.mjs');
  const { downloadLicence, licenceText } = await import('@civgraph/loader/download-licence.mjs');
  const notes = licenceNotes([
    { id: 'a', name: 'Map A', slug: 'map-a', provider: ['OSNI'], licence: 'OGL v3.0', attribution: 'Contains public sector information.',
      references: [{ label: 'OSNI', url: 'https://example.org/a' }],
      files: { fgb: 'https://data.civgraph.net/data/maps/x/A%20file.fgb' },
      variants: [{ id: 'a-1', label: 'Part', files: { fgb: 'https://data.civgraph.net/data/maps/x/a1.fgb' } }] },
    { id: 'h', hidden: true, files: { fgb: 'https://data.civgraph.net/data/maps/x/h.fgb' } },
    { id: 'o', files: { fgb: 'https://elsewhere.example/o.fgb' } },
  ]);
  assert.deepEqual([...notes.keys()], ['data/maps/x/A file.fgb.LICENCE.txt', 'data/maps/x/a1.fgb.LICENCE.txt']);
  const note = /** @type {string} */ (notes.get('data/maps/x/A file.fgb.LICENCE.txt'));
  assert.match(note, /^Map A\nCivgraph map: https:\/\/civgraph\.net\/browse\/maps\/map-a\n/);
  assert.match(note, /Credit: OSNI\nLicence: Open Government Licence v3\.0 \(https:\/\/www\.nationalarchives\.gov\.uk/);
  assert.match(note, /Attribution: Contains public sector information\./);
  assert.match(note, /- OSNI: https:\/\/example\.org\/a/);
  assert.match(/** @type {string} */ (notes.get('data/maps/x/a1.fgb.LICENCE.txt')), /^Map A: Part\n/);
  const terms = downloadLicence('https://civgraph.net');
  assert.match(terms.licence, /CC BY 4\.0/);
  assert.match(terms.attribution, /Crediting Civgraph alone is not enough/);
  assert.match(licenceText('https://civgraph.net', 'the graph'), /^Civgraph: the graph\n\nLicence\n/);
});
