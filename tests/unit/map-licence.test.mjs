// A map's licence, attribution and source credits on its Browse page (citations review, 24 Nov
// 2026): buildMaps() in scripts/build/build-browse-indexes.mjs carries them through
// scripts/lib/map-licence.mjs, and site/browse/map-licence.js renders the "Licence and sources" block.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { LICENCE_PAGE, licenceDisplay, licenceRights, mapRights } from '../../scripts/lib/map-licence.mjs';
import { RIGHTS } from '../../scripts/build/build-licence-page.mjs';
import { mapLicenceRows, renderMapLicenceBlock } from '../../site/browse/map-licence.js';

const OGL_URL = 'https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/';
const CC_BY_URL = 'https://creativecommons.org/licenses/by/4.0/';

test('each spelling of a licence in the catalogue finds its section of the Licence page', () => {
  for (const [text, rights] of /** @type {[string, string | null][]} */ ([
    ['CC-BY-4.0', 'CC-BY-4.0'], ['CC BY 4.0', 'CC-BY-4.0'], ['Creative Commons Attribution 4.0', 'CC-BY-4.0'],
    ['CC-BY-SA-4.0', 'CC-BY-SA'], ['CC BY-SA 4.0', 'CC-BY-SA'],
    ['OGL v3.0', 'OGL-3.0'], ['Open Government Licence v3.0', 'OGL-3.0'],
    ['CC0 1.0', 'CC0'], ['ODbL', 'ODbL'],
    ['Derived model; source DoBIH data CC BY 4.0', 'CC-BY-4.0'],
    ['CC BY-NC 4.0', null],
    ['OGL v3.0 and CC BY 4.0', null],
    ['Not specified', null],
  ])) assert.equal(licenceRights(text), rights, text);
});

test('a licence is shown by its usual name, with its terms and its Licence page section', () => {
  assert.deepEqual(licenceDisplay('CC-BY-4.0'), { name: 'CC BY 4.0', url: CC_BY_URL, page: '/pages/licence#rights-cc-by-4.0' });
  assert.deepEqual(licenceDisplay('OGL v3.0'), { name: 'Open Government Licence v3.0', url: OGL_URL, page: '/pages/licence#rights-ogl-3.0' });
  assert.deepEqual(licenceDisplay('CC-BY-SA-4.0', 'https://creativecommons.org/licenses/by-sa/4.0/'),
    { name: 'CC BY-SA 4.0', url: 'https://creativecommons.org/licenses/by-sa/4.0/', page: '/pages/licence#rights-cc-by-sa' });
  // A sentence keeps its words; a licence the page has no section for points at the sources list.
  assert.deepEqual(licenceDisplay('Derived model; source DoBIH data CC BY 4.0'),
    { name: 'Derived model; source DoBIH data CC BY 4.0', url: CC_BY_URL, page: '/pages/licence#rights-cc-by-4.0' });
  assert.deepEqual(licenceDisplay('Some other terms'), { name: 'Some other terms', page: '/pages/licence#sources' });
  assert.equal(licenceDisplay(''), null);
  assert.equal(licenceDisplay(undefined), null);
  // The map's own link to the terms wins, and only a web address is kept.
  assert.equal(licenceDisplay('OGL v3.0', 'https://example.org/terms')?.url, 'https://example.org/terms');
  assert.equal(licenceDisplay('Some other terms', 'javascript:alert(1)')?.url, undefined);
});

test('every Licence page section a map can point at exists on the page', () => {
  const page = readFileSync('site/pages/licence.html', 'utf8');
  for (const rights of ['CC-BY-4.0', 'CC-BY-SA', 'OGL-3.0', 'OPL-3.0', 'CC0', 'ODbL']) {
    assert.ok(rights in RIGHTS, `${rights} is a ledger rights value`);
    assert.match(page, new RegExp(`id="rights-${rights.toLowerCase().replace(/\./g, '\\.')}"`), `${rights}: no section on the Licence page`);
  }
  assert.match(page, /<section id="sources">/);
  assert.equal(LICENCE_PAGE, '/pages/licence');
});

