// The Independent QUB Catalogue's pure modules (27 Nov 2026): the request parsing and FTS match
// text the endpoints share (packages/api/src/handlers/qub/_query.js), the app's URL state, its
// markup and its state machines (site/apps/qub-catalogue/).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildFilters, buildMatch, isMmsId, qubRecordUrl, readParams, tagList } from '@civgraph/api/handlers/qub/_query.js';
import { mmsIdFromPath, recordHead } from '@civgraph/api/handlers/qub/page.js';
import { readDetail, sharedSource } from '@civgraph/api/handlers/qub/record.js';
import { parseRoute, searchQuery, recordPath } from '../../site/apps/qub-catalogue/url-state.js';
import { catalogueLinks, qubRecordLink, recordHtml, recordMissing, resultCard, summaryLine } from '../../site/apps/qub-catalogue/views.js';
import { RESULTS, VIEW } from '../../site/apps/qub-catalogue/state-machines.js';

test('readParams: scope defaults to in; tags, sort and limits are clamped', () => {
  const p = readParams(new URLSearchParams('tag=g,b,z,B&limit=500&offset=-3&sort=bogus&from=abc&to=1922'));
  assert.equal(p.scope, 'in');
  assert.deepEqual(p.tags, ['B', 'G']);
  assert.equal(p.limit, 60);
  assert.equal(p.offset, 0);
  assert.equal(p.sort, 'relevance');
  assert.equal(p.from, null);
  assert.equal(p.to, 1922);
  assert.equal(readParams(new URLSearchParams('scope=all')).scope, 'all');
});

