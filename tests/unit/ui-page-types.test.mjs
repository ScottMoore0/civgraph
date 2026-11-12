/**
 * REG-7: the page-types registry (packages/ui/src/page-types.mjs) is the one declaration of the
 * record types with a page of their own. Each reader derives what it held as a literal before
 * 12 Nov 2026; the literals are restated here, so the derived values are held to them.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { PAGE_TYPES, PAGE_TYPE_IDS, pageType, recordPagePath } from '../../packages/ui/src/page-types.mjs';
import { SSR_RECORD_TYPES } from '../../packages/ui/src/templates/records/index.js';
import { personBody } from '../../packages/ui/src/templates/records/person.js';
import { sourceBody } from '../../packages/ui/src/templates/records/source.js';
import { registerInterestBody } from '../../packages/ui/src/templates/records/register-interest.js';
import { electionBody } from '../../packages/ui/src/templates/records/election.js';
import { partyBody } from '../../packages/ui/src/templates/records/party.js';
import { BROWSE_PAGE_TYPES } from '../../functions/_browse-page.js';
import { BROWSE_SITEMAP_TYPES } from '../../scripts/build/build-sitemap.mjs';

const ROOT = path.resolve(import.meta.dirname, '../..');

test('page types: BROWSE_PAGE_TYPES is the literal it replaced, key for key and in order', () => {
  const before = {
    persons: { singular: 'Person', table: 'person_cards', aliasTable: 'person_aliases' },
    sources: { singular: 'Source', table: 'sources', aliasTable: 'source_aliases' },
    'register-interests': { singular: 'Register interest', table: 'register_entries', aliasTable: 'register_entries_aliases' },
    elections: { singular: 'Election' },
    maps: { singular: 'Map' },
    parties: { singular: 'Party / label' },
    offices: { singular: 'Office' },
  };
  assert.equal(JSON.stringify(BROWSE_PAGE_TYPES), JSON.stringify(before));
  assert.deepEqual(PAGE_TYPE_IDS, Object.keys(before));
});

test('page types: SSR_RECORD_TYPES is the literal it replaced', () => {
  const before = {
    persons: { body: personBody, crumb: 'People', listHash: '#/persons' },
    sources: { body: sourceBody, crumb: 'Sources', listHash: '#/sources' },
    'register-interests': { body: registerInterestBody, crumb: 'Register of interests', listHash: '#/register-interests' },
    elections: { body: electionBody, crumb: 'Elections', listHash: '#/elections' },
    parties: { body: partyBody, crumb: 'Parties', listHash: '#/parties' },
  };
  assert.deepEqual(Object.keys(SSR_RECORD_TYPES), Object.keys(before));
  for (const [type, config] of Object.entries(before)) {
    assert.equal(SSR_RECORD_TYPES[type].body, config.body, `${type}: body`);
    assert.equal(SSR_RECORD_TYPES[type].crumb, config.crumb, `${type}: crumb`);
    assert.equal(SSR_RECORD_TYPES[type].listHash, config.listHash, `${type}: list`);
  }
});

test('page types: the sitemap and Browse list the same types as before', () => {
  assert.deepEqual(BROWSE_SITEMAP_TYPES, ['elections', 'maps', 'offices', 'parties', 'persons', 'register-interests', 'sources']);
  const browse = readFileSync(path.join(ROOT, 'site/browse/browse.js'), 'utf8');
  assert.ok(browse.includes("import { PAGE_TYPE_IDS } from '../pkg/ui/src/page-types.mjs';"));
  assert.ok(browse.includes('const PATH_ROUTE_TYPES = new Set(PAGE_TYPE_IDS);'));
  assert.deepEqual(new Set(PAGE_TYPE_IDS), new Set(['elections', 'maps', 'offices', 'parties', 'persons', 'register-interests', 'sources']));
});

test('page types: the map app links a record to its page as before', () => {
  assert.equal(recordPagePath('persons', 'gerry-adams-27771'), '/browse/persons/gerry-adams-27771');
  assert.equal(recordPagePath('persons', 'a b/c'), `/browse/persons/${encodeURIComponent('a b/c')}`);
  // ui-controller buildCatalogueSearchBrowseUrl's kinds (elections, parties, persons, sources) all
  // have a page: '/browse/' + kind + '/' + slug, as its pathByKind table gave.
  for (const kind of ['elections', 'parties', 'persons', 'sources']) {
    assert.ok(pageType(kind), kind);
    assert.equal(recordPagePath(kind, 'x y'), `/browse/${kind}/x%20y`);
  }
  assert.equal(pageType('features'), null);
  assert.ok(PAGE_TYPES.every((type) => Object.isFrozen(type)));
});
