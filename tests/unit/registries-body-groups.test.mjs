/**
 * The election-bodies registry's groups (data/registries/election-bodies.json `groups`) against the
 * literals they replaced (refactor survey part 7, rf9-registries, 12 Nov 2026), restated here as the
 * reference: every body slug the data holds, and every election type the map app derives from one,
 * is placed as before.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { REPO_ROOT, loadRegistry } from '../../packages/registries/src/index.mjs';
import { catalogueShelves, partyChartOf, partyCharts } from '../../packages/registries/src/election-bodies.mjs';
import { bodySlugsWithFlag } from '../../packages/registries/src/councils.mjs';
import { groupLabel } from '../../packages/registries/src/browser/body-groups.mjs';
import electionGroups from '../../packages/registries/src/browser/election-groups.mjs';
import { electionTypeFromEntityKey } from '../../packages/map/src/app/helpers.mjs';
import { bodyGroup as homeBodyGroup } from '../../site/apps/elections/views/home.js';

const registry = loadRegistry('election-bodies');
const councils = loadRegistry('councils');

/** Every body slug the data files elections under, the index names, and some that are not bodies. */
const index = JSON.parse(readFileSync(path.join(REPO_ROOT, 'data/elections-source/data/elections_index.json'), 'utf8'));
const SLUGS = [...new Set([
  ...readdirSync(path.join(REPO_ROOT, 'data/elections-source/data/elections')),
  ...index.bodies.map((/** @type {{ slug: string }} */ b) => b.slug),
  ...registry.bodies.map((b) => b.id),
  ...bodySlugsWithFlag(councils, 'pre1973Council'),
  'local-government', 'ni-local-elections', 'irish-local-elections', 'ireland-local', 'seanad-eireann', 'seanad-eireann-panels',
  'northern-ireland-referendum', 'ireland-recall', 'fine-gael-leadership', 'fianna-fail-presidential-nomination',
  'president-of-ireland', 'european-parliament-ireland', 'example-body', ''
])].sort();

test('body groups: the catalogue shelves are the BODY_GROUPS literal they replaced', () => {
  // packages/map/src/catalogue/view-elections.js before 12 Nov 2026 (colours aside: they stay ELECTION_SHELF_COLOURS[id]).
  const pre1973 = bodySlugsWithFlag(councils, 'pre1973Council');
  const before = [
    { id: 'dail', label: 'Dáil', bodies: ['dail-eireann'], icon: 'dail' },
    { id: 'westminster', label: 'Westminster', bodies: ['house-of-commons-of-the-united-kingdom'], icon: 'westminster' },
    { id: 'ni-devolved', label: 'NI Devolved', bodies: ['northern-ireland-assembly', 'parliament-of-northern-ireland', 'northern-ireland-constitutional-convention', 'northern-ireland-forum-for-political-dialogue'], icon: 'ni-devolved' },
    { id: 'ni-local', label: 'NI local', bodies: ['local-government', 'ni-local-elections', ...pre1973], icon: 'ni-local' },
    { id: 'irish-local', label: 'Irish local', bodies: ['ireland-local'], icon: 'irish-local' },
    { id: 'pre-partition-local', label: 'Pre-partition local', bodies: ['irish-local-elections'], icon: 'irish-local' },
    { id: 'european', label: 'European', bodies: ['european-parliament', 'ireland-european'], icon: 'european' },
    { id: 'referendum', label: 'Referendum', bodies: ['ireland-referendum', 'northern-ireland-referendum'], icon: 'referendum' },
    { id: 'presidential', label: 'Presidential', bodies: ['ireland-president'], icon: 'presidential' },
  ].map((g) => ({
    ...g,
    bodies: [...g.bodies, ...registry.bodies.filter((b) => b.shelf === g.id && !g.bodies.includes(b.id)).map((b) => b.id)],
  }));
  assert.equal(JSON.stringify(catalogueShelves(registry, (flag) => bodySlugsWithFlag(councils, flag))), JSON.stringify(before));
  assert.equal(JSON.stringify(electionGroups.shelves), JSON.stringify(before));
  // A shelf's councilFlag is a flag the councils registry gives some council.
  for (const shelf of registry.groups.catalogueShelves) {
    if (shelf.councilFlag) assert.ok(bodySlugsWithFlag(councils, /** @type {Parameters<typeof bodySlugsWithFlag>[1]} */ (shelf.councilFlag)).length > 0, shelf.id);
  }
});

