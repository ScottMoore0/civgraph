// Link health (link review fixes, 24 Nov 2026): derived Wikipedia titles are linked only when the
// article exists; a dead citation link shows its archived copy first; the dead-link list prefers
// Civgraph's own mirror and never links a mirrored document that may carry home addresses.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  citationLinkOrder, deadLinkStatus, isOwnMirror, verifiedArticleUrl, wikipediaReferenceUrl, withLinkHealth,
} from '@civgraph/core/link-health.mjs';
import { deadLinks, linkKey, mirrorIndex } from '../../scripts/build/build-dead-links.mjs';

const ORIGIN = 'https://data.civgraph.net';
const WIKI = 'https://en.wikipedia.org/wiki/';

test('a derived Wikipedia title is linked only when the article was confirmed to exist', () => {
  const articles = {
    [`${WIKI}1920_Antrim_County_Council_election`]: null,
    [`${WIKI}1920_Londonderry_County_Borough_Council_election`]: `${WIKI}1920_Londonderry_Borough_Council_election`,
  };
  assert.equal(verifiedArticleUrl(`${WIKI}1920_Antrim_County_Council_election`, articles), `${WIKI}1920_Antrim_County_Council_election`);
  // a redirect: the article it leads to
  assert.equal(verifiedArticleUrl(`${WIKI}1920_Londonderry_County_Borough_Council_election`, articles), `${WIKI}1920_Londonderry_Borough_Council_election`);
  // a guess that names a missing page (the 1,586 of the review) is not linked
  assert.equal(verifiedArticleUrl(`${WIKI}1899_Aghalee_Rural_District_Council_election`, articles), null);
  assert.equal(verifiedArticleUrl(null, articles), null);
  // an inherited name is not an article
  assert.equal(verifiedArticleUrl('toString', articles), null);
});

test('the Wikipedia reference: resolved first, then a verified derived title, never a guess', () => {
  const articles = { [`${WIKI}1922_Seanad_election`]: null };
  assert.equal(wikipediaReferenceUrl(`${WIKI}2024_Irish_general_election`, `${WIKI}Anything`, articles), `${WIKI}2024_Irish_general_election`);
  assert.equal(wikipediaReferenceUrl(null, `${WIKI}1922_Seanad_election`, articles), `${WIKI}1922_Seanad_election`);
  assert.equal(wikipediaReferenceUrl(null, `${WIKI}1801_United_Kingdom_general_election_in_Northern_Ireland`, articles), null);
  assert.equal(wikipediaReferenceUrl(null, `${WIKI}Antrim_E_(UK_Parliament_constituency)`, articles), null);
  // a referendum's own first source is not a Wikipedia article: kept
  assert.equal(wikipediaReferenceUrl(null, 'https://www.electoralcommission.ie/referendum-results', articles), 'https://www.electoralcommission.ie/referendum-results');
  assert.equal(wikipediaReferenceUrl(null, null, articles), null);
});