test('buildMatch: phrases, fields, negatives, prefix, scope and tag facets', () => {
  assert.equal(buildMatch({ q: '', scope: 'all', tags: [] }), null);
  assert.equal(buildMatch({ q: '', scope: 'in', tags: [] }), 'facets:scopein');
  assert.equal(buildMatch({ q: 'home rul', scope: 'in', tags: ['A'] }),
    '{title author subjects notes}:"home" AND {title author subjects notes}:"rul"* AND facets:scopein AND facets:taga');
  assert.equal(buildMatch({ q: 'title:"poor law" -dublin', scope: 'all', tags: [] }),
    'title:"poor law" NOT {title author subjects notes}:"dublin"');
  // quotes and FTS operators in the text never reach the match unbalanced
  const odd = String(buildMatch({ q: 'x"); DROP (a OR b) NEAR*', scope: 'all', tags: [] }));
  assert.equal((odd.match(/"/g) || []).length % 2, 0);
  assert.doesNotMatch(odd, /[()]/);
  // an unknown field is searched as text, never passed through as a column
  assert.equal(buildMatch({ q: 'rowid:5', scope: 'all', tags: [] }), '{title author subjects notes}:"rowid 5"');
});

test('buildFilters and helpers', () => {
  assert.deepEqual(buildFilters({ from: 1800, to: null }), { where: ['q.year >= ?'], binds: [1800] });
  assert.equal(isMmsId('991003809249708046'), true);
  assert.equal(isMmsId('12345'), false);
  assert.deepEqual(tagList('AGZ'), ['A', 'G']);
  assert.equal(qubRecordUrl('991003809249708046'),
    'https://qub.primo.exlibrisgroup.com/discovery/fulldisplay?docid=alma991003809249708046&context=L&vid=44QSUB_INST%3AQUB&lang=en');
});

test('page helpers: the id from the path, the record head', () => {
  assert.equal(mmsIdFromPath('/qub'), '');
  assert.equal(mmsIdFromPath('/qub/'), '');
  assert.equal(mmsIdFromPath('/qub/991003809249708046'), '991003809249708046');
  assert.equal(mmsIdFromPath('/proni/x'), null);
  const head = recordHead({ title: 'Thom’s directory', author: 'Thom', imprint: 'Dublin, 1850' });
  assert.equal(head.title, 'Thom’s directory – QUB catalogue record – Civgraph');
  assert.match(head.description, /^Thom.s directory\. Thom\. Dublin, 1850\./);
});

test('readDetail drops fields of the wrong shape; sharedSource reads OCLC numbers', () => {
  const d = readDetail('{"extent":"3 v.","series":["S",5],"holdings":[{"library":"L","call":"C"},null],"online":[{"url":"javascript:x"},{"url":"https://a.b/c"}],"oclc":[]}');
  assert.equal(d.extent, '3 v.');
  assert.deepEqual(d.series, ['S']);
  assert.deepEqual(d.holdings, [{ library: 'L', location: '', callNumber: 'C', availability: '' }]);
  assert.deepEqual(d.online, [{ label: '', url: 'https://a.b/c' }]);
  assert.equal(sharedSource(d), false);
  assert.equal(sharedSource(readDetail('{"oclc":["(OCoLC)1"]}')), true);
  assert.equal(readDetail('not json').extent, '');
});

test('URL state round-trips, defaults left out', () => {
  const r = parseRoute('/qub', '?q=poor+law&scope=all&tag=g,a,x&from=1838&sort=year&dir=desc');
  assert.equal(r.view, 'search');
  assert.deepEqual(r.search, { q: 'poor law', scope: 'all', tags: ['A', 'G'], from: '1838', to: '', sort: 'year', dir: 'desc' });
  assert.equal(searchQuery(r.search), '?q=poor+law&scope=all&tag=A%2CG&from=1838&sort=year&dir=desc');
  assert.equal(searchQuery(parseRoute('/qub', '').search), '');
  const rec = parseRoute('/qub/991003809249708046', '');
  assert.equal(rec.view, 'record');
  assert.equal(rec.view === 'record' && rec.id, '991003809249708046');
  assert.equal(recordPath('99123'), '/qub/99123');
});

test('views: a result card and the record page link to QUB and escape text', () => {
  const card = resultCard({ mmsId: '99123', title: '<b>x</b>', author: 'A', imprint: 'Dublin', year: 1900, format: 'Book', inScope: true,
    tags: ['C'], url: '/qub/99123', qubUrl: 'https://qub.primo.exlibrisgroup.com/discovery/fulldisplay?docid=alma99123' });
  assert.match(card, /&lt;b&gt;x&lt;\/b&gt;/);
  assert.match(card, /href="https:\/\/qub\.primo\.exlibrisgroup\.com/);
  assert.match(card, /Within Civgraph scope/);
  const page = recordHtml(/** @type {any} */ ({ qubUrl: 'https://qub.primo.exlibrisgroup.com/x', credit: 'Credit text', sharedSource: true,
    item: { mmsId: '99123', title: 'T', author: '', imprint: '', year: null, dateText: '', format: '', language: '', shelfMark: '', subjects: ['S1'],
      inScope: false, tags: [], scopeReason: 'no Irish signal', scopeMethod: 'rules', responsibility: '', uniformTitle: '', variantTitles: [],
      edition: '', extent: '', series: [], notes: [], contents: '', summary: '', contributors: [], isbn: [], issn: [], oclc: [], catalogingSource: '',
      lcClass: '', dewey: '', govDocNumber: '', places: [], holdings: [], online: [] } }));
  assert.match(page, /View this record in QUB Library.s catalogue/);
  assert.match(page, /Credit text/);
  assert.match(page, /shared cataloguing source/);
  assert.match(page, /Outside of Civgraph scope/);
  assert.match(page, /archive\.org\/details\/civgraph-qub-library-catalogue-csv/);
  // a record this app does not hold (outside Civgraph scope) points to QUB and to the full catalogue file
  const missing = recordMissing('991003809249708046');
  assert.match(missing, /Not in this app/);
  assert.ok(missing.includes(qubRecordLink('991003809249708046').replace(/&/g, '&amp;')));
  assert.match(catalogueLinks(), /Full QUB catalogue records \(all 1\.67 million\) on the Internet Archive/);
  assert.equal(qubRecordLink('991003809249708046'), qubRecordUrl('991003809249708046'));
  assert.equal(summaryLine(0, false, 'in'), 'No records match.');
  assert.equal(summaryLine(null, false, 'in'), '');
});

test('state machines: every forbidden move throws', () => {
  for (const machine of [RESULTS, VIEW]) {
    for (const from of machine.states) {
      for (const to of machine.states) {
        if (machine.can(from, to)) machine.assertTransition(from, to);
        else assert.throws(() => machine.assertTransition(from, to), /is not a transition/);
      }
    }
  }
  assert.equal(RESULTS.can('done', 'loading'), false);
  assert.equal(RESULTS.can('failed', 'loading'), false);
});