test('body groups: every body is charted in a party profile as before', () => {
  // scripts/build/build-party-profiles.mjs BODY_GROUPS before 12 Nov 2026.
  /** @type {Array<{ id: string, label: string, test: (p: string) => boolean }>} */
  const before = [
    { id: 'westminster', label: 'House of Commons (Westminster)', test: (p) => p === 'house-of-commons-of-the-united-kingdom' },
    { id: 'stormont', label: 'Parliament of Northern Ireland (Stormont)', test: (p) => p === 'parliament-of-northern-ireland' },
    { id: 'ni-assembly', label: 'Northern Ireland Assembly', test: (p) => p === 'northern-ireland-assembly' },
    { id: 'ni-convention', label: 'Northern Ireland Constitutional Convention', test: (p) => p === 'northern-ireland-constitutional-convention' },
    { id: 'ni-forum', label: 'Northern Ireland Forum', test: (p) => p === 'northern-ireland-forum-for-political-dialogue' },
    { id: 'dail', label: 'Dáil Éireann', test: (p) => p === 'dail-eireann' },
    { id: 'seanad', label: 'Seanad Éireann', test: (p) => p.startsWith('seanad') },
    { id: 'european-ni', label: 'European Parliament (Northern Ireland)', test: (p) => p === 'european-parliament' },
    { id: 'european-ie', label: 'European Parliament (Ireland)', test: (p) => p === 'ireland-european' },
    { id: 'councils-ni', label: 'Councils in Northern Ireland', test: (p) => p.startsWith('local-government') || /council/.test(p) },
    { id: 'councils-ie', label: 'Local elections in Ireland', test: (p) => p === 'ireland-local' },
    { id: 'president', label: 'President of Ireland', test: (p) => p === 'ireland-president' },
    ...registry.bodies.filter((body) => body.partyGroup).map((body) => ({ id: /** @type {{ id: string }} */ (body.partyGroup).id, label: /** @type {{ label: string }} */ (body.partyGroup).label, test: (/** @type {string} */ p) => p === body.id })),
  ];
  assert.deepEqual(partyCharts(registry).map(({ id, label }) => ({ id, label })), before.map(({ id, label }) => ({ id, label })));
  assert.equal(partyCharts(registry).find((c) => c.id === 'councils-ni')?.note, 'Before 1973 Civgraph holds the results of only some councils, so these rounds are not comparable with the district council elections from 1973.');
  for (const slug of SLUGS) {
    assert.equal(partyChartOf(registry, slug)?.id ?? null, before.find((g) => g.test(slug))?.id ?? null, slug);
  }
});

test('body groups: the catalogue lists the bodies in the order it did', () => {
  // scripts/build/catalogue/build-catalogue.mjs ELECTION_BODY_ORDER before 12 Nov 2026. Its
  // 'european-parliament-ireland' and 'president-of-ireland' name no body (the bodies are
  // ireland-european and ireland-president), so they never placed anything and are not carried over.
  const before = ['dail-eireann', 'house-of-commons-of-the-united-kingdom', 'northern-ireland-assembly', 'parliament-of-northern-ireland',
    'local-government', 'european-parliament', 'european-parliament-ireland', 'president-of-ireland', 'ireland-referendum', 'ireland-local'];
  /** @param {string[]} order @returns {(a: string, b: string) => number} */
  const by = (order) => (a, b) => {
    const ia = order.indexOf(a); const ib = order.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
  };
  const real = SLUGS.filter((s) => s && !['european-parliament-ireland', 'president-of-ireland'].includes(s));
  assert.deepEqual([...real].sort(by(registry.groups.catalogueOrder)), [...real].sort(by(before)));
  assert.deepEqual(registry.groups.catalogueOrder, before.filter((s) => !['european-parliament-ireland', 'president-of-ireland'].includes(s)));
});

test('body groups: the Elections home page groups every body as before', () => {
  // site/apps/elections/views/home.js bodyGroup and GROUP_ORDER before 12 Nov 2026.
  /** @param {string} slug */
  const before = (slug) => {
    if (/referendum|recall/.test(slug)) return 'Referendums';
    if (/(council|commissioners)/.test(slug)) return 'Northern Ireland councils before 1973';
    if (/^(local-government|ireland-local)/.test(slug)) return 'Local government';
    if (/(leadership|nomination)/.test(slug)) return 'Party contests';
    return 'Parliaments, assemblies and offices';
  };
  for (const slug of SLUGS) {
    assert.equal(groupLabel(electionGroups.electionsHome, slug), before(slug), slug);
    assert.equal(homeBodyGroup(slug), before(slug), `home.js ${slug}`);
  }
  assert.deepEqual(electionGroups.electionsHome.order, ['Parliaments, assemblies and offices', 'Local government', 'Referendums', 'Northern Ireland councils before 1973', 'Party contests']);
});

test('body groups: a person or party history groups every election type as before', () => {
  // packages/map/src/entity-detail-data.mjs bodyGroupOf and BODY_GROUP_ORDER before 12 Nov 2026.
  /** @param {unknown} electionType */
  const before = (electionType) => {
    const t = String(electionType || '');
    if (/D[aá]il/i.test(t)) return 'Dáil';
    if (/Westminster/i.test(t)) return 'Westminster';
    if (/Assembly|Forum|Convention|Parliament of NI/i.test(t)) return 'Devolved';
    if (/Local/i.test(t)) return 'Local';
    if (/European/i.test(t)) return 'European';
    if (/Presidential/i.test(t)) return 'Presidential';
    if (/Referendum/i.test(t)) return 'Referendum';
    return 'Other';
  };
  const types = new Set(['', 'Dáil', 'Dail', 'DÁIL', 'Seanad', 'Mayoral', 'local', 'Election', undefined, null]);
  for (const slug of SLUGS) for (const title of ['', '1998 election', 'Referendum on X']) types.add(electionTypeFromEntityKey(`${slug}__2020-01-01`, title));
  for (const type of types) assert.equal(groupLabel(electionGroups.entityHistory, type), before(type), String(type));
  assert.deepEqual(electionGroups.entityHistory.order, ['Dáil', 'Westminster', 'Devolved', 'Local', 'European', 'Presidential', 'Referendum', 'Other']);
});

test('body groups: the registry refuses a shelf that does not exist and an order that drops a group', async () => {
  const { registryErrors } = await import('../../packages/registries/src/index.mjs');
  const shelfless = structuredClone(registry);
  shelfless.bodies[0].shelf = 'no-such-shelf';
  assert.ok(registryErrors('election-bodies', shelfless).some((e) => e.includes('shelf no-such-shelf')));
  const dropped = structuredClone(registry);
  dropped.groups.electionsHome.order.pop();
  assert.ok(registryErrors('election-bodies', dropped).some((e) => e.includes('groups.electionsHome')));
});