test('the shipped verified-articles list holds none of the review\'s missing pages', () => {
  const doc = JSON.parse(readFileSync(new URL('../../data/elections/wikipedia-verified-articles.json', import.meta.url), 'utf8'));
  for (const missing of ['1899_Aghalee_Rural_District_Council_election', '1801_United_Kingdom_general_election_in_Northern_Ireland', 'Antrim_E_(UK_Parliament_constituency)']) {
    assert.equal(Object.hasOwn(doc.articles, `${WIKI}${missing}`), false, missing);
  }
  for (const [url, to] of Object.entries(doc.articles)) {
    assert.match(url, /^https:\/\/en\.wikipedia\.org\/wiki\//);
    assert.ok(to === null || /^https:\/\/en\.wikipedia\.org\/wiki\//.test(to), url);
  }
});

test('a dead citation link carries its archived copy: own mirror first, then the citation\'s, then the list\'s', () => {
  const dead = {
    'http://www.eoni.org.uk/a': `${ORIGIN}/data/sources/eoni-result-sheets/2011-local/a.pdf`,
    'http://www.eoni.org.uk/b': 'https://web.archive.org/web/2020/http://www.eoni.org.uk/b',
    'http://example.org/gone': null,
  };
  assert.deepEqual(deadLinkStatus('http://example.org/gone', dead), { dead: true, archive: null });
  assert.deepEqual(deadLinkStatus('http://example.org/fine', dead), { dead: false, archive: null });
  assert.equal(isOwnMirror(dead['http://www.eoni.org.uk/a'], ORIGIN), true);
  assert.equal(isOwnMirror('https://data.civgraph.network/x', ORIGIN), false);

  const fine = { url: 'http://example.org/fine', archiveUrl: null };
  assert.equal(withLinkHealth(fine, dead, ORIGIN), fine, 'a working link is returned unchanged');
  // own mirror beats an Internet Archive capture the citation already carries
  assert.deepEqual(withLinkHealth({ url: 'http://www.eoni.org.uk/a', archiveUrl: 'https://web.archive.org/web/1/x' }, dead, ORIGIN),
    { url: 'http://www.eoni.org.uk/a', archiveUrl: dead['http://www.eoni.org.uk/a'], urlDead: true });
  // the citation's own archive copy beats the list's capture
  assert.equal(withLinkHealth({ url: 'http://www.eoni.org.uk/b', archiveUrl: 'https://web.archive.org/web/1/b' }, dead, ORIGIN).archiveUrl, 'https://web.archive.org/web/1/b');
  // no archive anywhere: still marked dead
  assert.deepEqual(withLinkHealth({ url: 'http://example.org/gone', archiveUrl: null }, dead, ORIGIN), { url: 'http://example.org/gone', archiveUrl: null, urlDead: true });
});

test('which address a citation shows first', () => {
  assert.deepEqual(citationLinkOrder({ url: 'https://a', archiveUrl: 'https://arch' }), { main: 'https://a', mainIsArchive: false, archive: 'https://arch', deadOriginal: null });
  assert.deepEqual(citationLinkOrder({ url: 'https://a', archiveUrl: 'https://arch', urlDead: 1 }), { main: 'https://arch', mainIsArchive: true, archive: null, deadOriginal: 'https://a' });
  assert.deepEqual(citationLinkOrder({ url: 'https://a', archiveUrl: null, urlDead: true }), { main: null, mainIsArchive: false, archive: null, deadOriginal: 'https://a' });
  assert.deepEqual(citationLinkOrder({ url: null, archiveUrl: 'https://arch' }), { main: 'https://arch', mainIsArchive: true, archive: null, deadOriginal: null });
  assert.deepEqual(citationLinkOrder({ url: 'https://a', archiveUrl: 'https://a' }), { main: 'https://a', mainIsArchive: false, archive: null, deadOriginal: null });
  assert.deepEqual(citationLinkOrder({}), { main: null, mainIsArchive: false, archive: null, deadOriginal: null });
});

test('the dead-link list: severity, moves, links fixed at source, own addresses, mirror matching', () => {
  const prefix = 'data/sources/eoni-result-sheets/';
  const manifest = [
    { key: '2011-local/result_sheet_-_ballymoney.pdf', sourceUrl: 'http://www.eoni.org.uk/getattachment/Elections/x/result_sheet_-_ballymoney.pdf' },
    { key: '2015-misc/sheet.pdf', sourceUrl: 'https://www.eoni.org.uk/getmedia/0f0e0d0c-0b0a-0908-0706-050403020100/sheet' },
    { key: '2011-assembly/Statement-of-Persons-Nominated-East.pdf', sourceUrl: 'http://www.eoni.org.uk/getmedia/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/SOPN' },
    { key: '2016-local/unpublished.pdf', sourceUrl: 'http://www.eoni.org.uk/unpublished' },
  ];
  const published = new Set(manifest.filter((m) => !m.key.includes('unpublished')).map((m) => `${prefix}${m.key}`));
  const mirror = mirrorIndex(prefix, manifest, published);
  const rows = [
    { severity: 'high', outcome: 'soft-404', url: 'https://www.eoni.org.uk/getattachment/Elections/x/result_sheet_-_ballymoney', wayback_snapshot: 'https://web.archive.org/web/1/x' },
    { severity: 'high', outcome: 'broken', url: 'http://www.eoni.org.uk/getmedia/0F0E0D0C-0B0A-0908-0706-050403020100/other-name', wayback_snapshot: 'none' },
    { severity: 'high', outcome: 'broken', url: 'http://www.eoni.org.uk/getmedia/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/SOPN', wayback_snapshot: 'https://web.archive.org/web/2/sopn' },
    { severity: 'high', outcome: 'broken', url: 'http://www.eoni.org.uk/unpublished', wayback_snapshot: '' },
    { severity: 'medium', outcome: 'broken', url: 'http://example.org/gone', wayback_snapshot: 'https://web.archive.org/web/3/gone' },
    { severity: 'low', outcome: 'redirect-moved', url: 'http://example.org/moved', wayback_snapshot: '' },
    { severity: 'high', outcome: 'redirect-moved', url: 'http://example.org/moved-high', wayback_snapshot: '' },
    { severity: 'recheck', outcome: 'timeout', url: 'http://example.org/slow', wayback_snapshot: '' },
    { severity: 'high', outcome: 'broken', url: `${WIKI}1899_Aghalee_Rural_District_Council_election`, wayback_snapshot: '' },
    { severity: 'high', outcome: 'soft-404', url: 'https://aims.niassembly.gov.uk/mlas/details.aspx?per=1', wayback_snapshot: '' },
    { severity: 'high', outcome: 'soft-404', url: 'https://electionsireland.org/result.cfm?election=1974L&cons=10', wayback_snapshot: '' },
    { severity: 'high', outcome: 'broken', url: `${ORIGIN}/data/maps/x.csv`, wayback_snapshot: '' },
  ];
  assert.deepEqual(deadLinks(rows, [mirror]), {
    'http://example.org/gone': 'https://web.archive.org/web/3/gone',
    'http://www.eoni.org.uk/getmedia/0F0E0D0C-0B0A-0908-0706-050403020100/other-name': `${ORIGIN}/${prefix}2015-misc/sheet.pdf`,
    // a nomination statement is never linked from the mirror: the capture instead
    'http://www.eoni.org.uk/getmedia/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/SOPN': 'https://web.archive.org/web/2/sopn',
    // not published on the data origin: no mirror
    'http://www.eoni.org.uk/unpublished': null,
    'https://www.eoni.org.uk/getattachment/Elections/x/result_sheet_-_ballymoney': `${ORIGIN}/${prefix}2011-local/result_sheet_-_ballymoney.pdf`,
  });
  assert.equal(linkKey('HTTPS://www.Example.org/A%20B.pdf/'), 'example.org/a b');
});
