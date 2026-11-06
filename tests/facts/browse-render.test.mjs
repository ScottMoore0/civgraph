// Browse rendering of the facts model: a person's Offices and Affiliation timeline, an office's
// holders, a party's officers and internal contests. browse/browse.js is a browser script, so it
// is run in a sandbox with an inert document and its render functions called directly.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

function loadBrowse() {
  const handler = {
    get: (target, prop) => {
      if (prop === Symbol.toPrimitive) return () => '';
      if (prop === 'then') return undefined;
      if (prop === 'dataset') return {};
      if (prop === 'length') return 0;
      return inert;
    },
    apply: () => inert,
    construct: () => inert,
    set: () => true,
  };
  const inert = new Proxy(function inertElement() {}, handler);
  const ctx = {
    document: inert,
    location: { hash: '', pathname: '/browse/', search: '', href: 'https://civgraph.net/browse/' },
    history: { replaceState() {}, pushState() {} },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    fetch: () => Promise.reject(new Error('no network in tests')),
    console: { log() {}, warn() {}, error() {}, info() {} },
    setTimeout, clearTimeout, URL, URLSearchParams,
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    navigator: {}, requestAnimationFrame: () => 0, performance: { now: () => 0 },
    IntersectionObserver: class { observe() {} }, ResizeObserver: class { observe() {} }, MutationObserver: class { observe() {} },
    CustomEvent: class {}, Event: class {},
  };
  ctx.window = ctx;
  ctx.self = ctx;
  vm.createContext(ctx);
  vm.runInContext(readFileSync('browse/browse.js', 'utf8'), ctx, { filename: 'browse.js' });
  return (name) => vm.runInContext(name, ctx);
}

const fn = loadBrowse();
const cite = [{ title: 'Elliott and Flackes (1999), Dictionary, p. 469' }];

test('Offices is a type Browse lists and opens', () => {
  const config = fn('ENTITY_CONFIG').offices;
  assert.equal(config.index, 'offices.json');
  assert.equal(config.detailDir, 'offices');
});

test('a person page shows offices, linked, with how the tenure began and the contest', () => {
  const html = fn('renderPersonOfficesPanel')({
    offices: [{ officeSlug: 'uup-leader', office: 'Leader, Ulster Unionist Party', institution: 'Ulster Unionist Party', held: 'from 8 September 1995', began: 'elected', contestKey: 'uup-leadership__1995-09-08', citations: cite }],
  });
  assert.match(html, /<h2>Offices<\/h2>/);
  assert.match(html, /href="#\/offices\/uup-leader"/);
  assert.match(html, /from 8 September 1995/);
  assert.match(html, /elected \(<a href="#\/elections\/uup-leadership-1995-09-08"/);
  assert.match(html, /title="Elliott and Flackes \(1999\), Dictionary, p\. 469"/);
  assert.equal(fn('renderPersonOfficesPanel')({}), '');
});

test('the affiliation timeline shows both the affiliation and a differing candidacy label', () => {
  const html = fn('renderAffiliationTimelinePanel')({
    affiliationTimeline: [
      { kind: 'party', party: 'Ulster Unionist Party', partySlug: 'uup', end: '1974-01-04', endEvent: 'defected-to', citations: cite },
      { kind: 'party', party: 'Unionist Party of Northern Ireland', partySlug: 'unionist-party-of-northern-ireland', start: '1974-01-04', startEvent: 'joined', citations: cite,
        otherLabels: [{ key: 'northern-ireland-assembly__1973-06-28', title: '1973 Northern Ireland Assembly election', label: 'UUP' }] },
    ],
  });
  assert.match(html, /<h2>Affiliation timeline<\/h2>/);
  assert.match(html, /start not recorded; until 4 Jan 1974 \(left for another party\)/);
  assert.match(html, /from 4 Jan 1974 \(joined\); no end recorded/);
  assert.match(html, /Stood under another label in this period:.*\(UUP\)/s);
  assert.match(html, /browse-affiliation-timeline__item--party/);
});

test('an office page lists its holders, linked to their person pages', () => {
  const html = fn('renderRelatedPanel')('offices', {
    holders: [
      { personSlug: 'peter-brooke-900001', name: 'Peter Brooke', held: 'July 1989 – April 1992', citations: cite },
      { name: 'Unlinked Holder', held: 'from 1992', ended: 'resigned' },
    ],
    nameHistory: [{ name: 'Mayor of Londonderry', note: 'the title the book also uses' }],
    sources: [{ title: 'Elliott and Flackes (1999), Office Holders 1968-99' }],
  });
  assert.match(html, /<h2>Holders<\/h2>/);
  assert.match(html, /href="#\/persons\/peter-brooke-900001"/);
  assert.match(html, /Unlinked Holder/);
  assert.match(html, /resigned/);
  assert.match(html, /Other names/);
  assert.match(html, /Sources for this office/);
});

test('a party page shows officers and internal contests', () => {
  const profile = {
    officers: [{ office: 'Leader, Ulster Unionist Party', officeSlug: 'uup-leader', personSlug: 'david-trimble-84615', name: 'David Trimble', held: 'from 8 September 1995', began: 'elected', contestKey: 'uup-leadership__1995-09-08', citations: cite }],
    internalContests: [{ key: 'uup-leadership__1995-09-08', title: 'September 1995 Ulster Unionist Party leadership election',
      ballots: [{ name: 'Ulster Unionist Council', candidates: [{ personSlug: 'david-trimble-84615', name: 'David Trimble', votes: 466, elected: true }, { name: 'Ken Maginnis' }] }] }],
  };
  const officers = fn('renderPartyOfficersPanel')(profile);
  assert.match(officers, /<h2>Leaders and officers<\/h2>/);
  assert.match(officers, /href="#\/persons\/david-trimble-84615"/);
  const contests = fn('renderPartyInternalContestsPanel')(profile);
  assert.match(contests, /<h2>Internal contests<\/h2>/);
  assert.match(contests, /466/);
  assert.match(contests, /not recorded/);
  assert.match(contests, /href="#\/elections\/uup-leadership-1995-09-08"/);
  assert.equal(fn('renderPartyInternalContestsPanel')({}), '');
});