test('mapRights reads both spellings of each key, and the attribution and source credits', () => {
  assert.deepEqual(mapRights({
    licence: 'CC-BY-4.0', licenceUrl: CC_BY_URL, licenceNote: ' Built for  Civgraph. ',
    attribution: 'Contains Tailte Éireann data.', sourceCredits: ['Tailte Éireann', 'OSNI', 'Tailte Éireann', ''],
  }), {
    licence: { name: 'CC BY 4.0', url: CC_BY_URL, page: '/pages/licence#rights-cc-by-4.0' },
    licenceNote: 'Built for Civgraph.',
    attribution: 'Contains Tailte Éireann data.',
    sourceCredits: ['Tailte Éireann', 'OSNI'],
  });
  assert.deepEqual(mapRights({ license: 'Open Government Licence v3.0', licenseUrl: OGL_URL, licenseNote: 'n' }).licence,
    { name: 'Open Government Licence v3.0', url: OGL_URL, page: '/pages/licence#rights-ogl-3.0' });
  assert.equal(mapRights({ license: 'x', licenseNote: 'n' }).licenceNote, 'n');
  assert.deepEqual(mapRights({ sourceCredits: 'One body' }).sourceCredits, ['One body']);
  assert.deepEqual(mapRights({}), { licence: null, licenceNote: null, attribution: null, sourceCredits: [] });
});

test('every licence in the catalogue is shown, and the common ones link a Licence page section', () => {
  const { maps } = JSON.parse(readFileSync('data/database/maps.json', 'utf8'));
  let withLicence = 0;
  for (const map of maps) {
    const raw = map.licence ?? map.license;
    if (!raw) continue;
    withLicence += 1;
    const { licence } = mapRights(map);
    assert.ok(licence?.name, `${map.id}: licence ${raw} not shown`);
    assert.match(licence.page, /^\/pages\/licence#(rights-[a-z0-9.-]+|sources)$/, `${map.id}: ${licence.page}`);
    if (/^(CC[- ]BY|OGL|Open Government|CC0)/i.test(raw)) assert.match(licence.page, /#rights-/, `${map.id}: ${raw} should link its section`);
  }
  assert.ok(withLicence > 200, `only ${withLicence} maps name a licence`);
});

test('the Browse block: credit, licence linked to the Licence page and its terms, attribution, sources', () => {
  const rows = mapLicenceRows({
    provider: ['OSNI', 'Scott Moore'],
    licence: { name: 'Open Government Licence v3.0', url: OGL_URL, page: '/pages/licence#rights-ogl-3.0' },
    licenceNote: 'Note <b>',
    attribution: 'Contains public sector information licensed under the Open Government Licence v3.0.',
    sourceCredits: ['OSNI six-inch maps', 'PRONI'],
  });
  assert.deepEqual(rows.map(([label]) => label), ['Credit', 'Licence', 'Licence note', 'Attribution', 'Sources']);
  assert.equal(rows[0]?.[1], 'OSNI, Scott Moore');
  assert.equal(rows[1]?.[1], `<a href="/pages/licence#rights-ogl-3.0">Open Government Licence v3.0</a> (<a href="${OGL_URL}" target="_blank" rel="noopener noreferrer">licence terms</a>)`);
  assert.equal(rows[2]?.[1], 'Note &lt;b&gt;');
  assert.equal(rows[4]?.[1], 'OSNI six-inch maps; PRONI');
});

test('the Browse block: a map with no licence points at the Licence page; nothing unsafe is linked', () => {
  assert.deepEqual(mapLicenceRows({}), [['Licence', '<a href="/pages/licence">Not recorded for this map: see the Licence page</a>']]);
  const [, html] = /** @type {[string, string]} */ (mapLicenceRows({ licence: { name: 'X', url: 'javascript:alert(1)', page: '//evil.example/' } })[0]);
  assert.equal(html, '<a href="/pages/licence">X</a>');
  const block = renderMapLicenceBlock({ provider: 'Phelim Birch' });
  assert.match(block, /<h2 id="browse-map-licence-title">Licence and sources<\/h2>/);
  assert.match(block, /<dt>Credit<\/dt><dd>Phelim Birch<\/dd>/);
});
